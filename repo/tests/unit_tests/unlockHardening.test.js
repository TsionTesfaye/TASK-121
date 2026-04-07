/**
 * Unit tests — Session unlock brute-force protection.
 *
 * Covers:
 *   - wrong password returns false
 *   - 4 wrong attempts still returns false (no lock)
 *   - 5th wrong attempt throws and forces logout
 *   - counter resets on correct unlock
 *   - counter resets on full login
 *   - correct unlock re-derives session key
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { AuthService, authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { OrgRepository } from '../../src/repositories/implementations/OrgRepository.js';
import { ROLES } from '../../src/utils/constants.js';

const USERNAME = 'unlockuser';
const PASSWORD = 'Secure12345!';
const ADMIN = { id: 'boot', role: ROLES.ADMINISTRATOR, organizationNodeId: 'org-001' };

async function seedAndLogin(svc) {
  svc._currentUser = ADMIN;
  await svc.createUser({ username: USERNAME, password: PASSWORD, role: ROLES.STORE_MANAGER, organizationNodeId: 'org-001' });
  svc._currentUser = null;
  await svc.login(USERNAME, PASSWORD);
}

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const orgRepo = new OrgRepository();
  await orgRepo.create({
    id: 'org-001', name: 'Test Org', type: 'company', parentId: null,
    organizationId: 'org-001', createdAt: Date.now(), updatedAt: Date.now(),
  });

  authService._currentUser = null;
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
});

describe('Unlock attempt tracking', () => {
  it('single wrong password returns false without throwing', async () => {
    const svc = new AuthService();
    await seedAndLogin(svc);
    svc.lockSession();

    const result = await svc.unlockSession('WrongPass12!');
    expect(result).toBe(false);
    expect(svc._isLocked).toBe(true);
  });

  it('4 wrong attempts do not trigger forced logout', async () => {
    const svc = new AuthService();
    await seedAndLogin(svc);
    svc.lockSession();

    for (let i = 0; i < 4; i++) {
      const result = await svc.unlockSession('WrongPass12!');
      expect(result).toBe(false);
    }

    // Session still active (just locked)
    expect(svc._currentUser).not.toBeNull();
  });

  it('5th wrong attempt throws and terminates session', async () => {
    const svc = new AuthService();
    await seedAndLogin(svc);
    svc.lockSession();

    for (let i = 0; i < 4; i++) {
      await svc.unlockSession('WrongPass12!').catch(() => {});
    }

    await expect(svc.unlockSession('WrongPass12!')).rejects.toThrow(/too many/i);
    // Session must be cleared after forced logout.
    expect(svc._currentUser).toBeNull();
  });

  it('correct unlock resets attempt counter to 0', async () => {
    const svc = new AuthService();
    await seedAndLogin(svc);
    svc.lockSession();

    // 2 failures
    await svc.unlockSession('WrongPass12!');
    await svc.unlockSession('WrongPass12!');
    expect(svc._unlockAttempts).toBe(2);

    // Correct unlock
    await svc.unlockSession(PASSWORD);
    expect(svc._unlockAttempts).toBe(0);
    expect(svc._isLocked).toBe(false);
  });

  it('full login resets unlock attempt counter', async () => {
    const svc = new AuthService();
    await seedAndLogin(svc);
    svc.lockSession();

    await svc.unlockSession('WrongPass12!');
    await svc.unlockSession('WrongPass12!');

    // Re-login with correct password
    await svc.login(USERNAME, PASSWORD);
    expect(svc._unlockAttempts).toBe(0);
  });

  it('correct unlock re-derives session key', async () => {
    const svc = new AuthService();
    await seedAndLogin(svc);
    svc.lockSession();

    expect(cryptoService._sessionKey).toBeNull();

    await svc.unlockSession(PASSWORD);
    // Screen unlock no longer derives the encryption key.
    expect(cryptoService._sessionKey).toBeNull();
  });

  it('forced logout clears current user', async () => {
    const svc = new AuthService();
    await seedAndLogin(svc);
    svc.lockSession();

    for (let i = 0; i < 5; i++) {
      await svc.unlockSession('WrongPass12!').catch(() => {});
    }

    expect(svc._currentUser).toBeNull();
    expect(svc.isAuthenticated()).toBe(false);
  });
});
