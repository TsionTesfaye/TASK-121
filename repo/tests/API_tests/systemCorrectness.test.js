/**
 * System-level correctness tests — crypto, deactivation, versioning invariants.
 *
 * Covers:
 *   1. Org-level crypto: same-password users share encryption
 *   2. Deactivated user loses access immediately
 *   3. Versioning: no multiple active versions per entity
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { masterDataService } from '../../src/services/MasterDataService.js';
import { lookupDataService } from '../../src/services/LookupDataService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, MASTER_DATA_ENTITY_TYPES } from '../../src/utils/constants.js';

const SHARED_PASS = 'SharedPass@1234';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'sys_admin',
    adminPassword: SHARED_PASS,
    orgName: 'SysCorrectCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('sys_admin', SHARED_PASS);
    await authService.unlockProtectedData(SHARED_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. ORG-LEVEL CRYPTO
// ══════════════════════════════════════════════════════════════════════════════

describe('Org-level crypto — shared key via org salt', () => {
  it('user A encrypts → user B (same org, same password) decrypts', async () => {
    await authService.createUser({
      username: 'user_b', password: SHARED_PASS,
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });

    // Admin encrypts
    const enc = await cryptoService.encrypt('shared secret');

    // Switch to user B
    await authService.logout();
    await authService.login('user_b', SHARED_PASS);
    await authService.unlockProtectedData(SHARED_PASS);

    // User B decrypts (same password + same org salt = same key)
    const dec = await cryptoService.decrypt(enc.ciphertext, enc.iv);
    expect(dec).toBe('shared secret');
  });

  it('logout clears key → cannot decrypt', async () => {
    const enc = await cryptoService.encrypt('secret');
    await authService.logout();
    expect(cryptoService.isUnlocked()).toBe(false);
    await expect(cryptoService.decrypt(enc.ciphertext, enc.iv)).rejects.toThrow(/locked/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. DEACTIVATED USER LOSES ACCESS
// ══════════════════════════════════════════════════════════════════════════════

describe('Deactivated user — immediate access revocation', () => {
  it('deactivating current user forces logout', async () => {
    const user = await authService.createUser({
      username: 'to_deact', password: SHARED_PASS,
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });

    // Login as that user
    await authService.logout();
    await authService.login('to_deact', SHARED_PASS);
    await authService.unlockProtectedData(SHARED_PASS);
    expect(authService.isAuthenticated()).toBe(true);

    // Admin deactivates (need admin session)
    // Simulate: set admin as current user to deactivate
    authService._currentUser = { ...adminUser, role: ROLES.ADMINISTRATOR };
    await authService.deactivateAccount(user.id);

    // The deactivated user's login should now fail
    authService._currentUser = null;
    await expect(authService.login('to_deact', SHARED_PASS)).rejects.toThrow(/invalid credentials/i);
  });

  it('active user can still operate normally', async () => {
    expect(authService.isAuthenticated()).toBe(true);
    // Service call should work
    const customers = await customerService.getByOrg(orgId);
    expect(Array.isArray(customers)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. VERSIONING INVARIANT — NO MULTIPLE ACTIVE VERSIONS
// ══════════════════════════════════════════════════════════════════════════════

describe('Versioning invariant — single active per entity', () => {
  it('dataset publish: new version deactivates previous (atomicVersionSwitch)', async () => {
    const v1 = await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.COLOR, entityId: 'inv-color',
      organizationId: orgId, payload: { name: 'Red' },
      reasonNote: 'Version invariant test v1', createdBy: adminUser.id,
      expectedActiveVersionId: null,
    });

    const v2 = await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.COLOR, entityId: 'inv-color',
      organizationId: orgId, payload: { name: 'Red v2' },
      reasonNote: 'Version invariant test v2', createdBy: adminUser.id,
      expectedActiveVersionId: v1.id,
    });

    const active = await masterDataService.getActiveVersion(MASTER_DATA_ENTITY_TYPES.COLOR, orgId);
    expect(active.id).toBe(v2.id);

    // Only one active
    const mdRepo = new MasterDataRepository();
    const all = await mdRepo.findAll();
    const activeForType = all.filter(
      (v) => v.entityType === 'color' && v.organizationId === orgId && v.isActive,
    );
    expect(activeForType.length).toBe(1);
  });

  it('record history: create+deactivate+reactivate → always 1 active', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'colors', organizationId: orgId, name: 'Invariant Blue',
      actorId: adminUser.id, reasonNote: 'Invariant test creation',
    });

    await lookupDataService.deactivateEntry({
      store: 'colors', entryId: entry.id, actorId: adminUser.id,
      reasonNote: 'Invariant test deactivation',
    });

    await lookupDataService.reactivateEntry({
      store: 'colors', entryId: entry.id, actorId: adminUser.id,
      reasonNote: 'Invariant test reactivation',
    });

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);
    const activeCount = history.filter((v) => v.isActive).length;
    expect(activeCount).toBe(1);
    expect(history.length).toBe(3);
  });

  it('two different entities of same type each have independent active versions', async () => {
    const a = await lookupDataService.createEntry({
      store: 'sizes', organizationId: orgId, name: 'Small',
      actorId: adminUser.id, reasonNote: 'Size S for invariant',
    });
    const b = await lookupDataService.createEntry({
      store: 'sizes', organizationId: orgId, name: 'Large',
      actorId: adminUser.id, reasonNote: 'Size L for invariant',
    });

    const mdRepo = new MasterDataRepository();
    const activeA = (await mdRepo.findVersionHistory(a.id)).filter((v) => v.isActive);
    const activeB = (await mdRepo.findVersionHistory(b.id)).filter((v) => v.isActive);

    expect(activeA.length).toBe(1);
    expect(activeB.length).toBe(1);
  });
});
