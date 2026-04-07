/**
 * Critical correctness tests — scope model, locked session, channel validation,
 * notification filters, overdue query.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { OrderService } from '../../src/services/OrderService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { orgService } from '../../src/services/OrgService.js';
import { lookupDataService } from '../../src/services/LookupDataService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { TicketRepository } from '../../src/repositories/implementations/TicketRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, ORG_NODE_TYPES } from '../../src/utils/constants.js';

const PASS = 'CritCorr@12345';
let companyId, storeId, adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'cc_admin', adminPassword: PASS, orgName: 'CritCorrCo',
  });
  companyId = org.id;
  adminUser = admin;
  await authService.login('cc_admin', PASS);
    await authService.unlockProtectedData(PASS);

  const factory = await orgService.createNode({
    parentId: companyId, type: ORG_NODE_TYPES.FACTORY, name: 'F',
    organizationId: companyId, actorId: adminUser.id,
  });
  const store = await orgService.createNode({
    parentId: factory.id, type: ORG_NODE_TYPES.STORE, name: 'S',
    organizationId: companyId, actorId: adminUser.id,
  });
  storeId = store.id;

  await authService.createUser({
    username: 'store_mgr', password: PASS,
    role: ROLES.STORE_MANAGER, organizationNodeId: storeId,
  });

  const custRepo = new CustomerRepository();
  await custRepo.create({
    id: 'cust-cc', organizationId: companyId, name: 'CC Customer',
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
// 1. SCOPE MODEL — STORE USER ACCESSES ROOT-LEVEL APIs
// ══════════════════════════════════════════════════════════════════════════════

describe('Scope model — store user accesses root-level APIs', () => {
  beforeEach(async () => {
    await authService.logout();
    await authService.login('store_mgr', PASS);
    await authService.unlockProtectedData(PASS);
  });

  it('store user can access company root via isInScope (ancestor)', async () => {
    const actor = authService.getCurrentUser();
    const inScope = await orgService.isInScope(actor, companyId);
    expect(inScope).toBe(true);
  });

  it('store user can create order with companyId as organizationId', async () => {
    const svc = new OrderService();
    const order = await svc.createOrder({
      customerId: 'cust-cc', organizationId: companyId, storeId,
      items: [], actorId: authService.getCurrentUser().id,
    });
    expect(order.organizationId).toBe(companyId);
  });

  it('store user can create ticket with companyId as organizationId', async () => {
    const ticket = await ticketService.createTicket({
      customerId: 'cust-cc', organizationId: companyId, storeId,
      subject: 'Scope test', description: 'Test',
      category: 'general', priority: 'low',
      actorId: authService.getCurrentUser().id,
    });
    expect(ticket.organizationId).toBe(companyId);
  });

  it('store user CANNOT access a different company', async () => {
    const actor = authService.getCurrentUser();
    const inScope = await orgService.isInScope(actor, 'foreign-company-999');
    expect(inScope).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. LOCKED SESSION BLOCKS ALL MUTATIONS
// ══════════════════════════════════════════════════════════════════════════════

describe('Locked session blocks mutations', () => {
  beforeEach(() => {
    authService.lockSession();
  });

  it('customerService.createCustomer throws when locked', async () => {
    await expect(customerService.createCustomer({
      organizationId: companyId, name: 'Locked',
      actorId: adminUser.id, reasonNote: 'Lock test creation',
    })).rejects.toThrow(/locked/i);
  });

  it('orderService.createOrder throws when locked', async () => {
    const svc = new OrderService();
    await expect(svc.createOrder({
      customerId: 'cust-cc', organizationId: companyId, storeId: companyId,
      items: [], actorId: adminUser.id,
    })).rejects.toThrow(/locked/i);
  });

  it('ticketService.createTicket throws when locked', async () => {
    await expect(ticketService.createTicket({
      customerId: null, organizationId: companyId, storeId: companyId,
      subject: 'Locked', description: 'X', category: 'general', priority: 'low',
      actorId: adminUser.id,
    })).rejects.toThrow(/locked/i);
  });

  it('lookupDataService.createEntry throws when locked', async () => {
    await expect(lookupDataService.createEntry({
      store: 'colors', organizationId: companyId, name: 'Locked',
      actorId: adminUser.id, reasonNote: 'Lock test entry',
    })).rejects.toThrow(/locked/i);
  });

  it('notificationService.upsertChannel throws when locked', async () => {
    await expect(notificationService.upsertChannel({
      organizationId: companyId, name: 'Locked Channel',
    })).rejects.toThrow(/locked/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. CHANNEL VALIDATION ON SUBSCRIBE
// ══════════════════════════════════════════════════════════════════════════════

describe('Channel validation on subscribe', () => {
  it('subscribing with nonexistent channelId throws', async () => {
    await expect(notificationService.subscribe({
      userId: adminUser.id, channelId: 'ghost-channel',
      eventType: 'order_status', organizationId: companyId,
    })).rejects.toThrow(/not found/i);
  });

  it('subscribing with null channelId succeeds (default channel)', async () => {
    const sub = await notificationService.subscribe({
      userId: adminUser.id, channelId: null,
      eventType: 'order_status', organizationId: companyId,
    });
    expect(sub.eventType).toBe('order_status');
  });

  it('subscribing with valid channelId succeeds', async () => {
    const channel = await notificationService.upsertChannel({
      organizationId: companyId, name: 'Valid Channel',
    });
    const sub = await notificationService.subscribe({
      userId: adminUser.id, channelId: channel.id,
      eventType: 'order_status', organizationId: companyId,
    });
    expect(sub.channelId).toBe(channel.id);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. OVERDUE TICKETS CORRECTLY RETURNED
// ══════════════════════════════════════════════════════════════════════════════

describe('Overdue tickets — boolean query correctness', () => {
  it('findOverdue returns tickets with isOverdue === true', async () => {
    // Create ticket with past SLA
    const ticket = await ticketService.createTicket({
      customerId: null, organizationId: companyId, storeId: companyId,
      subject: 'Overdue test', description: 'SLA test',
      category: 'general', priority: 'high',
      actorId: adminUser.id, slaHours: 0,
    });

    // Trigger overdue evaluation
    await ticketService.evaluateOverdue();

    // Verify repository returns it
    const repo = new TicketRepository();
    const overdue = await repo.findOverdue();
    expect(overdue.length).toBeGreaterThan(0);
    expect(overdue.every((t) => t.isOverdue === true)).toBe(true);
  });

  it('non-overdue tickets are NOT returned', async () => {
    await ticketService.createTicket({
      customerId: null, organizationId: companyId, storeId: companyId,
      subject: 'Not overdue', description: 'Normal SLA',
      category: 'general', priority: 'low',
      actorId: adminUser.id, slaHours: 48,
    });

    const repo = new TicketRepository();
    const overdue = await repo.findOverdue();
    expect(overdue.every((t) => t.isOverdue === true)).toBe(true);
  });
});
