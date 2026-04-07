/**
 * RBAC Hardening — break tests for cross-org scope bypass, role enforcement,
 * and privilege escalation attempts.
 *
 * Every test here attempts an action that MUST be rejected. A passing test
 * means the system refused the illegal operation.
 *
 * Covers:
 *   - Unauthenticated access blocked across all services
 *   - Wrong-org scope bypass blocked (CustomerService, OrderService,
 *     TemplateService, RiskReviewService, TicketService, StyleService)
 *   - Insufficient role blocked (GUEST, ANALYST blocked from writes)
 *   - Admin bypass: administrator can access any org (correct behaviour)
 *   - getMaskedFields now enforces org scope
 *   - TemplateService reads now enforce org scope
 *   - RiskReviewService case management enforces org scope
 *   - OrderService.transitionOrder enforces org scope
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { CustomerService } from '../../src/services/CustomerService.js';
import { OrderService } from '../../src/services/OrderService.js';
import { TemplateService } from '../../src/services/TemplateService.js';
import { RiskReviewService } from '../../src/services/RiskReviewService.js';
import { TicketService } from '../../src/services/TicketService.js';
import { StyleService } from '../../src/services/StyleService.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { TemplateRepository } from '../../src/repositories/implementations/TemplateRepository.js';
import { RiskCaseRepository } from '../../src/repositories/implementations/RiskRepository.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, RISK_CASE_STATUSES, OUTCOME_CODES } from '../../src/utils/constants.js';
import { generateId } from '../../src/utils/idGenerator.js';

const ORG_A = 'org-alpha';
const ORG_B = 'org-beta';

const MGR_A = { id: 'mgr-a', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_A };
const MGR_B = { id: 'mgr-b', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_B };
const REVIEWER_A = { id: 'rev-a', role: ROLES.REVIEWER, organizationNodeId: ORG_A };
const REVIEWER_B = { id: 'rev-b', role: ROLES.REVIEWER, organizationNodeId: ORG_B };
const ADMIN = { id: 'admin-x', role: ROLES.ADMINISTRATOR, organizationNodeId: null };
const GUEST = { id: 'guest-x', role: ROLES.GUEST, organizationNodeId: null };
const ANALYST = { id: 'analyst-x', role: ROLES.ANALYST, organizationNodeId: ORG_A };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedCustomer(orgId) {
  const repo = new CustomerRepository();
  const c = { id: generateId(), organizationId: orgId, name: 'Test', membershipTier: 'Bronze', points: 0, storedValueCiphertext: 'ct', storedValueIv: 'iv', createdAt: Date.now(), updatedAt: Date.now() };
  await repo.create(c);
  return c;
}

async function seedTemplate(orgId) {
  const repo = new TemplateRepository();
  const t = { id: generateId(), organizationId: orgId, name: 'T', body: 'Hello', placeholders: [], isCompact: false, createdAt: Date.now(), updatedAt: Date.now() };
  await repo.create(t);
  return t;
}

async function seedRiskCase(orgId) {
  const repo = new RiskCaseRepository();
  const c = { id: generateId(), organizationId: orgId, sourceType: 'order', sourceId: 'o1', ruleMatches: [], status: RISK_CASE_STATUSES.OPEN, outcomeCode: null, resolutionComment: null, assignedReviewerId: null, createdAt: Date.now(), resolvedAt: null };
  await repo.create(c);
  return c;
}

async function seedStyleRefs(orgId) {
  const refs = { colorId: `col-${orgId}`, sizeId: `siz-${orgId}`, seasonId: `sea-${orgId}`, brandId: `brd-${orgId}`, supplierId: `sup-${orgId}` };
  await new BaseRepository('colors').create({ id: refs.colorId, isActive: true });
  await new BaseRepository('sizes').create({ id: refs.sizeId, isActive: true });
  await new BaseRepository('seasons').create({ id: refs.seasonId, isActive: true });
  await new BaseRepository('brands').create({ id: refs.brandId, isActive: true });
  await new BaseRepository('suppliers').create({ id: refs.supplierId, isActive: true });
  return refs;
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
});

// ── Unauthenticated access ────────────────────────────────────────────────────

describe('Unauthenticated access blocked', () => {
  it('CustomerService.getMaskedFields rejects no session', async () => {
    const svc = new CustomerService();
    await expect(svc.getMaskedFields('any-id')).rejects.toThrow(/authentication required/i);
  });

  it('OrderService.transitionOrder rejects no session', async () => {
    const svc = new OrderService();
    await expect(svc.transitionOrder('any-id', 'placed', 'actor')).rejects.toThrow(/authentication required/i);
  });

  it('TemplateService.getByOrg rejects no session', async () => {
    const svc = new TemplateService();
    await expect(svc.getByOrg(ORG_A)).rejects.toThrow(/authentication required/i);
  });

  it('TemplateService.getById rejects no session', async () => {
    const svc = new TemplateService();
    await expect(svc.getById('any-id')).rejects.toThrow(/authentication required/i);
  });

  it('RiskReviewService.assignCase rejects no session', async () => {
    const svc = new RiskReviewService();
    await expect(svc.assignCase('any-id', 'reviewer', 'actor')).rejects.toThrow(/authentication required/i);
  });

  it('RiskReviewService.resolveCase rejects no session', async () => {
    const svc = new RiskReviewService();
    await expect(svc.resolveCase({ caseId: 'x', outcomeCode: OUTCOME_CODES.NO_ISSUE, resolutionComment: 'done', reviewerId: 'r' })).rejects.toThrow(/authentication required/i);
  });

  it('TicketService.createTicket rejects no session', async () => {
    const svc = new TicketService();
    await expect(svc.createTicket({ organizationId: ORG_A, storeId: ORG_A, customerId: 'c', subject: 'x', description: 'y', category: 'z', priority: 'low', actorId: 'a' })).rejects.toThrow(/authentication required/i);
  });
});

// ── Insufficient role ─────────────────────────────────────────────────────────

describe('Insufficient role blocked', () => {
  it('GUEST cannot create a customer', async () => {
    authService._currentUser = GUEST;
    const svc = new CustomerService();
    await expect(svc.createCustomer({ organizationId: ORG_A, name: 'X', actorId: GUEST.id, reasonNote: 'Test customer creation' })).rejects.toThrow(/permission denied/i);
  });

  it('GUEST cannot transition an order', async () => {
    authService._currentUser = GUEST;
    const svc = new OrderService();
    await expect(svc.transitionOrder('any', 'placed', GUEST.id)).rejects.toThrow(/permission denied/i);
  });

  it('ANALYST cannot create a template', async () => {
    authService._currentUser = ANALYST;
    const svc = new TemplateService();
    await expect(svc.createTemplate({ organizationId: ORG_A, name: 'X', body: 'Hello', actorId: ANALYST.id })).rejects.toThrow(/permission denied/i);
  });

  it('STORE_MANAGER cannot assign a risk case (requires REVIEWER)', async () => {
    authService._currentUser = MGR_A;
    const riskCase = await seedRiskCase(ORG_A);
    const svc = new RiskReviewService();
    await expect(svc.assignCase(riskCase.id, 'reviewer', MGR_A.id)).rejects.toThrow(/permission denied/i);
  });

  it('STORE_MANAGER cannot import NLP text (requires ANALYST)', async () => {
    authService._currentUser = MGR_A;
    const { NLPService } = await import('../../src/services/NLPService.js');
    const svc = new NLPService();
    await expect(svc.importText({ sourceType: 'review', sourceId: 's', filename: 'f.txt', rawText: 'hello world test', actorId: MGR_A.id })).rejects.toThrow(/permission denied/i);
  });
});

// ── Cross-org scope bypass ────────────────────────────────────────────────────

describe('Cross-org scope bypass blocked', () => {
  it('getMaskedFields: manager from org-B cannot access org-A customer', async () => {
    const customer = await seedCustomer(ORG_A);
    authService._currentUser = MGR_B;
    const svc = new CustomerService();
    await expect(svc.getMaskedFields(customer.id)).rejects.toThrow(/scope violation/i);
  });

  it('createCustomer: manager from org-B cannot create in org-A', async () => {
    authService._currentUser = MGR_B;
    const svc = new CustomerService();
    await expect(
      svc.createCustomer({ organizationId: ORG_A, name: 'Intruder', actorId: MGR_B.id, reasonNote: 'Test customer creation' }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('TemplateService.getByOrg: manager from org-B cannot list org-A templates', async () => {
    await seedTemplate(ORG_A);
    authService._currentUser = MGR_B;
    const svc = new TemplateService();
    await expect(svc.getByOrg(ORG_A)).rejects.toThrow(/scope violation/i);
  });

  it('TemplateService.getById: manager from org-B cannot read org-A template', async () => {
    const tmpl = await seedTemplate(ORG_A);
    authService._currentUser = MGR_B;
    const svc = new TemplateService();
    await expect(svc.getById(tmpl.id)).rejects.toThrow(/scope violation/i);
  });

  it('RiskReviewService.assignCase: reviewer-B cannot manage org-A case', async () => {
    const riskCase = await seedRiskCase(ORG_A);
    authService._currentUser = REVIEWER_B;
    const svc = new RiskReviewService();
    await expect(svc.assignCase(riskCase.id, REVIEWER_B.id, REVIEWER_B.id)).rejects.toThrow(/scope violation/i);
  });

  it('RiskReviewService.resolveCase: reviewer-B cannot resolve org-A case', async () => {
    const riskCase = await seedRiskCase(ORG_A);
    authService._currentUser = REVIEWER_B;
    const svc = new RiskReviewService();
    await expect(
      svc.resolveCase({ caseId: riskCase.id, outcomeCode: OUTCOME_CODES.NO_ISSUE, resolutionComment: 'All good.', reviewerId: REVIEWER_B.id }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('RiskReviewService.dismissCase: reviewer-B cannot dismiss org-A case', async () => {
    const riskCase = await seedRiskCase(ORG_A);
    authService._currentUser = REVIEWER_B;
    const svc = new RiskReviewService();
    await expect(svc.dismissCase(riskCase.id, 'False positive.', REVIEWER_B.id)).rejects.toThrow(/scope violation/i);
  });

  it('StyleService.createStyle: manager-B cannot create style for org-A', async () => {
    const refs = await seedStyleRefs(ORG_B);
    authService._currentUser = MGR_B;
    const svc = new StyleService();
    await expect(
      svc.createStyle({ organizationId: ORG_A, sku: 'X', storeId: ORG_A, actorId: MGR_B.id, reasonNote: 'Test style creation', ...refs }),
    ).rejects.toThrow(/scope violation/i);
  });
});

// ── Admin bypass is correct ───────────────────────────────────────────────────

describe('Administrator correctly bypasses org scope', () => {
  it('admin can read any org template', async () => {
    const tmpl = await seedTemplate(ORG_A);
    authService._currentUser = ADMIN;
    const svc = new TemplateService();
    const result = await svc.getById(tmpl.id);
    expect(result.id).toBe(tmpl.id);
  });

  it('admin can assign risk case from any org', async () => {
    const riskCase = await seedRiskCase(ORG_A);
    authService._currentUser = ADMIN;
    const svc = new RiskReviewService();
    const updated = await svc.assignCase(riskCase.id, 'reviewer-x', ADMIN.id);
    expect(updated.status).toBe(RISK_CASE_STATUSES.IN_REVIEW);
  });

  it('admin can read masked fields of any customer', async () => {
    const customer = await seedCustomer(ORG_B);
    authService._currentUser = ADMIN;
    const svc = new CustomerService();
    const masked = await svc.getMaskedFields(customer.id);
    expect(masked.storedValue).toBeTruthy();
  });
});

// ── Actor-without-org blocked ─────────────────────────────────────────────────

describe('Actor without organizationNodeId blocked from scoped operations', () => {
  it('STORE_MANAGER with null org cannot create customer', async () => {
    authService._currentUser = { id: 'mgr-noorg', role: ROLES.STORE_MANAGER, organizationNodeId: null };
    const svc = new CustomerService();
    await expect(svc.createCustomer({ organizationId: ORG_A, name: 'X', actorId: 'mgr-noorg', reasonNote: 'Test customer creation' })).rejects.toThrow(/no organization assigned/i);
  });
});
