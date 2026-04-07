/**
 * Integration tests — Customer protected-field encryption/decryption.
 *
 * Covers:
 *   - create customer with encrypted fields
 *   - reveal sensitive fields round-trip
 *   - stored value adjust with encrypted read/write
 *   - session-locked access blocked
 *   - ANALYST can reveal but not modify financial fields
 *
 * Session key is derived via a full authService.login() call (real PBKDF2 path),
 * NOT by injecting cryptoService._sessionKey directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { AuthService, authService } from '../../src/services/AuthService.js';
import { CustomerService } from '../../src/services/CustomerService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASSWORD = 'AdminCrypto12!';
const ADMIN_USERNAME = 'cryptoadmin';
let ORG_ID;

/**
 * Bootstraps the system and logs in as admin, then unlocks protected data
 * with the org passphrase (defaults to admin password at bootstrap).
 */
async function loginAsAdmin() {
  const bs = new BootstrapService();
  const { org } = await bs.bootstrap({
    adminUsername: ADMIN_USERNAME,
    adminPassword: ADMIN_PASSWORD,
    orgName: 'CryptoTestCo',
  });
  ORG_ID = org.id;
  await authService.login(ADMIN_USERNAME, ADMIN_PASSWORD);
  await authService.unlockProtectedData(ADMIN_PASSWORD);
}

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  await loginAsAdmin();
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
});

describe('Customer encrypted field round-trip', () => {
  it('creates a customer with encrypted stored value', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Alice',
      storedValue: 99.99,
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    expect(customer.storedValueCiphertext).toBeDefined();
    expect(customer.storedValueIv).toBeDefined();
    // Raw stored value should NOT be visible in the record
    expect(customer.storedValueCiphertext).not.toBe('99.99');
  });

  it('encrypts allergy information', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Bob',
      allergies: 'Peanuts, Shellfish',
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    expect(customer.allergiesCiphertext).not.toBeNull();
    expect(customer.allergiesCiphertext).not.toBe('Peanuts, Shellfish');
  });

  it('revealSensitiveFields decrypts stored value correctly', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Carol',
      storedValue: 50.00,
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    const revealed = await svc.revealSensitiveFields(customer.id);
    expect(revealed.storedValue).toBe('50.00');
  });

  it('revealSensitiveFields decrypts allergy notes', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Dave',
      allergies: 'Tree nuts',
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    const revealed = await svc.revealSensitiveFields(customer.id);
    expect(revealed.allergies).toBe('Tree nuts');
  });

  it('revealSensitiveFields returns null for absent allergy field', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Eve',
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    const revealed = await svc.revealSensitiveFields(customer.id);
    expect(revealed.allergies).toBeNull();
  });
});

describe('Stored value adjustment', () => {
  it('adjustStoredValue credits correctly', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Frank',
      storedValue: 10.00,
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    await svc.adjustStoredValue(customer.id, 5.00, ADMIN_USERNAME, 'Test reason note text');
    const revealed = await svc.revealSensitiveFields(customer.id);
    expect(revealed.storedValue).toBe('15.00');
  });

  it('adjustStoredValue debits correctly', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Grace',
      storedValue: 20.00,
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    await svc.adjustStoredValue(customer.id, -5.50, ADMIN_USERNAME, 'Test reason note text');
    const revealed = await svc.revealSensitiveFields(customer.id);
    expect(revealed.storedValue).toBe('14.50');
  });

  it('adjustStoredValue rejects negative balance', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Heidi',
      storedValue: 5.00,
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    await expect(svc.adjustStoredValue(customer.id, -10.00, ADMIN_USERNAME, 'Test reason note text'))
      .rejects.toThrow();
  });
});

describe('Masked fields', () => {
  it('getMaskedFields returns bullet characters', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Ivan',
      storedValue: 25.00,
      allergies: 'Latex',
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    const masked = await svc.getMaskedFields(customer.id);
    expect(masked.storedValue).toMatch(/^•+$/);
    expect(masked.allergies).toMatch(/^•+$/);
  });
});

describe('Locked session blocks sensitive access', () => {
  it('revealSensitiveFields throws when session is locked', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Judy',
      storedValue: 30.00,
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    cryptoService.clearSessionKey();

    await expect(svc.revealSensitiveFields(customer.id))
      .rejects.toThrow('locked');
  });

  it('adjustStoredValue throws when session is locked', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Karl',
      storedValue: 30.00,
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    cryptoService.clearSessionKey();

    await expect(svc.adjustStoredValue(customer.id, 5.00, ADMIN_USERNAME, 'Test reason note text'))
      .rejects.toThrow('locked');
  });
});

describe('ANALYST cannot reveal or modify financial fields', () => {
  it('ANALYST cannot call revealSensitiveFields', async () => {
    // Create customer as admin first
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Linda',
      storedValue: 10.00,
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    authService._currentUser = { id: 'analyst-001', role: ROLES.ANALYST, organizationNodeId: ORG_ID };

    await expect(svc.revealSensitiveFields(customer.id)).rejects.toThrow(/permission denied/i);
  });

  it('ANALYST cannot adjustStoredValue', async () => {
    const svc = new CustomerService();
    const customer = await svc.createCustomer({
      organizationId: ORG_ID,
      name: 'Mike',
      storedValue: 10.00,
      actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
    });

    authService._currentUser = { id: 'analyst-001', role: ROLES.ANALYST, organizationNodeId: ORG_ID };

    await expect(svc.adjustStoredValue(customer.id, 5.00, 'analyst-001', 'Test reason note text'))
      .rejects.toThrow('Permission denied');
  });
});

describe('Allergy field length enforcement', () => {
  it('rejects allergy fields longer than 500 chars', async () => {
    const svc = new CustomerService();
    await expect(
      svc.createCustomer({
        organizationId: ORG_ID,
        name: 'Nancy',
        allergies: 'A'.repeat(501),
        actorId: ADMIN_USERNAME,
        reasonNote: 'Test customer creation',
      }),
    ).rejects.toThrow();
  });
});
