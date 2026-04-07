/**
 * E2E Simulation — Risk review: case creation → assign → resolve.
 *
 * Covers:
 *   - Rule evaluation generates open case
 *   - Sensitive word detection generates case
 *   - Reviewer assigns case (moves to IN_REVIEW)
 *   - Reviewer resolves case with outcome code
 *   - Reviewer dismisses case as false positive
 *   - Closed case cannot be modified
 *   - Bid event ingestion + heuristics flagging
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { RiskRuleRepository } from '../../src/repositories/implementations/RiskRepository.js';
import { generateId } from '../../src/utils/idGenerator.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, RISK_CASE_STATUSES, OUTCOME_CODES } from '../../src/utils/constants.js';

const ADMIN    = { id: 'admin-001',    role: ROLES.ADMINISTRATOR, organizationNodeId: 'org-001' };
const REVIEWER = { id: 'reviewer-001', role: ROLES.REVIEWER,      organizationNodeId: 'org-001' };
const MANAGER  = { id: 'mgr-001',      role: ROLES.STORE_MANAGER,  organizationNodeId: 'org-001' };
const ORG_ID   = 'org-001';

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = ADMIN;
});

afterEach(() => {
  authService._currentUser = null;
  riskReviewService.loadSensitiveWordDictionary([]);
  closeDB();
  closeAll();
});

async function seedRule(ruleType = 'field_contains', field = 'description', value = 'prohibited') {
  const repo = new RiskRuleRepository();
  const rule = {
    id: generateId(), organizationId: ORG_ID, name: 'E2E Rule',
    targetEntityType: 'product', ruleType,
    parameters: ruleType === 'field_contains' ? { field, value } : { field, threshold: value },
    isActive: true, createdAt: Date.now(),
  };
  await repo.create(rule);
  return rule;
}

describe('Risk review full flow', () => {
  it('rule evaluation creates an OPEN case', async () => {
    await seedRule();
    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID, entityType: 'product', entityId: 'p-001',
      payload: { description: 'This item is prohibited.' }, actorId: 'admin-001',
    });
    expect(cases[0].status).toBe(RISK_CASE_STATUSES.OPEN);
  });

  it('sensitive word detection creates case', async () => {
    riskReviewService.loadSensitiveWordDictionary(['contraband']);
    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID, entityType: 'listing', entityId: 'l-001',
      payload: { title: 'Buy contraband now' }, actorId: 'admin-001',
    });
    expect(cases.length).toBeGreaterThan(0);
    const swMatch = cases[0].ruleMatches.find((m) => m.ruleId === 'sensitive_word');
    expect(swMatch.matches).toContain('contraband');
  });

  it('reviewer assigns case → IN_REVIEW', async () => {
    await seedRule();
    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID, entityType: 'product', entityId: 'p-002',
      payload: { description: 'prohibited item' }, actorId: 'admin-001',
    });
    const riskCase = cases[0];

    authService._currentUser = REVIEWER;
    const assigned = await riskReviewService.assignCase(riskCase.id, 'reviewer-001', 'reviewer-001');
    expect(assigned.status).toBe(RISK_CASE_STATUSES.IN_REVIEW);
    expect(assigned.assignedReviewerId).toBe('reviewer-001');
  });

  it('reviewer resolves case with outcome code', async () => {
    await seedRule();
    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID, entityType: 'product', entityId: 'p-003',
      payload: { description: 'prohibited item' }, actorId: 'admin-001',
    });

    authService._currentUser = REVIEWER;
    const resolved = await riskReviewService.resolveCase({
      caseId: cases[0].id,
      outcomeCode: OUTCOME_CODES.WARNING_ISSUED,
      resolutionComment: 'Seller warned about listing policy.',
      reviewerId: 'reviewer-001',
    });

    expect(resolved.status).toBe(RISK_CASE_STATUSES.RESOLVED);
    expect(resolved.outcomeCode).toBe(OUTCOME_CODES.WARNING_ISSUED);
    expect(resolved.resolvedAt).toBeDefined();
  });

  it('reviewer dismisses case as false positive', async () => {
    await seedRule();
    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID, entityType: 'product', entityId: 'p-004',
      payload: { description: 'prohibited item' }, actorId: 'admin-001',
    });

    authService._currentUser = REVIEWER;
    const dismissed = await riskReviewService.dismissCase(
      cases[0].id, 'Content reviewed — false alarm.', 'reviewer-001',
    );

    expect(dismissed.status).toBe(RISK_CASE_STATUSES.DISMISSED);
    expect(dismissed.outcomeCode).toBe(OUTCOME_CODES.FALSE_POSITIVE);
  });

  it('closed case cannot be modified', async () => {
    await seedRule();
    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID, entityType: 'product', entityId: 'p-005',
      payload: { description: 'prohibited item' }, actorId: 'admin-001',
    });

    authService._currentUser = REVIEWER;
    await riskReviewService.resolveCase({
      caseId: cases[0].id,
      outcomeCode: OUTCOME_CODES.NO_ISSUE,
      resolutionComment: 'All clear after review.',
      reviewerId: 'reviewer-001',
    });

    await expect(
      riskReviewService.assignCase(cases[0].id, 'reviewer-002', 'reviewer-001'),
    ).rejects.toThrow(/already closed/i);
  });

  it('bid events flagged when frequency exceeds threshold', async () => {
    authService._currentUser = MANAGER;
    for (let i = 0; i < 5; i++) {
      await riskReviewService.ingestBidEvent({
        organizationId: ORG_ID, userId: `u-${i}`, itemId: 'hot-item',
        bidAmount: 100 + i, actorId: 'mgr-001',
      });
    }

    const result = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: ORG_ID, itemId: 'hot-item',
      windowMs: 60 * 60_000, frequencyThreshold: 3,
    });
    expect(result.flagged).toBe(true);
  });
});
