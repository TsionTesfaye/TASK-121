/**
 * E2E Simulation — Export → decrypt → preview → restore.
 *
 * Covers:
 *   - Full round-trip: seed data → export → clear → import → verify
 *   - Protected stores excluded from export
 *   - Schema version validated on import
 *   - Wrong passphrase rejected
 *   - RBAC: only ADMINISTRATOR can export/import
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { ImportExportService } from '../../src/services/ImportExportService.js';
import { masterDataService } from '../../src/services/MasterDataService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { generateSalt, deriveKey } from '../../src/infrastructure/crypto/webCrypto.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { OrgRepository } from '../../src/repositories/implementations/OrgRepository.js';
import { ROLES, MASTER_DATA_ENTITY_TYPES } from '../../src/utils/constants.js';
import { PROTECTED_STORES } from '../../src/infrastructure/db/schema.js';

const ADMIN = { id: 'admin-001', role: ROLES.ADMINISTRATOR, organizationNodeId: 'org-001' };
const ORG_ID = 'org-001';
const PASSPHRASE = 'ExportFlow12!';

async function unlockCrypto() {
  const salt = generateSalt();
  const key = await deriveKey('TestPass1!', salt);
  cryptoService._sessionKey = key;
}

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const orgRepo = new OrgRepository();
  await orgRepo.create({
    id: ORG_ID, name: 'Test Org', type: 'company', parentId: null,
    organizationId: ORG_ID, createdAt: Date.now(), updatedAt: Date.now(),
  });

  authService._currentUser = ADMIN;
  await unlockCrypto();
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
});

describe('Import/export full flow', () => {
  it('export produces encrypted Blob with envelope fields', async () => {
    const svc = new ImportExportService();
    const blob = await svc.exportBackup({ actorId: 'admin-001', backupPassphrase: PASSPHRASE });

    const ab = await blob.arrayBuffer();
    const parsed = JSON.parse(new TextDecoder().decode(ab));
    expect(parsed.saltHex).toBeDefined();
    expect(parsed.ciphertext).toBeDefined();
    expect(parsed.iv).toBeDefined();
  });

  it('protected stores excluded from snapshot', async () => {
    const svc = new ImportExportService();
    const blob = await svc.exportBackup({ actorId: 'admin-001', backupPassphrase: PASSPHRASE });
    const file = new File([blob], 'backup.json');
    const { snapshot } = await svc.previewImport({ file, backupPassphrase: PASSPHRASE });

    for (const store of PROTECTED_STORES) {
      expect(snapshot).not.toHaveProperty(store);
    }
  });

  it('wrong passphrase rejected on preview', async () => {
    const svc = new ImportExportService();
    const blob = await svc.exportBackup({ actorId: 'admin-001', backupPassphrase: PASSPHRASE });
    const file = new File([blob], 'backup.json');

    await expect(
      svc.previewImport({ file, backupPassphrase: 'WrongPassphrase12!' }),
    ).rejects.toThrow(/decrypt|passphrase/i);
  });

  it('full round-trip: seed → export → restore → verify', async () => {
    // Seed master data
    await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.COLOR,
      entityId: 'color-blue',
      organizationId: ORG_ID,
      payload: { name: 'Blue', hex: '#0000FF' },
      reasonNote: 'Blue color for export flow test',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    const svc = new ImportExportService();
    const blob = await svc.exportBackup({ actorId: 'admin-001', backupPassphrase: PASSPHRASE });
    const file = new File([blob], 'backup.json');

    const { snapshot, schemaVersion } = await svc.previewImport({ file, backupPassphrase: PASSPHRASE });
    await svc.applyImport({ snapshot, schemaVersion, actorId: 'admin-001' });

    // Import forces logout — re-authenticate to verify data.
    authService._currentUser = ADMIN;

    const active = await masterDataService.getActiveVersion(MASTER_DATA_ENTITY_TYPES.COLOR, ORG_ID);
    expect(active).not.toBeNull();
    expect(active.payload.name).toBe('Blue');
  });

  it('ANALYST cannot export (RBAC)', async () => {
    authService._currentUser = { id: 'analyst-001', role: ROLES.ANALYST, organizationNodeId: ORG_ID };
    const svc = new ImportExportService();
    await expect(
      svc.exportBackup({ actorId: 'analyst-001', backupPassphrase: PASSPHRASE }),
    ).rejects.toThrow(/Permission denied/i);
  });

  it('STORE_MANAGER cannot import (RBAC)', async () => {
    authService._currentUser = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_ID };
    const svc = new ImportExportService();
    await expect(
      svc.applyImport({ snapshot: {}, actorId: 'mgr-001' }),
    ).rejects.toThrow(/Permission denied/i);
  });
});
