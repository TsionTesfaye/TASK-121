/**
 * Org/Store identity contract tests.
 *
 * Proves that store-scoped flows correctly distinguish organizationId from storeId
 * in a real hierarchy: company → factory → store → warehouse.
 *
 * Covers:
 *   - resolveOrgContext helper returns correct values
 *   - createOrder with correct org/store split passes
 *   - createOrder with store ID as organizationId fails (store doesn't own data)
 *   - createTicket with correct org/store split passes
 *   - same-ID case (flat hierarchy) still works
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { OrderService } from '../../src/services/OrderService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { orgService } from '../../src/services/OrgService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { resolveOrgContext } from '../../src/app/stores/org.js';
import { ROLES, ORG_NODE_TYPES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'OrgStore@12345';
let companyId;
let storeId;
let adminUser;
let tree;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'os_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'OrgStoreCo',
  });
  companyId = org.id;
  adminUser = admin;

  await authService.login('os_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

  // Build a real hierarchy: company → factory → store
  const factory = await orgService.createNode({
    parentId: companyId, type: ORG_NODE_TYPES.FACTORY, name: 'Factory 1',
    organizationId: companyId, actorId: adminUser.id,
  });
  const store = await orgService.createNode({
    parentId: factory.id, type: ORG_NODE_TYPES.STORE, name: 'Store 1',
    organizationId: companyId, actorId: adminUser.id,
  });
  storeId = store.id;

  // Load tree for resolveOrgContext
  tree = await orgService.getTree(companyId);

  // Seed a customer in the company org
  const custRepo = new CustomerRepository();
  await custRepo.create({
    id: 'cust-hier', organizationId: companyId, name: 'Hierarchy Customer',
    membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
    storedValueCiphertext: null, storedValueIv: null,
    allergiesCiphertext: null, allergiesIv: null,
    materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// resolveOrgContext helper
// ══════════════════════════════════════════════════════════════════════════════

describe('resolveOrgContext', () => {
  it('user at store node → organizationId is company root, storeId is store node', () => {
    const user = { organizationNodeId: storeId };
    const ctx = resolveOrgContext(user, tree);
    expect(ctx.organizationId).toBe(companyId);
    expect(ctx.storeId).toBe(storeId);
    expect(ctx.organizationId).not.toBe(ctx.storeId);
  });

  it('user at company root → organizationId === storeId (flat case)', () => {
    const user = { organizationNodeId: companyId };
    const ctx = resolveOrgContext(user, tree);
    expect(ctx.organizationId).toBe(companyId);
    expect(ctx.storeId).toBe(companyId);
  });

  it('empty tree falls back to nodeId for both', () => {
    const user = { organizationNodeId: 'any-id' };
    const ctx = resolveOrgContext(user, []);
    expect(ctx.organizationId).toBe('any-id');
    expect(ctx.storeId).toBe('any-id');
  });

  it('null user returns empty strings', () => {
    const ctx = resolveOrgContext(null, tree);
    expect(ctx.organizationId).toBe('');
    expect(ctx.storeId).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Order creation with correct org/store split
// ══════════════════════════════════════════════════════════════════════════════

describe('Order creation — hierarchy-accurate org/store', () => {
  it('correct: organizationId=company, storeId=store → PASS', async () => {
    const svc = new OrderService();
    const order = await svc.createOrder({
      customerId: 'cust-hier',
      organizationId: companyId,
      storeId,
      items: [],
      actorId: adminUser.id,
    });

    expect(order.organizationId).toBe(companyId);
    expect(order.storeId).toBe(storeId);
  });

  it('wrong: organizationId=store (not company) → FAIL', async () => {
    const svc = new OrderService();
    await expect(
      svc.createOrder({
        customerId: 'cust-hier',
        organizationId: storeId, // store ID used as org — wrong
        storeId,
        items: [],
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(); // customer.organizationId (companyId) !== storeId
  });

  it('flat case: organizationId === storeId === companyId → PASS', async () => {
    const svc = new OrderService();
    const order = await svc.createOrder({
      customerId: 'cust-hier',
      organizationId: companyId,
      storeId: companyId, // company root used as store (flat hierarchy)
      items: [],
      actorId: adminUser.id,
    });

    expect(order.organizationId).toBe(companyId);
    expect(order.storeId).toBe(companyId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Ticket creation with correct org/store split
// ══════════════════════════════════════════════════════════════════════════════

describe('Ticket creation — hierarchy-accurate org/store', () => {
  it('correct: organizationId=company, storeId=store → PASS', async () => {
    const ticket = await ticketService.createTicket({
      customerId: 'cust-hier',
      organizationId: companyId,
      storeId,
      subject: 'Hierarchy ticket', description: 'Test',
      category: 'general', priority: 'low',
      actorId: adminUser.id,
    });

    expect(ticket.organizationId).toBe(companyId);
    expect(ticket.storeId).toBe(storeId);
  });

  it('wrong: organizationId=store (not company) → customer org mismatch', async () => {
    await expect(
      ticketService.createTicket({
        customerId: 'cust-hier',
        organizationId: storeId, // wrong — customer belongs to companyId
        storeId,
        subject: 'Bad ticket', description: 'Test',
        category: 'general', priority: 'low',
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it('flat case: same ID for both → PASS', async () => {
    const ticket = await ticketService.createTicket({
      customerId: 'cust-hier',
      organizationId: companyId,
      storeId: companyId,
      subject: 'Flat ticket', description: 'Test',
      category: 'general', priority: 'low',
      actorId: adminUser.id,
    });

    expect(ticket.storeId).toBe(companyId);
  });
});
