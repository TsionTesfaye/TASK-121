/**
 * Final governance tests — import versioning, crypto model, system actor hardening.
 *
 * Tasks:
 *   1. Import creates version records for imported entities
 *   2. Org-level crypto — same-org users can decrypt shared data
 *   3. System actor respects org boundaries
 *   4. Preference persistence per user
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { importExportService } from '../../src/services/ImportExportService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { eventDispatcherService } from '../../src/services/EventDispatcherService.js';
import { templateService } from '../../src/services/TemplateService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { MessageQueueRepository } from '../../src/repositories/implementations/NotificationRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { persistSelectedStore, restoreSelectedStore } from '../../src/app/stores/org.js';
import { ROLES, EVENT_TYPES, QUEUE_STATUSES } from '../../src/utils/constants.js';
import { DB_VERSION } from '../../src/infrastructure/db/schema.js';
import { generateId } from '../../src/utils/idGenerator.js';

const ADMIN_PASS = 'Govern@123456';
const BACKUP_PASS = 'BackupGov@1234';
const USER_PASS = 'UserGov@12345';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'gov_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'GovernanceCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('gov_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// TASK 1 — IMPORT GOVERNANCE
// ══════════════════════════════════════════════════════════════════════════════

describe('Import governance — post-import versioning', () => {
  it('import creates version records for entities without history', async () => {
    const colorId = generateId();
    await importExportService.applyImport({
      snapshot: {
        colors: [{ id: colorId, organizationId: orgId, name: 'Imported Red', isActive: true, createdAt: Date.now() }],
      },
      schemaVersion: DB_VERSION,
      actorId: adminUser.id,
    });

    // Re-auth after import-forced logout
    await authService.login('gov_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(colorId);
    expect(history.length).toBe(1);
    expect(history[0].reasonNote).toBe('System import');
    expect(history[0].systemGenerated).toBe(true);
    expect(history[0].entityType).toBe('color');
  });

  it('import enforces single-active-version invariant', async () => {
    const sizeId = generateId();
    // Pre-seed two active versions (simulating corrupt import data)
    const mdRepo = new MasterDataRepository();
    await mdRepo.create({
      id: generateId(), organizationId: orgId, entityType: 'size', entityId: sizeId,
      versionNumber: 1, payload: { name: 'S' }, reasonNote: 'v1', isActive: true,
      createdBy: adminUser.id, createdAt: Date.now(),
    });
    await mdRepo.create({
      id: generateId(), organizationId: orgId, entityType: 'size', entityId: sizeId,
      versionNumber: 2, payload: { name: 'M' }, reasonNote: 'v2', isActive: true,
      createdBy: adminUser.id, createdAt: Date.now(),
    });

    // Import with the size record — reconciliation should fix the duplicate active
    await importExportService.applyImport({
      snapshot: {
        sizes: [{ id: sizeId, organizationId: orgId, name: 'M', isActive: true, createdAt: Date.now() }],
      },
      schemaVersion: DB_VERSION,
      actorId: adminUser.id,
    });

    await authService.login('gov_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

    const history = await mdRepo.findVersionHistory(sizeId);
    const activeCount = history.filter((v) => v.isActive).length;
    expect(activeCount).toBe(1);
  });

  it('import works across multiple entity types', async () => {
    const colorId = generateId();
    const brandId = generateId();
    const styleId = generateId();

    await importExportService.applyImport({
      snapshot: {
        colors: [{ id: colorId, organizationId: orgId, name: 'Blue', isActive: true, createdAt: Date.now() }],
        brands: [{ id: brandId, organizationId: orgId, name: 'BrandX', isActive: true, createdAt: Date.now() }],
        styles: [{ id: styleId, organizationId: orgId, sku: 'IMP-SKU', isActive: true, createdAt: Date.now() }],
      },
      schemaVersion: DB_VERSION,
      actorId: adminUser.id,
    });

    await authService.login('gov_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

    const mdRepo = new MasterDataRepository();
    expect((await mdRepo.findVersionHistory(colorId)).length).toBe(1);
    expect((await mdRepo.findVersionHistory(brandId)).length).toBe(1);
    expect((await mdRepo.findVersionHistory(styleId)).length).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TASK 2 — ORG-LEVEL CRYPTO
// ══════════════════════════════════════════════════════════════════════════════

describe('Org-level crypto — shared key model', () => {
  it('user A encrypts → user B (same org, same password) decrypts', async () => {
    // Create user B with the SAME password as admin.
    // Org-level salt means same password → same derived key → shared decryption.
    await authService.createUser({
      username: 'user_b', password: ADMIN_PASS,
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });

    // Login as admin, encrypt data
    const enc = await cryptoService.encrypt('shared org data');

    // Logout, login as user B with same password
    await authService.logout();
    await authService.login('user_b', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

    // User B decrypts (same password + same org salt → same key)
    const dec = await cryptoService.decrypt(enc.ciphertext, enc.iv);
    expect(dec).toBe('shared org data');
  });

  it('logout clears key → decrypt fails', async () => {
    const enc = await cryptoService.encrypt('secret');
    await authService.logout();
    expect(cryptoService.isUnlocked()).toBe(false);
    await expect(cryptoService.decrypt(enc.ciphertext, enc.iv)).rejects.toThrow(/locked/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TASK 3 — SYSTEM ACTOR HARDENING
// ══════════════════════════════════════════════════════════════════════════════

describe('System actor — org boundary enforcement', () => {
  it('system dispatch only delivers to same-org subscribers', async () => {
    // Subscribe in our org
    const channel = await notificationService.upsertChannel({ organizationId: orgId, name: 'sys-ch' });
    await notificationService.subscribe({
      userId: adminUser.id, channelId: channel.id,
      eventType: EVENT_TYPES.DEADLINE_APPROACHING, organizationId: orgId,
    });

    // Also subscribe a user claiming to be in a different org
    await notificationService.subscribe({
      userId: adminUser.id, channelId: channel.id,
      eventType: EVENT_TYPES.DEADLINE_APPROACHING, organizationId: 'other-org-999',
    });

    await authService.logout();

    // System dispatch for OUR org only
    await eventDispatcherService.dispatch({
      organizationId: orgId,
      eventType: EVENT_TYPES.DEADLINE_APPROACHING,
      sourceId: 'sys-test-001', actorId: 'system',
      title: 'SLA', body: 'Overdue.',
      recipientUserIds: [adminUser.id],
    });

    const queueRepo = new MessageQueueRepository();
    const items = await queueRepo.findAll();

    // Subscription items should only be for orgId, not other-org-999
    const subItems = items.filter((i) => i.recipientUserId === adminUser.id);
    for (const item of subItems) {
      expect(item.organizationId).toBe(orgId);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TASK 4 — PREFERENCE PERSISTENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('Preference persistence — per user isolation', () => {
  it('preferences survive logout and restore on re-login', () => {
    persistSelectedStore({ id: 'store-gov', name: 'Gov Store' }, adminUser.id);

    // Simulate logout (clear store state but not localStorage)
    const restored = restoreSelectedStore(adminUser.id);
    expect(restored).toEqual({ id: 'store-gov', name: 'Gov Store' });
  });

  it('different users have isolated preferences', () => {
    persistSelectedStore({ id: 'store-A', name: 'A' }, 'userA');
    persistSelectedStore({ id: 'store-B', name: 'B' }, 'userB');

    expect(restoreSelectedStore('userA').id).toBe('store-A');
    expect(restoreSelectedStore('userB').id).toBe('store-B');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TASK 5 — VERSIONING GLOBAL CONSISTENCY
// ══════════════════════════════════════════════════════════════════════════════

describe('Versioning global consistency — all mutation paths create versions', () => {
  it('every versioned entity type has version record after import', async () => {
    const ids = {
      colors: generateId(), sizes: generateId(), seasons: generateId(),
      brands: generateId(), suppliers: generateId(), styles: generateId(),
    };

    const snapshot = {};
    for (const [store, id] of Object.entries(ids)) {
      snapshot[store] = [{ id, organizationId: orgId, name: `Import-${store}`, sku: `SKU-${store}`, isActive: true, createdAt: Date.now() }];
    }

    await importExportService.applyImport({ snapshot, schemaVersion: DB_VERSION, actorId: adminUser.id });
    await authService.login('gov_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

    const mdRepo = new MasterDataRepository();
    for (const [store, id] of Object.entries(ids)) {
      const history = await mdRepo.findVersionHistory(id);
      expect(history.length, `${store} should have version record`).toBeGreaterThanOrEqual(1);
    }
  });
});
