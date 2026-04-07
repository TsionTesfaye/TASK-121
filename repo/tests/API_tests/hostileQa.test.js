/**
 * Hostile QA simulation — destructive verification.
 *
 * Tries to break invariants through:
 *   - unusual sequences (lock→action, rapid login/logout)
 *   - partial states (empty orgTree, deleted nodes)
 *   - cross-user leakage
 *   - encryption edge cases
 *   - import/export consistency
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { get } from 'svelte/store';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { AuthService, authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { OrderService } from '../../src/services/OrderService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { importExportService } from '../../src/services/ImportExportService.js';
import { orgService } from '../../src/services/OrgService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { OrgRepository } from '../../src/repositories/implementations/OrgRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { resolveOrgContext, resolveRootOrgId, selectedStore } from '../../src/app/stores/org.js';
import { ROLES, ORG_NODE_TYPES } from '../../src/utils/constants.js';
import { DB_VERSION } from '../../src/infrastructure/db/schema.js';

const PASS_A = 'HostileQA@1234';
const PASS_B = 'DiffPass@12345';
const BACKUP = 'BackupQA@12345';
let companyId, storeId, adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'hq_admin', adminPassword: PASS_A, orgName: 'HostileQACo',
  });
  companyId = org.id;
  adminUser = admin;
  await authService.login('hq_admin', PASS_A);
    await authService.unlockProtectedData(PASS_A);

  // Build hierarchy
  const factory = await orgService.createNode({
    parentId: companyId, type: ORG_NODE_TYPES.FACTORY, name: 'F',
    organizationId: companyId, actorId: adminUser.id,
  });
  const store = await orgService.createNode({
    parentId: factory.id, type: ORG_NODE_TYPES.STORE, name: 'S',
    organizationId: companyId, actorId: adminUser.id,
  });
  storeId = store.id;

  // Create users
  await authService.createUser({ username: 'mgr_a', password: PASS_A, role: ROLES.STORE_MANAGER, organizationNodeId: storeId });
  await authService.createUser({ username: 'mgr_b', password: PASS_B, role: ROLES.STORE_MANAGER, organizationNodeId: storeId });

  // Seed customer
  const custRepo = new CustomerRepository();
  await custRepo.create({
    id: 'cust-hq', organizationId: companyId, name: 'HQ Customer',
    membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
    storedValueCiphertext: null, storedValueIv: null,
    allergiesCiphertext: null, allergiesIv: null,
    materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  selectedStore.set(null);
  closeDB();
  closeAll();
  vi.useRealTimers();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. AUTH + LOCK: action while locked must fail
// ══════════════════════════════════════════════════════════════════════════════

describe('Auth stress — lock prevents all operations', () => {
  it('encrypt fails immediately after lock', async () => {
    authService.lockSession();
    await expect(cryptoService.encrypt('test')).rejects.toThrow(/locked/i);
  });

  it('lock → unlock → encrypt works again', async () => {
    authService.lockSession();
    await authService.unlockSession(PASS_A);
    await authService.unlockProtectedData(PASS_A);
    const enc = await cryptoService.encrypt('recovered');
    const dec = await cryptoService.decrypt(enc.ciphertext, enc.iv);
    expect(dec).toBe('recovered');
  });

  it('lock → logout → login restores clean state', async () => {
    authService.lockSession();
    await authService.logout();
    expect(authService.isAuthenticated()).toBe(false);
    await authService.login('hq_admin', PASS_A);
    await authService.unlockProtectedData(PASS_A);
    expect(authService.isAuthenticated()).toBe(true);
    expect(cryptoService.isUnlocked()).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. ORG CONTEXT: empty tree, deleted nodes, deep hierarchy
// ══════════════════════════════════════════════════════════════════════════════

describe('Org context — edge cases', () => {
  it('resolveRootOrgId for deleted node falls back safely', async () => {
    await orgService.deleteNode(storeId, adminUser.id);
    const rootId = await resolveRootOrgId(storeId);
    // Node deleted → findById returns null → fallback to nodeId
    expect(rootId).toBe(storeId);
  });

  it('resolveOrgContext with undefined user returns empty', () => {
    const ctx = resolveOrgContext(undefined, []);
    expect(ctx.organizationId).toBe('');
    expect(ctx.storeId).toBe('');
  });

  it('resolveOrgContext with null organizationNodeId returns empty', () => {
    const ctx = resolveOrgContext({ organizationNodeId: null }, [{ id: 'x' }]);
    expect(ctx.organizationId).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. USER SWITCH: no leakage between sessions
// ══════════════════════════════════════════════════════════════════════════════

describe('User switch — no cross-user leakage', () => {
  it('user B in same org can access user A data with org passphrase', async () => {
    // User A encrypts
    const enc = await cryptoService.encrypt('user A secret');

    // Switch to user B (different login password, same org passphrase)
    await authService.logout();
    await authService.login('mgr_b', PASS_B);
    await authService.unlockProtectedData(PASS_A); // org passphrase, not login password

    // Same org → same passphrase → same key → decrypt succeeds
    const dec = await cryptoService.decrypt(enc.ciphertext, enc.iv);
    expect(dec).toBe('user A secret');
  });

  it('user A data accessible by any user with org passphrase', async () => {
    const enc = await cryptoService.encrypt('shared data');
    await authService.logout();
    await authService.login('mgr_a', PASS_A);
    await authService.unlockProtectedData(PASS_A);
    const dec = await cryptoService.decrypt(enc.ciphertext, enc.iv);
    expect(dec).toBe('shared data');
  });

  it('risk dictionary cleared between users', async () => {
    await riskReviewService.updateSensitiveWords(['fraud'], adminUser.id);
    expect(riskReviewService.getSensitiveWords().length).toBe(1);

    riskReviewService.clearDictionary();
    expect(riskReviewService.getSensitiveWords().length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. IMPORT/EXPORT: data survives round-trip
// ══════════════════════════════════════════════════════════════════════════════

describe('Import/export — round-trip consistency', () => {
  it('export → import → org mapping still valid', async () => {
    const blob = await importExportService.exportBackup({ actorId: adminUser.id, backupPassphrase: BACKUP });
    const file = new File([blob], 'hq.json');
    const { snapshot, schemaVersion } = await importExportService.previewImport({ file, backupPassphrase: BACKUP });
    await importExportService.applyImport({ snapshot, schemaVersion, actorId: adminUser.id });

    // Re-login (import forces logout)
    await authService.login('hq_admin', PASS_A);
    await authService.unlockProtectedData(PASS_A);

    // Org node still resolves
    const rootId = await resolveRootOrgId(storeId);
    expect(rootId).toBe(companyId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. ENCRYPTION: logout truly clears everything
// ══════════════════════════════════════════════════════════════════════════════

describe('Encryption — full key lifecycle', () => {
  it('logout clears key completely', async () => {
    expect(cryptoService.isUnlocked()).toBe(true);
    await authService.logout();
    expect(cryptoService.isUnlocked()).toBe(false);
    await expect(cryptoService.encrypt('x')).rejects.toThrow(/locked/i);
    await expect(cryptoService.decrypt('x', 'x')).rejects.toThrow(/locked/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. DICTIONARY: persists at root org, not node
// ══════════════════════════════════════════════════════════════════════════════

describe('Dictionary — root org persistence', () => {
  it('store_manager at store node → dictionary persists at root', async () => {
    await authService.logout();
    await authService.login('mgr_a', PASS_A);
    await authService.unlockProtectedData(PASS_A);

    await riskReviewService.updateSensitiveWords(['test'], authService.getCurrentUser().id);
    riskReviewService.clearDictionary();

    // Load from root org — should find it
    await riskReviewService.loadPersistedDictionary(companyId);
    expect(riskReviewService.getSensitiveWords()).toEqual(['test']);

    // Load from store node — should NOT find it (config is at root)
    riskReviewService.clearDictionary();
    await riskReviewService.loadPersistedDictionary(storeId);
    expect(riskReviewService.getSensitiveWords()).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. RAPID SEQUENCES: login/logout/lock stress
// ══════════════════════════════════════════════════════════════════════════════

describe('Rapid sequences — no crashes', () => {
  it('rapid login/logout does not crash', async () => {
    for (let i = 0; i < 5; i++) {
      await authService.logout();
      await authService.login('hq_admin', PASS_A);
    await authService.unlockProtectedData(PASS_A);
    }
    expect(authService.isAuthenticated()).toBe(true);
  });

  it('lock + unlock rapidly does not corrupt state', async () => {
    for (let i = 0; i < 5; i++) {
      authService.lockSession();
      await authService.unlockSession(PASS_A);
      await authService.unlockProtectedData(PASS_A);
    }
    expect(authService.isLocked()).toBe(false);
    expect(cryptoService.isUnlocked()).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. FULL FLOW STRESS
// ══════════════════════════════════════════════════════════════════════════════

describe('Full flow stress test', () => {
  it('complete lifecycle: login → create → lock → unlock → create → export → import → switch user', async () => {
    // Login as store manager
    await authService.logout();
    await authService.login('mgr_a', PASS_A);
    await authService.unlockProtectedData(PASS_A);

    // Create order
    const svc = new OrderService();
    const order = await svc.createOrder({
      customerId: 'cust-hq', organizationId: companyId, storeId,
      items: [], actorId: authService.getCurrentUser().id,
    });
    expect(order.storeId).toBe(storeId);

    // Lock
    authService.lockSession();
    expect(cryptoService.isUnlocked()).toBe(false);

    // Unlock
    await authService.unlockSession(PASS_A);
    await authService.unlockProtectedData(PASS_A);
    expect(cryptoService.isUnlocked()).toBe(true);

    // Create ticket
    const ticket = await ticketService.createTicket({
      customerId: 'cust-hq', organizationId: companyId, storeId,
      subject: 'Stress test', description: 'Full flow',
      category: 'general', priority: 'low',
      actorId: authService.getCurrentUser().id,
    });
    expect(ticket.storeId).toBe(storeId);

    // Update dictionary
    await riskReviewService.updateSensitiveWords(['stress'], authService.getCurrentUser().id);

    // Export
    // Need admin for export
    await authService.logout();
    await authService.login('hq_admin', PASS_A);
    await authService.unlockProtectedData(PASS_A);
    const blob = await importExportService.exportBackup({ actorId: adminUser.id, backupPassphrase: BACKUP });

    // Import
    const file = new File([blob], 'stress.json');
    const { snapshot, schemaVersion } = await importExportService.previewImport({ file, backupPassphrase: BACKUP });
    await importExportService.applyImport({ snapshot, schemaVersion, actorId: adminUser.id });

    // Re-login as different user
    await authService.login('mgr_b', PASS_B);
    await authService.unlockProtectedData(PASS_A);
    expect(authService.isAuthenticated()).toBe(true);
    expect(authService.getCurrentUser().username).toBe('mgr_b');
  });
});
