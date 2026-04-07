/**
 * Low-level Web Crypto wrapper.
 *
 * Uses globalThis.crypto.subtle — available natively in:
 *   - All modern browsers
 *   - Node 18+ (no polyfill required)
 *
 * Algorithm choices:
 *   - Key derivation : PBKDF2 / SHA-256 / 310 000 iterations
 *   - Encryption     : AES-GCM / 256-bit key / 96-bit IV per operation
 *   - Password hash  : PBKDF2-derived key material, stored as hex
 */

import { CRYPTO } from '../../utils/constants.js';

const subtle = () => globalThis.crypto.subtle;

// ── Utility helpers ────────────────────────────────────────────────────────────

/** @returns {Uint8Array} 32-byte random salt */
export function generateSalt() {
  return globalThis.crypto.getRandomValues(new Uint8Array(CRYPTO.SALT_LENGTH_BYTES));
}

/** @returns {Uint8Array} 12-byte random IV for AES-GCM */
export function generateIv() {
  return globalThis.crypto.getRandomValues(new Uint8Array(CRYPTO.IV_LENGTH_BYTES));
}

/**
 * Encodes a Uint8Array to a lowercase hex string.
 * @param {Uint8Array} buf
 * @returns {string}
 */
export function toHex(buf) {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Decodes a hex string to a Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Encodes a Uint8Array to a base64 string.
 * @param {Uint8Array} buf
 * @returns {string}
 */
export function toBase64(buf) {
  return btoa(String.fromCharCode(...buf));
}

/**
 * Decodes a base64 string to a Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 */
export function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ── Password hashing ───────────────────────────────────────────────────────────

/**
 * Hashes a password using PBKDF2.
 * Returns the derived key material as a hex string.
 *
 * @param {string} password
 * @param {Uint8Array} salt
 * @returns {Promise<string>} hex-encoded hash
 */
export async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await subtle().importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const bits = await subtle().deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: CRYPTO.PBKDF2_ITERATIONS,
      hash: CRYPTO.PBKDF2_HASH,
    },
    keyMaterial,
    256,
  );

  return toHex(new Uint8Array(bits));
}

/**
 * Verifies a password against a stored hex hash and salt.
 *
 * @param {string} password
 * @param {string} saltHex
 * @param {string} storedHashHex
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, saltHex, storedHashHex) {
  const salt = fromHex(saltHex);
  const derived = await hashPassword(password, salt);
  return timingSafeEqual(derived, storedHashHex);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Key derivation ─────────────────────────────────────────────────────────────

/**
 * Derives an AES-GCM CryptoKey from a user passphrase and salt.
 * The returned key is non-extractable and usable for encrypt/decrypt.
 *
 * @param {string} passphrase
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(passphrase, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await subtle().importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return subtle().deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: CRYPTO.PBKDF2_ITERATIONS,
      hash: CRYPTO.PBKDF2_HASH,
    },
    keyMaterial,
    { name: CRYPTO.AES_ALGORITHM, length: CRYPTO.AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── Field encryption / decryption ─────────────────────────────────────────────

/**
 * Encrypts a plaintext string using AES-GCM.
 *
 * @param {string} plaintext
 * @param {CryptoKey} key
 * @returns {Promise<{ ciphertext: string; iv: string; algorithmVersion: string }>}
 *   Base64-encoded ciphertext and hex-encoded IV.
 */
export async function encryptField(plaintext, key) {
  const iv = generateIv();
  const encoder = new TextEncoder();

  const encrypted = await subtle().encrypt(
    { name: CRYPTO.AES_ALGORITHM, iv },
    key,
    encoder.encode(plaintext),
  );

  return {
    ciphertext: toBase64(new Uint8Array(encrypted)),
    iv: toHex(iv),
    algorithmVersion: CRYPTO.ALGORITHM_VERSION,
  };
}

/**
 * Decrypts an AES-GCM encrypted field.
 *
 * @param {string} ciphertextB64  Base64-encoded ciphertext
 * @param {string} ivHex          Hex-encoded IV
 * @param {CryptoKey} key
 * @returns {Promise<string>} Decrypted plaintext
 */
export async function decryptField(ciphertextB64, ivHex, key) {
  const ciphertext = fromBase64(ciphertextB64);
  const iv = fromHex(ivHex);
  const decoder = new TextDecoder();

  const decrypted = await subtle().decrypt(
    { name: CRYPTO.AES_ALGORITHM, iv },
    key,
    ciphertext,
  );

  return decoder.decode(decrypted);
}
