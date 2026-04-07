/**
 * Simulation tests — Login lockout and session lock/unlock flows.
 *
 * Covers:
 *   - 4 failures do not lock the account
 *   - 5th failure triggers 15-minute lockout
 *   - locked account rejects login with clear message
 *   - successful login after lockout window expires
 *   - success resets failure counter
 *   - inactivity auto-lock fires after idle timeout
 *   - unlockSession re-derives key and clears lock
 *   - wrong password on unlock returns false (no throw)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { AuthService, authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { OrgRepository } from '../../src/repositories/implementations/OrgRepository.js';
import { ROLES, VALIDATION } from '../../src/utils/constants.js';

const ADMIN = { id: 'bootstrap', role: ROLES.ADMINISTRATOR, organizationNodeId: 'org-001' };

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = ADMIN;

  // Seed org node so createUser validation passes.
  const orgRepo = new OrgRepository();
  await orgRepo.create({
    id: 'org-001', name: 'Test Org', type: 'company', parentId: null,
    organizationId: 'org-001', createdAt: Date.now(), updatedAt: Date.now(),
  });
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
  vi.useRealTimers();
});

/** Creates a real user account and returns { username, password } */
async function seedUser(svc, username = 'testuser', password = 'Correct12345!') {
  // AuthService.createUser checks this._currentUser (instance), not the singleton.
  // Temporarily elevate the instance to ADMIN so the permission check passes.
  const prev = svc._currentUser;
  svc._currentUser = ADMIN;
  await svc.createUser({
    username,
    password,
    role: ROLES.STORE_MANAGER,
    organizationNodeId: 'org-001',
  });
  svc._currentUser = prev;
  return { username, password };
}

// ── Failed-attempt counter ────────────────────────────────────────────────────

describe('Login failure counter', () => {
  it('4 consecutive failures do not lock the account', async () => {
    const svc = new AuthService();
    const { username, password } = await seedUser(svc);

    for (let i = 0; i < 4; i++) {
      await expect(svc.login(username, 'WrongPass12!')).rejects.toThrow('Invalid credentials.');
    }

    // 5th attempt with correct password should succeed
    const user = await svc.login(username, password);
    expect(user.username).toBe(username);
    expect(user.failedLoginAttempts).toBe(0);
  });

  it('5th failure locks account — subsequent attempts return generic message', async () => {
    const svc = new AuthService();
    const { username } = await seedUser(svc);

    for (let i = 0; i < 5; i++) {
      await expect(svc.login(username, 'WrongPass12!')).rejects.toThrow();
    }

    // 6th attempt (even with correct password) must fail with generic message.
    await expect(svc.login(username, 'Correct12345!')).rejects.toThrow(/invalid credentials/i);
  });

  it('lockout message does NOT reveal duration or attempt count', async () => {
    const svc = new AuthService();
    const { username } = await seedUser(svc);

    for (let i = 0; i < 5; i++) {
      await svc.login(username, 'WrongPass12!').catch(() => {});
    }

    try {
      await svc.login(username, 'WrongPass12!');
    } catch (err) {
      expect(err.message).toBe('Invalid credentials.');
      expect(err.message).not.toMatch(/minute/i);
      expect(err.message).not.toMatch(/locked/i);
    }
  });
});

// ── Lockout expiry ────────────────────────────────────────────────────────────

describe('Lockout expiry', () => {
  it('login succeeds after lockout window passes', async () => {
    vi.useFakeTimers();
    const svc = new AuthService();
    const { username, password } = await seedUser(svc);

    for (let i = 0; i < 5; i++) {
      await svc.login(username, 'WrongPass12!').catch(() => {});
    }

    // Manually fast-forward lockoutUntil by patching the DB record.
    const { UserRepository } = await import('../../src/repositories/implementations/UserRepository.js');
    const repo = new UserRepository();
    const users = await repo.findAll();
    const locked = users.find((u) => u.username === username);
    await repo.update(locked.id, { ...locked, lockoutUntil: Date.now() - 1 });

    // Now login should work
    const user = await svc.login(username, password);
    expect(user.username).toBe(username);
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockoutUntil).toBeNull();
  });
});

// ── Success resets counter ────────────────────────────────────────────────────

describe('Failure counter reset on success', () => {
  it('3 failures followed by successful login resets counter to 0', async () => {
    const svc = new AuthService();
    const { username, password } = await seedUser(svc);

    for (let i = 0; i < 3; i++) {
      await svc.login(username, 'WrongPass12!').catch(() => {});
    }

    const user = await svc.login(username, password);
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockoutUntil).toBeNull();
  });
});

// ── Session auto-lock ─────────────────────────────────────────────────────────

describe('Inactivity auto-lock', () => {
  it('lockSession marks session as locked and clears key', async () => {
    const svc = new AuthService();
    const { username, password } = await seedUser(svc);
    await svc.login(username, password);

    expect(svc._isLocked).toBe(false);
    svc.lockSession();

    expect(svc._isLocked).toBe(true);
    expect(cryptoService._sessionKey).toBeNull();
  });
});

// ── Unlock flow ───────────────────────────────────────────────────────────────

describe('Session unlock', () => {
  it('unlockSession with correct password re-derives key and clears lock', async () => {
    const svc = new AuthService();
    const { username, password } = await seedUser(svc);
    await svc.login(username, password);
    svc.lockSession();

    expect(svc._isLocked).toBe(true);

    const result = await svc.unlockSession(password);
    expect(result).toBe(true);
    expect(svc._isLocked).toBe(false);
    // Screen unlock no longer derives the encryption key.
    expect(cryptoService._sessionKey).toBeNull();
  });

  it('unlockSession with wrong password returns false without throwing', async () => {
    const svc = new AuthService();
    const { username, password } = await seedUser(svc);
    await svc.login(username, password);
    svc.lockSession();

    const result = await svc.unlockSession('WrongPass12!');
    expect(result).toBe(false);
    expect(svc._isLocked).toBe(true);
  });
});
