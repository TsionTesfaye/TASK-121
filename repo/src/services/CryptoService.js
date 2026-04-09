/**
 * CryptoService — application-level encryption facade.
 *
 * Wraps the low-level webCrypto module to provide domain-oriented methods.
 * Holds the in-session derived CryptoKey; cleared on lock/logout.
 */

import {
  hashPassword,
  verifyPassword,
  deriveKey,
  encryptField,
  decryptField,
  generateSalt,
  generateIv,
  toHex,
  fromHex,
} from '../infrastructure/crypto/webCrypto.js';

export class CryptoService {
  constructor() {
    /** @type {CryptoKey | null} Active session data key. */
    this._sessionKey = null;
  }

  // ── Password ────────────────────────────────────────────────────────────────

  /**
   * Hashes a new password with a fresh random salt.
   * @param {string} password
   * @returns {Promise<{ hash: string; salt: string }>}  Both hex-encoded.
   */
  async hashNewPassword(password) {
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    return { hash, salt: toHex(salt) };
  }

  /**
   * Verifies a password against stored hex hash + salt.
   * @param {string} password
   * @param {string} saltHex
   * @param {string} hashHex
   * @returns {Promise<boolean>}
   */
  async verifyPassword(password, saltHex, hashHex) {
    return verifyPassword(password, saltHex, hashHex);
  }

  // ── Session key ─────────────────────────────────────────────────────────────

  /**
   * Derives and caches the session data key from the user's password and salt.
   * Must be called after successful login.
   *
   * @param {string} password
   * @param {string} saltHex
   * @returns {Promise<void>}
   */
  async deriveSessionKey(password, saltHex) {
    const salt = fromHex(saltHex);
    this._sessionKey = await deriveKey(password, salt);
  }

  /**
   * Sets the session key directly from an imported/shared CryptoKey.
   * Used for org-level shared encryption where all authorized users
   * in the same org share the same data encryption key.
   *
   * @param {CryptoKey} key
   */
  setSessionKey(key) {
    this._sessionKey = key;
  }

  /**
   * Derives and returns a key without caching it. Useful for key-wrapping.
   * @param {string} password
   * @param {string} saltHex
   * @returns {Promise<CryptoKey>}
   */
  async deriveKeyRaw(password, saltHex) {
    const salt = fromHex(saltHex);
    return deriveKey(password, salt);
  }

  /**
   * Clears the in-memory session key.
   * Called on lock or logout.
   */
  clearSessionKey() {
    this._sessionKey = null;
  }

  /**
   * Returns true if a session key is currently held in memory.
   * @returns {boolean}
   */
  isUnlocked() {
    return this._sessionKey !== null;
  }

  /**
   * Generates a hex-encoded random salt for org-level key derivation.
   * @returns {string}
   */
  generateOrgSalt() {
    return toHex(generateSalt());
  }

  // ── Field encryption ────────────────────────────────────────────────────────

  /**
   * Encrypts a plaintext field value using the active session key.
   * @param {string} plaintext
   * @returns {Promise<{ ciphertext: string; iv: string; algorithmVersion: string }>}
   */
  async encrypt(plaintext) {
    if (!this._sessionKey) throw new Error('Session is locked. Cannot encrypt.');
    return encryptField(plaintext, this._sessionKey);
  }

  /**
   * Decrypts a field using the active session key.
   * @param {string} ciphertextB64
   * @param {string} ivHex
   * @returns {Promise<string>}
   */
  async decrypt(ciphertextB64, ivHex) {
    if (!this._sessionKey) throw new Error('Session is locked. Cannot decrypt.');
    return decryptField(ciphertextB64, ivHex, this._sessionKey);
  }

  // ── Key rotation ────────────────────────────────────────────────────────────

  /**
   * Re-encrypts a collection of field envelopes from oldPassword to newPassword.
   * Used during password change.
   *
   * @param {Array<{ ciphertext: string; iv: string }>} envelopes
   * @param {string} oldPassword
   * @param {string} saltHex   The user's existing salt (unchanged on password change).
   * @param {string} newPassword
   * @returns {Promise<Array<{ ciphertext: string; iv: string; algorithmVersion: string }>>}
   */
  async rotateEncryptedFields(envelopes, oldPassword, saltHex, newPassword) {
    const salt = fromHex(saltHex);
    const oldKey = await deriveKey(oldPassword, salt);
    const newKey = await deriveKey(newPassword, salt);

    const results = [];
    for (const { ciphertext, iv } of envelopes) {
      const plaintext = await decryptField(ciphertext, iv, oldKey);
      const reEncrypted = await encryptField(plaintext, newKey);
      results.push(reEncrypted);
    }
    return results;
  }

  // ── Backup encryption ───────────────────────────────────────────────────────

  /**
   * Derives a one-time key from a backup passphrase for export encryption.
   * Uses a fixed salt embedded in the backup file (the passphrase salt).
   *
   * @param {string} backupPassphrase
   * @returns {Promise<{ key: CryptoKey; saltHex: string }>}
   */
  async deriveBackupKey(backupPassphrase) {
    const salt = generateSalt();
    const key = await deriveKey(backupPassphrase, salt);
    return { key, saltHex: toHex(salt) };
  }

  /**
   * Derives a backup decryption key given the passphrase and the stored salt.
   * @param {string} backupPassphrase
   * @param {string} saltHex
   * @returns {Promise<CryptoKey>}
   */
  async resolveBackupKey(backupPassphrase, saltHex) {
    const salt = fromHex(saltHex);
    return deriveKey(backupPassphrase, salt);
  }

  /**
   * Encrypts the backup JSON string with the provided backup key.
   * @param {string} json
   * @param {CryptoKey} key
   * @returns {Promise<{ ciphertext: string; iv: string; algorithmVersion: string }>}
   */
  async encryptBackup(json, key) {
    return encryptField(json, key);
  }

  /**
   * Decrypts a backup ciphertext with the provided backup key.
   * @param {string} ciphertextB64
   * @param {string} ivHex
   * @param {CryptoKey} key
   * @returns {Promise<string>}
   */
  async decryptBackup(ciphertextB64, ivHex, key) {
    return decryptField(ciphertextB64, ivHex, key);
  }

  // ── Passphrase wrapping ──────────────────────────────────────────────────────

  /**
   * Encrypts an org passphrase using a key derived from the user's login password.
   * The wrapped passphrase is stored per-user so that login/unlock can restore
   * the data encryption key without a separate passphrase prompt.
   *
   * @param {string} orgPassphrase  The org passphrase to wrap.
   * @param {string} password       The user's login password.
   * @param {string} saltHex        A dedicated wrapping salt (hex).
   * @returns {Promise<{ ciphertext: string; iv: string }>}
   */
  async wrapPassphrase(orgPassphrase, password, saltHex) {
    const salt = fromHex(saltHex);
    const wrappingKey = await deriveKey(password, salt);
    return encryptField(orgPassphrase, wrappingKey);
  }

  /**
   * Decrypts a previously wrapped org passphrase using the user's login password.
   *
   * @param {string} ciphertext  The wrapped passphrase ciphertext.
   * @param {string} iv          The IV used during wrapping.
   * @param {string} password    The user's login password.
   * @param {string} saltHex     The wrapping salt (hex).
   * @returns {Promise<string>}  The org passphrase in plaintext.
   */
  async unwrapPassphrase(ciphertext, iv, password, saltHex) {
    const salt = fromHex(saltHex);
    const wrappingKey = await deriveKey(password, salt);
    return decryptField(ciphertext, iv, wrappingKey);
  }

  // ── Masking ─────────────────────────────────────────────────────────────────

  /**
   * Returns a masked display string for a sensitive value.
   * @param {string} value
   * @returns {string}  e.g. "••••••••"
   */
  maskValue(value) {
    if (typeof value !== 'string' || value.length === 0) return '••••••••';
    return '•'.repeat(Math.min(value.length, 8));
  }
}

/** Singleton instance shared across the application. */
export const cryptoService = new CryptoService();
