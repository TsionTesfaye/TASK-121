/**
 * Unit tests — AuthService.
 *
 * Tests cover:
 *   - password validation rules
 *   - user creation and login
 *   - session lock / unlock
 *   - guest session creation
 *   - account deactivation
 *   - RBAC role checks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { AuthService } from '../../src/services/AuthService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { validatePassword } from '../../src/utils/validation.js';
import { ROLES } from '../../src/utils/constants.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';

// All passwords used in tests must be ≥12 chars with ≥1 digit and ≥1 symbol.
const ADMIN_PW  = 'AdminPass123!';   // bootstrap admin password (= org passphrase)
const VALID_PW  = 'ValidPass12!';
const LOCK_PW   = 'LockTest123!';
const WRONG_PW  = 'WrongPass12!';
const DEACT_PW  = 'ValidPass12!';

let authService;
let orgId;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  const idbFactory = new IDBFactory();
  await initDB(idbFactory);
  authService = new AuthService();

  // Bootstrap creates org, admin user, and org passphrase config.
  const bs = new BootstrapService();
  const { org } = await bs.bootstrap({
    adminUsername: 'unit_admin', adminPassword: ADMIN_PW, orgName: 'UnitTestCo',
  });
  orgId = org.id;
  // Login as admin so createUser calls below have permission.
  await authService.login('unit_admin', ADMIN_PW);
});

afterEach(() => {
  closeDB();
  closeAll();
  vi.useRealTimers();
});

// ── Password validation (pure function — no DB) ───────────────────────────────

describe('validatePassword', () => {
  it('accepts a valid password', () => {
    const { valid } = validatePassword('SecurePass1!');
    expect(valid).toBe(true);
  });

  it('rejects a password shorter than 12 characters', () => {
    const { valid, errors } = validatePassword('Short1!');
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('12'))).toBe(true);
  });

  it('rejects a password without a number', () => {
    const { valid, errors } = validatePassword('NoNumberHere!');
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('number'))).toBe(true);
  });

  it('rejects a password without a symbol', () => {
    const { valid, errors } = validatePassword('NoSymbolHere12');
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('symbol'))).toBe(true);
  });

  it('rejects an empty string', () => {
    const { valid } = validatePassword('');
    expect(valid).toBe(false);
  });

  it('accepts a password that is exactly 12 characters with digit and symbol', () => {
    const { valid } = validatePassword('Exactly12Ch1!');
    expect(valid).toBe(true);
  });
});

// ── User creation ─────────────────────────────────────────────────────────────

describe('AuthService.createUser', () => {
  it('creates a user and returns a record with the correct role', async () => {
    const user = await authService.createUser({
      username: 'alice',
      password: 'SecurePass12!',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: orgId,
    });

    expect(user.username).toBe('alice');
    expect(user.role).toBe(ROLES.STORE_MANAGER);
    expect(user.isActive).toBe(true);
    expect(user.passwordHash).toBeDefined();
    expect(user.passwordSalt).toBeDefined();
    expect(user.passwordHash).not.toBe('SecurePass1!');
  });

  it('throws if password does not meet rules', async () => {
    await expect(
      authService.createUser({
        username: 'bob',
        password: 'weak',
        role: ROLES.ANALYST,
        organizationNodeId: orgId,
      }),
    ).rejects.toThrow();
  });

  it('throws if called without admin role', async () => {
    authService._currentUser = { id: 'user-001', role: ROLES.STORE_MANAGER };
    await expect(
      authService.createUser({
        username: 'charlie',
        password: 'SecurePass12!',
        role: ROLES.ANALYST,
        organizationNodeId: orgId,
      }),
    ).rejects.toThrow('Permission denied');
  });
});

// ── Login / logout ────────────────────────────────────────────────────────────

describe('AuthService.login', () => {
  beforeEach(async () => {
    await authService.createUser({
      username: 'diana',
      password: VALID_PW,
      role: ROLES.ANALYST,
      organizationNodeId: orgId,
    });
    authService._currentUser = null;
  });

  it('logs in with correct credentials', async () => {
    const user = await authService.login('diana', VALID_PW);
    expect(user.username).toBe('diana');
    expect(authService.isAuthenticated()).toBe(true);
    expect(authService.isLocked()).toBe(false);
  });

  it('throws on wrong password', async () => {
    await expect(authService.login('diana', WRONG_PW)).rejects.toThrow(
      'Invalid credentials',
    );
  });

  it('throws on unknown username', async () => {
    await expect(authService.login('nobody', VALID_PW)).rejects.toThrow(
      'Invalid credentials',
    );
  });

  it('rejects login for a deactivated account', async () => {
    await authService.login('unit_admin', ADMIN_PW);
    const created = await authService.createUser({
      username: 'deactivated_user',
      password: DEACT_PW,
      role: ROLES.REVIEWER,
      organizationNodeId: orgId,
    });
    await authService.deactivateAccount(created.id);
    authService._currentUser = null;

    await expect(authService.login('deactivated_user', DEACT_PW)).rejects.toThrow(
      'Invalid credentials',
    );
  });
});

// ── Session lock / unlock ─────────────────────────────────────────────────────

describe('AuthService lock / unlock', () => {
  beforeEach(async () => {
    await authService.createUser({
      username: 'edgar',
      password: LOCK_PW,
      role: ROLES.ANALYST,
      organizationNodeId: orgId,
    });
    await authService.logout();
    await authService.login('edgar', LOCK_PW);
  });

  it('isLocked returns false after login', () => {
    expect(authService.isLocked()).toBe(false);
  });

  it('lockSession marks the session as locked', () => {
    authService.lockSession();
    expect(authService.isLocked()).toBe(true);
  });

  it('unlockSession with correct password unlocks', async () => {
    authService.lockSession();
    const result = await authService.unlockSession(LOCK_PW);
    expect(result).toBe(true);
    expect(authService.isLocked()).toBe(false);
  });

  it('unlockSession with wrong password returns false', async () => {
    authService.lockSession();
    const result = await authService.unlockSession(WRONG_PW);
    expect(result).toBe(false);
    expect(authService.isLocked()).toBe(true);
  });
});

// ── Guest session ─────────────────────────────────────────────────────────────

describe('AuthService guest session', () => {
  it('creates a guest session with read-only role', async () => {
    const expiryCalled = vi.fn();
    const guest = await authService.createGuestSession(expiryCalled);

    expect(guest.isGuest).toBe(true);
    expect(guest.role).toBe(ROLES.GUEST);
    expect(authService.isGuest()).toBe(true);
    expect(authService.isAuthenticated()).toBe(false);
  });

  it('calls the expiry callback after 30 minutes', async () => {
    vi.useFakeTimers();
    const expiryCalled = vi.fn();

    // Create a fresh service so the BroadcastChannel subscribe from the
    // constructor is registered after fake timers are set up.
    const svc = new AuthService();
    await svc.createGuestSession(expiryCalled);

    // runAllTimersAsync advances fake timers AND flushes all resulting promises.
    await vi.runAllTimersAsync();

    expect(expiryCalled).toHaveBeenCalledOnce();
  });
});

// ── RBAC ──────────────────────────────────────────────────────────────────────

describe('AuthService RBAC', () => {
  it('administrator has all roles', () => {
    authService._currentUser = { id: 'a', role: ROLES.ADMINISTRATOR, organizationNodeId: orgId };
    expect(authService.hasRole(ROLES.STORE_MANAGER)).toBe(true);
    expect(authService.hasRole(ROLES.ANALYST)).toBe(true);
    expect(authService.hasRole(ROLES.REVIEWER)).toBe(true);
  });

  it('store_manager does not have admin role', () => {
    authService._currentUser = { id: 'b', role: ROLES.STORE_MANAGER };
    expect(authService.hasRole(ROLES.ADMINISTRATOR)).toBe(false);
    expect(authService.hasRole(ROLES.STORE_MANAGER)).toBe(true);
  });

  it('hasRole returns false when no user', () => {
    authService._currentUser = null;
    expect(authService.hasRole(ROLES.ANALYST)).toBe(false);
  });
});
