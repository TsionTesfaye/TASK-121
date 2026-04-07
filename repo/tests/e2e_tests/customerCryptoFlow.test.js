/**
 * E2E Simulation — Customer crypto flow: create → encrypt → decrypt → mask.
 *
 * Uses the full PBKDF2 key derivation path (no _sessionKey injection).
 *
 * Covers:
 *   - Create customer with sensitive fields encrypted at rest
 *   - Sensitive field ciphertexts stored, not plaintext
 *   - revealSensitiveFields decrypts and returns plaintext
 *   - getMaskedFields returns placeholder without decryption
 *   - Locked session blocks reveal
 *   - adjustStoredValue re-encrypts correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { CustomerService } from '../../src/services/CustomerService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_USER = 'custcrypto_admin';
const ADMIN_PASS = 'CustCrypto12!';

let adminOrgId;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  // Bootstrap to create real admin with derived session key.
  const bs = new BootstrapService();
  const { org } = await bs.bootstrap({ adminUsername: ADMIN_USER, adminPassword: ADMIN_PASS, orgName: 'CryptoTestCo' });
  adminOrgId = org.id;

  // Login as admin — derives session key via real PBKDF2.
  await authService.login(ADMIN_USER, ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
});

describe('Customer crypto flow', () => {
  it('creates customer with sensitive fields encrypted (no plaintext at rest)', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: adminOrgId,
      name: 'Jane Doe',
      allergies: 'peanuts',
      materialRestrictions: 'latex',
      storedValue: 25.00,
      actorId: 'admin-001',
        reasonNote: 'Test customer creation',
    });

    // Ciphertexts must exist and not equal plaintext.
    expect(customer.allergiesCiphertext).toBeTruthy();
    expect(customer.allergiesCiphertext).not.toBe('peanuts');
    expect(customer.storedValueCiphertext).toBeTruthy();
    expect(customer.storedValueCiphertext).not.toBe('25.00');
  });

  it('revealSensitiveFields decrypts and returns correct plaintext', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: adminOrgId,
      name: 'John Smith',
      allergies: 'shellfish',
      storedValue: 50.00,
      actorId: 'admin-001',
        reasonNote: 'Test customer creation',
    });

    const revealed = await svc.revealSensitiveFields(customer.id);
    expect(revealed.storedValue).toBe('50.00');
    expect(revealed.allergies).toBe('shellfish');
  });

  it('getMaskedFields returns placeholder without exposing plaintext', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: adminOrgId,
      name: 'Alice Mask',
      allergies: 'nuts',
      storedValue: 10.00,
      actorId: 'admin-001',
        reasonNote: 'Test customer creation',
    });

    const masked = await svc.getMaskedFields(customer.id);
    expect(masked.storedValue).toBeTruthy();
    expect(masked.storedValue).not.toBe('10.00');
    expect(masked.allergies).toBeTruthy();
    expect(masked.allergies).not.toBe('nuts');
  });

  it('locked session blocks reveal of sensitive fields', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: adminOrgId,
      name: 'Locked User',
      storedValue: 5.00,
      actorId: 'admin-001',
        reasonNote: 'Test customer creation',
    });

    authService.lockSession();
    await expect(svc.revealSensitiveFields(customer.id)).rejects.toThrow(/locked/i);
  });

  it('adjustStoredValue re-encrypts and can be revealed with correct new value', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: adminOrgId,
      name: 'Balance Test',
      storedValue: 20.00,
      actorId: 'admin-001',
        reasonNote: 'Test customer creation',
    });

    await svc.adjustStoredValue(customer.id, 5.00, 'admin-001', 'Test reason note text');

    const revealed = await svc.revealSensitiveFields(customer.id);
    expect(revealed.storedValue).toBe('25.00');
  });

  it('customer without allergies has null allergy ciphertext', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: adminOrgId,
      name: 'No Allergy',
      storedValue: 0,
      actorId: 'admin-001',
        reasonNote: 'Test customer creation',
    });

    expect(customer.allergiesCiphertext).toBeNull();
    const revealed = await svc.revealSensitiveFields(customer.id);
    expect(revealed.allergies).toBeNull();
  });
});
