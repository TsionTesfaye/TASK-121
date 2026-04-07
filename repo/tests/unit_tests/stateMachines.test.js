/**
 * Unit tests — Order and Ticket state machines.
 *
 * Verifies legal and illegal transitions, terminal state enforcement,
 * and allergy flag propagation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { orderService } from '../../src/services/OrderService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';
import { OrgRepository } from '../../src/repositories/implementations/OrgRepository.js';
import { ORDER_STATUSES, TICKET_STATUSES, ROLES } from '../../src/utils/constants.js';
import { generateId } from '../../src/utils/idGenerator.js';

const ADMIN = { id: 'admin-001', role: ROLES.ADMINISTRATOR, organizationNodeId: 'store-001' };
const MANAGER = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: 'store-001' };

async function seedCustomer(orgId = 'store-001') {
  const repo = new BaseRepository('customers');
  const c = {
    id: generateId(),
    organizationId: orgId,
    name: 'Test Customer',
    membershipTier: 'Bronze',
    points: 0,
    storedValueCiphertext: 'enc',
    storedValueIv: 'iv',
    allergiesCiphertext: 'allergy-enc',
    allergiesIv: 'allergy-iv',
    materialRestrictionsCiphertext: null,
    materialRestrictionsIv: null,
    ratingAverage: 0,
    ratingCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await repo.create(c);
  return c;
}

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const orgRepo = new OrgRepository();
  await orgRepo.create({
    id: 'store-001', name: 'Test Org', type: 'company', parentId: null,
    organizationId: 'store-001', createdAt: Date.now(), updatedAt: Date.now(),
  });

  authService._currentUser = ADMIN;
});

afterEach(() => {
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ── Order state machine ───────────────────────────────────────────────────────

describe('Order state machine', () => {
  let order;

  beforeEach(async () => {
    const customer = await seedCustomer();
    order = await orderService.createOrder({
      customerId: customer.id,
      organizationId: 'store-001',
      storeId: 'store-001',
      actorId: 'admin-001',
    });
  });

  it('starts in DRAFT status', () => {
    expect(order.status).toBe(ORDER_STATUSES.DRAFT);
  });

  it('allows DRAFT → PLACED', async () => {
    const updated = await orderService.transitionOrder(order.id, ORDER_STATUSES.PLACED, 'admin-001');
    expect(updated.status).toBe(ORDER_STATUSES.PLACED);
  });

  it('allows DRAFT → CANCELED', async () => {
    const updated = await orderService.transitionOrder(order.id, ORDER_STATUSES.CANCELED, 'admin-001');
    expect(updated.status).toBe(ORDER_STATUSES.CANCELED);
  });

  it('rejects DRAFT → IN_PROGRESS (skipping PLACED)', async () => {
    await expect(orderService.transitionOrder(order.id, ORDER_STATUSES.IN_PROGRESS, 'admin-001'))
      .rejects.toThrow('Invalid transition');
  });

  it('rejects DRAFT → COMPLETED (skipping steps)', async () => {
    await expect(orderService.transitionOrder(order.id, ORDER_STATUSES.COMPLETED, 'admin-001'))
      .rejects.toThrow('Invalid transition');
  });

  it('follows full happy path: DRAFT → PLACED → IN_PROGRESS → READY → COMPLETED', async () => {
    await orderService.transitionOrder(order.id, ORDER_STATUSES.PLACED, 'admin-001');
    await orderService.transitionOrder(order.id, ORDER_STATUSES.IN_PROGRESS, 'admin-001');
    await orderService.transitionOrder(order.id, ORDER_STATUSES.READY, 'admin-001');
    const final = await orderService.transitionOrder(order.id, ORDER_STATUSES.COMPLETED, 'admin-001');
    expect(final.status).toBe(ORDER_STATUSES.COMPLETED);
  });

  it('COMPLETED is terminal — cannot transition further', async () => {
    await orderService.transitionOrder(order.id, ORDER_STATUSES.PLACED, 'admin-001');
    await orderService.transitionOrder(order.id, ORDER_STATUSES.IN_PROGRESS, 'admin-001');
    await orderService.transitionOrder(order.id, ORDER_STATUSES.READY, 'admin-001');
    await orderService.transitionOrder(order.id, ORDER_STATUSES.COMPLETED, 'admin-001');
    await expect(orderService.transitionOrder(order.id, ORDER_STATUSES.CANCELED, 'admin-001'))
      .rejects.toThrow('terminal state');
  });

  it('CANCELED is terminal — cannot transition further', async () => {
    await orderService.transitionOrder(order.id, ORDER_STATUSES.CANCELED, 'admin-001');
    await expect(orderService.transitionOrder(order.id, ORDER_STATUSES.PLACED, 'admin-001'))
      .rejects.toThrow('terminal state');
  });

  it('attaches restriction flags from the customer record', async () => {
    expect(order.restrictionFlags.hasAllergies).toBe(true);
    expect(order.restrictionFlags.hasMaterialRestrictions).toBe(false);
  });

  it('returns order detail with events', async () => {
    const detail = await orderService.getOrderDetail(order.id);
    expect(detail.order.id).toBe(order.id);
    expect(detail.events.length).toBeGreaterThan(0);
  });
});

// ── Ticket state machine ──────────────────────────────────────────────────────

describe('Ticket state machine', () => {
  let ticket;

  beforeEach(async () => {
    const customer = await seedCustomer();
    ticket = await ticketService.createTicket({
      customerId: customer.id,
      organizationId: 'store-001',
      storeId: 'store-001',
      subject: 'Product defect',
      description: 'The item is broken.',
      category: 'quality',
      priority: 'high',
      actorId: 'admin-001',
    });
  });

  it('starts in OPEN status', () => {
    expect(ticket.status).toBe(TICKET_STATUSES.OPEN);
  });

  it('allows OPEN → IN_PROGRESS', async () => {
    const updated = await ticketService.transitionTicket(ticket.id, TICKET_STATUSES.IN_PROGRESS, 'admin-001');
    expect(updated.status).toBe(TICKET_STATUSES.IN_PROGRESS);
  });

  it('allows OPEN → CLOSED directly', async () => {
    const updated = await ticketService.transitionTicket(ticket.id, TICKET_STATUSES.CLOSED, 'admin-001');
    expect(updated.status).toBe(TICKET_STATUSES.CLOSED);
    expect(updated.closedBy).toBe('admin-001');
  });

  it('rejects OPEN → RESOLVED (must go through IN_PROGRESS)', async () => {
    await expect(ticketService.transitionTicket(ticket.id, TICKET_STATUSES.RESOLVED, 'admin-001'))
      .rejects.toThrow('Invalid transition');
  });

  it('follows full path: OPEN → IN_PROGRESS → RESOLVED → CLOSED', async () => {
    await ticketService.transitionTicket(ticket.id, TICKET_STATUSES.IN_PROGRESS, 'admin-001');
    const resolved = await ticketService.transitionTicket(ticket.id, TICKET_STATUSES.RESOLVED, 'admin-001');
    expect(resolved.resolvedAt).toBeDefined();
    const closed = await ticketService.transitionTicket(ticket.id, TICKET_STATUSES.CLOSED, 'admin-001');
    expect(closed.status).toBe(TICKET_STATUSES.CLOSED);
  });

  it('CLOSED is terminal', async () => {
    await ticketService.transitionTicket(ticket.id, TICKET_STATUSES.CLOSED, 'admin-001');
    await expect(ticketService.transitionTicket(ticket.id, TICKET_STATUSES.IN_PROGRESS, 'admin-001'))
      .rejects.toThrow('terminal state');
  });

  it('assignTicket moves ticket to IN_PROGRESS', async () => {
    const updated = await ticketService.assignTicket(ticket.id, 'agent-001', 'admin-001');
    expect(updated.status).toBe(TICKET_STATUSES.IN_PROGRESS);
    expect(updated.assignedTo).toBe('agent-001');
  });

  it('returns ticket detail with sorted events', async () => {
    const detail = await ticketService.getTicketDetail(ticket.id);
    expect(detail.ticket.id).toBe(ticket.id);
    expect(detail.events.length).toBeGreaterThan(0);
    // Events should be sorted ascending by createdAt
    for (let i = 1; i < detail.events.length; i++) {
      expect(detail.events[i].createdAt).toBeGreaterThanOrEqual(detail.events[i - 1].createdAt);
    }
  });
});

// ── Ticket SLA overdue evaluation ─────────────────────────────────────────────

describe('Ticket SLA overdue evaluation', () => {
  it('marks tickets overdue when past SLA', async () => {
    const customer = await seedCustomer();
    // Create a ticket with a past-due SLA (0 hours = already due)
    const ticket = await ticketService.createTicket({
      customerId: customer.id,
      organizationId: 'store-001',
      storeId: 'store-001',
      subject: 'Overdue ticket',
      description: 'This is past due.',
      category: 'quality',
      priority: 'high',
      actorId: 'admin-001',
      slaHours: 0, // Immediately overdue
    });

    // Advance time slightly so slaDueAt < nowMs
    const overdue = await ticketService.evaluateOverdue();
    const found = overdue.find((t) => t.id === ticket.id);
    expect(found).toBeDefined();
    expect(found.isOverdue).toBe(true);
  });

  it('does not mark tickets overdue when within SLA', async () => {
    const customer = await seedCustomer();
    await ticketService.createTicket({
      customerId: customer.id,
      organizationId: 'store-001',
      storeId: 'store-001',
      subject: 'Fresh ticket',
      description: 'Within SLA.',
      category: 'quality',
      priority: 'low',
      actorId: 'admin-001',
      slaHours: 48, // 48 hours from now — not overdue
    });

    const overdue = await ticketService.evaluateOverdue();
    expect(overdue.length).toBe(0);
  });
});
