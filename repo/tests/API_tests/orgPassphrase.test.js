/**
 * Org passphrase encryption model tests.
 *
 * Validates that:
 * - Login password is NEVER used for data encryption
 * - Only org passphrase derives the encryption key
 * - Cross-user same-org access works with shared passphrase
 * - Wrong passphrase fails safely
 * - Logout/lock clears encryption state
 * - Password change does NOT affect encryption
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'OrgPassphrase@1234';
const WRONG_PASSPHRASE = 'WrongSecret@2024';
let orgId, adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'pp_admin', adminPassword: ADMIN_PASS, orgName: 'PassphraseCo',
  });
  orgId = org.id;
  adminUser = admin;
  await authService.login('pp_admin', ADMIN_PASS);
  // Unlock with the org passphrase (defaults to admin password at bootstrap)
  await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. PASSWORD NEVER USED FOR ENCRYPTION (EXPLICIT ASSERTION)
// ══════════════════════════════════════════════════════════════════════════════

describe('Password-based auto-unlock — wrapped passphrase model', () => {
  it('login auto-derives encryption key via wrapped passphrase', async () => {
    await authService.logout();
    await authService.login('pp_admin', ADMIN_PASS);

    // After login, crypto is unlocked — passphrase was auto-unwrapped
    expect(cryptoService.isUnlocked()).toBe(true);
    const enc = await cryptoService.encrypt('test');
    const dec = await cryptoService.decrypt(enc.ciphertext, enc.iv);
    expect(dec).toBe('test');
  });

  it('screen unlock restores encryption key via wrapped passphrase', async () => {
    // Lock session
    authService.lockSession();
    expect(cryptoService.isUnlocked()).toBe(false);

    // Unlock screen with login password — key IS derived via wrapped passphrase
    await authService.unlockSession(ADMIN_PASS);
    expect(cryptoService.isUnlocked()).toBe(true);
  });

  it('password change does NOT affect encryption key', async () => {
    // Encrypt something
    const enc = await cryptoService.encrypt('secret data');

    // Change password
    const NEW_PASS = 'NewPassword@12345';
    await authService.changePassword(adminUser.id, ADMIN_PASS, NEW_PASS);

    // Key must still work (passphrase unchanged)
    const dec = await cryptoService.decrypt(enc.ciphertext, enc.iv);
    expect(dec).toBe('secret data');
  });

  it('encryption model is always passphrase', async () => {
    const model = await authService.getEncryptionModel();
    expect(model).toBe('passphrase');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. CROSS-USER SAME ORG + SAME PASSPHRASE → DECRYPT SUCCEEDS
// ══════════════════════════════════════════════════════════════════════════════

describe('Passphrase-only — cross-user decryption', () => {
  it('user A encrypts, user B decrypts with same org passphrase', async () => {
    // Admin creates a customer (encrypted with passphrase-derived key)
    const cust = await customerService.createCustomer({
      organizationId: orgId, name: 'PassTest', storedValue: 42.50,
      allergies: 'peanuts', actorId: adminUser.id, reasonNote: 'cross-user encryption test',
    });

    // Verify admin can decrypt
    const revealed = await customerService.revealSensitiveFields(cust.id);
    expect(revealed.storedValue).toBe('42.50');
    expect(revealed.allergies).toBe('peanuts');

    // Create a second user with a DIFFERENT login password
    await authService.createUser({
      username: 'user_b', password: 'DifferentPass@1234',
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });

    // Logout admin, login as user B
    await authService.logout();
    await authService.login('user_b', 'DifferentPass@1234');

    // Login doesn't derive key — crypto is locked
    expect(cryptoService.isUnlocked()).toBe(false);

    // Unlock with org passphrase (same for all users in org)
    const ok = await authService.unlockProtectedData(ADMIN_PASS);
    expect(ok).toBe(true);
    expect(cryptoService.isUnlocked()).toBe(true);

    // User B can now decrypt the same data
    const revealedB = await customerService.revealSensitiveFields(cust.id);
    expect(revealedB.storedValue).toBe('42.50');
    expect(revealedB.allergies).toBe('peanuts');
  });

  it('cross-user: different passwords, same passphrase → both succeed', async () => {
    // Create customer
    const cust = await customerService.createCustomer({
      organizationId: orgId, name: 'MultiUser',
      storedValue: 99.99, actorId: adminUser.id,
      reasonNote: 'multi-user passphrase verification test',
    });

    // Create user with very different password
    await authService.createUser({
      username: 'user_c', password: 'TotallyDifferent@99',
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });

    await authService.logout();
    await authService.login('user_c', 'TotallyDifferent@99');
    await authService.unlockProtectedData(ADMIN_PASS); // org passphrase, NOT login password

    const revealedC = await customerService.revealSensitiveFields(cust.id);
    expect(revealedC.storedValue).toBe('99.99');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. WRONG PASSPHRASE FAILS SAFELY
// ══════════════════════════════════════════════════════════════════════════════

describe('Passphrase-only — wrong passphrase', () => {
  it('wrong passphrase does not unlock', async () => {
    cryptoService.clearSessionKey();

    const result = await authService.unlockProtectedData(WRONG_PASSPHRASE);
    expect(result).toBe(false);
    expect(cryptoService.isUnlocked()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. LOGOUT/LOCK CLEARS ENCRYPTION STATE
// ══════════════════════════════════════════════════════════════════════════════

describe('Passphrase-only — session lifecycle', () => {
  it('logout clears encryption state', async () => {
    expect(cryptoService.isUnlocked()).toBe(true);

    await authService.logout();
    expect(cryptoService.isUnlocked()).toBe(false);
  });

  it('lock clears encryption state', async () => {
    expect(cryptoService.isUnlocked()).toBe(true);

    authService.lockSession();
    expect(cryptoService.isUnlocked()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. PASSPHRASE SETUP
// ══════════════════════════════════════════════════════════════════════════════

describe('Passphrase-only — setup', () => {
  it('admin can change org passphrase', async () => {
    const NEW_PP = 'NewPassphrase@2024';
    await authService.setupOrgPassphrase(NEW_PP);

    // Clear key and try new passphrase
    cryptoService.clearSessionKey();
    const ok = await authService.unlockProtectedData(NEW_PP);
    expect(ok).toBe(true);

    // Old passphrase should fail
    cryptoService.clearSessionKey();
    const fail = await authService.unlockProtectedData(ADMIN_PASS);
    expect(fail).toBe(false);
  });

  it('short passphrase is rejected', async () => {
    await expect(authService.setupOrgPassphrase('short'))
      .rejects.toThrow(/at least 12/i);
  });

  it('non-admin cannot set passphrase', async () => {
    await authService.createUser({
      username: 'sm_user', password: 'SmUserPass@1234',
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });
    await authService.logout();
    await authService.login('sm_user', 'SmUserPass@1234');
    await expect(authService.setupOrgPassphrase('SomePassphrase@1234'))
      .rejects.toThrow(/permission denied/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. UI WIRING CHECKS
// ══════════════════════════════════════════════════════════════════════════════

describe('Passphrase-only — UI wiring', () => {
  it('OrgSetupPage has passphrase setup UI', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/OrgSetupPage.svelte'), 'utf8');
    expect(content).toContain('setupOrgPassphrase');
    expect(content).toContain('handleSetupPassphrase');
    expect(content).toContain('Protected Data Encryption');
  });

  it('CRMPage no longer has separate passphrase unlock UI', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/CRMPage.svelte'), 'utf8');
    // The separate passphrase prompt has been removed — login/unlock auto-restores encryption
    expect(content).not.toContain('handlePassphraseUnlock');
    expect(content).not.toContain('Unlock Protected Data');
    expect(content).not.toContain('showPassphrasePrompt');
  });

  it('AuthService uses _restoreEncryptionKey in login and unlockSession', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/services/AuthService.js'), 'utf8');

    // login() restores encryption via _restoreEncryptionKey
    const loginMethod = content.substring(
      content.indexOf('async login('),
      content.indexOf('return freshUser;'),
    );
    expect(loginMethod).toContain('_restoreEncryptionKey');

    // unlockSession() restores encryption via _restoreEncryptionKey
    const unlockMethod = content.substring(
      content.indexOf('async unlockSession('),
      content.indexOf('// ── Account management'),
    );
    expect(unlockMethod).toContain('_restoreEncryptionKey');
  });
});
