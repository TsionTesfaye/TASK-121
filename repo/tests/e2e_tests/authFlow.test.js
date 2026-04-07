/**
 * E2E Simulation — Auth flow: login, lockout, auto-lock, unlock.
 *
 * Covers:
 *   - Successful login derives session key
 *   - Wrong password accumulates failures
 *   - 5 failures → account locked for 15 minutes
 *   - Locked account rejects login even with correct password
 *   - Unlock with correct password re-derives key
 *   - Unlock with wrong password tracks attempts; 5 → forced logout
 *   - Logout clears session
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { AuthService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_USER = 'authflow_admin';
const ADMIN_PASS = 'AuthFlow1234!';

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  // Bootstrap a fresh system so we have a real user.
  const bs = new BootstrapService();
  await bs.bootstrap({ adminUsername: ADMIN_USER, adminPassword: ADMIN_PASS, orgName: 'AuthTestCo' });
  // Reset currentUser — bootstrap leaves it null; login tests set it themselves.
});

afterEach(() => {
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
  vi.useRealTimers();
});

describe('Auth flow', () => {
  it('login with correct credentials authenticates but does NOT derive key', async () => {
    const svc = new AuthService();
    const user = await svc.login(ADMIN_USER, ADMIN_PASS);
    expect(user.role).toBe(ROLES.ADMINISTRATOR);
    // Login password is NEVER used for data encryption
    expect(cryptoService.isUnlocked()).toBe(false);
    // Org passphrase unlocks protected data
    await svc.unlockProtectedData(ADMIN_PASS);
    expect(cryptoService.isUnlocked()).toBe(true);
  });

  it('wrong password does not set session', async () => {
    const svc = new AuthService();
    await expect(svc.login(ADMIN_USER, 'WrongPass99!')).rejects.toThrow(/invalid credentials/i);
    expect(svc.isAuthenticated()).toBe(false);
  });

  it('5 wrong passwords → account locked (generic error)', async () => {
    const svc = new AuthService();
    for (let i = 0; i < 5; i++) {
      await expect(svc.login(ADMIN_USER, 'Bad1!')).rejects.toThrow(/invalid/i);
    }
    // 6th attempt — even correct password should be rejected with generic message.
    await expect(svc.login(ADMIN_USER, ADMIN_PASS)).rejects.toThrow(/invalid credentials/i);
  });

  it('lockout expires after 15 minutes (timer-fast)', async () => {
    vi.useFakeTimers();
    const svc = new AuthService();
    for (let i = 0; i < 5; i++) {
      await expect(svc.login(ADMIN_USER, 'Bad1!')).rejects.toThrow(/invalid/i);
    }
    // Still locked right now.
    await expect(svc.login(ADMIN_USER, ADMIN_PASS)).rejects.toThrow(/invalid credentials/i);

    // Advance time past lockout duration.
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    const user = await svc.login(ADMIN_USER, ADMIN_PASS);
    expect(user.role).toBe(ROLES.ADMINISTRATOR);
  });

  it('logout clears session and crypto key', async () => {
    const svc = new AuthService();
    await svc.login(ADMIN_USER, ADMIN_PASS);
    expect(svc.isAuthenticated()).toBe(true);

    await svc.logout();
    expect(svc.isAuthenticated()).toBe(false);
    expect(cryptoService.isUnlocked()).toBe(false);
  });

  it('lockSession clears key but keeps user identity', async () => {
    const svc = new AuthService();
    await svc.login(ADMIN_USER, ADMIN_PASS);
    svc.lockSession();
    expect(cryptoService.isUnlocked()).toBe(false);
    expect(svc.isAuthenticated()).toBe(true);
    expect(svc.isLocked()).toBe(true);
  });

  it('unlockSession unlocks screen but does NOT derive encryption key', async () => {
    const svc = new AuthService();
    await svc.login(ADMIN_USER, ADMIN_PASS);
    svc.lockSession();
    expect(cryptoService.isUnlocked()).toBe(false);

    const ok = await svc.unlockSession(ADMIN_PASS);
    expect(ok).toBe(true);
    // Screen is unlocked but encryption key is NOT derived from login password
    expect(cryptoService.isUnlocked()).toBe(false);
    expect(svc.isLocked()).toBe(false);
    // Must use org passphrase to unlock protected data
    await svc.unlockProtectedData(ADMIN_PASS);
    expect(cryptoService.isUnlocked()).toBe(true);
  });

  it('5 failed unlocks → session terminated (forced logout)', async () => {
    const svc = new AuthService();
    await svc.login(ADMIN_USER, ADMIN_PASS);
    svc.lockSession();

    for (let i = 0; i < 4; i++) {
      const result = await svc.unlockSession('WrongPass99!');
      expect(result).toBe(false);
      expect(svc.isAuthenticated()).toBe(true);
    }

    // 5th wrong attempt → forced logout.
    await expect(svc.unlockSession('WrongPass99!')).rejects.toThrow(/too many failed unlock/i);
    expect(svc.isAuthenticated()).toBe(false);
  });
});
