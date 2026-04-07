/**
 * Integration tests — ImportExportService backup/restore.
 *
 * Covers:
 *   - export produces an encrypted Blob
 *   - export excludes protected stores (sessions, auditLogs)
 *   - blank passphrase throws on export
 *   - previewImport decrypts correctly and returns diff
 *   - wrong passphrase on preview throws
 *   - previewImport with invalid JSON throws
 *   - schema version mismatch throws
 *   - applyImport round-trip restores exportable data
 *   - RBAC: non-administrator cannot export or import
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { ImportExportService } from '../../src/services/ImportExportService.js';
import { masterDataService } from '../../src/services/MasterDataService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { generateSalt, deriveKey } from '../../src/infrastructure/crypto/webCrypto.js';
import { ROLES, MASTER_DATA_ENTITY_TYPES } from '../../src/utils/constants.js';
import { PROTECTED_STORES, DB_VERSION } from '../../src/infrastructure/db/schema.js';

const ADMIN = { id: 'admin-001', role: ROLES.ADMINISTRATOR, organizationNodeId: 'org-001' };
const ORG_ID = 'org-001';
const PASSPHRASE = 'MyBackup12345!';

async function unlockCrypto() {
  const salt = generateSalt();
  const key = await deriveKey('TestPass1!', salt);
  cryptoService._sessionKey = key;
}

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = ADMIN;
  await unlockCrypto();
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
});

// ── Export ────────────────────────────────────────────────────────────────────

describe('Export backup', () => {
  it('produces an encrypted Blob', async () => {
    const svc = new ImportExportService();
    const blob = await svc.exportBackup({ actorId: 'admin-001', backupPassphrase: PASSPHRASE });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('exported JSON contains encryption envelope fields', async () => {
    const svc = new ImportExportService();
    const blob = await svc.exportBackup({ actorId: 'admin-001', backupPassphrase: PASSPHRASE });
    const ab = await blob.arrayBuffer();
    const parsed = JSON.parse(new TextDecoder().decode(ab));

    expect(parsed).toHaveProperty('saltHex');
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('ciphertext');
    expect(parsed).toHaveProperty('version');
  });

  it('rejects blank passphrase', async () => {
    const svc = new ImportExportService();
    await expect(
      svc.exportBackup({ actorId: 'admin-001', backupPassphrase: '   ' }),
    ).rejects.toThrow('passphrase');
  });

  it('protected stores are excluded from the export envelope', async () => {
    // Seed some master data so the export is non-trivial
    await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.COLOR,
      entityId: 'color-red',
      organizationId: ORG_ID,
      payload: { name: 'Red' },
      reasonNote: 'Red color for export test',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    const svc = new ImportExportService();
    const blob = await svc.exportBackup({ actorId: 'admin-001', backupPassphrase: PASSPHRASE });

    const { snapshot } = await svc.previewImport({
      file: new File([blob], 'backup.json', { type: 'application/json' }),
      backupPassphrase: PASSPHRASE,
    });

    for (const store of PROTECTED_STORES) {
      expect(snapshot).not.toHaveProperty(store);
    }
  });
});

// ── Preview import ────────────────────────────────────────────────────────────

describe('Preview import', () => {
  it('decrypts and returns diff and snapshot', async () => {
    const svc = new ImportExportService();
    const blob = await svc.exportBackup({ actorId: 'admin-001', backupPassphrase: PASSPHRASE });
    const file = new File([blob], 'backup.json', { type: 'application/json' });

    const { diff, snapshot, schemaVersion } = await svc.previewImport({
      file,
      backupPassphrase: PASSPHRASE,
    });

    expect(diff).toBeDefined();
    expect(Array.isArray(diff)).toBe(true);
    expect(snapshot).toBeDefined();
    expect(typeof schemaVersion).toBe('number');
  });

  it('wrong passphrase throws decryption error', async () => {
    const svc = new ImportExportService();
    const blob = await svc.exportBackup({ actorId: 'admin-001', backupPassphrase: PASSPHRASE });
    const file = new File([blob], 'backup.json', { type: 'application/json' });

    await expect(
      svc.previewImport({ file, backupPassphrase: 'WrongPass99!' }),
    ).rejects.toThrow(/decrypt|passphrase/i);
  });

  it('non-JSON file throws parse error', async () => {
    const svc = new ImportExportService();
    const file = new File(['not json at all'], 'backup.json', { type: 'application/json' });

    await expect(
      svc.previewImport({ file, backupPassphrase: PASSPHRASE }),
    ).rejects.toThrow(/JSON/i);
  });

  it('null file throws', async () => {
    const svc = new ImportExportService();
    await expect(
      svc.previewImport({ file: null, backupPassphrase: PASSPHRASE }),
    ).rejects.toThrow(/file/i);
  });
});

// ── Schema version check ──────────────────────────────────────────────────────

describe('Schema version validation', () => {
  it('throws on mismatched schema version', () => {
    const svc = new ImportExportService();
    expect(() => svc.validateSchemaVersion(999)).toThrow(/mismatch|migration/i);
  });

  it('accepts current DB_VERSION', () => {
    const svc = new ImportExportService();
    expect(() => svc.validateSchemaVersion(DB_VERSION)).not.toThrow();
  });
});

// ── Round-trip: export → applyImport ─────────────────────────────────────────

describe('Export → applyImport round-trip', () => {
  it('restores master data records after applyImport', async () => {
    // Seed data
    await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.SIZE,
      entityId: 'size-m',
      organizationId: ORG_ID,
      payload: { label: 'Medium', code: 'M' },
      reasonNote: 'Medium size variant for roundtrip',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    const svc = new ImportExportService();
    const blob = await svc.exportBackup({ actorId: 'admin-001', backupPassphrase: PASSPHRASE });
    const file = new File([blob], 'backup.json', { type: 'application/json' });

    const { snapshot, schemaVersion } = await svc.previewImport({ file, backupPassphrase: PASSPHRASE });

    // Apply the import — must pass schemaVersion for validation.
    // Import now forces logout — re-auth is required.
    await svc.applyImport({ snapshot, schemaVersion, actorId: 'admin-001' });

    // Re-authenticate after import (import forces logout).
    authService._currentUser = ADMIN;

    // Verify restored data is still accessible
    const active = await masterDataService.getActiveVersion(MASTER_DATA_ENTITY_TYPES.SIZE, ORG_ID);
    expect(active).not.toBeNull();
    expect(active.payload.label).toBe('Medium');
  });
});

// ── applyImport schema validation ─────────────────────────────────────────────

describe('applyImport schema validation', () => {
  it('rejects applyImport without schemaVersion', async () => {
    const svc = new ImportExportService();
    await expect(
      svc.applyImport({ snapshot: {}, actorId: 'admin-001' }),
    ).rejects.toThrow(/schema version is required/i);
  });

  it('rejects applyImport with mismatched schemaVersion', async () => {
    const svc = new ImportExportService();
    await expect(
      svc.applyImport({ snapshot: {}, schemaVersion: 9999, actorId: 'admin-001' }),
    ).rejects.toThrow(/mismatch|migration/i);
  });

  it('accepts applyImport with current DB_VERSION', async () => {
    const svc = new ImportExportService();
    // Empty snapshot — should not throw on schema version check.
    await expect(
      svc.applyImport({ snapshot: {}, schemaVersion: DB_VERSION, actorId: 'admin-001' }),
    ).resolves.toBeUndefined();
  });
});

// ── RBAC ──────────────────────────────────────────────────────────────────────

describe('ImportExport RBAC', () => {
  it('ANALYST cannot export', async () => {
    authService._currentUser = { id: 'analyst-001', role: ROLES.ANALYST, organizationNodeId: ORG_ID };
    const svc = new ImportExportService();
    await expect(
      svc.exportBackup({ actorId: 'analyst-001', backupPassphrase: PASSPHRASE }),
    ).rejects.toThrow(/Permission denied/i);
  });

  it('STORE_MANAGER cannot import', async () => {
    authService._currentUser = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_ID };
    const svc = new ImportExportService();
    await expect(
      svc.applyImport({ snapshot: {}, actorId: 'mgr-001' }),
    ).rejects.toThrow(/Permission denied/i);
  });

  it('REVIEWER cannot preview import', async () => {
    authService._currentUser = { id: 'rev-001', role: ROLES.REVIEWER, organizationNodeId: ORG_ID };
    const svc = new ImportExportService();
    const file = new File(['{}'], 'x.json');
    await expect(
      svc.previewImport({ file, backupPassphrase: PASSPHRASE }),
    ).rejects.toThrow(/Permission denied/i);
  });
});
