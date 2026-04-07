/**
 * Unit tests — BootstrapService first-run initialization.
 *
 * Covers:
 *   - isBootstrapped() returns false when no users exist
 *   - isBootstrapped() returns true after bootstrap
 *   - bootstrap() creates admin user and root org
 *   - bootstrap() refuses to run twice
 *   - bootstrap() validates password policy
 *   - bootstrap() rejects blank username
 *   - bootstrap() rejects blank org name
 *   - bootstrapped admin can log in
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

// ── isBootstrapped ────────────────────────────────────────────────────────────

describe('isBootstrapped', () => {
  it('returns false on a fresh empty database', async () => {
    const svc = new BootstrapService();
    expect(await svc.isBootstrapped()).toBe(false);
  });

  it('returns true after bootstrap is performed', async () => {
    const svc = new BootstrapService();
    await svc.bootstrap({ adminUsername: 'admin', adminPassword: 'Secure12345!', orgName: 'Test Corp' });
    expect(await svc.isBootstrapped()).toBe(true);
  });
});

// ── bootstrap() happy path ────────────────────────────────────────────────────

describe('bootstrap() success path', () => {
  it('creates an administrator user', async () => {
    const svc = new BootstrapService();
    const { admin } = await svc.bootstrap({
      adminUsername: 'superadmin',
      adminPassword: 'Secure12345!',
      orgName: 'Acme Corp',
    });

    expect(admin.username).toBe('superadmin');
    expect(admin.role).toBe(ROLES.ADMINISTRATOR);
    expect(admin.isActive).toBe(true);
    expect(admin.passwordHash).toBeDefined();
    // Password must never be stored in plaintext.
    expect(admin.passwordHash).not.toBe('Secure12345!');
  });

  it('creates a root company org node', async () => {
    const svc = new BootstrapService();
    const { org } = await svc.bootstrap({
      adminUsername: 'admin',
      adminPassword: 'Secure12345!',
      orgName: 'Retail Group',
    });

    expect(org.name).toBe('Retail Group');
    expect(org.type).toBe('company');
    expect(org.parentId).toBeNull();
  });

  it('assigns admin to the root org node', async () => {
    const svc = new BootstrapService();
    const { admin, org } = await svc.bootstrap({
      adminUsername: 'admin',
      adminPassword: 'Secure12345!',
      orgName: 'My Org',
    });

    expect(admin.organizationNodeId).toBe(org.id);
  });

  it('initializes failedLoginAttempts to 0', async () => {
    const svc = new BootstrapService();
    const { admin } = await svc.bootstrap({
      adminUsername: 'admin',
      adminPassword: 'Secure12345!',
      orgName: 'My Org',
    });

    expect(admin.failedLoginAttempts).toBe(0);
    expect(admin.lockoutUntil).toBeNull();
  });
});

// ── bootstrap() re-run prevention ────────────────────────────────────────────

describe('bootstrap() re-run prevention', () => {
  it('throws on second bootstrap attempt', async () => {
    const svc = new BootstrapService();
    await svc.bootstrap({ adminUsername: 'admin', adminPassword: 'Secure12345!', orgName: 'Corp' });
    await expect(
      svc.bootstrap({ adminUsername: 'admin2', adminPassword: 'Secure12345!', orgName: 'Corp 2' }),
    ).rejects.toThrow(/already initialized/i);
  });
});

// ── bootstrap() input validation ─────────────────────────────────────────────

describe('bootstrap() input validation', () => {
  it('rejects blank username', async () => {
    const svc = new BootstrapService();
    await expect(
      svc.bootstrap({ adminUsername: '   ', adminPassword: 'Secure12345!', orgName: 'Org' }),
    ).rejects.toThrow(/username/i);
  });

  it('rejects blank org name', async () => {
    const svc = new BootstrapService();
    await expect(
      svc.bootstrap({ adminUsername: 'admin', adminPassword: 'Secure12345!', orgName: '   ' }),
    ).rejects.toThrow(/organization/i);
  });

  it('enforces password policy — too short', async () => {
    const svc = new BootstrapService();
    await expect(
      svc.bootstrap({ adminUsername: 'admin', adminPassword: 'Short1!', orgName: 'Org' }),
    ).rejects.toThrow(/12/i);
  });

  it('enforces password policy — no digit', async () => {
    const svc = new BootstrapService();
    await expect(
      svc.bootstrap({ adminUsername: 'admin', adminPassword: 'NoDigitHere!!!', orgName: 'Org' }),
    ).rejects.toThrow(/number/i);
  });

  it('enforces password policy — no symbol', async () => {
    const svc = new BootstrapService();
    await expect(
      svc.bootstrap({ adminUsername: 'admin', adminPassword: 'NoSymbol12345', orgName: 'Org' }),
    ).rejects.toThrow(/symbol/i);
  });
});

// ── Post-bootstrap login ──────────────────────────────────────────────────────

describe('Login after bootstrap', () => {
  it('bootstrapped admin can log in successfully', async () => {
    const svc = new BootstrapService();
    await svc.bootstrap({
      adminUsername: 'firstadmin',
      adminPassword: 'Welcome12345!',
      orgName: 'Demo Store',
    });

    const user = await authService.login('firstadmin', 'Welcome12345!');
    await authService.unlockProtectedData('Welcome12345!');
    expect(user.role).toBe(ROLES.ADMINISTRATOR);
    expect(user.username).toBe('firstadmin');
    // Session key should be derived after login.
    expect(cryptoService._sessionKey).not.toBeNull();
  });

  it('wrong password after bootstrap fails', async () => {
    const svc = new BootstrapService();
    await svc.bootstrap({
      adminUsername: 'admin',
      adminPassword: 'Welcome12345!',
      orgName: 'Store',
    });

    await expect(authService.login('admin', 'WrongPass12!')).rejects.toThrow(/Invalid/i);
  });
});
