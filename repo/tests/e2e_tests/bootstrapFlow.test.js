/**
 * E2E Simulation — Bootstrap and first-user creation flow.
 *
 * Covers:
 *   1. Fresh DB → isBootstrapped() = false
 *   2. Bootstrap creates admin + org
 *   3. /bootstrap route locked out after completion
 *   4. Admin can immediately log in after bootstrap
 *   5. Second bootstrap attempt is rejected
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = null;
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
});

describe('Bootstrap flow', () => {
  it('step 1: fresh DB is not bootstrapped', async () => {
    const svc = new BootstrapService();
    expect(await svc.isBootstrapped()).toBe(false);
  });

  it('step 2: bootstrap creates admin + root org', async () => {
    const svc = new BootstrapService();
    const { admin, org } = await svc.bootstrap({
      adminUsername: 'firstadmin',
      adminPassword: 'Bootstrap12!',
      orgName: 'Acme Retail',
    });

    expect(admin.role).toBe(ROLES.ADMINISTRATOR);
    expect(admin.isActive).toBe(true);
    expect(org.type).toBe('company');
    expect(org.parentId).toBeNull();
    expect(admin.organizationNodeId).toBe(org.id);
  });

  it('step 3: system is bootstrapped after completion', async () => {
    const svc = new BootstrapService();
    await svc.bootstrap({
      adminUsername: 'admin',
      adminPassword: 'Bootstrap12!',
      orgName: 'Corp',
    });
    expect(await svc.isBootstrapped()).toBe(true);
  });

  it('step 4: admin can log in and session key is derived', async () => {
    const svc = new BootstrapService();
    await svc.bootstrap({
      adminUsername: 'admin',
      adminPassword: 'Bootstrap12!',
      orgName: 'My Company',
    });

    const user = await authService.login('admin', 'Bootstrap12!');
    await authService.unlockProtectedData('Bootstrap12!');
    expect(user.role).toBe(ROLES.ADMINISTRATOR);
    expect(cryptoService._sessionKey).not.toBeNull();
  });

  it('step 5: bootstrap route is locked after first admin created', async () => {
    const svc = new BootstrapService();
    await svc.bootstrap({ adminUsername: 'admin', adminPassword: 'Bootstrap12!', orgName: 'Corp' });
    await expect(
      svc.bootstrap({ adminUsername: 'admin2', adminPassword: 'Bootstrap12!', orgName: 'Corp2' }),
    ).rejects.toThrow(/already initialized/i);
  });

  it('full flow: bootstrap → login → create second user → login as second user', async () => {
    const bsSvc = new BootstrapService();

    // Bootstrap
    await bsSvc.bootstrap({ adminUsername: 'superadmin', adminPassword: 'Admin123456!', orgName: 'TestCo' });

    // Login as admin
    const admin = await authService.login('superadmin', 'Admin123456!');
    await authService.unlockProtectedData('Admin123456!');
    expect(admin.role).toBe(ROLES.ADMINISTRATOR);

    // Create a store manager
    await authService.createUser({
      username: 'manager1',
      password: 'Manager12345!',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: admin.organizationNodeId,
    });

    // Logout
    await authService.logout();
    expect(authService.isAuthenticated()).toBe(false);

    // Login as manager
    const mgr = await authService.login('manager1', 'Manager12345!');
    await authService.unlockProtectedData('Manager12345!');
    expect(mgr.role).toBe(ROLES.STORE_MANAGER);
  });
});
