/**
 * Integration tests — Customer version history.
 *
 * Covers:
 *   - publishCustomerVersion creates a version record
 *   - Second publish deactivates the first and activates the new one
 *   - reasonNote too short is rejected
 *   - getCustomerVersionHistory returns all versions in descending order
 *   - getActiveCustomerVersion returns only the active version
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'CustVer@1234';
const ORG_ID = 'org-001';
const ADMIN_USER = { id: 'admin-001', role: ROLES.ADMINISTRATOR, organizationNodeId: ORG_ID };

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  await bs.bootstrap({ adminUsername: 'cv_admin', adminPassword: ADMIN_PASS, orgName: 'CVCo' });

  await authService.login('cv_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
  authService._currentUser = { ...authService._currentUser, organizationNodeId: ORG_ID };
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

async function makeCustomer() {
  return customerService.createCustomer({
    organizationId: ORG_ID,
    name: 'Test Customer',
    actorId: 'admin-001',
        reasonNote: 'Test customer creation',
  });
}

describe('Customer versioning — create', () => {
  it('publishCustomerVersion creates a version record', async () => {
    const customer = await makeCustomer();
    const version = await customerService.publishCustomerVersion({
      customerId: customer.id,
      organizationId: ORG_ID,
      reasonNote: 'Initial snapshot for compliance audit.',
      actorId: 'admin-001',
    });

    expect(version.entityId).toBe(customer.id);
    expect(version.entityType).toBe('customer');
    // createCustomer already creates version 1, so publishCustomerVersion creates version 2.
    expect(version.versionNumber).toBe(2);
    expect(version.isActive).toBe(true);
    expect(version.reasonNote).toBe('Initial snapshot for compliance audit.');
  });

  it('version payload captures customer name and tier', async () => {
    const customer = await makeCustomer();
    const version = await customerService.publishCustomerVersion({
      customerId: customer.id,
      organizationId: ORG_ID,
      reasonNote: 'Capturing current state for review.',
      actorId: 'admin-001',
    });

    expect(version.payload.name).toBe('Test Customer');
    expect(version.payload.membershipTier).toBeDefined();
  });
});

describe('Customer versioning — publish switches active', () => {
  it('second publish deactivates the first version and activates the new one', async () => {
    const customer = await makeCustomer();
    const v1 = await customerService.publishCustomerVersion({
      customerId: customer.id,
      organizationId: ORG_ID,
      reasonNote: 'Initial snapshot for compliance.',
      actorId: 'admin-001',
    });
    expect(v1.isActive).toBe(true);

    const v2 = await customerService.publishCustomerVersion({
      customerId: customer.id,
      organizationId: ORG_ID,
      reasonNote: 'Updated after membership tier change.',
      actorId: 'admin-001',
    });
    // createCustomer=v1, first publish=v2, second publish=v3
    expect(v2.versionNumber).toBe(3);
    expect(v2.isActive).toBe(true);

    const history = await customerService.getCustomerVersionHistory(customer.id);
    const active = history.filter((v) => v.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(v2.id);
  });
});

describe('Customer versioning — reason note enforced', () => {
  it('rejects a reasonNote that is too short', async () => {
    const customer = await makeCustomer();
    await expect(
      customerService.publishCustomerVersion({
        customerId: customer.id,
        organizationId: ORG_ID,
        reasonNote: 'Too short',
        actorId: 'admin-001',
      }),
    ).rejects.toThrow();
  });

  it('rejects an empty reasonNote', async () => {
    const customer = await makeCustomer();
    await expect(
      customerService.publishCustomerVersion({
        customerId: customer.id,
        organizationId: ORG_ID,
        reasonNote: '',
        actorId: 'admin-001',
      }),
    ).rejects.toThrow();
  });
});

describe('Customer versioning — history retained', () => {
  it('getCustomerVersionHistory returns all versions newest first', async () => {
    const customer = await makeCustomer();

    await customerService.publishCustomerVersion({
      customerId: customer.id,
      organizationId: ORG_ID,
      reasonNote: 'First snapshot for audit trail.',
      actorId: 'admin-001',
    });
    await customerService.publishCustomerVersion({
      customerId: customer.id,
      organizationId: ORG_ID,
      reasonNote: 'Second snapshot after data correction.',
      actorId: 'admin-001',
    });
    await customerService.publishCustomerVersion({
      customerId: customer.id,
      organizationId: ORG_ID,
      reasonNote: 'Third snapshot after tier upgrade request.',
      actorId: 'admin-001',
    });

    const history = await customerService.getCustomerVersionHistory(customer.id);
    // createCustomer=v1, publish1=v2, publish2=v3, publish3=v4
    expect(history).toHaveLength(4);
    expect(history[0].versionNumber).toBe(4);
    expect(history[1].versionNumber).toBe(3);
    expect(history[2].versionNumber).toBe(2);
    expect(history[3].versionNumber).toBe(1);
  });

  it('getActiveCustomerVersion returns only the active version', async () => {
    const customer = await makeCustomer();

    await customerService.publishCustomerVersion({
      customerId: customer.id,
      organizationId: ORG_ID,
      reasonNote: 'Initial version for compliance.',
      actorId: 'admin-001',
    });
    await customerService.publishCustomerVersion({
      customerId: customer.id,
      organizationId: ORG_ID,
      reasonNote: 'Superseding initial version with corrections.',
      actorId: 'admin-001',
    });

    const active = await customerService.getActiveCustomerVersion(customer.id);
    expect(active).not.toBeNull();
    // createCustomer=v1, publish1=v2, publish2=v3
    expect(active.versionNumber).toBe(3);
    expect(active.isActive).toBe(true);
  });
});
