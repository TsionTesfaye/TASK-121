/**
 * Auth lifecycle simulation tests.
 *
 * Covers full session lifecycle beyond the basic login/lockout flows:
 *   - Auto-lock after inactivity, crypto key cleared
 *   - Unlock re-derives session key
 *   - Logout clears all state
 *   - Guest session hard-expiry after 30 minutes
 *   - Multi-tab lock broadcast propagation
 *   - Forced logout after 5 failed unlock attempts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { AuthService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import {
  setBroadcastService,
  closeAll,
  subscribe,
  CHANNEL_NAMES,
  EVENT_TYPES,
} from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { VALIDATION } from '../../src/utils/constants.js';

const ADMIN_USER = 'lifecycle_admin';
const ADMIN_PASS = 'Lifecycle@1234';
const ORG_NAME = 'LifecycleCo';

let authSvc;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  await bs.bootstrap({ adminUsername: ADMIN_USER, adminPassword: ADMIN_PASS, orgName: ORG_NAME });

  authSvc = new AuthService();
});

afterEach(() => {
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
  vi.useRealTimers();
});

// ── Auto-lock ─────────────────────────────────────────────────────────────────

describe('Auto-lock after inactivity', () => {
  it('lockSession clears the crypto key', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);
    await authSvc.unlockProtectedData(ADMIN_PASS);
    expect(cryptoService.isUnlocked()).toBe(true);

    authSvc.lockSession();

    expect(cryptoService.isUnlocked()).toBe(false);
    expect(authSvc.isLocked()).toBe(true);
  });

  it('user identity is retained after lock', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);
    authSvc.lockSession();

    // getCurrentUser() should still return the user (not null).
    expect(authSvc.getCurrentUser()).not.toBeNull();
    expect(authSvc.getCurrentUser().username).toBe(ADMIN_USER);
  });

  it('resetInactivityTimer is a no-op for guest sessions', async () => {
    await authSvc.createGuestSession(() => {});
    // Should not throw and should not set the lock timer for guests.
    expect(() => authSvc.resetInactivityTimer()).not.toThrow();
    expect(authSvc.isLocked()).toBe(false);
  });

  it('auto-lock timer fires after AUTO_LOCK_MINUTES', async () => {
    vi.useFakeTimers();
    await authSvc.login(ADMIN_USER, ADMIN_PASS);

    expect(authSvc.isLocked()).toBe(false);

    vi.advanceTimersByTime(VALIDATION.AUTO_LOCK_MINUTES * 60_000 + 100);

    expect(authSvc.isLocked()).toBe(true);
    expect(cryptoService.isUnlocked()).toBe(false);
  });

  it('resetInactivityTimer delays auto-lock', async () => {
    vi.useFakeTimers();
    await authSvc.login(ADMIN_USER, ADMIN_PASS);

    // Advance half the inactivity period.
    vi.advanceTimersByTime((VALIDATION.AUTO_LOCK_MINUTES * 60_000) / 2);

    // Reset — should restart the countdown.
    authSvc.resetInactivityTimer();

    // Advance another half period — should NOT be locked (reset extended it).
    vi.advanceTimersByTime((VALIDATION.AUTO_LOCK_MINUTES * 60_000) / 2 + 100);
    expect(authSvc.isLocked()).toBe(false);

    // Advance the remaining full period — NOW it should lock.
    vi.advanceTimersByTime(VALIDATION.AUTO_LOCK_MINUTES * 60_000);
    expect(authSvc.isLocked()).toBe(true);
  });
});

// ── Unlock ────────────────────────────────────────────────────────────────────

describe('Unlock session', () => {
  it('correct password clears lock and restores encryption key', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);
    expect(cryptoService.isUnlocked()).toBe(true);
    authSvc.lockSession();
    expect(cryptoService.isUnlocked()).toBe(false);

    const ok = await authSvc.unlockSession(ADMIN_PASS);

    expect(ok).toBe(true);
    expect(authSvc.isLocked()).toBe(false);
    // Unlock restores encryption key via wrapped passphrase.
    expect(cryptoService.isUnlocked()).toBe(true);
  });

  it('wrong password returns false without locking out permanently', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);
    authSvc.lockSession();

    const ok = await authSvc.unlockSession('WrongPassword!1');

    expect(ok).toBe(false);
    expect(authSvc.isLocked()).toBe(true); // still locked
  });

  it('4 wrong unlock attempts do not force logout', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);
    authSvc.lockSession();

    for (let i = 0; i < 4; i++) {
      await authSvc.unlockSession('WrongPassword!1');
    }

    // User is still in session (not logged out).
    expect(authSvc.getCurrentUser()).not.toBeNull();
  });

  it('5 wrong unlock attempts force logout and throw', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);
    authSvc.lockSession();

    let threw = false;
    for (let i = 0; i < 5; i++) {
      try {
        await authSvc.unlockSession('WrongPassword!1');
      } catch (err) {
        threw = true;
        expect(err.message).toMatch(/too many failed unlock attempts/i);
      }
    }

    expect(threw).toBe(true);
    expect(authSvc.getCurrentUser()).toBeNull();
    expect(authSvc.isAuthenticated()).toBe(false);
  });

  it('successful unlock resets the failed-attempt counter', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);
    authSvc.lockSession();

    // 3 wrong, then correct.
    await authSvc.unlockSession('Wrong!1111111');
    await authSvc.unlockSession('Wrong!1111111');
    await authSvc.unlockSession('Wrong!1111111');
    await authSvc.unlockSession(ADMIN_PASS); // correct

    authSvc.lockSession();

    // 3 more wrong — should NOT force logout (counter was reset).
    for (let i = 0; i < 3; i++) {
      await authSvc.unlockSession('Wrong!1111111');
    }
    expect(authSvc.getCurrentUser()).not.toBeNull();
  });
});

// ── Logout ────────────────────────────────────────────────────────────────────

describe('Logout', () => {
  it('logout clears current user', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);
    expect(authSvc.getCurrentUser()).not.toBeNull();

    await authSvc.logout();

    expect(authSvc.getCurrentUser()).toBeNull();
    expect(authSvc.isAuthenticated()).toBe(false);
  });

  it('logout clears the session crypto key', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);
    await authSvc.unlockProtectedData(ADMIN_PASS);
    expect(cryptoService.isUnlocked()).toBe(true);

    await authSvc.logout();

    expect(cryptoService.isUnlocked()).toBe(false);
  });

  it('logout clears lock state', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);
    authSvc.lockSession();

    await authSvc.logout();

    expect(authSvc.isLocked()).toBe(false);
    expect(authSvc.getCurrentUser()).toBeNull();
  });
});

// ── Guest session ─────────────────────────────────────────────────────────────

describe('Guest session lifecycle', () => {
  it('createGuestSession sets guest user and isGuest flag', async () => {
    await authSvc.createGuestSession(() => {});

    expect(authSvc.isGuest()).toBe(true);
    expect(authSvc.isAuthenticated()).toBe(false);
    const guest = authSvc.getCurrentUser();
    expect(guest.role).toBe('guest');
    expect(guest.isGuest).toBe(true);
  });

  it('guest session expires after GUEST_TRIAL_MINUTES', async () => {
    vi.useFakeTimers();
    let expired = false;
    await authSvc.createGuestSession(() => { expired = true; });

    vi.advanceTimersByTime(VALIDATION.GUEST_TRIAL_MINUTES * 60_000 + 100);

    expect(expired).toBe(true);
  });

  it('guest session has a guestExpiresAt timestamp', async () => {
    const before = Date.now();
    await authSvc.createGuestSession(() => {});
    const guest = authSvc.getCurrentUser();
    const expectedExpiry = before + VALIDATION.GUEST_TRIAL_MINUTES * 60_000;

    expect(guest.guestExpiresAt).toBeGreaterThanOrEqual(expectedExpiry - 100);
    expect(guest.guestExpiresAt).toBeLessThanOrEqual(expectedExpiry + 100);
  });
});

// ── Multi-tab broadcast ───────────────────────────────────────────────────────

describe('Multi-tab lock broadcast', () => {
  it('lockSession broadcasts SESSION_LOCKED event', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);

    let receivedType = null;
    subscribe(CHANNEL_NAMES.STATE, (event) => { receivedType = event.type; });

    authSvc.lockSession();

    // Broadcast is dispatched synchronously in MockBroadcastService.
    expect(receivedType).toBe(EVENT_TYPES.SESSION_LOCKED);
  });

  it('logout broadcasts SESSION_LOGGED_OUT event', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);

    let receivedType = null;
    subscribe(CHANNEL_NAMES.STATE, (event) => { receivedType = event.type; });

    await authSvc.logout();

    expect(receivedType).toBe(EVENT_TYPES.SESSION_LOGGED_OUT);
  });

  it('a second tab receiving SESSION_LOCKED also becomes locked', async () => {
    await authSvc.login(ADMIN_USER, ADMIN_PASS);

    // Simulate second tab.
    const tab2 = new AuthService();

    // tab1 locks → broadcasts.
    authSvc.lockSession();

    // tab2 received the broadcast via its subscribe handler.
    expect(tab2.isLocked()).toBe(true);
  });
});
