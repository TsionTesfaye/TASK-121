/**
 * Data integrity + tenant isolation tests.
 *
 * Covers:
 *   1. Order — customer org validation
 *   2. Ticket — customer validation
 *   3. Org tree — cross-link prevention
 *   4. Style — cross-org reference validation
 *   5. Warehouse type validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { OrderService } from '../../src/services/OrderService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { styleService } from '../../src/services/StyleService.js';
import { orgService } from '../../src/services/OrgService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, ORG_NODE_TYPES } from '../../src/utils/constants.js';
import { generateId } from '../../src/utils/idGenerator.js';

const ADMIN_PASS = 'DataInteg@1234';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'integ_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'IntegTestCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('integ_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

async function seedCustomer(custOrgId) {
  const repo = new CustomerRepository();
  const id = generateId();
  await repo.create({
    id, organizationId: custOrgId, name: 'Test Customer',
    membershipTier: 'Bronze', points: 0,
    ratingAverage: 0, ratingCount: 0,
    storedValueCiphertext: null, storedValueIv: null,
    allergiesCiphertext: null, allergiesIv: null,
    materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  return id;
}

async function seedMasterData(mdOrgId) {
  const now = Date.now();
  const colorRepo = new BaseRepository('colors');
  const sizeRepo = new BaseRepository('sizes');
  const seasonRepo = new BaseRepository('seasons');
  const brandRepo = new BaseRepository('brands');
  const supplierRepo = new BaseRepository('suppliers');
  await colorRepo.create({ id: `c-${mdOrgId}`, organizationId: mdOrgId, name: 'Red', isActive: true, createdAt: now });
  await sizeRepo.create({ id: `s-${mdOrgId}`, organizationId: mdOrgId, name: 'M', isActive: true, createdAt: now });
  await seasonRepo.create({ id: `ss-${mdOrgId}`, organizationId: mdOrgId, name: 'SS25', isActive: true, createdAt: now });
  await brandRepo.create({ id: `b-${mdOrgId}`, organizationId: mdOrgId, name: 'Brand', isActive: true, createdAt: now });
  await supplierRepo.create({ id: `sp-${mdOrgId}`, organizationId: mdOrgId, name: 'Supplier', isActive: true, createdAt: now });
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. ORDER — CUSTOMER ORG VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Order — customer org validation', () => {
  it('rejects order with cross-org customer', async () => {
    const foreignCustId = await seedCustomer('foreign-org-999');

    const orderSvc = new OrderService();
    await expect(
      orderSvc.createOrder({
        customerId: foreignCustId,
        organizationId: orgId,
        storeId: orgId,
        items: [],
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(/does not belong to this organization/i);
  });

  it('accepts order with same-org customer', async () => {
    const custId = await seedCustomer(orgId);

    const orderSvc = new OrderService();
    const order = await orderSvc.createOrder({
      customerId: custId,
      organizationId: orgId,
      storeId: orgId,
      items: [],
      actorId: adminUser.id,
    });
    expect(order.customerId).toBe(custId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. TICKET — CUSTOMER VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Ticket — customer validation', () => {
  it('rejects ticket with nonexistent customer', async () => {
    await expect(
      ticketService.createTicket({
        customerId: 'ghost-customer',
        organizationId: orgId,
        storeId: orgId,
        subject: 'Test', description: 'Desc',
        category: 'general', priority: 'low',
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects ticket with cross-org customer', async () => {
    const foreignCustId = await seedCustomer('foreign-org-999');

    await expect(
      ticketService.createTicket({
        customerId: foreignCustId,
        organizationId: orgId,
        storeId: orgId,
        subject: 'Test', description: 'Desc',
        category: 'general', priority: 'low',
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(/does not belong to this organization/i);
  });

  it('accepts ticket with same-org customer', async () => {
    const custId = await seedCustomer(orgId);

    const ticket = await ticketService.createTicket({
      customerId: custId,
      organizationId: orgId,
      storeId: orgId,
      subject: 'Valid ticket', description: 'All good.',
      category: 'general', priority: 'low',
      actorId: adminUser.id,
    });
    expect(ticket.customerId).toBe(custId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. ORG TREE — CROSS-LINK PREVENTION
// ══════════════════════════════════════════════════════════════════════════════

describe('Org tree — cross-link prevention', () => {
  it('rejects child node with parent from different organization', async () => {
    // Create a factory in orgId
    const factory = await orgService.createNode({
      parentId: orgId,
      type: ORG_NODE_TYPES.FACTORY,
      name: 'My Factory',
      organizationId: orgId,
      actorId: adminUser.id,
    });

    // Try to create a store under that factory but with a DIFFERENT organizationId
    await expect(
      orgService.createNode({
        parentId: factory.id,
        type: ORG_NODE_TYPES.STORE,
        name: 'Cross-Link Store',
        organizationId: 'different-org-999',
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(/different organization/i);
  });

  it('accepts child node with same organizationId as parent', async () => {
    const factory = await orgService.createNode({
      parentId: orgId,
      type: ORG_NODE_TYPES.FACTORY,
      name: 'Valid Factory',
      organizationId: orgId,
      actorId: adminUser.id,
    });

    const store = await orgService.createNode({
      parentId: factory.id,
      type: ORG_NODE_TYPES.STORE,
      name: 'Valid Store',
      organizationId: orgId,
      actorId: adminUser.id,
    });
    expect(store.organizationId).toBe(orgId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. STYLE — CROSS-ORG REFERENCE VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Style — cross-org reference validation', () => {
  beforeEach(async () => {
    await seedMasterData(orgId);
    await seedMasterData('foreign-org-999');
  });

  it('rejects style referencing a color from a different org', async () => {
    await expect(
      styleService.createStyle({
        organizationId: orgId,
        sku: 'SKU-CROSS-COLOR',
        colorId: 'c-foreign-org-999', // foreign color
        sizeId: `s-${orgId}`, seasonId: `ss-${orgId}`,
        brandId: `b-${orgId}`, supplierId: `sp-${orgId}`,
        storeId: orgId,
        actorId: adminUser.id,
        reasonNote: 'Test style creation',
      }),
    ).rejects.toThrow(/different organization/i);
  });

  it('rejects style referencing a supplier from a different org', async () => {
    await expect(
      styleService.createStyle({
        organizationId: orgId,
        sku: 'SKU-CROSS-SUP',
        colorId: `c-${orgId}`, sizeId: `s-${orgId}`,
        seasonId: `ss-${orgId}`, brandId: `b-${orgId}`,
        supplierId: 'sp-foreign-org-999', // foreign supplier
        storeId: orgId,
        actorId: adminUser.id,
        reasonNote: 'Test style creation',
      }),
    ).rejects.toThrow(/different organization/i);
  });

  it('accepts style with all same-org references', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId,
      sku: 'SKU-VALID-REFS',
      colorId: `c-${orgId}`, sizeId: `s-${orgId}`,
      seasonId: `ss-${orgId}`, brandId: `b-${orgId}`,
      supplierId: `sp-${orgId}`,
      storeId: orgId,
      actorId: adminUser.id,
      reasonNote: 'Test style creation',
    });
    expect(style.sku).toBe('SKU-VALID-REFS');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. WAREHOUSE TYPE VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Style — warehouse type validation', () => {
  beforeEach(async () => {
    await seedMasterData(orgId);
  });

  it('rejects non-warehouse node type as warehouseId', async () => {
    // Create a factory node (not a warehouse)
    const factory = await orgService.createNode({
      parentId: orgId,
      type: ORG_NODE_TYPES.FACTORY,
      name: 'Not A Warehouse',
      organizationId: orgId,
      actorId: adminUser.id,
    });

    await expect(
      styleService.createStyle({
        organizationId: orgId,
        sku: 'SKU-BAD-TYPE',
        colorId: `c-${orgId}`, sizeId: `s-${orgId}`,
        seasonId: `ss-${orgId}`, brandId: `b-${orgId}`,
        supplierId: `sp-${orgId}`,
        storeId: orgId,
        warehouseId: factory.id, // factory, not warehouse
        actorId: adminUser.id,
        reasonNote: 'Test style creation',
      }),
    ).rejects.toThrow(/not 'warehouse'/i);
  });

  it('accepts valid warehouse node type', async () => {
    const factory = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
      name: 'F1', organizationId: orgId, actorId: adminUser.id,
    });
    const store = await orgService.createNode({
      parentId: factory.id, type: ORG_NODE_TYPES.STORE,
      name: 'S1', organizationId: orgId, actorId: adminUser.id,
    });
    const warehouse = await orgService.createNode({
      parentId: store.id, type: ORG_NODE_TYPES.WAREHOUSE,
      name: 'W1', organizationId: orgId, actorId: adminUser.id,
    });

    const style = await styleService.createStyle({
      organizationId: orgId,
      sku: 'SKU-GOOD-WH',
      colorId: `c-${orgId}`, sizeId: `s-${orgId}`,
      seasonId: `ss-${orgId}`, brandId: `b-${orgId}`,
      supplierId: `sp-${orgId}`,
      storeId: store.id,
      warehouseId: warehouse.id,
      actorId: adminUser.id,
      reasonNote: 'Test style creation',
    });
    expect(style.warehouseId).toBe(warehouse.id);
  });
});
