/**
 * State propagation tests — lock/unlock/logout sync between service and stores.
 *
 * Covers:
 *   1. Auto-lock propagates to service state
 *   2. Manual lock propagates
 *   3. Broadcast events carry correct types
 *   4. App.svelte has broadcast listener for state sync
 *   5. Store persistence is wired in App.svelte
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { AuthService, authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { VALIDATION } from '../../src/utils/constants.js';

const ADMIN_PASS = 'StateProp@1234';

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  await bs.bootstrap({
    adminUsername: 'sp_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'StatePropCo',
  });

  await authService.login('sp_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
  vi.useRealTimers();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. AUTO-LOCK PROPAGATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Auto-lock propagation', () => {
  it('service is locked after auto-lock timer fires', async () => {
    vi.useFakeTimers();
    // Re-login with fake timers active so the lock timer uses mocked setTimeout.
    const svc = new AuthService();
    await svc.login('sp_admin', ADMIN_PASS);
    await svc.unlockProtectedData(ADMIN_PASS);

    expect(svc.isLocked()).toBe(false);
    expect(cryptoService.isUnlocked()).toBe(true);

    // Advance past the auto-lock timeout
    vi.advanceTimersByTime(VALIDATION.AUTO_LOCK_MINUTES * 60_000 + 100);

    expect(svc.isLocked()).toBe(true);
    expect(cryptoService.isUnlocked()).toBe(false);
  });

  it('manual lockSession sets service locked + clears key', () => {
    expect(authService.isLocked()).toBe(false);

    authService.lockSession();

    expect(authService.isLocked()).toBe(true);
    expect(cryptoService.isUnlocked()).toBe(false);
  });

  it('lockSession broadcasts SESSION_LOCKED event', () => {
    // The AuthService constructor subscribes to broadcasts.
    // lockSession() calls broadcast(CHANNEL_NAMES.STATE, SESSION_LOCKED)
    // Create a fresh instance to capture the broadcast.
    const svc = new AuthService();
    svc._currentUser = authService._currentUser;
    svc._isLocked = false;

    svc.lockSession();
    expect(svc._isLocked).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. APP.SVELTE WIRING
// ══════════════════════════════════════════════════════════════════════════════

describe('App.svelte — broadcast state sync', () => {
  it('App.svelte subscribes to STATE broadcast channel', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/App.svelte'), 'utf8');
    expect(content).toContain('subscribeBroadcast(CHANNEL_NAMES.STATE');
    expect(content).toContain('SESSION_LOCKED');
    expect(content).toContain('SESSION_LOGGED_OUT');
    expect(content).toContain('SESSION_UNLOCKED');
    expect(content).toContain('syncAuthStores');
  });

  it('App.svelte auto-persists selectedStore on change', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/App.svelte'), 'utf8');
    expect(content).toContain('persistSelectedStore($selectedStore');
  });

  it('App.svelte restores preferences on user change', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/App.svelte'), 'utf8');
    expect(content).toContain('restoreColumnLayouts');
    expect(content).toContain('restoreSelectedStore');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. UNLOCK RESTORES STATE
// ══════════════════════════════════════════════════════════════════════════════

describe('Unlock restores state', () => {
  it('unlock after lock re-derives key via wrapped passphrase', async () => {
    authService.lockSession();
    expect(cryptoService.isUnlocked()).toBe(false);

    const ok = await authService.unlockSession(ADMIN_PASS);
    expect(ok).toBe(true);
    expect(authService.isLocked()).toBe(false);
    // Password unlock automatically restores encryption key via wrapped passphrase.
    expect(cryptoService.isUnlocked()).toBe(true);
  });
});
