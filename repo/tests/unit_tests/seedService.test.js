/**
 * SeedService tests.
 *
 * Verifies that:
 *   - seedDemoAccounts() bootstraps the system on first run
 *   - All four demo accounts can log in after seeding
 *   - Each account has the expected role
 *   - seedDemoAccounts() is a no-op when already bootstrapped
 *   - Seeded accounts do not interfere with explicit bootstrap
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { SeedService, DEMO_ACCOUNTS, DEMO_ORG } from '../../src/services/SeedService.js';
import { AuthService } from '../../src/services/AuthService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

// Use non-singleton instances so tests are fully isolated.
let seedSvc;
let authSvc;
let bs;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  seedSvc = new SeedService();
  authSvc = new AuthService();
  bs = new BootstrapService();
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authSvc._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// DEMO_ACCOUNTS constants sanity
// ══════════════════════════════════════════════════════════════════════════════

describe('DEMO_ACCOUNTS constants', () => {
  it('all four roles are present', () => {
    expect(DEMO_ACCOUNTS.ADMIN.role).toBe(ROLES.ADMINISTRATOR);
    expect(DEMO_ACCOUNTS.MANAGER.role).toBe(ROLES.STORE_MANAGER);
    expect(DEMO_ACCOUNTS.ANALYST.role).toBe(ROLES.ANALYST);
    expect(DEMO_ACCOUNTS.REVIEWER.role).toBe(ROLES.REVIEWER);
  });

  it('all passwords meet the 12-char + digit + symbol policy', () => {
    for (const acct of Object.values(DEMO_ACCOUNTS)) {
      const { password } = acct;
      expect(password.length, `${acct.username} too short`).toBeGreaterThanOrEqual(12);
      expect(/\d/.test(password), `${acct.username} missing digit`).toBe(true);
      expect(/[^a-zA-Z0-9]/.test(password), `${acct.username} missing symbol`).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// seedDemoAccounts — fresh install
// ══════════════════════════════════════════════════════════════════════════════

describe('seedDemoAccounts — fresh install', () => {
  it('returns true on first run', async () => {
    const result = await seedSvc.seedDemoAccounts();
    expect(result).toBe(true);
  });

  it('system is bootstrapped after seed', async () => {
    await seedSvc.seedDemoAccounts();
    expect(await bs.isBootstrapped()).toBe(true);
  });

  it('admin account exists and can log in', async () => {
    await seedSvc.seedDemoAccounts();
    const { username, password } = DEMO_ACCOUNTS.ADMIN;
    const user = await authSvc.login(username, password);
    expect(user.username).toBe(username);
    expect(user.role).toBe(ROLES.ADMINISTRATOR);
  });

  it('manager account exists and can log in', async () => {
    await seedSvc.seedDemoAccounts();
    const { username, password } = DEMO_ACCOUNTS.MANAGER;
    const user = await authSvc.login(username, password);
    expect(user.username).toBe(username);
    expect(user.role).toBe(ROLES.STORE_MANAGER);
  });

  it('analyst account exists and can log in', async () => {
    await seedSvc.seedDemoAccounts();
    const { username, password } = DEMO_ACCOUNTS.ANALYST;
    const user = await authSvc.login(username, password);
    expect(user.username).toBe(username);
    expect(user.role).toBe(ROLES.ANALYST);
  });

  it('reviewer account exists and can log in', async () => {
    await seedSvc.seedDemoAccounts();
    const { username, password } = DEMO_ACCOUNTS.REVIEWER;
    const user = await authSvc.login(username, password);
    expect(user.username).toBe(username);
    expect(user.role).toBe(ROLES.REVIEWER);
  });

  it('session is cleared after seed (no user logged in)', async () => {
    await seedSvc.seedDemoAccounts();
    expect(authSvc.getCurrentUser()).toBeNull();
    expect(authSvc.isAuthenticated()).toBe(false);
  });

  it('encryption key is derived on admin login after seed', async () => {
    await seedSvc.seedDemoAccounts();
    await authSvc.login(DEMO_ACCOUNTS.ADMIN.username, DEMO_ACCOUNTS.ADMIN.password);
    expect(cryptoService.isUnlocked()).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// seedDemoAccounts — idempotent (already bootstrapped)
// ══════════════════════════════════════════════════════════════════════════════

describe('seedDemoAccounts — idempotent when already bootstrapped', () => {
  it('returns false if already bootstrapped', async () => {
    // Manual bootstrap first
    await bs.bootstrap({
      adminUsername: 'manual_admin',
      adminPassword: 'ManualAdmin@1234',
      orgName: 'ManualOrg',
    });

    // Seed is a no-op
    const result = await seedSvc.seedDemoAccounts();
    expect(result).toBe(false);
  });

  it('does not overwrite existing manual bootstrap', async () => {
    await bs.bootstrap({
      adminUsername: 'manual_admin',
      adminPassword: 'ManualAdmin@1234',
      orgName: 'ManualOrg',
    });

    await seedSvc.seedDemoAccounts(); // no-op

    // Original admin still works
    const user = await authSvc.login('manual_admin', 'ManualAdmin@1234');
    expect(user.username).toBe('manual_admin');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Login with wrong credentials fails (not just seed-specific)
// ══════════════════════════════════════════════════════════════════════════════

describe('Seeded accounts — wrong credentials rejected', () => {
  it('wrong password fails for admin', async () => {
    await seedSvc.seedDemoAccounts();
    await expect(authSvc.login(DEMO_ACCOUNTS.ADMIN.username, 'WrongPass@1234'))
      .rejects.toThrow(/invalid credentials/i);
  });

  it('nonexistent username fails', async () => {
    await seedSvc.seedDemoAccounts();
    await expect(authSvc.login('nonexistent', DEMO_ACCOUNTS.ADMIN.password))
      .rejects.toThrow(/invalid credentials/i);
  });
});
