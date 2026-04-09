/**
 * Unlock semantics tests — verifies that password re-entry after auto-lock
 * restores protected-data decryption capability.
 *
 * Tests cover:
 *   1. Protected data is not decryptable while locked
 *   2. unlockSession(correctPassword) restores decrypt capability
 *   3. unlockSession(wrongPassword) fails and protected data stays blocked
 *   4. Logout clears decrypt capability
 *   5. Reviewer/admin/manager flows with protected data
 *   6. No separate passphrase prompt needed after inactivity lock
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'UnlockTest@1234';
const SM_PASS = 'StoreManager@1234';
const WRONG_PASS = 'WrongPassword@1234';

let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'unlock_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'UnlockTestCo',
  });
  orgId = org.id;
  adminUser = admin;
  await authService.login('unlock_admin', ADMIN_PASS);
});

afterEach(async () => {
  await authService.logout().catch(() => {});
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
  vi.useRealTimers();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. PROTECTED DATA IS NOT DECRYPTABLE WHILE LOCKED
// ══════════════════════════════════════════════════════════════════════════════

describe('Protected data blocked while locked', () => {
  it('encrypt throws when session is locked', async () => {
    expect(cryptoService.isUnlocked()).toBe(true);
    authService.lockSession();
    expect(cryptoService.isUnlocked()).toBe(false);
    await expect(cryptoService.encrypt('secret')).rejects.toThrow(/locked/i);
  });

  it('decrypt throws when session is locked', async () => {
    const enc = await cryptoService.encrypt('secret data');
    authService.lockSession();
    await expect(cryptoService.decrypt(enc.ciphertext, enc.iv)).rejects.toThrow(/locked/i);
  });

  it('revealSensitiveFields fails when session is locked', async () => {
    const cust = await customerService.createCustomer({
      organizationId: orgId,
      name: 'LockTestCustomer',
      storedValue: 100.50,
      allergies: 'peanuts',
      actorId: adminUser.id,
      reasonNote: 'testing lock semantics',
    });

    authService.lockSession();
    await expect(customerService.revealSensitiveFields(cust.id)).rejects.toThrow(/locked/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. unlockSession(correctPassword) RESTORES DECRYPT CAPABILITY
// ══════════════════════════════════════════════════════════════════════════════

describe('unlockSession(correctPassword) restores decryption', () => {
  it('password unlock restores cryptoService.isUnlocked()', async () => {
    expect(cryptoService.isUnlocked()).toBe(true);
    authService.lockSession();
    expect(cryptoService.isUnlocked()).toBe(false);

    const ok = await authService.unlockSession(ADMIN_PASS);
    expect(ok).toBe(true);
    expect(cryptoService.isUnlocked()).toBe(true);
  });

  it('encrypted data can be decrypted after password unlock', async () => {
    const enc = await cryptoService.encrypt('restore test');
    authService.lockSession();

    await authService.unlockSession(ADMIN_PASS);
    const dec = await cryptoService.decrypt(enc.ciphertext, enc.iv);
    expect(dec).toBe('restore test');
  });

  it('customer sensitive fields can be revealed after password unlock', async () => {
    const cust = await customerService.createCustomer({
      organizationId: orgId,
      name: 'UnlockRevealTest',
      storedValue: 42.99,
      allergies: 'shellfish',
      actorId: adminUser.id,
      reasonNote: 'unlock reveal verification',
    });

    authService.lockSession();
    await authService.unlockSession(ADMIN_PASS);

    const revealed = await customerService.revealSensitiveFields(cust.id);
    expect(revealed.storedValue).toBe('42.99');
    expect(revealed.allergies).toBe('shellfish');
  });

  it('no separate passphrase prompt is needed after lock+unlock', async () => {
    // Encrypt data
    const enc = await cryptoService.encrypt('no passphrase needed');

    // Lock → unlock with password only
    authService.lockSession();
    await authService.unlockSession(ADMIN_PASS);

    // Decrypt works immediately without calling unlockProtectedData
    const dec = await cryptoService.decrypt(enc.ciphertext, enc.iv);
    expect(dec).toBe('no passphrase needed');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. unlockSession(wrongPassword) FAILS — PROTECTED DATA STAYS BLOCKED
// ══════════════════════════════════════════════════════════════════════════════

describe('unlockSession(wrongPassword) keeps data blocked', () => {
  it('wrong password returns false and keeps crypto locked', async () => {
    authService.lockSession();
    const ok = await authService.unlockSession(WRONG_PASS);
    expect(ok).toBe(false);
    expect(cryptoService.isUnlocked()).toBe(false);
    expect(authService.isLocked()).toBe(true);
  });

  it('encrypt still throws after wrong password attempt', async () => {
    authService.lockSession();
    await authService.unlockSession(WRONG_PASS);
    await expect(cryptoService.encrypt('nope')).rejects.toThrow(/locked/i);
  });

  it('correct password after wrong attempts still restores decryption', async () => {
    authService.lockSession();
    await authService.unlockSession(WRONG_PASS);
    await authService.unlockSession(WRONG_PASS);
    expect(cryptoService.isUnlocked()).toBe(false);

    const ok = await authService.unlockSession(ADMIN_PASS);
    expect(ok).toBe(true);
    expect(cryptoService.isUnlocked()).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. LOGOUT CLEARS DECRYPT CAPABILITY
// ══════════════════════════════════════════════════════════════════════════════

describe('Logout clears decryption capability', () => {
  it('logout clears the encryption key', async () => {
    expect(cryptoService.isUnlocked()).toBe(true);
    await authService.logout();
    expect(cryptoService.isUnlocked()).toBe(false);
  });

  it('encrypt throws after logout', async () => {
    await authService.logout();
    await expect(cryptoService.encrypt('after logout')).rejects.toThrow(/locked/i);
  });

  it('re-login restores encryption key', async () => {
    await authService.logout();
    expect(cryptoService.isUnlocked()).toBe(false);

    await authService.login('unlock_admin', ADMIN_PASS);
    expect(cryptoService.isUnlocked()).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. MULTI-ROLE FLOWS — ADMIN, MANAGER, REVIEWER WITH PROTECTED DATA
// ══════════════════════════════════════════════════════════════════════════════

describe('Multi-role protected data access after unlock', () => {
  it('store_manager can reveal data after lock+unlock (with enrollment)', async () => {
    // Admin creates a store manager
    await authService.createUser({
      username: 'sm_user',
      password: SM_PASS,
      role: ROLES.STORE_MANAGER,
      organizationNodeId: orgId,
    });

    // Create customer data as admin
    const cust = await customerService.createCustomer({
      organizationId: orgId,
      name: 'MultiRoleTest',
      storedValue: 77.77,
      actorId: adminUser.id,
      reasonNote: 'multi-role flow test',
    });

    // Login as store manager
    await authService.logout();
    await authService.login('sm_user', SM_PASS);

    // SM needs first-time enrollment: provide both passphrase and password
    await authService.unlockProtectedData(ADMIN_PASS, SM_PASS);
    expect(cryptoService.isUnlocked()).toBe(true);

    // Verify can reveal
    const revealed = await customerService.revealSensitiveFields(cust.id);
    expect(revealed.storedValue).toBe('77.77');

    // Lock → unlock with password only (no passphrase needed)
    authService.lockSession();
    expect(cryptoService.isUnlocked()).toBe(false);

    await authService.unlockSession(SM_PASS);
    expect(cryptoService.isUnlocked()).toBe(true);

    const revealed2 = await customerService.revealSensitiveFields(cust.id);
    expect(revealed2.storedValue).toBe('77.77');
  });

  it('admin encrypted data survives lock-unlock cycle', async () => {
    const cust = await customerService.createCustomer({
      organizationId: orgId,
      name: 'AdminCycle',
      storedValue: 123.45,
      allergies: 'dairy',
      materialRestrictions: 'latex',
      actorId: adminUser.id,
      reasonNote: 'admin lock cycle test',
    });

    // Lock → unlock
    authService.lockSession();
    await authService.unlockSession(ADMIN_PASS);

    const revealed = await customerService.revealSensitiveFields(cust.id);
    expect(revealed.storedValue).toBe('123.45');
    expect(revealed.allergies).toBe('dairy');
    expect(revealed.materialRestrictions).toBe('latex');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. PASSWORD CHANGE RE-WRAPS PASSPHRASE — FUTURE UNLOCK STILL WORKS
// ══════════════════════════════════════════════════════════════════════════════

describe('Password change preserves unlock semantics', () => {
  it('after password change, new password restores encryption on unlock', async () => {
    const enc = await cryptoService.encrypt('before pw change');

    const NEW_PASS = 'ChangedPass@1234';
    await authService.changePassword(adminUser.id, ADMIN_PASS, NEW_PASS);

    // Logout and re-login with new password
    await authService.logout();
    await authService.login('unlock_admin', NEW_PASS);
    expect(cryptoService.isUnlocked()).toBe(true);

    const dec = await cryptoService.decrypt(enc.ciphertext, enc.iv);
    expect(dec).toBe('before pw change');
  });

  it('old password fails login after change', async () => {
    const NEW_PASS = 'AnotherNew@1234';
    await authService.changePassword(adminUser.id, ADMIN_PASS, NEW_PASS);
    await authService.logout();

    await expect(authService.login('unlock_admin', ADMIN_PASS)).rejects.toThrow(/invalid credentials/i);
  });
});
