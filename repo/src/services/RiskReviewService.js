import {
  RiskRuleRepository,
  RiskCaseRepository,
  BidEventRepository,
  LinkedAccountRepository,
} from '../repositories/implementations/RiskRepository.js';
import { AppConfigRepository } from '../repositories/implementations/AppConfigRepository.js';
import { OrgRepository } from '../repositories/implementations/OrgRepository.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { generateId } from '../utils/idGenerator.js';
import { ROLES, RISK_CASE_STATUSES, OUTCOME_CODES } from '../utils/constants.js';
import { orgService } from './OrgService.js';
import { isValidOutcomeCode, validateImageFile } from '../utils/validation.js';

/**
 * RiskReviewService — risk case evaluation, bid signal analysis, and resolution.
 *
 * RBAC:
 *   - evaluateRules, validateImage, evaluateBiddingHeuristics → ADMINISTRATOR or STORE_MANAGER
 *   - ingestBidEvent, ingestLinkedAccount                     → ADMINISTRATOR or STORE_MANAGER
 *   - assignCase, resolveCase, dismissCase                    → ADMINISTRATOR or REVIEWER
 *   - getInbox                                                → ADMINISTRATOR or REVIEWER
 */
export class RiskReviewService {
  constructor() {
    this._ruleRepo = new RiskRuleRepository();
    this._caseRepo = new RiskCaseRepository();
    this._bidRepo = new BidEventRepository();
    this._linkedRepo = new LinkedAccountRepository();
    this._configRepo = new AppConfigRepository();

    /** @type {string[]} Sensitive word dictionary (loaded from app config). */
    this._sensitiveWords = [];
  }

  /**
   * Loads the sensitive word dictionary from a plain array.
   * Words are lowercased for matching.
   * @param {string[]} words
   */
  loadSensitiveWordDictionary(words) {
    if (!Array.isArray(words)) throw new Error('Sensitive word dictionary must be an array.');
    this._sensitiveWords = words.map((w) => w.toLowerCase());
  }

  // ── Machine rule evaluation ───────────────────────────────────────────────────

  /**
   * Evaluates all active rules against a submitted entity and generates risk cases.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ organizationId: string; entityType: string; entityId: string; payload: object; actorId: string }} params
   * @returns {Promise<object[]>}  Generated risk cases.
   */
  async evaluateRules({ organizationId, entityType, entityId, payload, actorId }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);

    if (!entityType?.trim()) throw new Error('entityType is required.');
    if (!entityId?.trim()) throw new Error('entityId is required.');
    if (!payload || typeof payload !== 'object') throw new Error('payload must be a non-null object.');

    const rules = await this._ruleRepo.findActiveByOrg(organizationId);
    const applicableRules = rules.filter((r) => r.targetEntityType === entityType || r.targetEntityType === '*');

    const matches = [];
    for (const rule of applicableRules) {
      if (this._ruleMatches(rule, payload)) {
        matches.push({ ruleId: rule.id, ruleName: rule.name, ruleType: rule.ruleType });
      }
    }

    // Check sensitive words in any string field of the payload.
    const swMatches = this._checkSensitiveWords(payload);
    if (swMatches.length > 0) {
      matches.push({ ruleId: 'sensitive_word', ruleName: 'Sensitive Word Match', matches: swMatches });
    }

    if (matches.length === 0) return [];

    const riskCase = {
      id: generateId(),
      organizationId,
      sourceType: entityType,
      sourceId: entityId,
      ruleMatches: matches,
      status: RISK_CASE_STATUSES.OPEN,
      outcomeCode: null,
      resolutionComment: null,
      assignedReviewerId: null,
      createdAt: Date.now(),
      resolvedAt: null,
    };

    await this._caseRepo.create(riskCase);
    await auditService.log({
      actorId,
      action: 'risk_case_created',
      entityType: 'riskCase',
      entityId: riskCase.id,
      metadata: { sourceType: entityType, ruleMatchCount: matches.length },
    });

    return [riskCase];
  }

  /**
   * Validates an image file before ingestion.
   * Checks MIME type, magic bytes, and size.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {File} file
   * @returns {Promise<{ valid: boolean; error: string | null }>}
   */
  async validateImage(file) {
    this._requireRole(ROLES.STORE_MANAGER);
    return validateImageFile(file);
  }

  /**
   * Evaluates shill/abnormal bidding heuristics for a given item.
   * Device fingerprint clustering is best-effort only.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ organizationId: string; itemId: string; windowMs?: number; frequencyThreshold?: number }} params
   * @returns {Promise<{ flagged: boolean; reason: string | null; evidence: object }>}
   */
  async evaluateBiddingHeuristics({ organizationId, itemId, windowMs = 60 * 60_000, frequencyThreshold = 10 }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);

    if (!itemId?.trim()) throw new Error('itemId is required.');

    const now = Date.now();
    const allEvents = await this._bidRepo.findByItemInWindow(itemId, now - windowMs, now);
    // Org-scoped: filter events to this organization only — no cross-org contamination.
    const events = allEvents.filter((e) => e.organizationId === organizationId);

    if (events.length >= frequencyThreshold) {
      return {
        flagged: true,
        reason: `Bid frequency ${events.length} exceeds threshold ${frequencyThreshold} within ${windowMs / 60_000} minutes.`,
        evidence: { eventCount: events.length, windowMs, frequencyThreshold },
      };
    }

    // Check for fingerprint clustering (best-effort heuristic).
    const fingerprints = new Map();
    for (const e of events) {
      if (e.deviceFingerprint) {
        fingerprints.set(e.deviceFingerprint, (fingerprints.get(e.deviceFingerprint) ?? 0) + 1);
      }
    }
    for (const [fp, count] of fingerprints) {
      if (count >= Math.floor(frequencyThreshold * 0.5)) {
        return {
          flagged: true,
          reason: `Device fingerprint '${fp}' appears ${count} times — possible coordinated activity (best-effort signal).`,
          evidence: { fingerprint: fp, count, isBestEffort: true },
        };
      }
    }

    // Check linked-account relationships among bidders on this item.
    const bidderIds = [...new Set(events.map((e) => e.userId).filter(Boolean))];
    if (bidderIds.length > 1) {
      const linksByBidder = await Promise.all(
        bidderIds.map((id) => this._linkedRepo.findAllLinksForUser(id)),
      );
      const allLinks = linksByBidder.flat();
      // Deduplicate: findAllLinksForUser queries both directions, so the same
      // link may appear twice when both its ends are in the bidder set.
      const uniqueLinks = [...new Map(allLinks.map((l) => [l.id, l])).values()];
      // Keep only links where both ends are active bidders on this item.
      const crossBidderLinks = uniqueLinks.filter(
        (link) => bidderIds.includes(link.primaryUserId) && bidderIds.includes(link.linkedUserId),
      );
      if (crossBidderLinks.length > 0) {
        const linkedUserIds = [...new Set(crossBidderLinks.flatMap((l) => [l.primaryUserId, l.linkedUserId]))];
        return {
          flagged: true,
          reason: `${crossBidderLinks.length} linked-account relationship(s) detected among ${linkedUserIds.length} bidder(s) on item '${itemId}'. Possible coordinated bidding.`,
          evidence: {
            linkedAccountCount: crossBidderLinks.length,
            linkedUserIds,
            evidenceTypes: [...new Set(crossBidderLinks.map((l) => l.evidenceType))],
            links: crossBidderLinks.map((l) => ({
              primaryUserId: l.primaryUserId,
              linkedUserId: l.linkedUserId,
              evidenceType: l.evidenceType,
              evidenceDetails: l.evidenceDetails,
            })),
          },
        };
      }
    }

    return { flagged: false, reason: null, evidence: {} };
  }

  /**
   * Runs bidding heuristics AND auto-creates a risk case if flagged.
   * Idempotent: checks for existing open case on the same item before creating.
   *
   * @param {object} params  Same as evaluateBiddingHeuristics
   * @returns {Promise<{ result: object; caseCreated: object | null }>}
   */
  async evaluateAndAutoCase(params) {
    const result = await this.evaluateBiddingHeuristics(params);
    if (!result.flagged) return { result, caseCreated: null };

    // Idempotency: check if an open case already exists for this item.
    const existingCases = await this._caseRepo.findByOrg(params.organizationId);
    const alreadyOpen = existingCases.some(
      (c) => c.sourceId === params.itemId && (c.status === 'open' || c.status === 'in_review'),
    );
    if (alreadyOpen) return { result, caseCreated: null };

    const riskCase = await this.createCaseFromHeuristic({
      organizationId: params.organizationId,
      itemId: params.itemId,
      heuristicResult: result,
      actorId: params.actorId ?? authService.getCurrentUser()?.id ?? 'system',
    });

    return { result, caseCreated: riskCase };
  }

  // ── Bid / linked account ingestion ───────────────────────────────────────────

  /**
   * Ingests a bid event for analysis.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ organizationId: string; userId: string; itemId: string; deviceFingerprint?: string; bidAmount: number; actorId: string }} params
   * @returns {Promise<object>}
   */
  async ingestBidEvent({ organizationId, userId, itemId, deviceFingerprint = null, bidAmount, actorId }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);

    if (!userId?.trim()) throw new Error('userId is required.');
    if (!itemId?.trim()) throw new Error('itemId is required.');
    if (typeof bidAmount !== 'number' || bidAmount <= 0) throw new Error('bidAmount must be a positive number.');

    const event = {
      id: generateId(),
      organizationId,
      userId,
      itemId,
      deviceFingerprint,
      bidAmount,
      createdAt: Date.now(),
    };

    await this._bidRepo.create(event);
    await auditService.log({
      actorId,
      action: 'ingest_bid_event',
      entityType: 'bidEvent',
      entityId: event.id,
      metadata: { userId, itemId, bidAmount },
    });

    return event;
  }

  /**
   * Records a linked account relationship as evidence.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ organizationId: string; primaryUserId: string; linkedUserId: string; evidenceType: string; evidenceDetails: string; actorId: string }} params
   * @returns {Promise<object>}
   */
  async ingestLinkedAccount({ organizationId, primaryUserId, linkedUserId, evidenceType, evidenceDetails, actorId }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);

    if (!primaryUserId?.trim()) throw new Error('primaryUserId is required.');
    if (!linkedUserId?.trim()) throw new Error('linkedUserId is required.');
    if (primaryUserId === linkedUserId) throw new Error('primaryUserId and linkedUserId must differ.');
    if (!evidenceType?.trim()) throw new Error('evidenceType is required.');
    if (!evidenceDetails?.trim()) throw new Error('evidenceDetails is required.');

    const link = {
      id: generateId(),
      organizationId,
      primaryUserId,
      linkedUserId,
      evidenceType,
      evidenceDetails,
      createdAt: Date.now(),
    };

    await this._linkedRepo.create(link);
    await auditService.log({
      actorId,
      action: 'ingest_linked_account',
      entityType: 'linkedAccount',
      entityId: link.id,
      metadata: { primaryUserId, linkedUserId, evidenceType },
    });

    return link;
  }

  // ── Case management ───────────────────────────────────────────────────────────

  /**
   * Assigns a risk case to a reviewer.
   * Requires: ADMINISTRATOR or REVIEWER role.
   *
   * @param {string} caseId
   * @param {string} reviewerId
   * @param {string} actorId
   * @returns {Promise<object>}
   */
  async assignCase(caseId, reviewerId, actorId) {
    const actor = this._requireRole(ROLES.REVIEWER);

    const riskCase = await this._getOrThrow(caseId);
    await this._assertOrgScope(actor, riskCase.organizationId);
    this._assertNotClosed(riskCase);

    const updated = { ...riskCase, status: RISK_CASE_STATUSES.IN_REVIEW, assignedReviewerId: reviewerId };
    await this._caseRepo.update(caseId, updated);
    await auditService.log({
      actorId,
      action: 'assign_risk_case',
      entityType: 'riskCase',
      entityId: caseId,
      metadata: { reviewerId },
    });
    return updated;
  }

  /**
   * Resolves a risk case with an outcome code and comment.
   * Both outcome code and comment are REQUIRED — no case may close without them.
   * Requires: ADMINISTRATOR or REVIEWER role.
   *
   * @param {{ caseId: string; outcomeCode: string; resolutionComment: string; reviewerId: string }} params
   * @returns {Promise<object>}
   */
  async resolveCase({ caseId, outcomeCode, resolutionComment, reviewerId }) {
    const actor = this._requireRole(ROLES.REVIEWER);

    if (!isValidOutcomeCode(outcomeCode)) {
      throw new Error(`Invalid outcome code: '${outcomeCode}'. Valid: ${Object.values(OUTCOME_CODES).join(', ')}`);
    }
    if (!resolutionComment?.trim()) {
      throw new Error('Resolution comment is required to close a risk case.');
    }

    const riskCase = await this._getOrThrow(caseId);
    await this._assertOrgScope(actor, riskCase.organizationId);
    this._assertNotClosed(riskCase);

    const updated = {
      ...riskCase,
      status: RISK_CASE_STATUSES.RESOLVED,
      outcomeCode,
      resolutionComment,
      assignedReviewerId: reviewerId,
      resolvedAt: Date.now(),
    };

    await this._caseRepo.update(caseId, updated);
    await auditService.log({
      actorId: reviewerId,
      action: 'resolve_risk_case',
      entityType: 'riskCase',
      entityId: caseId,
      metadata: { outcomeCode },
    });

    return updated;
  }

  /**
   * Dismisses a risk case as a false positive.
   * Comment is required.
   * Requires: ADMINISTRATOR or REVIEWER role.
   *
   * @param {string} caseId
   * @param {string} resolutionComment
   * @param {string} reviewerId
   * @returns {Promise<object>}
   */
  async dismissCase(caseId, resolutionComment, reviewerId) {
    const actor = this._requireRole(ROLES.REVIEWER);

    if (!resolutionComment?.trim()) throw new Error('Comment required to dismiss a risk case.');

    const riskCase = await this._getOrThrow(caseId);
    await this._assertOrgScope(actor, riskCase.organizationId);
    this._assertNotClosed(riskCase);

    const updated = {
      ...riskCase,
      status: RISK_CASE_STATUSES.DISMISSED,
      outcomeCode: OUTCOME_CODES.FALSE_POSITIVE,
      resolutionComment,
      assignedReviewerId: reviewerId,
      resolvedAt: Date.now(),
    };

    await this._caseRepo.update(caseId, updated);
    await auditService.log({
      actorId: reviewerId,
      action: 'dismiss_risk_case',
      entityType: 'riskCase',
      entityId: caseId,
    });
    return updated;
  }

  /**
   * Returns all open and in-review risk cases for an organization.
   * Requires: ADMINISTRATOR or REVIEWER role.
   *
   * @param {string} organizationId
   * @returns {Promise<object[]>}
   */
  async getInbox(organizationId) {
    const actor = this._requireRole(ROLES.REVIEWER);
    await this._assertOrgScope(actor, organizationId);
    const cases = await this._caseRepo.findByOrg(organizationId);
    return cases.filter((c) => c.status === RISK_CASE_STATUSES.OPEN || c.status === RISK_CASE_STATUSES.IN_REVIEW);
  }

  // ── Rule management ───────────────────────────────────────────────────────────

  /**
   * Creates a new risk detection rule.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ organizationId: string; name: string; ruleType: string; targetEntityType: string; parameters: object; actorId: string }} params
   * @returns {Promise<object>}
   */
  async createRule({ organizationId, name, ruleType, targetEntityType, parameters, actorId }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    if (!name?.trim()) throw new Error('Rule name is required.');
    if (!['field_contains', 'field_exceeds'].includes(ruleType)) {
      throw new Error('ruleType must be field_contains or field_exceeds.');
    }
    if (!targetEntityType?.trim()) throw new Error('targetEntityType is required.');
    if (!parameters || typeof parameters !== 'object') throw new Error('parameters must be a non-null object.');
    await this._assertOrgScope(actor, organizationId);

    const rule = {
      id: generateId(),
      organizationId,
      name: name.trim(),
      ruleType,
      targetEntityType: targetEntityType.trim(),
      parameters,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const saved = await this._ruleRepo.create(rule);
    await auditService.log({ actorId, action: 'create_risk_rule', entityType: 'riskRule', entityId: rule.id });
    return saved;
  }

  /**
   * Lists all risk rules for an organization.
   * Requires: ADMINISTRATOR, STORE_MANAGER, or REVIEWER role.
   *
   * @param {string} organizationId
   * @returns {Promise<object[]>}
   */
  async listRules(organizationId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER, ROLES.REVIEWER);
    await this._assertOrgScope(actor, organizationId);
    const rules = await this._ruleRepo.findByOrg(organizationId);
    return rules.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Deletes a risk rule.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} ruleId
   * @param {string} actorId
   */
  async deleteRule(ruleId, actorId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    const rule = await this._ruleRepo.findById(ruleId);
    if (!rule) throw new Error(`Risk rule '${ruleId}' not found.`);
    await this._assertOrgScope(actor, rule.organizationId);
    await this._ruleRepo.delete(ruleId);
    await auditService.log({ actorId, action: 'delete_risk_rule', entityType: 'riskRule', entityId: ruleId });
  }

  /**
   * Creates a risk case from a flagged bidding heuristic result.
   * If heuristicResult.flagged is false, returns null.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ organizationId: string; itemId: string; heuristicResult: object; actorId: string }} params
   * @returns {Promise<object | null>}
   */
  async createCaseFromHeuristic({ organizationId, itemId, heuristicResult, actorId }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);

    if (!itemId?.trim()) throw new Error('itemId is required.');
    if (!heuristicResult || !heuristicResult.flagged) return null;

    const riskCase = {
      id: generateId(),
      organizationId,
      sourceType: 'bid_event',
      sourceId: itemId,
      ruleMatches: [{
        ruleId: 'heuristic',
        ruleName: 'Bidding Heuristic',
        reason: heuristicResult.reason,
        evidence: heuristicResult.evidence,
      }],
      status: RISK_CASE_STATUSES.OPEN,
      outcomeCode: null,
      resolutionComment: null,
      assignedReviewerId: null,
      createdAt: Date.now(),
      resolvedAt: null,
    };

    await this._caseRepo.create(riskCase);
    await auditService.log({
      actorId,
      action: 'risk_case_created',
      entityType: 'riskCase',
      entityId: riskCase.id,
      metadata: { sourceType: 'bid_event', trigger: 'heuristic', reason: heuristicResult.reason },
    });

    return riskCase;
  }

  /**
   * Returns the current sensitive word dictionary.
   * @returns {string[]}
   */
  getSensitiveWords() {
    return [...this._sensitiveWords];
  }

  /**
   * Clears in-memory dictionary state.
   * Called on logout/session-switch to prevent cross-org leakage.
   */
  clearDictionary() {
    this._sensitiveWords = [];
  }

  /**
   * Updates the sensitive word dictionary and persists it to IndexedDB (org-scoped).
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string[]} words
   * @param {string} actorId
   */
  async updateSensitiveWords(words, actorId) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    if (!Array.isArray(words)) throw new Error('words must be an array of strings.');
    this.loadSensitiveWordDictionary(words);

    // Persist to appConfig, org-scoped. Resolve to root org ID.
    const nodeId = actor.organizationNodeId;
    if (nodeId) {
      const orgRepo = new OrgRepository();
      const node = await orgRepo.findById(nodeId);
      const rootOrgId = node?.organizationId ?? nodeId;
      const config = await this._configRepo.findByOrg(rootOrgId);
      if (config) {
        await this._configRepo.update(config.id, { ...config, sensitiveWords: this._sensitiveWords });
      }
    }
    auditService.log({ actorId, action: 'update_sensitive_words', entityType: 'config', entityId: 'sensitiveWords' }).catch(() => {});
  }

  /**
   * Loads the persisted sensitive word dictionary from IndexedDB for the given org.
   * Called on app start / service initialization.
   *
   * @param {string} organizationId
   * @returns {Promise<void>}
   */
  async loadPersistedDictionary(organizationId) {
    const config = await this._configRepo.findByOrg(organizationId);
    // Always reset — if no persisted data, clear to prevent stale leakage.
    this._sensitiveWords = config?.sensitiveWords?.length ? config.sensitiveWords : [];
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  async _getOrThrow(caseId) {
    const c = await this._caseRepo.findById(caseId);
    if (!c) throw new Error(`Risk case '${caseId}' not found.`);
    return c;
  }

  _assertNotClosed(riskCase) {
    if (riskCase.status === RISK_CASE_STATUSES.RESOLVED || riskCase.status === RISK_CASE_STATUSES.DISMISSED) {
      throw new Error(`Risk case '${riskCase.id}' is already closed (${riskCase.status}).`);
    }
  }

  _ruleMatches(rule, payload) {
    if (rule.ruleType === 'field_contains') {
      const { field, value } = rule.parameters;
      const fieldValue = String(payload[field] ?? '').toLowerCase();
      return fieldValue.includes(String(value).toLowerCase());
    }
    if (rule.ruleType === 'field_exceeds') {
      const { field, threshold } = rule.parameters;
      return Number(payload[field] ?? 0) > threshold;
    }
    return false;
  }

  _checkSensitiveWords(payload) {
    if (this._sensitiveWords.length === 0) return [];
    const text = Object.values(payload)
      .filter((v) => typeof v === 'string')
      .join(' ')
      .toLowerCase();
    return this._sensitiveWords.filter((word) => text.includes(word));
  }

  _requireRole(...allowedRoles) {
    const user = authService.getCurrentUser();
    if (!user) throw new Error('Authentication required.');
    authService.requireUnlocked();
    if (user.role === ROLES.ADMINISTRATOR) return user;
    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      throw new Error(`Permission denied. Required role(s): ${allowedRoles.join(', ')}`);
    }
    return user;
  }

  async _assertOrgScope(actor, targetOrgId) {
    if (actor.role === ROLES.ADMINISTRATOR) return;
    if (!actor.organizationNodeId) throw new Error('Actor has no organization assigned.');
    const inScope = await orgService.isInScope(actor, targetOrgId);
    if (!inScope) throw new Error('Scope violation: you can only access data within your assigned organization.');
  }
}

export const riskReviewService = new RiskReviewService();
