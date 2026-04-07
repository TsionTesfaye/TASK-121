/**
 * Order + Ticket RBAC enforcement on read methods.
 *
 * Covers:
 *   - guest cannot read orders
 *   - analyst cannot read orders
 *   - guest cannot read tickets
 *   - analyst cannot read tickets
 *   - store_manager can read orders and tickets
 *   - reviewer can read tickets but not orders
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { OrderService } from '../../src/services/OrderService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'OrdTktRbac@123';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'rbac_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'RbacTestCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('rbac_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

  // Seed a customer for order/ticket creation
  const custRepo = new CustomerRepository();
  await custRepo.create({
    id: 'cust-rbac', organizationId: orgId, name: 'RBAC Customer',
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
// ORDERS — RBAC
// ══════════════════════════════════════════════════════════════════════════════

describe('OrderService read RBAC', () => {
  let orderId;

  beforeEach(async () => {
    const svc = new OrderService();
    const order = await svc.createOrder({
      customerId: 'cust-rbac', organizationId: orgId, storeId: orgId,
      items: [], actorId: adminUser.id,
    });
    orderId = order.id;
  });

  it('guest cannot read orders via getByStore', async () => {
    authService._currentUser = { id: 'guest-001', role: ROLES.GUEST, organizationNodeId: orgId };
    const svc = new OrderService();
    await expect(svc.getByStore(orgId)).rejects.toThrow(/permission denied/i);
  });

  it('guest cannot read order detail', async () => {
    authService._currentUser = { id: 'guest-001', role: ROLES.GUEST, organizationNodeId: orgId };
    const svc = new OrderService();
    await expect(svc.getOrderDetail(orderId)).rejects.toThrow(/permission denied/i);
  });

  it('analyst cannot read orders', async () => {
    authService._currentUser = { id: 'analyst-001', role: ROLES.ANALYST, organizationNodeId: orgId };
    const svc = new OrderService();
    await expect(svc.getByStore(orgId)).rejects.toThrow(/permission denied/i);
  });

  it('reviewer cannot read orders', async () => {
    authService._currentUser = { id: 'rev-001', role: ROLES.REVIEWER, organizationNodeId: orgId };
    const svc = new OrderService();
    await expect(svc.getByStore(orgId)).rejects.toThrow(/permission denied/i);
  });

  it('store_manager can read orders', async () => {
    authService._currentUser = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: orgId };
    const svc = new OrderService();
    const orders = await svc.getByStore(orgId);
    expect(orders.length).toBe(1);
  });

  it('admin can read orders', async () => {
    const svc = new OrderService();
    const orders = await svc.getByStore(orgId);
    expect(orders.length).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TICKETS — RBAC
// ══════════════════════════════════════════════════════════════════════════════

describe('TicketService read RBAC', () => {
  let ticketId;

  beforeEach(async () => {
    const ticket = await ticketService.createTicket({
      customerId: 'cust-rbac', organizationId: orgId, storeId: orgId,
      subject: 'RBAC Ticket', description: 'Test', category: 'general',
      priority: 'low', actorId: adminUser.id,
    });
    ticketId = ticket.id;
  });

  it('guest cannot read tickets via getByStore', async () => {
    authService._currentUser = { id: 'guest-001', role: ROLES.GUEST, organizationNodeId: orgId };
    await expect(ticketService.getByStore(orgId)).rejects.toThrow(/permission denied/i);
  });

  it('guest cannot read ticket detail', async () => {
    authService._currentUser = { id: 'guest-001', role: ROLES.GUEST, organizationNodeId: orgId };
    await expect(ticketService.getTicketDetail(ticketId)).rejects.toThrow(/permission denied/i);
  });

  it('analyst cannot read tickets', async () => {
    authService._currentUser = { id: 'analyst-001', role: ROLES.ANALYST, organizationNodeId: orgId };
    await expect(ticketService.getByStore(orgId)).rejects.toThrow(/permission denied/i);
  });

  it('reviewer CAN read tickets', async () => {
    authService._currentUser = { id: 'rev-001', role: ROLES.REVIEWER, organizationNodeId: orgId };
    const tickets = await ticketService.getByStore(orgId);
    expect(tickets.length).toBe(1);
  });

  it('store_manager can read tickets', async () => {
    authService._currentUser = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: orgId };
    const tickets = await ticketService.getByStore(orgId);
    expect(tickets.length).toBe(1);
  });

  it('admin can read ticket detail', async () => {
    const detail = await ticketService.getTicketDetail(ticketId);
    expect(detail.ticket.id).toBe(ticketId);
  });
});
