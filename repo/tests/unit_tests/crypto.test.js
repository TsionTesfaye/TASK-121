/**
 * Unit tests — CryptoService and webCrypto primitives.
 *
 * Node 18 exposes globalThis.crypto.subtle natively.
 * No polyfill is required; the test setup in tests/setup.js asserts it exists.
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
  toBase64,
  fromBase64,
} from '../../src/infrastructure/crypto/webCrypto.js';
import { CryptoService } from '../../src/services/CryptoService.js';

// ── Low-level helpers ─────────────────────────────────────────────────────────

describe('generateSalt', () => {
  it('returns a 32-byte Uint8Array', () => {
    const salt = generateSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(32);
  });

  it('produces different values on each call', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(toHex(a)).not.toBe(toHex(b));
  });
});

describe('generateIv', () => {
  it('returns a 12-byte Uint8Array', () => {
    const iv = generateIv();
    expect(iv).toBeInstanceOf(Uint8Array);
    expect(iv.length).toBe(12);
  });
});

describe('hex encoding', () => {
  it('round-trips through toHex / fromHex', () => {
    const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const hex = toHex(original);
    expect(hex).toBe('deadbeef');
    expect(fromHex(hex)).toEqual(original);
  });
});

describe('base64 encoding', () => {
  it('round-trips through toBase64 / fromBase64', () => {
    const original = new TextEncoder().encode('hello world');
    const b64 = toBase64(original);
    const decoded = fromBase64(b64);
    // Compare as regular arrays to avoid cross-realm Uint8Array identity issues.
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('encodes to a valid base64 string', () => {
    const buf = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const b64 = toBase64(buf);
    expect(b64).toBe('SGVsbG8=');
  });
});

// ── Password hashing ──────────────────────────────────────────────────────────

describe('hashPassword', () => {
  it('returns a non-empty hex string', async () => {
    const salt = generateSalt();
    const hash = await hashPassword('MyPassword1!', salt);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
    // SHA-256 PBKDF2 deriveBits(256) → 64 hex chars
    expect(hash.length).toBe(64);
  });

  it('produces the same hash for the same password and salt', async () => {
    const salt = generateSalt();
    const h1 = await hashPassword('TestPass1!', salt);
    const h2 = await hashPassword('TestPass1!', salt);
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different salts', async () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    const h1 = await hashPassword('TestPass1!', s1);
    const h2 = await hashPassword('TestPass1!', s2);
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different passwords', async () => {
    const salt = generateSalt();
    const h1 = await hashPassword('Password1!', salt);
    const h2 = await hashPassword('Password2!', salt);
    expect(h1).not.toBe(h2);
  });
});

describe('verifyPassword', () => {
  it('returns true for a correct password', async () => {
    const salt = generateSalt();
    const hash = await hashPassword('Correct1!', salt);
    const result = await verifyPassword('Correct1!', toHex(salt), hash);
    expect(result).toBe(true);
  });

  it('returns false for an incorrect password', async () => {
    const salt = generateSalt();
    const hash = await hashPassword('Correct1!', salt);
    const result = await verifyPassword('Wrong1!', toHex(salt), hash);
    expect(result).toBe(false);
  });
});

// ── Key derivation ────────────────────────────────────────────────────────────

describe('deriveKey', () => {
  it('returns a CryptoKey', async () => {
    const salt = generateSalt();
    const key = await deriveKey('passphrase', salt);
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
  });
});

// ── AES-GCM encrypt / decrypt ─────────────────────────────────────────────────

describe('encryptField / decryptField', () => {
  let key;

  beforeEach(async () => {
    const salt = generateSalt();
    key = await deriveKey('session-passphrase', salt);
  });

  it('encrypts and decrypts a string correctly', async () => {
    const plaintext = 'Sensitive allergy information';
    const { ciphertext, iv } = await encryptField(plaintext, key);
    const decrypted = await decryptField(ciphertext, iv, key);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (different IVs)', async () => {
    const plaintext = 'same text';
    const e1 = await encryptField(plaintext, key);
    const e2 = await encryptField(plaintext, key);
    expect(e1.ciphertext).not.toBe(e2.ciphertext);
    expect(e1.iv).not.toBe(e2.iv);
  });

  it('throws when decrypting with a wrong key', async () => {
    const plaintext = 'secret';
    const { ciphertext, iv } = await encryptField(plaintext, key);

    const wrongSalt = generateSalt();
    const wrongKey = await deriveKey('different-passphrase', wrongSalt);

    await expect(decryptField(ciphertext, iv, wrongKey)).rejects.toThrow();
  });

  it('encrypts an empty string', async () => {
    const { ciphertext, iv } = await encryptField('', key);
    const decrypted = await decryptField(ciphertext, iv, key);
    expect(decrypted).toBe('');
  });
});

// ── CryptoService ─────────────────────────────────────────────────────────────

describe('CryptoService', () => {
  let service;

  beforeEach(() => {
    service = new CryptoService();
  });

  it('hashes and verifies a password', async () => {
    const { hash, salt } = await service.hashNewPassword('ValidPass1!');
    const valid = await service.verifyPassword('ValidPass1!', salt, hash);
    expect(valid).toBe(true);
  });

  it('rejects an incorrect password on verify', async () => {
    const { hash, salt } = await service.hashNewPassword('ValidPass1!');
    const valid = await service.verifyPassword('WrongPass1!', salt, hash);
    expect(valid).toBe(false);
  });

  it('is locked before deriveSessionKey is called', () => {
    expect(service.isUnlocked()).toBe(false);
  });

  it('is unlocked after deriveSessionKey', async () => {
    const { salt } = await service.hashNewPassword('SessionPass1!');
    await service.deriveSessionKey('SessionPass1!', salt);
    expect(service.isUnlocked()).toBe(true);
  });

  it('is locked after clearSessionKey', async () => {
    const { salt } = await service.hashNewPassword('SessionPass1!');
    await service.deriveSessionKey('SessionPass1!', salt);
    service.clearSessionKey();
    expect(service.isUnlocked()).toBe(false);
  });

  it('encrypt/decrypt round-trips through the service', async () => {
    const { salt } = await service.hashNewPassword('TestPass1!');
    await service.deriveSessionKey('TestPass1!', salt);

    const plaintext = 'stored value 99.50';
    const { ciphertext, iv } = await service.encrypt(plaintext);
    const decrypted = await service.decrypt(ciphertext, iv);
    expect(decrypted).toBe(plaintext);
  });

  it('throws on encrypt when locked', async () => {
    await expect(service.encrypt('data')).rejects.toThrow('Session is locked');
  });

  it('throws on decrypt when locked', async () => {
    await expect(service.decrypt('abc', 'def')).rejects.toThrow('Session is locked');
  });

  it('maskValue returns bullet characters', () => {
    const masked = service.maskValue('hello world');
    expect(masked).toMatch(/^•+$/);
  });

  it('masks empty string with fallback placeholder', () => {
    const masked = service.maskValue('');
    expect(masked).toBe('••••••••');
  });
});
