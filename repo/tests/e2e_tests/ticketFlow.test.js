/**
 * E2E Simulation — Ticket lifecycle: SLA → overdue → resolve → close.
 *
 * Covers:
 *   - Full ticket path: OPEN → IN_PROGRESS → RESOLVED → CLOSED
 *   - SLA overdue evaluation marks tickets
 *   - CLOSED is terminal
 *   - Assignee receives notification on assignment and status change
 *   - Invalid transitions rejected
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { TicketService } from '../../src/services/TicketService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { TemplateRepository } from '../../src/repositories/implementations/TemplateRepository.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { ROLES, TICKET_STATUSES, SYSTEM_TEMPLATES } from '../../src/utils/constants.js';
import { OrgRepository } from '../../src/repositories/implementations/OrgRepository.js';
import { generateId } from '../../src/utils/idGenerator.js';
import { extractPlaceholders } from '../../src/utils/validation.js';

const MANAGER = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: 'org-001' };
const ORG_ID = 'org-001';
// storeId must match manager's organizationNodeId (scope enforcement).
const STORE_ID = 'org-001';

async function seedSystemTemplates(orgId) {
  const repo = new TemplateRepository();
  for (const def of Object.values(SYSTEM_TEMPLATES)) {
    await repo.create({
      id: generateId(), organizationId: orgId, name: def.name, body: def.body,
      placeholders: extractPlaceholders(def.body), isCompact: false, createdAt: Date.now(), updatedAt: Date.now(),
    });
  }
}

async function seedCustomer(id, custOrgId) {
  const repo = new CustomerRepository();
  await repo.create({
    id, organizationId: custOrgId, name: 'Test Customer',
    membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
    storedValueCiphertext: null, storedValueIv: null,
    allergiesCiphertext: null, allergiesIv: null,
    materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
}

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const orgRepo = new OrgRepository();
  await orgRepo.create({
    id: ORG_ID, name: 'Test Org', type: 'company', parentId: null,
    organizationId: ORG_ID, createdAt: Date.now(), updatedAt: Date.now(),
  });

  authService._currentUser = MANAGER;
  await seedSystemTemplates(ORG_ID);
  await seedCustomer('cust-001', ORG_ID);
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
  vi.useRealTimers();
});

async function createTicket(svc, overrides = {}) {
  return svc.createTicket({
    organizationId: ORG_ID,
    storeId: STORE_ID,
    customerId: 'cust-001',
    subject: 'Test issue',
    description: 'Something went wrong',
    priority: 'medium',
    category: 'general',
    actorId: 'mgr-001',
    ...overrides,
  });
}

describe('Ticket lifecycle', () => {
  it('full path: OPEN → IN_PROGRESS → RESOLVED → CLOSED', async () => {
    const svc = new TicketService();
    const ticket = await createTicket(svc);
    expect(ticket.status).toBe(TICKET_STATUSES.OPEN);

    const assigned = await svc.assignTicket(ticket.id, 'reviewer-001', 'mgr-001');
    expect(assigned.status).toBe(TICKET_STATUSES.IN_PROGRESS);

    const resolved = await svc.transitionTicket(ticket.id, TICKET_STATUSES.RESOLVED, 'mgr-001', 'Issue fixed');
    expect(resolved.status).toBe(TICKET_STATUSES.RESOLVED);
    expect(resolved.resolvedAt).toBeDefined();

    const closed = await svc.transitionTicket(ticket.id, TICKET_STATUSES.CLOSED, 'mgr-001', 'Confirmed resolved');
    expect(closed.status).toBe(TICKET_STATUSES.CLOSED);
    expect(closed.closedBy).toBe('mgr-001');
  });

  it('CLOSED ticket cannot be transitioned', async () => {
    const svc = new TicketService();
    const ticket = await createTicket(svc);
    await svc.assignTicket(ticket.id, 'reviewer-001', 'mgr-001');
    await svc.transitionTicket(ticket.id, TICKET_STATUSES.RESOLVED, 'mgr-001', 'Done');
    await svc.transitionTicket(ticket.id, TICKET_STATUSES.CLOSED, 'mgr-001', 'Closed');

    await expect(
      svc.transitionTicket(ticket.id, TICKET_STATUSES.OPEN, 'mgr-001'),
    ).rejects.toThrow(/terminal/i);
  });

  it('SLA overdue evaluation marks past-due tickets', async () => {
    const svc = new TicketService();
    // Create a ticket with a slaDeadline in the past.
    const ticket = await createTicket(svc, { priority: 'high' });

    // Manually set slaDeadline in the past via the repository.
    const { TicketRepository } = await import('../../src/repositories/implementations/TicketRepository.js');
    const repo = new TicketRepository();
    await repo.update(ticket.id, { ...ticket, slaDueAt: Date.now() - 1000 });

    const overdueList = await svc.evaluateOverdue();
    expect(overdueList.some((t) => t.id === ticket.id)).toBe(true);

    const updated = await repo.findById(ticket.id);
    expect(updated.isOverdue).toBe(true);
  });

  it('notification queued for assignee on assignment', async () => {
    const svc = new TicketService();
    const ticket = await createTicket(svc);
    await svc.assignTicket(ticket.id, 'reviewer-001', 'mgr-001');

    // Assignment now routes through the queue. Verify queue item exists.
    const { MessageQueueRepository } = await import('../../src/repositories/implementations/NotificationRepository.js');
    const queueRepo = new MessageQueueRepository();
    const items = await queueRepo.findAll();
    expect(items.some((i) => i.recipientUserId === 'reviewer-001')).toBe(true);

    // Process queue to deliver to inbox.
    await notificationService.processDueItems();

    authService._currentUser = { id: 'reviewer-001', role: ROLES.REVIEWER, organizationNodeId: ORG_ID };
    const inbox = await notificationService.getInbox('reviewer-001');
    expect(inbox.length).toBeGreaterThan(0);
  });

  it('invalid transition rejected', async () => {
    const svc = new TicketService();
    const ticket = await createTicket(svc);

    // OPEN → RESOLVED skips IN_PROGRESS and should be rejected.
    await expect(
      svc.transitionTicket(ticket.id, TICKET_STATUSES.RESOLVED, 'mgr-001'),
    ).rejects.toThrow(/Invalid transition/i);
  });
});
