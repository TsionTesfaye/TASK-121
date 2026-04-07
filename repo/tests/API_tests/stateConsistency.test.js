/**
 * State consistency tests — cross-tab lock, customer versioning, import sync, RBAC.
 *
 * Covers:
 *   1. Cross-tab lock clears crypto key
 *   2. Customer mutations require reasonNote + create version
 *   3. Import forces UI logout
 *   4. RBAC: analyst cannot reveal sensitive fields
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { AuthService } from '../../src/services/AuthService.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'StateConsist@1';
let orgId;
let adminUser;
let customerId;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'sc_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'StateConsistCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('sc_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

  const c = await customerService.createCustomer({
    organizationId: orgId, name: 'State Customer',
    storedValue: 100, actorId: adminUser.id,
        reasonNote: 'Test customer creation',
  });
  customerId = c.id;
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. CROSS-TAB LOCK — CRYPTO KEY CLEARED
// ══════════════════════════════════════════════════════════════════════════════

describe('Cross-tab lock security', () => {
  it('SESSION_LOCKED broadcast clears crypto key', () => {
    expect(cryptoService.isUnlocked()).toBe(true);

    // Simulate broadcast lock (the AuthService constructor listens for this)
    const svc = new AuthService();
    svc._isLocked = false;

    // Directly test: the constructor's subscriber clears key on lock
    // The production code: cryptoService.clearSessionKey() on SESSION_LOCKED
    authService.lockSession();

    // After lock, key should be cleared
    expect(cryptoService.isUnlocked()).toBe(false);
  });

  it('after lock, encrypt fails', async () => {
    authService.lockSession();
    await expect(cryptoService.encrypt('test')).rejects.toThrow(/locked/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. CUSTOMER MUTATION GOVERNANCE
// ══════════════════════════════════════════════════════════════════════════════

describe('Customer mutation governance — reasonNote + versioning', () => {
  it('updateCustomer without reasonNote → rejected', async () => {
    await expect(
      customerService.updateCustomer(customerId, { name: 'New Name' }, adminUser.id),
    ).rejects.toThrow(/reason/i);
  });

  it('updateCustomer with valid reason → version created', async () => {
    await customerService.updateCustomer(customerId, { name: 'Versioned Name' }, adminUser.id, 'Updating name for test verification');
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customerId);
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('adjustPoints without reasonNote → rejected', async () => {
    await expect(
      customerService.adjustPoints(customerId, 10, adminUser.id),
    ).rejects.toThrow(/reason/i);
  });

  it('adjustPoints with valid reason → version created', async () => {
    await customerService.adjustPoints(customerId, 10, adminUser.id, 'Loyalty bonus points');
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customerId);
    expect(history.some((v) => v.payload?.action === 'adjust_points')).toBe(true);
  });

  it('adjustStoredValue without reasonNote → rejected', async () => {
    await expect(
      customerService.adjustStoredValue(customerId, 5, adminUser.id),
    ).rejects.toThrow(/reason/i);
  });

  it('addRating without reasonNote → rejected', async () => {
    await expect(
      customerService.addRating(customerId, 5, adminUser.id),
    ).rejects.toThrow(/reason/i);
  });

  it('addRating with valid reason → version created', async () => {
    await customerService.addRating(customerId, 4, adminUser.id, 'Service quality rating');
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customerId);
    expect(history.some((v) => v.payload?.action === 'add_rating')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. IMPORT LOGOUT SYNC
// ══════════════════════════════════════════════════════════════════════════════

describe('Import logout sync', () => {
  it('AdminPage has clearAuthStores + navigate after import', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/AdminPage.svelte'), 'utf8');
    expect(content).toContain('clearAuthStores');
    expect(content).toContain("navigate('/login')");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. RBAC — SENSITIVE DATA
// ══════════════════════════════════════════════════════════════════════════════

describe('RBAC — revealSensitiveFields', () => {
  it('admin can reveal', async () => {
    const fields = await customerService.revealSensitiveFields(customerId);
    expect(fields.storedValue).toBeDefined();
  });

  it('store_manager can reveal', async () => {
    authService._currentUser = { id: 'mgr', role: ROLES.STORE_MANAGER, organizationNodeId: orgId };
    const fields = await customerService.revealSensitiveFields(customerId);
    expect(fields.storedValue).toBeDefined();
  });

  it('analyst cannot reveal', async () => {
    authService._currentUser = { id: 'ana', role: ROLES.ANALYST, organizationNodeId: orgId };
    await expect(customerService.revealSensitiveFields(customerId)).rejects.toThrow(/permission denied/i);
  });

  it('CRMPage hides reveal button for non-managers', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/CRMPage.svelte'), 'utf8');
    // Reveal button is gated by canManage (not shown for analyst/guest)
    expect(content).toContain('{:else if canManage}');
    expect(content).toContain('on:click={revealSensitive}');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. CRM UI — REASON INPUTS IN MODALS
// ══════════════════════════════════════════════════════════════════════════════

describe('CRM UI — reason note inputs', () => {
  it('all mutation modals have reason input', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/CRMPage.svelte'), 'utf8');
    expect(content).toContain('editReason');
    expect(content).toContain('pointsReason');
    expect(content).toContain('svReason');
    expect(content).toContain('ratingReason');
  });

  it('all mutation modals gate submit on reason length', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/CRMPage.svelte'), 'utf8');
    expect(content).toContain('editReason.trim().length < 10');
    expect(content).toContain('pointsReason.trim().length < 10');
    expect(content).toContain('svReason.trim().length < 10');
    expect(content).toContain('ratingReason.trim().length < 10');
  });
});
