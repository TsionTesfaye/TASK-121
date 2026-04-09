/**
 * AuthService — local-only authentication, session, and password management.
 *
 * Responsibilities:
 *   - username/password login and logout
 *   - login lockout (5 failed attempts → 15-minute lock)
 *   - password validation (min 12 chars, ≥1 digit, ≥1 symbol)
 *   - guest trial session (read-only, 30-minute hard expiry)
 *   - inactivity auto-lock (10 minutes)
 *   - password change with session-key rotation
 *   - account deactivation
 *   - RBAC role resolution
 *
 * Encryption model:
 *   The data encryption key is derived from the org passphrase. At bootstrap the
 *   org passphrase defaults to the admin password. The passphrase is wrapped
 *   (encrypted) with a key derived from each user's login password and stored
 *   per-user. On login and unlock, the wrapped passphrase is automatically
 *   unwrapped and used to derive the session encryption key — no separate
 *   passphrase prompt is required.
 */

import { UserRepository } from '../repositories/implementations/UserRepository.js';
import { OrgRepository } from '../repositories/implementations/OrgRepository.js';
import { AppConfigRepository } from '../repositories/implementations/AppConfigRepository.js';
import { LinkedAccountRepository } from '../repositories/implementations/RiskRepository.js';
import { CustomerRepository } from '../repositories/implementations/CustomerRepository.js';
import { decryptField, encryptField } from '../infrastructure/crypto/webCrypto.js';
import { cryptoService } from './CryptoService.js';
import { auditService } from './AuditService.js';
import { generateId } from '../utils/idGenerator.js';
import { validatePassword, isValidRole } from '../utils/validation.js';
import { ROLES, VALIDATION } from '../utils/constants.js';
import { cancel, schedule } from '../infrastructure/scheduler/timerManager.js';
import {
  broadcast,
  subscribe,
  CHANNEL_NAMES,
  EVENT_TYPES,
} from '../infrastructure/broadcast/broadcastManager.js';

const LOCK_TIMER_KEY = 'auth:auto_lock';
const GUEST_TIMER_KEY = 'auth:guest_expiry';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60_000; // 15 minutes
/** Max wrong-password attempts on unlockSession before forcing full logout. */
const MAX_UNLOCK_ATTEMPTS = 5;

export class AuthService {
  constructor() {
    this._userRepo = new UserRepository();
    /** @type {object | null} Currently active user record. */
    this._currentUser = null;
    /** @type {boolean} */
    this._isLocked = false;
    /** @type {boolean} */
    this._isGuestSession = false;
    /**
     * In-memory counter for failed unlockSession attempts.
     * Resets on successful unlock or full login.
     * Not persisted — physical access resets it (acceptable for local-only app).
     * @type {number}
     */
    this._unlockAttempts = 0;

    // Listen for lock events broadcast from other tabs.
    subscribe(CHANNEL_NAMES.STATE, (event) => {
      if (event.type === EVENT_TYPES.SESSION_LOCKED) {
        this._isLocked = true;
        cryptoService.clearSessionKey();
      } else if (event.type === EVENT_TYPES.SESSION_LOGGED_OUT) {
        this._currentUser = null;
        this._isLocked = false;
        cryptoService.clearSessionKey();
      }
    });
  }

  // ── Login / logout ───────────────────────────────────────────────────────────

  /**
   * Authenticates a user with username and password.
   * Derives the session encryption key on success.
   * Tracks failed attempts; locks account for 15 minutes after 5 failures.
   *
   * @param {string} username
   * @param {string} password
   * @returns {Promise<object>}  The authenticated user record.
   * @throws {Error} On invalid credentials, deactivated account, or lockout.
   */
  async login(username, password) {
    const user = await this._userRepo.findByUsername(username);

    // All failure paths return the same generic message to prevent enumeration.
    if (!user) throw new Error('Invalid credentials.');
    if (!user.isActive) throw new Error('Invalid credentials.');

    const now = Date.now();
    if (user.lockoutUntil && now < user.lockoutUntil) {
      throw new Error('Invalid credentials.');
    }

    const valid = await cryptoService.verifyPassword(password, user.passwordSalt, user.passwordHash);

    if (!valid) {
      const failedAttempts = (user.failedLoginAttempts ?? 0) + 1;
      const lockoutUntil = failedAttempts >= MAX_FAILED_ATTEMPTS
        ? Date.now() + LOCKOUT_DURATION_MS
        : null;

      await this._userRepo.update(user.id, {
        ...user,
        failedLoginAttempts: failedAttempts,
        lockoutUntil,
        updatedAt: Date.now(),
      });

      // Generic error — same message regardless of lockout to prevent enumeration.
      throw new Error('Invalid credentials.');
    }

    // Success: clear failure state.
    const freshUser = {
      ...user,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      updatedAt: Date.now(),
    };
    await this._userRepo.update(user.id, freshUser);

    this._currentUser = freshUser;
    this._isLocked = false;
    this._isGuestSession = false;
    this._unlockAttempts = 0; // reset on any successful login

    // Auto-restore protected-data decryption if user has a wrapped passphrase.
    await this._restoreEncryptionKey(freshUser, password);

    this._resetLockTimer();

    await auditService.log({
      actorId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
    });

    return freshUser;
  }

  /**
   * Logs out the current user and clears all session state.
   * @returns {Promise<void>}
   */
  async logout() {
    if (this._currentUser) {
      await auditService.log({
        actorId: this._currentUser.id,
        action: 'logout',
        entityType: 'user',
        entityId: this._currentUser.id,
      });
    }

    cancel(LOCK_TIMER_KEY);
    cancel(GUEST_TIMER_KEY);
    cryptoService.clearSessionKey();

    this._currentUser = null;
    this._isLocked = false;
    this._isGuestSession = false;

    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_LOGGED_OUT);
  }

  // ── Guest session ────────────────────────────────────────────────────────────

  /**
   * Creates a temporary read-only guest session.
   * Hard-expires after 30 minutes and auto-redirects to login.
   *
   * @param {(reason: string) => void} onExpiry  Called when the guest session expires.
   * @returns {{ id: string; role: string; isGuest: true }}
   */
  async createGuestSession(onExpiry) {
    // Attach guest to the root org so they can explore read-only data.
    const allUsers = await this._userRepo.findAll();
    const adminUser = allUsers.find((u) => u.role === ROLES.ADMINISTRATOR);
    const guestOrgId = adminUser?.organizationNodeId ?? null;

    const guestUser = {
      id: `guest_${Date.now()}`,
      username: 'guest',
      role: ROLES.GUEST,
      organizationNodeId: guestOrgId,
      isActive: true,
      isGuest: true,
      guestExpiresAt: Date.now() + VALIDATION.GUEST_TRIAL_MINUTES * 60_000,
    };

    this._currentUser = guestUser;
    this._isGuestSession = true;

    schedule(
      GUEST_TIMER_KEY,
      async () => {
        onExpiry('Guest trial expired after 30 minutes.');
        await this.logout();
      },
      VALIDATION.GUEST_TRIAL_MINUTES * 60_000,
    );

    return guestUser;
  }

  // ── Inactivity lock ──────────────────────────────────────────────────────────

  /**
   * Resets the inactivity auto-lock timer.
   * Must be called on every user interaction.
   */
  resetInactivityTimer() {
    if (!this._currentUser || this._isGuestSession) return;
    this._resetLockTimer();
  }

  /** @private */
  _resetLockTimer() {
    schedule(
      LOCK_TIMER_KEY,
      () => {
        this.lockSession();
      },
      VALIDATION.AUTO_LOCK_MINUTES * 60_000,
    );
  }

  /**
   * Locks the session — encrypted data becomes inaccessible until unlock.
   */
  lockSession() {
    cryptoService.clearSessionKey();
    this._isLocked = true;
    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_LOCKED);
  }

  /**
   * Unlocks the session by re-deriving the encryption key.
   *
   * @param {string} password
   * @returns {Promise<boolean>}
   */
  async unlockSession(password) {
    if (!this._currentUser) throw new Error('No active session to unlock.');

    const user = await this._userRepo.findById(this._currentUser.id);
    if (!user) throw new Error('User record not found.');

    const valid = await cryptoService.verifyPassword(password, user.passwordSalt, user.passwordHash);

    if (!valid) {
      this._unlockAttempts += 1;
      if (this._unlockAttempts >= MAX_UNLOCK_ATTEMPTS) {
        // Too many wrong attempts — force full logout to prevent brute-force.
        await this.logout();
        throw new Error(
          `Too many failed unlock attempts (${MAX_UNLOCK_ATTEMPTS}). ` +
            'Session has been terminated. Please log in again.',
        );
      }
      return false;
    }

    // Successful unlock — reset counter, clear lock, restore encryption key.
    this._unlockAttempts = 0;
    this._isLocked = false;

    // Auto-restore protected-data decryption from wrapped passphrase.
    await this._restoreEncryptionKey(user, password);

    this._resetLockTimer();
    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_UNLOCKED);
    return true;
  }

  // ── Account management ───────────────────────────────────────────────────────

  /**
   * Creates a new user account.
   * Requires administrator role.
   *
   * @param {{ username: string; password: string; role: string; organizationNodeId: string }} params
   * @returns {Promise<object>}
   */
  async createUser({ username, password, role, organizationNodeId }) {
    this._assertPermission('administrator');

    const pwValidation = validatePassword(password);
    if (!pwValidation.valid) throw new Error(pwValidation.errors.join(' '));
    if (!isValidRole(role)) throw new Error(`Invalid role: ${role}`);

    // Non-admin/non-guest roles require a valid org node assignment.
    if (role !== ROLES.ADMINISTRATOR && role !== ROLES.GUEST) {
      if (!organizationNodeId) {
        throw new Error(`Role '${role}' requires an organizationNodeId.`);
      }
      const orgRepo = new OrgRepository();
      const node = await orgRepo.findById(organizationNodeId);
      if (!node) {
        throw new Error(`Organization node '${organizationNodeId}' not found.`);
      }
    }

    const { hash, salt } = await cryptoService.hashNewPassword(password);

    const user = {
      id: generateId(),
      username,
      passwordHash: hash,
      passwordSalt: salt,
      role,
      organizationNodeId,
      isActive: true,
      isGuest: false,
      guestExpiresAt: null,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this._userRepo.create(user);
    await auditService.log({
      actorId: this._currentUser?.id ?? 'system',
      action: 'create_user',
      entityType: 'user',
      entityId: user.id,
      metadata: { username, role },
    });

    return user;
  }

  /**
   * Links two user accounts. Persisted to the linkedAccounts store.
   * Prevents duplicates (A-B == B-A) and self-links.
   * Requires: ADMINISTRATOR role.
   *
   * @param {{ userIdA: string; userIdB: string; reason: string }} params
   * @returns {Promise<object>}
   */
  async linkUserAccounts({ userIdA, userIdB, reason }) {
    this._assertPermission('administrator');
    if (!userIdA || !userIdB) throw new Error('Both user IDs are required.');
    if (userIdA === userIdB) throw new Error('Cannot link a user to themselves.');
    if (!reason?.trim() || reason.trim().length < 10) throw new Error('Reason must be at least 10 characters.');

    const a = await this._userRepo.findById(userIdA);
    const b = await this._userRepo.findById(userIdB);
    if (!a) throw new Error(`User '${userIdA}' not found.`);
    if (!b) throw new Error(`User '${userIdB}' not found.`);

    // Duplicate check (A-B == B-A)
    const linkRepo = new LinkedAccountRepository();
    const existingA = await linkRepo.findAllLinksForUser(userIdA);
    const isDuplicate = existingA.some(
      (l) => (l.primaryUserId === userIdB || l.linkedUserId === userIdB),
    );
    if (isDuplicate) throw new Error('These users are already linked.');

    const link = {
      id: generateId(),
      primaryUserId: userIdA,
      linkedUserId: userIdB,
      evidenceType: 'admin_link',
      evidenceDetails: reason,
      organizationId: a.organizationNodeId,
      createdAt: Date.now(),
    };
    await linkRepo.create(link);

    await auditService.log({
      actorId: this._currentUser?.id ?? 'system',
      action: 'link_user_accounts',
      entityType: 'user',
      entityId: userIdA,
      metadata: { linkedTo: userIdB, reason },
    });

    return link;
  }

  /**
   * Returns all account links for a user.
   * Requires: ADMINISTRATOR role.
   * @param {string} userId
   * @returns {Promise<object[]>}
   */
  async getLinkedAccounts(userId) {
    this._assertPermission('administrator');
    const linkRepo = new LinkedAccountRepository();
    return linkRepo.findAllLinksForUser(userId);
  }

  /**
   * Removes an account link.
   * Requires: ADMINISTRATOR role.
   * @param {string} linkId
   * @returns {Promise<void>}
   */
  async unlinkAccounts(linkId) {
    this._assertPermission('administrator');
    const linkRepo = new LinkedAccountRepository();
    const link = await linkRepo.findById(linkId);
    if (!link) throw new Error(`Link '${linkId}' not found.`);
    await linkRepo.delete(linkId);
    await auditService.log({
      actorId: this._currentUser?.id ?? 'system',
      action: 'unlink_user_accounts',
      entityType: 'user',
      entityId: linkId,
    });
  }

  /**
   * Changes a user's login password.
   * Re-wraps the org passphrase with the new password so that future
   * login/unlock continues to auto-restore decryption capability.
   *
   * @param {string} userId
   * @param {string} oldPassword
   * @param {string} newPassword
   * @returns {Promise<void>}
   */
  async changePassword(userId, oldPassword, newPassword) {
    const pwValidation = validatePassword(newPassword);
    if (!pwValidation.valid) throw new Error(pwValidation.errors.join(' '));

    const user = await this._userRepo.findById(userId);
    if (!user) throw new Error('User not found.');

    const valid = await cryptoService.verifyPassword(oldPassword, user.passwordSalt, user.passwordHash);
    if (!valid) throw new Error('Old password is incorrect.');

    const { hash, salt } = await cryptoService.hashNewPassword(newPassword);

    // Re-wrap the org passphrase with the new password if previously enrolled.
    let reWrapped = {};
    if (user.wrappedOrgPassphrase && user.wrappedOrgPassphraseIv && user.wrappingSalt) {
      try {
        const orgPassphrase = await cryptoService.unwrapPassphrase(
          user.wrappedOrgPassphrase, user.wrappedOrgPassphraseIv,
          oldPassword, user.wrappingSalt,
        );
        const newWrappingSalt = cryptoService.generateOrgSalt();
        const wrapped = await cryptoService.wrapPassphrase(orgPassphrase, newPassword, newWrappingSalt);
        reWrapped = {
          wrappedOrgPassphrase: wrapped.ciphertext,
          wrappedOrgPassphraseIv: wrapped.iv,
          wrappingSalt: newWrappingSalt,
        };
      } catch {
        // If unwrap fails, clear the stale wrapped passphrase.
        reWrapped = {
          wrappedOrgPassphrase: null,
          wrappedOrgPassphraseIv: null,
          wrappingSalt: null,
        };
      }
    }

    await this._userRepo.update(userId, {
      ...user,
      passwordHash: hash,
      passwordSalt: salt,
      ...reWrapped,
      updatedAt: Date.now(),
    });

    await auditService.log({
      actorId: userId,
      action: 'change_password',
      entityType: 'user',
      entityId: userId,
    });
  }

  /**
   * Deactivates a user account.
   * Requires administrator role.
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async deactivateAccount(userId) {
    this._assertPermission('administrator');

    const user = await this._userRepo.findById(userId);
    if (!user) throw new Error('User not found.');

    await this._userRepo.update(userId, { ...user, isActive: false, updatedAt: Date.now() });

    // Force-logout the deactivated user if they are the current session.
    if (this._currentUser?.id === userId) {
      await this.logout();
    }
    // Broadcast so other tabs also invalidate.
    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_LOGGED_OUT);

    await auditService.log({
      actorId: this._currentUser?.id ?? 'system',
      action: 'deactivate_account',
      entityType: 'user',
      entityId: userId,
    });
  }

  // ── User listing ────────────────────────────────────────────────────────────

  /**
   * Returns all user accounts.
   * Requires: ADMINISTRATOR role.
   *
   * @returns {Promise<object[]>}
   */
  async listUsers() {
    this._assertPermission('administrator');
    return this._userRepo.findAll();
  }

  // ── State accessors ──────────────────────────────────────────────────────────

  /** @returns {object | null} */
  getCurrentUser() {
    return this._currentUser;
  }

  /** @returns {boolean} */
  isAuthenticated() {
    return this._currentUser !== null && !this._isGuestSession;
  }

  /** @returns {boolean} */
  isLocked() {
    return this._isLocked;
  }

  /**
   * Throws if the session is locked. Call from mutation paths.
   */
  requireUnlocked() {
    if (this._isLocked) throw new Error('Session is locked. Unlock to perform this action.');
  }

  /** @returns {boolean} */
  isGuest() {
    return this._isGuestSession;
  }

  /**
   * Returns true if the current user has the given role or Administrator access.
   * @param {string} requiredRole
   * @returns {boolean}
   */
  hasRole(requiredRole) {
    if (!this._currentUser) return false;
    if (this._currentUser.role === ROLES.ADMINISTRATOR) return true;
    return this._currentUser.role === requiredRole;
  }

  // ── Org passphrase management ────────────────────────────────────────────────

  /**
   * Sets up or updates the org-level passphrase for protected data encryption.
   * Derives the encryption key from orgPassphrase + orgSalt and stores a verifier.
   * Requires: ADMINISTRATOR role.
   *
   * @param {string} orgPassphrase  The new org passphrase.
   * @returns {Promise<void>}
   */
  async setupOrgPassphrase(orgPassphrase) {
    this._assertPermission('administrator');
    if (!orgPassphrase || orgPassphrase.length < 12) {
      throw new Error('Org passphrase must be at least 12 characters.');
    }

    const user = this._currentUser;
    const { config, rootOrgId } = await this._resolveOrgConfig(user);
    if (!config) throw new Error('Organization config not found.');

    // Hash the passphrase for future verification.
    const { hash, salt } = await cryptoService.hashNewPassword(orgPassphrase);

    // Update config with passphrase verifier and encryption model flag.
    const configRepo = new AppConfigRepository();
    await configRepo.update(config.id, {
      ...config,
      orgPassphraseHash: hash,
      orgPassphraseSalt: salt,
      encryptionModel: 'passphrase',
    });

    // Derive and set session key from orgPassphrase + orgEncryptionSalt.
    await cryptoService.deriveSessionKey(orgPassphrase, config.orgEncryptionSalt);

    await auditService.log({
      actorId: user.id,
      action: 'setup_org_passphrase',
      entityType: 'system',
      entityId: rootOrgId,
    });
  }

  /**
   * Unlocks protected data using the org passphrase and enrolls the current user
   * for automatic key restoration on future login/unlock by wrapping the passphrase
   * with the user's login password.
   *
   * After first enrollment, the user's login password alone is sufficient to
   * restore decryption capability (via the wrapped passphrase stored per-user).
   *
   * @param {string} orgPassphrase
   * @param {string} [loginPassword]  The user's current login password (required for enrollment).
   * @returns {Promise<boolean>}
   */
  async unlockProtectedData(orgPassphrase, loginPassword) {
    this._assertPermission('store_manager');

    const { config } = await this._resolveOrgConfig(this._currentUser);
    if (!config) throw new Error('Organization config not found.');
    if (!config.orgPassphraseHash || !config.orgPassphraseSalt) {
      throw new Error('Org passphrase not configured. An administrator must set it up first.');
    }

    const valid = await cryptoService.verifyPassword(
      orgPassphrase,
      config.orgPassphraseSalt,
      config.orgPassphraseHash,
    );
    if (!valid) return false;

    await cryptoService.deriveSessionKey(orgPassphrase, config.orgEncryptionSalt);

    // If login password is provided, wrap the org passphrase for future auto-unlock.
    if (loginPassword && this._currentUser) {
      await this._wrapAndStorePassphrase(this._currentUser, loginPassword, orgPassphrase);
    }

    return true;
  }

  /**
   * Migrates encrypted records from the old password-derived model to the new
   * org-passphrase model. Decrypts all sensitive customer fields with the old
   * key and re-encrypts them with the new passphrase-derived key.
   * Requires: ADMINISTRATOR role.
   *
   * @param {string} oldLoginPassword  The admin's login password (old key source).
   * @param {string} orgPassphrase     The new org passphrase.
   * @returns {Promise<number>}  Number of records migrated.
   */
  async migrateToOrgPassphrase(oldLoginPassword, orgPassphrase) {
    this._assertPermission('administrator');
    if (!orgPassphrase || orgPassphrase.length < 12) {
      throw new Error('Org passphrase must be at least 12 characters.');
    }

    const user = this._currentUser;
    const { config } = await this._resolveOrgConfig(user);
    if (!config) throw new Error('Organization config not found.');
    if (config.orgPassphraseHash) {
      throw new Error('Already using passphrase model. No migration needed.');
    }

    // Derive old key (password + org salt).
    const oldKey = await cryptoService.deriveKeyRaw(oldLoginPassword, config.orgEncryptionSalt);
    // Derive new key (passphrase + org salt).
    const newKey = await cryptoService.deriveKeyRaw(orgPassphrase, config.orgEncryptionSalt);

    // Re-encrypt all customer sensitive fields.
    const custRepo = new CustomerRepository();
    const customers = await custRepo.findAll();
    let migrated = 0;

    for (const c of customers) {
      const updates = { ...c };
      let changed = false;

      if (c.storedValueCiphertext && c.storedValueIv) {
        const plain = await decryptField(c.storedValueCiphertext, c.storedValueIv, oldKey);
        const enc = await encryptField(plain, newKey);
        updates.storedValueCiphertext = enc.ciphertext;
        updates.storedValueIv = enc.iv;
        changed = true;
      }
      if (c.allergiesCiphertext && c.allergiesIv) {
        const plain = await decryptField(c.allergiesCiphertext, c.allergiesIv, oldKey);
        const enc = await encryptField(plain, newKey);
        updates.allergiesCiphertext = enc.ciphertext;
        updates.allergiesIv = enc.iv;
        changed = true;
      }
      if (c.materialRestrictionsCiphertext && c.materialRestrictionsIv) {
        const plain = await decryptField(c.materialRestrictionsCiphertext, c.materialRestrictionsIv, oldKey);
        const enc = await encryptField(plain, newKey);
        updates.materialRestrictionsCiphertext = enc.ciphertext;
        updates.materialRestrictionsIv = enc.iv;
        changed = true;
      }

      if (changed) {
        await custRepo.update(c.id, updates);
        migrated++;
      }
    }

    // Set up the passphrase model.
    await this.setupOrgPassphrase(orgPassphrase);

    await auditService.log({
      actorId: user.id,
      action: 'migrate_encryption_model',
      entityType: 'system',
      entityId: 'encryption',
      metadata: { migratedRecords: migrated },
    });

    return migrated;
  }

  /**
   * Returns the encryption model in use. Always 'passphrase' —
   * password-based encryption has been removed.
   * @returns {Promise<string>}
   */
  async getEncryptionModel() {
    return 'passphrase';
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Resolves the org config and root org ID for a user.
   * @param {object} user
   * @returns {Promise<{ config: object | null; rootOrgId: string | null }>}
   */
  async _resolveOrgConfig(user) {
    if (!user?.organizationNodeId) return { config: null, rootOrgId: null };
    const configRepo = new AppConfigRepository();
    const orgRepo = new OrgRepository();
    const node = await orgRepo.findById(user.organizationNodeId);
    const rootOrgId = node?.organizationId ?? user.organizationNodeId;
    const config = await configRepo.findByOrg(rootOrgId);
    return { config, rootOrgId };
  }

  /**
   * Throws if the current user does not have the required role.
   * @param {string} requiredRole
   */
  _assertPermission(requiredRole) {
    if (!this.hasRole(requiredRole)) {
      throw new Error(`Permission denied. Required role: ${requiredRole}`);
    }
  }

  /**
   * Wraps the org passphrase with a key derived from the user's login password
   * and stores the wrapped passphrase on the user record.
   *
   * @param {object} user      The user record.
   * @param {string} password  The user's login password.
   * @param {string} orgPassphrase  The org passphrase to wrap.
   * @returns {Promise<void>}
   */
  async _wrapAndStorePassphrase(user, password, orgPassphrase) {
    const wrappingSalt = cryptoService.generateOrgSalt();
    const wrapped = await cryptoService.wrapPassphrase(orgPassphrase, password, wrappingSalt);
    await this._userRepo.update(user.id, {
      ...user,
      wrappedOrgPassphrase: wrapped.ciphertext,
      wrappedOrgPassphraseIv: wrapped.iv,
      wrappingSalt,
      updatedAt: Date.now(),
    });
  }

  /**
   * Restores the data encryption key by unwrapping the org passphrase stored
   * on the user record. Called automatically after successful login or unlock.
   *
   * @param {object} user      The user record.
   * @param {string} password  The user's login password.
   * @returns {Promise<void>}
   */
  async _restoreEncryptionKey(user, password) {
    if (!user.wrappedOrgPassphrase || !user.wrappedOrgPassphraseIv || !user.wrappingSalt) {
      return; // Not yet enrolled — user must call unlockProtectedData first.
    }
    try {
      const orgPassphrase = await cryptoService.unwrapPassphrase(
        user.wrappedOrgPassphrase,
        user.wrappedOrgPassphraseIv,
        password,
        user.wrappingSalt,
      );
      const { config } = await this._resolveOrgConfig(user);
      if (config?.orgEncryptionSalt) {
        await cryptoService.deriveSessionKey(orgPassphrase, config.orgEncryptionSalt);
      }
    } catch {
      // Unwrap failed (e.g. password changed without re-wrapping) — silently skip.
      // User can still manually unlock via unlockProtectedData if needed.
    }
  }
}

export const authService = new AuthService();
