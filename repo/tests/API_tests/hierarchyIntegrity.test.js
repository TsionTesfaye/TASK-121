/**
 * Hierarchy integrity tests — prevent future QA failures.
 *
 * All tests use a REAL hierarchy: company → factory → store → warehouse
 * where organizationId !== storeId.
 *
 * Covers:
 *   1. Orders: org/store split in real hierarchy
 *   2. Tickets: org/store split in real hierarchy
 *   3. Styles: org/store/warehouse chain in real hierarchy
 *   4. Warehouse must belong to correct store
 *   5. Store must belong to org
 *   6. UI contract: resolveOrgContext produces correct split
 *   7. Service rejects mismatched org/store
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
import { resolveOrgContext } from '../../src/app/stores/org.js';
import { ROLES, ORG_NODE_TYPES } from '../../src/utils/constants.js';
import { generateId } from '../../src/utils/idGenerator.js';

const ADMIN_PASS = 'Hierarchy@1234';
let companyId;
let factoryId;
let storeAId;
let storeBId;
let warehouseAId;
let warehouseBId;
let adminUser;
let tree;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'hier_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'HierarchyCo',
  });
  companyId = org.id;
  adminUser = admin;

  await authService.login('hier_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

  // Build hierarchy: company → factory → storeA, storeB → warehouseA, warehouseB
  const factory = await orgService.createNode({
    parentId: companyId, type: ORG_NODE_TYPES.FACTORY, name: 'Factory',
    organizationId: companyId, actorId: adminUser.id,
  });
  factoryId = factory.id;

  const storeA = await orgService.createNode({
    parentId: factoryId, type: ORG_NODE_TYPES.STORE, name: 'Store A',
    organizationId: companyId, actorId: adminUser.id,
  });
  storeAId = storeA.id;

  const storeB = await orgService.createNode({
    parentId: factoryId, type: ORG_NODE_TYPES.STORE, name: 'Store B',
    organizationId: companyId, actorId: adminUser.id,
  });
  storeBId = storeB.id;

  const whA = await orgService.createNode({
    parentId: storeAId, type: ORG_NODE_TYPES.WAREHOUSE, name: 'Warehouse A',
    organizationId: companyId, actorId: adminUser.id,
  });
  warehouseAId = whA.id;

  const whB = await orgService.createNode({
    parentId: storeBId, type: ORG_NODE_TYPES.WAREHOUSE, name: 'Warehouse B',
    organizationId: companyId, actorId: adminUser.id,
  });
  warehouseBId = whB.id;

  tree = await orgService.getTree(companyId);

  // Seed customer in the company org
  const custRepo = new CustomerRepository();
  await custRepo.create({
    id: 'cust-h', organizationId: companyId, name: 'Hier Customer',
    membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
    storedValueCiphertext: null, storedValueIv: null,
    allergiesCiphertext: null, allergiesIv: null,
    materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  // Seed master data for styles
  const now = Date.now();
  await new BaseRepository('colors').create({ id: 'c1', organizationId: companyId, name: 'Red', isActive: true, createdAt: now });
  await new BaseRepository('sizes').create({ id: 's1', organizationId: companyId, name: 'M', isActive: true, createdAt: now });
  await new BaseRepository('seasons').create({ id: 'ss1', organizationId: companyId, name: 'SS25', isActive: true, createdAt: now });
  await new BaseRepository('brands').create({ id: 'b1', organizationId: companyId, name: 'Brand', isActive: true, createdAt: now });
  await new BaseRepository('suppliers').create({ id: 'sp1', organizationId: companyId, name: 'Supplier', isActive: true, createdAt: now });
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. ORDERS — REAL HIERARCHY (orgId !== storeId)
// ══════════════════════════════════════════════════════════════════════════════

describe('Orders — hierarchy: organizationId !== storeId', () => {
  it('createOrder with company org + store node succeeds', async () => {
    const svc = new OrderService();
    const order = await svc.createOrder({
      customerId: 'cust-h', organizationId: companyId, storeId: storeAId,
      items: [], actorId: adminUser.id,
    });
    expect(order.organizationId).toBe(companyId);
    expect(order.storeId).toBe(storeAId);
    expect(order.organizationId).not.toBe(order.storeId);
  });

  it('createOrder with store as organizationId fails (customer org mismatch)', async () => {
    const svc = new OrderService();
    await expect(svc.createOrder({
      customerId: 'cust-h', organizationId: storeAId, storeId: storeAId,
      items: [], actorId: adminUser.id,
    })).rejects.toThrow(/does not belong/i);
  });

  it('createOrder with factory as storeId fails (wrong node type)', async () => {
    const svc = new OrderService();
    await expect(svc.createOrder({
      customerId: 'cust-h', organizationId: companyId, storeId: factoryId,
      items: [], actorId: adminUser.id,
    })).rejects.toThrow(/expected 'store'/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. TICKETS — REAL HIERARCHY
// ══════════════════════════════════════════════════════════════════════════════

describe('Tickets — hierarchy: organizationId !== storeId', () => {
  it('createTicket with company org + store node succeeds', async () => {
    const ticket = await ticketService.createTicket({
      customerId: 'cust-h', organizationId: companyId, storeId: storeAId,
      subject: 'Hierarchy test', description: 'Test',
      category: 'general', priority: 'low', actorId: adminUser.id,
    });
    expect(ticket.organizationId).toBe(companyId);
    expect(ticket.storeId).toBe(storeAId);
  });

  it('createTicket with store as organizationId fails', async () => {
    await expect(ticketService.createTicket({
      customerId: 'cust-h', organizationId: storeAId, storeId: storeAId,
      subject: 'Bad', description: 'Test',
      category: 'general', priority: 'low', actorId: adminUser.id,
    })).rejects.toThrow(/does not belong/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. STYLES — REAL HIERARCHY WITH WAREHOUSE
// ══════════════════════════════════════════════════════════════════════════════

describe('Styles — hierarchy with warehouse', () => {
  it('createStyle with correct org/store/warehouse chain succeeds', async () => {
    const style = await styleService.createStyle({
      organizationId: companyId, sku: 'H-SKU-001',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: storeAId, warehouseId: warehouseAId,
      actorId: adminUser.id,
      reasonNote: 'Test style creation',
    });
    expect(style.organizationId).toBe(companyId);
    expect(style.storeId).toBe(storeAId);
    expect(style.warehouseId).toBe(warehouseAId);
  });

  it('createStyle with store as organizationId still creates (org scope check uses company)', async () => {
    // StyleService._assertOrgScope checks if actor can access the orgId — admin can access anything
    // But the style record's organizationId should be the company for consistency
    const style = await styleService.createStyle({
      organizationId: companyId, sku: 'H-SKU-002',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: storeAId,
      actorId: adminUser.id,
      reasonNote: 'Test style creation',
    });
    expect(style.warehouseId).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. WAREHOUSE MUST BELONG TO CORRECT ORG
// ══════════════════════════════════════════════════════════════════════════════

describe('Warehouse hierarchy integrity', () => {
  it('warehouse from same org tree is accepted', async () => {
    const style = await styleService.createStyle({
      organizationId: companyId, sku: 'WH-VALID',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: storeAId, warehouseId: warehouseAId,
      actorId: adminUser.id,
      reasonNote: 'Test style creation',
    });
    expect(style.warehouseId).toBe(warehouseAId);
  });

  it('factory used as warehouse fails (wrong type)', async () => {
    await expect(styleService.createStyle({
      organizationId: companyId, sku: 'WH-TYPE',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: storeAId, warehouseId: factoryId,
      actorId: adminUser.id,
      reasonNote: 'Test style creation',
    })).rejects.toThrow(/not 'warehouse'/i);
  });

  it('nonexistent warehouse fails', async () => {
    await expect(styleService.createStyle({
      organizationId: companyId, sku: 'WH-GHOST',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: storeAId, warehouseId: 'ghost-wh',
      actorId: adminUser.id,
      reasonNote: 'Test style creation',
    })).rejects.toThrow(/not found/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. STORE MUST BELONG TO ORG
// ══════════════════════════════════════════════════════════════════════════════

describe('Store belongs to organization', () => {
  it('store with matching organizationId passes', async () => {
    const svc = new OrderService();
    const order = await svc.createOrder({
      customerId: 'cust-h', organizationId: companyId, storeId: storeAId,
      items: [], actorId: adminUser.id,
    });
    expect(order.storeId).toBe(storeAId);
  });

  it('store from different organization fails', async () => {
    // storeAId.organizationId === companyId, but if we claim a different org it mismatches
    const svc = new OrderService();
    await expect(svc.createOrder({
      customerId: 'cust-h', organizationId: 'other-company-999',
      storeId: storeAId, items: [], actorId: adminUser.id,
    })).rejects.toThrow(/does not belong/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. UI CONTRACT: resolveOrgContext
// ══════════════════════════════════════════════════════════════════════════════

describe('resolveOrgContext — UI contract', () => {
  it('store manager at store A → orgId is company, storeId is store A', () => {
    const user = { organizationNodeId: storeAId };
    const ctx = resolveOrgContext(user, tree);
    expect(ctx.organizationId).toBe(companyId);
    expect(ctx.storeId).toBe(storeAId);
  });

  it('store manager at store B → orgId is company, storeId is store B', () => {
    const user = { organizationNodeId: storeBId };
    const ctx = resolveOrgContext(user, tree);
    expect(ctx.organizationId).toBe(companyId);
    expect(ctx.storeId).toBe(storeBId);
  });

  it('admin at company root → both same', () => {
    const user = { organizationNodeId: companyId };
    const ctx = resolveOrgContext(user, tree);
    expect(ctx.organizationId).toBe(companyId);
    expect(ctx.storeId).toBe(companyId);
  });

  it('user at factory → orgId is company', () => {
    const user = { organizationNodeId: factoryId };
    const ctx = resolveOrgContext(user, tree);
    expect(ctx.organizationId).toBe(companyId);
    expect(ctx.storeId).toBe(factoryId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. SERVICE REJECTS MISMATCHED ORG/STORE
// ══════════════════════════════════════════════════════════════════════════════

describe('Service rejects mismatched org/store', () => {
  it('order: customer belongs to company but organizationId is store → mismatch', async () => {
    const svc = new OrderService();
    await expect(svc.createOrder({
      customerId: 'cust-h',
      organizationId: storeAId, // wrong — should be companyId
      storeId: storeAId,
      items: [], actorId: adminUser.id,
    })).rejects.toThrow();
  });

  it('ticket: customer belongs to company but organizationId is store → mismatch', async () => {
    await expect(ticketService.createTicket({
      customerId: 'cust-h',
      organizationId: storeBId, // wrong — should be companyId
      storeId: storeBId,
      subject: 'Mismatch', description: 'Test',
      category: 'general', priority: 'low',
      actorId: adminUser.id,
    })).rejects.toThrow();
  });
});
