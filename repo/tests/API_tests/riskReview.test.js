/**
 * Integration tests — Risk case creation and resolution.
 *
 * Covers:
 *   - rule evaluation generates risk cases
 *   - sensitive word matching
 *   - case assignment and resolution
 *   - resolution without outcome code fails
 *   - resolution without comment fails
 *   - already-closed case cannot be modified
 *   - dismissal
 *   - bid event ingestion
 *   - bidding heuristics frequency threshold
 *   - linked account ingestion
 *   - linked-account signals in heuristic evaluation
 *   - linked-account evidence in generated risk case
 *   - heuristic unflagged when link signal absent and thresholds not met
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, RISK_CASE_STATUSES, OUTCOME_CODES } from '../../src/utils/constants.js';
import { RiskRuleRepository } from '../../src/repositories/implementations/RiskRepository.js';
import { generateId } from '../../src/utils/idGenerator.js';

const ADMIN = { id: 'admin-001', role: ROLES.ADMINISTRATOR, organizationNodeId: 'org-001' };
const REVIEWER = { id: 'reviewer-001', role: ROLES.REVIEWER, organizationNodeId: 'org-001' };
const MANAGER = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: 'org-001' };
const ORG_ID = 'org-001';

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

async function seedActiveRule({ ruleType = 'field_contains', field = 'description', value = 'prohibited' } = {}) {
  const repo = new RiskRuleRepository();
  const rule = {
    id: generateId(),
    organizationId: ORG_ID,
    name: 'Test Rule',
    targetEntityType: 'product',
    ruleType,
    parameters: ruleType === 'field_contains' ? { field, value } : { field, threshold: 100 },
    isActive: true,
    createdAt: Date.now(),
  };
  await repo.create(rule);
  return rule;
}

// ── Machine rule evaluation ───────────────────────────────────────────────────

describe('Risk case creation via rule evaluation', () => {
  it('creates a risk case when a rule matches', async () => {
    await seedActiveRule({ ruleType: 'field_contains', field: 'description', value: 'prohibited' });

    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID,
      entityType: 'product',
      entityId: 'prod-001',
      payload: { description: 'This item is prohibited content' },
      actorId: 'admin-001',
    });

    expect(cases.length).toBe(1);
    expect(cases[0].status).toBe(RISK_CASE_STATUSES.OPEN);
    expect(cases[0].ruleMatches.length).toBeGreaterThan(0);
  });

  it('returns empty array when no rules match', async () => {
    await seedActiveRule({ field: 'description', value: 'prohibited' });

    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID,
      entityType: 'product',
      entityId: 'prod-002',
      payload: { description: 'A perfectly fine product' },
      actorId: 'admin-001',
    });

    expect(cases.length).toBe(0);
  });

  it('field_exceeds rule triggers on threshold violation', async () => {
    await seedActiveRule({ ruleType: 'field_exceeds', field: 'price', value: 100 });

    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID,
      entityType: 'product',
      entityId: 'prod-003',
      payload: { price: 150 },
      actorId: 'admin-001',
    });

    expect(cases.length).toBe(1);
  });
});

// ── Sensitive word detection ──────────────────────────────────────────────────

describe('Sensitive word detection', () => {
  it('creates a risk case when sensitive word is found', async () => {
    riskReviewService.loadSensitiveWordDictionary(['contraband', 'illegal']);

    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID,
      entityType: 'listing',
      entityId: 'list-001',
      payload: { title: 'Buy contraband goods here' },
      actorId: 'admin-001',
    });

    expect(cases.length).toBe(1);
    const swMatch = cases[0].ruleMatches.find((m) => m.ruleId === 'sensitive_word');
    expect(swMatch.matches).toContain('contraband');
  });

  it('does not trigger when no sensitive words present', async () => {
    riskReviewService.loadSensitiveWordDictionary(['contraband']);

    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID,
      entityType: 'listing',
      entityId: 'list-002',
      payload: { title: 'Legitimate product for sale' },
      actorId: 'admin-001',
    });

    expect(cases.length).toBe(0);
  });
});

// ── Case resolution ───────────────────────────────────────────────────────────

describe('Case resolution', () => {
  async function createOpenCase() {
    // evaluateRules requires STORE_MANAGER+; use ADMIN to seed test data.
    const savedUser = authService._currentUser;
    authService._currentUser = ADMIN;
    riskReviewService.loadSensitiveWordDictionary(['flagged']);
    const cases = await riskReviewService.evaluateRules({
      organizationId: ORG_ID,
      entityType: 'listing',
      entityId: `list-${Date.now()}`,
      payload: { title: 'This is flagged' },
      actorId: 'admin-001',
    });
    authService._currentUser = savedUser;
    return cases[0];
  }

  it('reviewer can assign a case', async () => {
    authService._currentUser = REVIEWER;
    const riskCase = await createOpenCase();
    authService._currentUser = REVIEWER;

    const updated = await riskReviewService.assignCase(riskCase.id, 'reviewer-001', 'reviewer-001');
    expect(updated.status).toBe(RISK_CASE_STATUSES.IN_REVIEW);
    expect(updated.assignedReviewerId).toBe('reviewer-001');
  });

  it('reviewer can resolve a case with outcome code and comment', async () => {
    authService._currentUser = REVIEWER;
    const riskCase = await createOpenCase();
    authService._currentUser = REVIEWER;

    const resolved = await riskReviewService.resolveCase({
      caseId: riskCase.id,
      outcomeCode: OUTCOME_CODES.WARNING_ISSUED,
      resolutionComment: 'Warning issued to the seller.',
      reviewerId: 'reviewer-001',
    });

    expect(resolved.status).toBe(RISK_CASE_STATUSES.RESOLVED);
    expect(resolved.outcomeCode).toBe(OUTCOME_CODES.WARNING_ISSUED);
    expect(resolved.resolvedAt).toBeDefined();
  });

  it('resolution without outcome code throws', async () => {
    authService._currentUser = REVIEWER;
    const riskCase = await createOpenCase();
    authService._currentUser = REVIEWER;

    await expect(
      riskReviewService.resolveCase({
        caseId: riskCase.id,
        outcomeCode: '',
        resolutionComment: 'Some comment',
        reviewerId: 'reviewer-001',
      }),
    ).rejects.toThrow('Invalid outcome code');
  });

  it('resolution without comment throws', async () => {
    authService._currentUser = REVIEWER;
    const riskCase = await createOpenCase();
    authService._currentUser = REVIEWER;

    await expect(
      riskReviewService.resolveCase({
        caseId: riskCase.id,
        outcomeCode: OUTCOME_CODES.NO_ISSUE,
        resolutionComment: '',
        reviewerId: 'reviewer-001',
      }),
    ).rejects.toThrow('comment is required');
  });

  it('already-resolved case cannot be modified', async () => {
    authService._currentUser = REVIEWER;
    const riskCase = await createOpenCase();
    authService._currentUser = REVIEWER;

    await riskReviewService.resolveCase({
      caseId: riskCase.id,
      outcomeCode: OUTCOME_CODES.NO_ISSUE,
      resolutionComment: 'All clear.',
      reviewerId: 'reviewer-001',
    });

    await expect(
      riskReviewService.assignCase(riskCase.id, 'reviewer-002', 'reviewer-001'),
    ).rejects.toThrow('already closed');
  });

  it('dismissCase sets status to DISMISSED', async () => {
    authService._currentUser = REVIEWER;
    const riskCase = await createOpenCase();
    authService._currentUser = REVIEWER;

    const dismissed = await riskReviewService.dismissCase(riskCase.id, 'False alarm, confirmed.', 'reviewer-001');
    expect(dismissed.status).toBe(RISK_CASE_STATUSES.DISMISSED);
    expect(dismissed.outcomeCode).toBe(OUTCOME_CODES.FALSE_POSITIVE);
  });

  it('dismissCase without comment throws', async () => {
    authService._currentUser = REVIEWER;
    const riskCase = await createOpenCase();
    authService._currentUser = REVIEWER;

    await expect(riskReviewService.dismissCase(riskCase.id, '', 'reviewer-001'))
      .rejects.toThrow('Comment required');
  });
});

// ── Bid event ingestion ───────────────────────────────────────────────────────

describe('Bid event ingestion', () => {
  beforeEach(() => {
    authService._currentUser = MANAGER;
  });

  it('ingests a bid event', async () => {
    const event = await riskReviewService.ingestBidEvent({
      organizationId: ORG_ID,
      userId: 'user-001',
      itemId: 'item-001',
      bidAmount: 150.00,
      actorId: 'mgr-001',
    });

    expect(event.id).toBeDefined();
    expect(event.userId).toBe('user-001');
    expect(event.bidAmount).toBe(150.00);
  });

  it('rejects bid with non-positive amount', async () => {
    await expect(
      riskReviewService.ingestBidEvent({
        organizationId: ORG_ID,
        userId: 'user-001',
        itemId: 'item-001',
        bidAmount: -10,
        actorId: 'mgr-001',
      }),
    ).rejects.toThrow('positive');
  });

  it('bidding heuristics flag when frequency exceeds threshold', async () => {
    // Ingest 5 bids for the same item
    for (let i = 0; i < 5; i++) {
      await riskReviewService.ingestBidEvent({
        organizationId: ORG_ID,
        userId: `user-${i}`,
        itemId: 'hot-item',
        bidAmount: 100 + i,
        actorId: 'mgr-001',
      });
    }

    const result = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: ORG_ID,
      itemId: 'hot-item',
      windowMs: 60 * 60_000,
      frequencyThreshold: 3, // lower threshold to trigger
    });

    expect(result.flagged).toBe(true);
  });
});

// ── Linked account ingestion ──────────────────────────────────────────────────

describe('Linked account ingestion', () => {
  beforeEach(() => { authService._currentUser = MANAGER; });

  it('ingests a linked account record', async () => {
    const link = await riskReviewService.ingestLinkedAccount({
      organizationId: ORG_ID,
      primaryUserId: 'user-A',
      linkedUserId: 'user-B',
      evidenceType: 'shared_device',
      evidenceDetails: 'Same IP address and device fingerprint',
      actorId: 'mgr-001',
    });

    expect(link.id).toBeDefined();
    expect(link.primaryUserId).toBe('user-A');
  });

  it('rejects when primaryUserId equals linkedUserId', async () => {
    await expect(
      riskReviewService.ingestLinkedAccount({
        organizationId: ORG_ID,
        primaryUserId: 'user-A',
        linkedUserId: 'user-A',
        evidenceType: 'shared_device',
        evidenceDetails: 'Same user',
        actorId: 'mgr-001',
      }),
    ).rejects.toThrow('must differ');
  });
});

// ── Rule management ───────────────────────────────────────────────────────────

describe('Risk rule management', () => {
  beforeEach(() => { authService._currentUser = MANAGER; });

  it('createRule creates an active rule', async () => {
    const rule = await riskReviewService.createRule({
      organizationId: ORG_ID,
      name: 'Flag High Prices',
      ruleType: 'field_exceeds',
      targetEntityType: 'product',
      parameters: { field: 'price', threshold: 500 },
      actorId: 'mgr-001',
    });

    expect(rule.id).toBeDefined();
    expect(rule.isActive).toBe(true);
    expect(rule.ruleType).toBe('field_exceeds');
  });

  it('createRule rejects invalid ruleType', async () => {
    await expect(
      riskReviewService.createRule({
        organizationId: ORG_ID,
        name: 'Bad Rule',
        ruleType: 'unknown_type',
        targetEntityType: 'product',
        parameters: {},
        actorId: 'mgr-001',
      }),
    ).rejects.toThrow('ruleType must be');
  });

  it('listRules returns all rules for org', async () => {
    await riskReviewService.createRule({
      organizationId: ORG_ID,
      name: 'Rule 1',
      ruleType: 'field_contains',
      targetEntityType: 'order',
      parameters: { field: 'note', value: 'suspicious' },
      actorId: 'mgr-001',
    });

    await riskReviewService.createRule({
      organizationId: ORG_ID,
      name: 'Rule 2',
      ruleType: 'field_exceeds',
      targetEntityType: 'bid',
      parameters: { field: 'amount', threshold: 1000 },
      actorId: 'mgr-001',
    });

    const rules = await riskReviewService.listRules(ORG_ID);
    expect(rules.length).toBe(2);
    // Both rules present
    const names = rules.map((r) => r.name);
    expect(names).toContain('Rule 1');
    expect(names).toContain('Rule 2');
  });

  it('deleteRule removes the rule', async () => {
    const rule = await riskReviewService.createRule({
      organizationId: ORG_ID,
      name: 'Delete Me',
      ruleType: 'field_contains',
      targetEntityType: 'listing',
      parameters: { field: 'title', value: 'banned' },
      actorId: 'mgr-001',
    });

    await riskReviewService.deleteRule(rule.id, 'mgr-001');

    const rules = await riskReviewService.listRules(ORG_ID);
    expect(rules.find((r) => r.id === rule.id)).toBeUndefined();
  });

  it('deleteRule throws for unknown rule', async () => {
    await expect(
      riskReviewService.deleteRule('nonexistent-id', 'mgr-001'),
    ).rejects.toThrow('not found');
  });
});

// ── Heuristic → risk case ─────────────────────────────────────────────────────

describe('Heuristic → risk case creation', () => {
  beforeEach(() => { authService._currentUser = MANAGER; });

  it('createCaseFromHeuristic creates a case when flagged=true', async () => {
    const result = await riskReviewService.createCaseFromHeuristic({
      organizationId: ORG_ID,
      itemId: 'item-auction-001',
      heuristicResult: {
        flagged: true,
        reason: 'Bid frequency 12 exceeds threshold 10 within 60 minutes.',
        evidence: { eventCount: 12, windowMs: 3600000, frequencyThreshold: 10 },
      },
      actorId: 'mgr-001',
    });

    expect(result).not.toBeNull();
    expect(result.status).toBe('open');
    expect(result.sourceType).toBe('bid_event');
    expect(result.sourceId).toBe('item-auction-001');
    expect(result.ruleMatches[0].ruleId).toBe('heuristic');
    expect(result.ruleMatches[0].reason).toContain('Bid frequency');
  });

  it('createCaseFromHeuristic returns null when flagged=false', async () => {
    const result = await riskReviewService.createCaseFromHeuristic({
      organizationId: ORG_ID,
      itemId: 'item-clean-001',
      heuristicResult: { flagged: false, reason: null, evidence: {} },
      actorId: 'mgr-001',
    });

    expect(result).toBeNull();
  });

  it('evaluateBiddingHeuristics + createCaseFromHeuristic end-to-end', async () => {
    // Ingest enough bids to trigger heuristic
    for (let i = 0; i < 5; i++) {
      await riskReviewService.ingestBidEvent({
        organizationId: ORG_ID,
        userId: `bidder-${i}`,
        itemId: 'e2e-item',
        bidAmount: 100 + i,
        actorId: 'mgr-001',
      });
    }

    const heuristicResult = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: ORG_ID,
      itemId: 'e2e-item',
      windowMs: 60 * 60_000,
      frequencyThreshold: 3,
    });

    expect(heuristicResult.flagged).toBe(true);

    const riskCase = await riskReviewService.createCaseFromHeuristic({
      organizationId: ORG_ID,
      itemId: 'e2e-item',
      heuristicResult,
      actorId: 'mgr-001',
    });

    expect(riskCase).not.toBeNull();
    expect(riskCase.status).toBe('open');

    // Confirm inbox shows the new case
    authService._currentUser = REVIEWER;
    const inbox = await riskReviewService.getInbox(ORG_ID);
    expect(inbox.some((c) => c.id === riskCase.id)).toBe(true);
  });
});

// ── Linked-account heuristic integration ─────────────────────────────────────

describe('Heuristic — linked-account signal integration', () => {
  beforeEach(() => { authService._currentUser = MANAGER; });

  it('flags when two bidders on the same item have a linked-account relationship', async () => {
    // Ingest bids from two users (below frequency threshold — link signal only)
    await riskReviewService.ingestBidEvent({
      organizationId: ORG_ID, userId: 'bidder-linked-A', itemId: 'linked-item-001',
      bidAmount: 50, actorId: 'mgr-001',
    });
    await riskReviewService.ingestBidEvent({
      organizationId: ORG_ID, userId: 'bidder-linked-B', itemId: 'linked-item-001',
      bidAmount: 55, actorId: 'mgr-001',
    });

    // Record a linked-account relationship between the two bidders
    await riskReviewService.ingestLinkedAccount({
      organizationId: ORG_ID,
      primaryUserId: 'bidder-linked-A',
      linkedUserId: 'bidder-linked-B',
      evidenceType: 'shared_device',
      evidenceDetails: 'Same browser fingerprint detected across sessions.',
      actorId: 'mgr-001',
    });

    const result = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: ORG_ID,
      itemId: 'linked-item-001',
      windowMs: 60 * 60_000,
      frequencyThreshold: 10, // Not triggered by frequency (only 2 bids)
    });

    expect(result.flagged).toBe(true);
    expect(result.reason).toMatch(/linked-account/i);
    expect(result.evidence.linkedAccountCount).toBe(1);
    expect(result.evidence.linkedUserIds).toContain('bidder-linked-A');
    expect(result.evidence.linkedUserIds).toContain('bidder-linked-B');
  });

  it('linked-account evidence propagates into generated risk case', async () => {
    await riskReviewService.ingestBidEvent({
      organizationId: ORG_ID, userId: 'bidder-ev-A', itemId: 'evidence-item-001',
      bidAmount: 80, actorId: 'mgr-001',
    });
    await riskReviewService.ingestBidEvent({
      organizationId: ORG_ID, userId: 'bidder-ev-B', itemId: 'evidence-item-001',
      bidAmount: 85, actorId: 'mgr-001',
    });
    await riskReviewService.ingestLinkedAccount({
      organizationId: ORG_ID,
      primaryUserId: 'bidder-ev-A',
      linkedUserId: 'bidder-ev-B',
      evidenceType: 'shared_payment_method',
      evidenceDetails: 'Both accounts use the same card on file.',
      actorId: 'mgr-001',
    });

    const heuristicResult = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: ORG_ID, itemId: 'evidence-item-001',
      windowMs: 60 * 60_000, frequencyThreshold: 10,
    });
    expect(heuristicResult.flagged).toBe(true);

    const riskCase = await riskReviewService.createCaseFromHeuristic({
      organizationId: ORG_ID, itemId: 'evidence-item-001',
      heuristicResult, actorId: 'mgr-001',
    });

    expect(riskCase).not.toBeNull();
    const match = riskCase.ruleMatches[0];
    expect(match.evidence.linkedAccountCount).toBe(1);
    expect(match.evidence.evidenceTypes).toContain('shared_payment_method');
    expect(match.evidence.links[0].evidenceDetails).toBe('Both accounts use the same card on file.');
  });

  it('heuristic is NOT flagged when no links exist and thresholds are not met', async () => {
    // Only one bid — no frequency trigger, no fingerprint cluster, no links
    await riskReviewService.ingestBidEvent({
      organizationId: ORG_ID, userId: 'solo-bidder', itemId: 'clean-item-001',
      bidAmount: 200, actorId: 'mgr-001',
    });

    const result = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: ORG_ID,
      itemId: 'clean-item-001',
      windowMs: 60 * 60_000,
      frequencyThreshold: 10,
    });

    expect(result.flagged).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('linked-account evidence surfaces in reviewer inbox via full pipeline', async () => {
    await riskReviewService.ingestBidEvent({
      organizationId: ORG_ID, userId: 'pipe-A', itemId: 'pipeline-item-001',
      bidAmount: 100, actorId: 'mgr-001',
    });
    await riskReviewService.ingestBidEvent({
      organizationId: ORG_ID, userId: 'pipe-B', itemId: 'pipeline-item-001',
      bidAmount: 105, actorId: 'mgr-001',
    });
    await riskReviewService.ingestLinkedAccount({
      organizationId: ORG_ID,
      primaryUserId: 'pipe-A', linkedUserId: 'pipe-B',
      evidenceType: 'ip_address', evidenceDetails: 'Same IP address observed.',
      actorId: 'mgr-001',
    });

    const heuristic = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: ORG_ID, itemId: 'pipeline-item-001',
      windowMs: 60 * 60_000, frequencyThreshold: 10,
    });
    await riskReviewService.createCaseFromHeuristic({
      organizationId: ORG_ID, itemId: 'pipeline-item-001',
      heuristicResult: heuristic, actorId: 'mgr-001',
    });

    authService._currentUser = REVIEWER;
    const inbox = await riskReviewService.getInbox(ORG_ID);
    const linkedCase = inbox.find((c) => c.sourceId === 'pipeline-item-001');
    expect(linkedCase).toBeTruthy();
    expect(linkedCase.ruleMatches[0].evidence.linkedAccountCount).toBeGreaterThan(0);
  });
});
