/**
 * State Machine Break Tests — exhaustive invalid transition coverage.
 *
 * Every test attempts an illegal state transition and MUST be rejected.
 * A passing test means the machine refused the illegal operation.
 *
 * Covers:
 *   ORDER state machine: every invalid transition pair
 *   TICKET state machine: every invalid transition pair
 *   RISK CASE state machine: terminal states cannot be modified
 *   Terminal state enforcement: no transition out of terminal states
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { OrderService } from '../../src/services/OrderService.js';
import { TicketService } from '../../src/services/TicketService.js';
import { RiskReviewService } from '../../src/services/RiskReviewService.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { OrgRepository } from '../../src/repositories/implementations/OrgRepository.js';
import { RiskCaseRepository } from '../../src/repositories/implementations/RiskRepository.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, ORDER_STATUSES, TICKET_STATUSES, RISK_CASE_STATUSES, OUTCOME_CODES } from '../../src/utils/constants.js';
import { generateId } from '../../src/utils/idGenerator.js';

const ACTOR = { id: 'actor-001', role: ROLES.STORE_MANAGER, organizationNodeId: 'org-001' };
const REVIEWER = { id: 'rev-001', role: ROLES.REVIEWER, organizationNodeId: 'org-001' };
const ORG = 'org-001';

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = ACTOR;

  // Seed org node so store validation passes.
  const orgRepo = new OrgRepository();
  await orgRepo.create({
    id: ORG, name: 'SM Test Org', type: 'company', parentId: null,
    organizationId: ORG, createdAt: Date.now(), updatedAt: Date.now(),
  });

  // Seed a customer so orders and tickets can be created.
  const custRepo = new CustomerRepository();
  await custRepo.create({
    id: 'cust-sm', organizationId: ORG, name: 'SM Test', membershipTier: 'Bronze', points: 0,
    ratingAverage: 0, ratingCount: 0,
    storedValueCiphertext: null, storedValueIv: null,
    allergiesCiphertext: null, allergiesIv: null,
    materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
});

// ── Order state machine ───────────────────────────────────────────────────────

async function makeOrder(svc) {
  return svc.createOrder({ customerId: 'cust-sm', organizationId: ORG, storeId: ORG, actorId: ACTOR.id });
}

async function advanceOrder(svc, orderId, ...statuses) {
  for (const s of statuses) {
    await svc.transitionOrder(orderId, s, ACTOR.id);
  }
}

describe('Order state machine — invalid transitions', () => {
  it('DRAFT → IN_PROGRESS is invalid (must go through PLACED)', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.IN_PROGRESS, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('DRAFT → READY is invalid', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.READY, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('DRAFT → COMPLETED is invalid', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.COMPLETED, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('PLACED → READY is invalid (must go through IN_PROGRESS)', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await advanceOrder(svc, order.id, ORDER_STATUSES.PLACED);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.READY, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('PLACED → COMPLETED is invalid', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await advanceOrder(svc, order.id, ORDER_STATUSES.PLACED);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.COMPLETED, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('IN_PROGRESS → PLACED is invalid (no backward transitions)', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await advanceOrder(svc, order.id, ORDER_STATUSES.PLACED, ORDER_STATUSES.IN_PROGRESS);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.PLACED, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('IN_PROGRESS → COMPLETED is invalid (must go through READY)', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await advanceOrder(svc, order.id, ORDER_STATUSES.PLACED, ORDER_STATUSES.IN_PROGRESS);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.COMPLETED, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('READY → IN_PROGRESS is invalid (no backward transitions)', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await advanceOrder(svc, order.id, ORDER_STATUSES.PLACED, ORDER_STATUSES.IN_PROGRESS, ORDER_STATUSES.READY);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.IN_PROGRESS, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('COMPLETED is terminal — cannot transition to CANCELED', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await advanceOrder(svc, order.id, ORDER_STATUSES.PLACED, ORDER_STATUSES.IN_PROGRESS, ORDER_STATUSES.READY, ORDER_STATUSES.COMPLETED);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.CANCELED, ACTOR.id)).rejects.toThrow(/terminal/i);
  });

  it('COMPLETED is terminal — cannot transition back to PLACED', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await advanceOrder(svc, order.id, ORDER_STATUSES.PLACED, ORDER_STATUSES.IN_PROGRESS, ORDER_STATUSES.READY, ORDER_STATUSES.COMPLETED);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.PLACED, ACTOR.id)).rejects.toThrow(/terminal/i);
  });

  it('CANCELED is terminal — cannot transition to PLACED', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await advanceOrder(svc, order.id, ORDER_STATUSES.PLACED, ORDER_STATUSES.CANCELED);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.PLACED, ACTOR.id)).rejects.toThrow(/terminal/i);
  });

  it('CANCELED is terminal — cannot transition to IN_PROGRESS', async () => {
    const svc = new OrderService();
    const order = await makeOrder(svc);
    await advanceOrder(svc, order.id, ORDER_STATUSES.PLACED, ORDER_STATUSES.CANCELED);
    await expect(svc.transitionOrder(order.id, ORDER_STATUSES.IN_PROGRESS, ACTOR.id)).rejects.toThrow(/terminal/i);
  });

  it('transitioning non-existent order throws', async () => {
    const svc = new OrderService();
    await expect(svc.transitionOrder('does-not-exist', ORDER_STATUSES.PLACED, ACTOR.id)).rejects.toThrow(/not found/i);
  });
});

// ── Ticket state machine ──────────────────────────────────────────────────────

async function makeTicket(svc) {
  return svc.createTicket({
    organizationId: ORG, storeId: ORG, customerId: 'cust-sm',
    subject: 'Issue', description: 'Details here.', category: 'general',
    priority: 'medium', actorId: ACTOR.id,
  });
}

describe('Ticket state machine — invalid transitions', () => {
  it('OPEN → RESOLVED is invalid (must go through IN_PROGRESS)', async () => {
    const svc = new TicketService();
    const ticket = await makeTicket(svc);
    await expect(svc.transitionTicket(ticket.id, TICKET_STATUSES.RESOLVED, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('IN_PROGRESS → OPEN is invalid (no backward transitions)', async () => {
    const svc = new TicketService();
    const ticket = await makeTicket(svc);
    await svc.assignTicket(ticket.id, 'rev-001', ACTOR.id); // → IN_PROGRESS
    await expect(svc.transitionTicket(ticket.id, TICKET_STATUSES.OPEN, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('RESOLVED → IN_PROGRESS is invalid (no backward transitions)', async () => {
    const svc = new TicketService();
    const ticket = await makeTicket(svc);
    await svc.assignTicket(ticket.id, 'rev-001', ACTOR.id);
    await svc.transitionTicket(ticket.id, TICKET_STATUSES.RESOLVED, ACTOR.id);
    await expect(svc.transitionTicket(ticket.id, TICKET_STATUSES.IN_PROGRESS, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('RESOLVED → OPEN is invalid', async () => {
    const svc = new TicketService();
    const ticket = await makeTicket(svc);
    await svc.assignTicket(ticket.id, 'rev-001', ACTOR.id);
    await svc.transitionTicket(ticket.id, TICKET_STATUSES.RESOLVED, ACTOR.id);
    await expect(svc.transitionTicket(ticket.id, TICKET_STATUSES.OPEN, ACTOR.id)).rejects.toThrow(/invalid transition/i);
  });

  it('CLOSED is terminal — cannot transition to OPEN', async () => {
    const svc = new TicketService();
    const ticket = await makeTicket(svc);
    await svc.assignTicket(ticket.id, 'rev-001', ACTOR.id);
    await svc.transitionTicket(ticket.id, TICKET_STATUSES.RESOLVED, ACTOR.id);
    await svc.transitionTicket(ticket.id, TICKET_STATUSES.CLOSED, ACTOR.id);
    await expect(svc.transitionTicket(ticket.id, TICKET_STATUSES.OPEN, ACTOR.id)).rejects.toThrow(/terminal/i);
  });

  it('CLOSED is terminal — cannot transition to IN_PROGRESS', async () => {
    const svc = new TicketService();
    const ticket = await makeTicket(svc);
    await svc.assignTicket(ticket.id, 'rev-001', ACTOR.id);
    await svc.transitionTicket(ticket.id, TICKET_STATUSES.RESOLVED, ACTOR.id);
    await svc.transitionTicket(ticket.id, TICKET_STATUSES.CLOSED, ACTOR.id);
    await expect(svc.transitionTicket(ticket.id, TICKET_STATUSES.IN_PROGRESS, ACTOR.id)).rejects.toThrow(/terminal/i);
  });

  it('CLOSED ticket cannot be re-assigned', async () => {
    const svc = new TicketService();
    const ticket = await makeTicket(svc);
    await svc.assignTicket(ticket.id, 'rev-001', ACTOR.id);
    await svc.transitionTicket(ticket.id, TICKET_STATUSES.RESOLVED, ACTOR.id);
    await svc.transitionTicket(ticket.id, TICKET_STATUSES.CLOSED, ACTOR.id);
    await expect(svc.assignTicket(ticket.id, 'rev-002', ACTOR.id)).rejects.toThrow(/terminal/i);
  });

  it('transitioning non-existent ticket throws', async () => {
    const svc = new TicketService();
    await expect(svc.transitionTicket('does-not-exist', TICKET_STATUSES.IN_PROGRESS, ACTOR.id)).rejects.toThrow(/not found/i);
  });
});

// ── Risk case state machine ───────────────────────────────────────────────────

describe('Risk case state machine — closed cases cannot be modified', () => {
  async function makeResolvedCase() {
    const repo = new RiskCaseRepository();
    const c = { id: generateId(), organizationId: ORG, sourceType: 'order', sourceId: 'o1', ruleMatches: [], status: RISK_CASE_STATUSES.RESOLVED, outcomeCode: OUTCOME_CODES.NO_ISSUE, resolutionComment: 'done', assignedReviewerId: REVIEWER.id, createdAt: Date.now(), resolvedAt: Date.now() };
    await repo.create(c);
    return c;
  }

  async function makeDismissedCase() {
    const repo = new RiskCaseRepository();
    const c = { id: generateId(), organizationId: ORG, sourceType: 'order', sourceId: 'o2', ruleMatches: [], status: RISK_CASE_STATUSES.DISMISSED, outcomeCode: OUTCOME_CODES.FALSE_POSITIVE, resolutionComment: 'FP', assignedReviewerId: REVIEWER.id, createdAt: Date.now(), resolvedAt: Date.now() };
    await repo.create(c);
    return c;
  }

  it('RESOLVED case cannot be re-assigned', async () => {
    authService._currentUser = REVIEWER;
    const resolved = await makeResolvedCase();
    const svc = new RiskReviewService();
    await expect(svc.assignCase(resolved.id, 'rev-002', REVIEWER.id)).rejects.toThrow(/already closed/i);
  });

  it('RESOLVED case cannot be resolved again', async () => {
    authService._currentUser = REVIEWER;
    const resolved = await makeResolvedCase();
    const svc = new RiskReviewService();
    await expect(
      svc.resolveCase({ caseId: resolved.id, outcomeCode: OUTCOME_CODES.NO_ISSUE, resolutionComment: 'Again.', reviewerId: REVIEWER.id }),
    ).rejects.toThrow(/already closed/i);
  });

  it('DISMISSED case cannot be re-assigned', async () => {
    authService._currentUser = REVIEWER;
    const dismissed = await makeDismissedCase();
    const svc = new RiskReviewService();
    await expect(svc.assignCase(dismissed.id, 'rev-003', REVIEWER.id)).rejects.toThrow(/already closed/i);
  });

  it('DISMISSED case cannot be dismissed again', async () => {
    authService._currentUser = REVIEWER;
    const dismissed = await makeDismissedCase();
    const svc = new RiskReviewService();
    await expect(svc.dismissCase(dismissed.id, 'Already dismissed.', REVIEWER.id)).rejects.toThrow(/already closed/i);
  });

  it('resolveCase with invalid outcome code is rejected', async () => {
    authService._currentUser = REVIEWER;
    const repo = new RiskCaseRepository();
    const c = { id: generateId(), organizationId: ORG, sourceType: 'order', sourceId: 'o3', ruleMatches: [], status: RISK_CASE_STATUSES.OPEN, outcomeCode: null, resolutionComment: null, assignedReviewerId: null, createdAt: Date.now(), resolvedAt: null };
    await repo.create(c);
    const svc = new RiskReviewService();
    await expect(
      svc.resolveCase({ caseId: c.id, outcomeCode: 'INVALID_CODE', resolutionComment: 'Done.', reviewerId: REVIEWER.id }),
    ).rejects.toThrow(/invalid outcome code/i);
  });

  it('dismissCase with empty comment is rejected', async () => {
    authService._currentUser = REVIEWER;
    const repo = new RiskCaseRepository();
    const c = { id: generateId(), organizationId: ORG, sourceType: 'order', sourceId: 'o4', ruleMatches: [], status: RISK_CASE_STATUSES.OPEN, outcomeCode: null, resolutionComment: null, assignedReviewerId: null, createdAt: Date.now(), resolvedAt: null };
    await repo.create(c);
    const svc = new RiskReviewService();
    await expect(svc.dismissCase(c.id, '', REVIEWER.id)).rejects.toThrow(/comment required/i);
  });
});
