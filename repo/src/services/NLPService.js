/**
 * NLPService — offline NLP analysis workspace.
 *
 * All NLP processing uses bundled, lightweight, deterministic algorithms:
 *   - keyword extraction  : TF-IDF frequency analysis
 *   - summarization       : extractive (top-scoring sentences)
 *   - topic classification: keyword-bag matching against topic dictionaries
 *   - sentiment analysis  : lexicon-based polarity scoring
 *   - NER                 : dictionary-based entity matching
 *
 * Quality metrics (precision/recall/F1) are drawn from the active
 * ValidationProfile, NOT computed against arbitrary live data.
 *
 * RBAC:
 *   - importText, runBatch, runIncremental → ADMINISTRATOR or ANALYST
 *   - getRunHistory, getRunDetail          → ADMINISTRATOR, ANALYST, or REVIEWER
 *   - createValidationProfile              → ADMINISTRATOR only
 */

import {
  ImportedTextRepository,
  ValidationProfileRepository,
  NLPRunRepository,
} from '../repositories/implementations/NLPRepository.js';
import { AppConfigRepository } from '../repositories/implementations/AppConfigRepository.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { generateId } from '../utils/idGenerator.js';
import { ROLES, NLP } from '../utils/constants.js';
import { orgService } from './OrgService.js';

export class NLPService {
  constructor() {
    this._textRepo = new ImportedTextRepository();
    this._profileRepo = new ValidationProfileRepository();
    this._runRepo = new NLPRunRepository();
    this._configRepo = new AppConfigRepository();
    /** @type {number | null} Persisted F1 alert threshold override (null = use default). */
    this._f1ThresholdOverride = null;
  }

  // ── Text ingestion ────────────────────────────────────────────────────────────

  /**
   * Imports a text file into the system.
   * Requires: ADMINISTRATOR or ANALYST role.
   *
   * @param {{ sourceType: string; sourceId: string; filename: string; rawText: string; actorId: string }} params
   * @returns {Promise<object>}
   */
  async importText({ organizationId, sourceType, sourceId, filename, rawText, actorId }) {
    const actor = this._requireRole(ROLES.ANALYST);
    await this._assertOrgScope(actor, organizationId);

    if (!rawText?.trim()) throw new Error('Imported text cannot be empty.');
    if (!sourceType?.trim()) throw new Error('Source type is required.');
    if (!filename?.trim()) throw new Error('Filename is required.');

    const record = {
      id: generateId(),
      organizationId,
      sourceType,
      sourceId,
      filename,
      rawText,
      sizeBytes: new TextEncoder().encode(rawText).length,
      importedAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this._textRepo.create(record);
    await auditService.log({ actorId, action: 'import_text', entityType: 'importedText', entityId: record.id });
    return record;
  }

  // ── Batch run ─────────────────────────────────────────────────────────────────

  /**
   * Runs NLP analysis on all imported texts in the organization.
   * Requires: ADMINISTRATOR or ANALYST role.
   *
   * @param {{ organizationId: string; modelVersion: string; actorId: string }} params
   * @returns {Promise<object>}
   */
  async runBatch({ organizationId, modelVersion, actorId }) {
    const actor = this._requireRole(ROLES.ANALYST);
    await this._assertOrgScope(actor, organizationId);

    if (!modelVersion?.trim()) throw new Error('Model version is required.');

    const texts = await this._textRepo.findByOrg(organizationId);
    return this._executeRun({
      organizationId,
      modelVersion,
      inputIds: texts.map((t) => t.id),
      texts,
      runType: NLP.RUN_TYPES.BATCH,
      actorId,
    });
  }

  /**
   * Runs incremental NLP analysis on texts created or updated since the last run.
   * Automatically ingests new CRM/ticket notes before analysis.
   * Uses both createdAt AND updatedAt to find new or modified texts.
   * Requires: ADMINISTRATOR or ANALYST role.
   *
   * @param {{ organizationId: string; modelVersion: string; actorId: string }} params
   * @returns {Promise<object>}
   */
  async runIncremental({ organizationId, modelVersion, actorId }) {
    const actor = this._requireRole(ROLES.ANALYST);
    await this._assertOrgScope(actor, organizationId);

    if (!modelVersion?.trim()) throw new Error('Model version is required.');

    // Auto-ingest CRM/ticket notes so they are included in incremental analysis.
    await this._ingestOperationalNotes(organizationId);

    const lastRun = await this._runRepo.findLatestByOrg(organizationId);
    const sinceMs = lastRun?.createdAt ?? 0;

    // Find texts created OR updated since the last run, scoped to this organization.
    const texts = await this._textRepo.findByOrgUpdatedSince(organizationId, sinceMs);

    return this._executeRun({
      organizationId,
      modelVersion,
      inputIds: texts.map((t) => t.id),
      texts,
      runType: NLP.RUN_TYPES.INCREMENTAL,
      actorId,
    });
  }

  /**
   * Manually triggers ingestion of CRM and ticket notes into the NLP text store.
   * Skips notes that have already been ingested (idempotent via sourceId).
   * Requires: ADMINISTRATOR or ANALYST role.
   *
   * @param {{ organizationId: string }} params
   * @returns {Promise<number>} Number of new notes ingested.
   */
  async ingestNotes({ organizationId }) {
    const actor = this._requireRole(ROLES.ANALYST);
    await this._assertOrgScope(actor, organizationId);
    return this._ingestOperationalNotes(organizationId);
  }

  // ── Run history ───────────────────────────────────────────────────────────────

  /**
   * Returns all NLP runs for an organization, newest first.
   * Requires: ADMINISTRATOR, ANALYST, or REVIEWER role.
   *
   * @param {string} organizationId
   * @returns {Promise<object[]>}
   */
  async getRunHistory(organizationId) {
    const actor = this._requireRole(ROLES.ANALYST, ROLES.REVIEWER);
    await this._assertOrgScope(actor, organizationId);
    const runs = await this._runRepo.findByOrg(organizationId);
    return runs.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Returns all imported texts for the organization.
   * Requires: ADMINISTRATOR, ANALYST, or REVIEWER role.
   *
   * @param {string} organizationId
   * @returns {Promise<object[]>}
   */
  async getImportedTexts(organizationId) {
    const actor = this._requireRole(ROLES.ANALYST, ROLES.REVIEWER);
    await this._assertOrgScope(actor, organizationId);
    const texts = await this._textRepo.findByOrg(organizationId);
    return texts.sort((a, b) => b.importedAt - a.importedAt);
  }

  /**
   * Returns a single run with its full output payload.
   * Requires: ADMINISTRATOR, ANALYST, or REVIEWER role.
   *
   * @param {string} runId
   * @returns {Promise<object | null>}
   */
  async getRunDetail(runId) {
    const actor = this._requireRole(ROLES.ANALYST, ROLES.REVIEWER);
    const run = await this._runRepo.findById(runId);
    if (run) await this._assertOrgScope(actor, run.organizationId);
    return run;
  }

  // ── Topic clustering ─────────────────────────────────────────────────────────

  /**
   * Clusters imported texts by their dominant topic using the latest run.
   * Returns a map of { topicName: [textId, ...] }.
   * If no runs exist, returns an empty object.
   * Requires: ADMINISTRATOR, ANALYST, or REVIEWER role.
   *
   * @param {string} organizationId
   * @returns {Promise<Record<string, string[]>>}
   */
  async clusterTopics(organizationId) {
    const actor = this._requireRole(ROLES.ANALYST, ROLES.REVIEWER);
    await this._assertOrgScope(actor, organizationId);

    const runs = await this._runRepo.findByOrg(organizationId);
    if (runs.length === 0) return {};

    const latestRun = runs.sort((a, b) => b.createdAt - a.createdAt)[0];
    const clusters = {};

    for (const [textId, output] of Object.entries(latestRun.outputPayload)) {
      const topics = output.topics ?? [];
      const dominant = topics[0] ?? 'uncategorized';
      if (!clusters[dominant]) clusters[dominant] = [];
      clusters[dominant].push(textId);
    }

    return clusters;
  }

  // ── Entity disambiguation ─────────────────────────────────────────────────────

  /**
   * Extracts and disambiguates named entities from text using context cues.
   * Returns entities with types: PERSON, ORG, LOCATION, PRODUCT, or PROPER_NOUN.
   *
   * @param {string} text
   * @returns {Array<{ text: string; type: string }>}
   */
  disambiguateEntities(text) {
    const rawEntities = this._extractEntities(text);
    const lower = text.toLowerCase();

    const orgSuffixes = ['inc', 'corp', 'ltd', 'llc', 'co', 'group', 'enterprises', 'company', 'solutions', 'technologies'];
    const locationIndicators = ['street', 'avenue', 'blvd', 'road', 'city', 'town', 'county', 'district', 'park', 'plaza', 'located in', 'based in', 'store in'];
    const productIndicators = ['model', 'version', 'edition', 'series', 'collection', 'range', 'line', 'sku', 'product', 'item'];

    return rawEntities.map((entity) => {
      const entityLower = entity.text.toLowerCase();
      const entityIdx = lower.indexOf(entityLower);
      const context = entityIdx !== -1
        ? lower.slice(Math.max(0, entityIdx - 30), entityIdx + entityLower.length + 30)
        : '';

      if (orgSuffixes.some((s) => entityLower.endsWith(s) || context.includes(entityLower + ' ' + s))) {
        return { text: entity.text, type: 'ORG' };
      }

      if (locationIndicators.some((indicator) => context.includes(indicator))) {
        return { text: entity.text, type: 'LOCATION' };
      }

      if (productIndicators.some((indicator) => context.includes(indicator))) {
        return { text: entity.text, type: 'PRODUCT' };
      }

      return { text: entity.text, type: 'PERSON' };
    });
  }

  // ── Validation profile management ─────────────────────────────────────────────

  /**
   * Returns the effective F1 alert threshold.
   * Uses persisted override if set, otherwise falls back to the default constant.
   * @returns {number}
   */
  getF1Threshold() {
    return this._f1ThresholdOverride ?? NLP.F1_ALERT_THRESHOLD;
  }

  /**
   * Sets and persists a custom F1 alert threshold.
   * Requires: ADMINISTRATOR role.
   * @param {number} threshold  Between 0 and 1.
   * @param {string} organizationId
   * @returns {Promise<void>}
   */
  async setF1Threshold(threshold, organizationId) {
    this._requireRole(ROLES.ADMINISTRATOR);
    if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
      throw new Error('Threshold must be a number between 0 and 1.');
    }
    this._f1ThresholdOverride = threshold;
    const config = await this._configRepo.findByOrg(organizationId);
    if (config) {
      await this._configRepo.update(config.id, { ...config, f1AlertThreshold: threshold });
    }
  }

  /**
   * Loads persisted F1 threshold from appConfig.
   * @param {string} organizationId
   * @returns {Promise<void>}
   */
  async loadPersistedThreshold(organizationId) {
    const config = await this._configRepo.findByOrg(organizationId);
    if (config?.f1AlertThreshold != null) {
      this._f1ThresholdOverride = config.f1AlertThreshold;
    }
  }

  /**
   * Returns all validation profiles, newest first.
   * Requires: ADMINISTRATOR, ANALYST, or REVIEWER role.
   *
   * @returns {Promise<object[]>}
   */
  async listProfiles() {
    this._requireRole(ROLES.ANALYST, ROLES.REVIEWER);
    const profiles = await this._profileRepo.findAll();
    return profiles.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Creates a validation profile binding model version to benchmark metrics.
   * No live metrics are generated — benchmarks come from the labeled corpus.
   * Requires: ADMINISTRATOR only.
   *
   * @param {{ modelVersion: string; corpusName: string; precision: number; recall: number; f1: number; labeledSampleCount: number; actorId: string }} params
   * @returns {Promise<object>}
   */
  async createValidationProfile({ modelVersion, corpusName, precision, recall, f1, labeledSampleCount, actorId }) {
    this._requireRole(ROLES.ADMINISTRATOR);

    if (!modelVersion?.trim()) throw new Error('Model version is required.');
    if (!corpusName?.trim()) throw new Error('Corpus name is required.');
    if (typeof precision !== 'number' || precision < 0 || precision > 1) throw new Error('Precision must be a number between 0 and 1.');
    if (typeof recall !== 'number' || recall < 0 || recall > 1) throw new Error('Recall must be a number between 0 and 1.');
    if (typeof f1 !== 'number' || f1 < 0 || f1 > 1) throw new Error('F1 score must be a number between 0 and 1.');
    if (!Number.isInteger(labeledSampleCount) || labeledSampleCount < 1) throw new Error('labeledSampleCount must be a positive integer.');

    const profile = {
      id: generateId(),
      modelVersion,
      corpusName,
      precision,
      recall,
      f1,
      labeledSampleCount,
      createdAt: Date.now(),
    };
    const created = await this._profileRepo.create(profile);
    await auditService.log({ actorId, action: 'create_validation_profile', entityType: 'validationProfile', entityId: profile.id, metadata: { modelVersion, f1 } });
    return created;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * Pulls CRM customer version notes and ticket event comments into ImportedTexts.
   * Skips already-ingested records (checked via sourceId). No auth check — called
   * from within authenticated methods.
   * @param {string} organizationId
   * @returns {Promise<number>}
   */
  async _ingestOperationalNotes(organizationId) {
    const { MasterDataRepository } = await import('../repositories/implementations/MasterDataRepository.js');
    const { TicketRepository, TicketEventRepository } = await import('../repositories/implementations/TicketRepository.js');

    const mdRepo = new MasterDataRepository();
    const ticketRepo = new TicketRepository();
    const eventRepo = new TicketEventRepository();

    let ingested = 0;

    // 1. Customer version notes (reasonNote from MasterDataVersions).
    const customerVersions = await mdRepo.findByCompoundIndex('by_entityType_orgId', ['customer', organizationId]);
    for (const v of customerVersions) {
      if (!v.reasonNote?.trim()) continue;
      const sourceId = `crm_version:${v.id}`;
      const existing = await this._textRepo.findByIndex('by_sourceId', sourceId);
      if (existing.length > 0) continue;
      await this._textRepo.create({
        id: generateId(),
        organizationId,
        sourceType: 'customer_note',
        sourceId,
        filename: `customer_${v.entityId}_v${v.versionNumber}.txt`,
        rawText: v.reasonNote,
        sizeBytes: new TextEncoder().encode(v.reasonNote).length,
        importedAt: Date.now(),
        updatedAt: Date.now(),
      });
      ingested++;
    }

    // 2. Ticket event comments.
    const tickets = await ticketRepo.findByIndex('by_orgId', organizationId);
    for (const ticket of tickets) {
      const events = await eventRepo.findByIndex('by_ticketId', ticket.id);
      for (const evt of events) {
        if (!evt.comment?.trim()) continue;
        const sourceId = `ticket_event:${evt.id}`;
        const existing = await this._textRepo.findByIndex('by_sourceId', sourceId);
        if (existing.length > 0) continue;
        await this._textRepo.create({
          id: generateId(),
          organizationId,
          sourceType: 'ticket_note',
          sourceId,
          filename: `ticket_${ticket.id}_${evt.type}.txt`,
          rawText: evt.comment,
          sizeBytes: new TextEncoder().encode(evt.comment).length,
          importedAt: Date.now(),
          updatedAt: Date.now(),
        });
        ingested++;
      }
    }

    return ingested;
  }

  async _executeRun({ organizationId, modelVersion, inputIds, texts, runType, actorId }) {
    const outputPayload = texts.reduce((acc, text) => {
      acc[text.id] = {
        keywords: this._extractKeywords(text.rawText),
        summary: this._extractSummary(text.rawText),
        topics: this._classifyTopics(text.rawText),
        sentiment: this._analyzeSentiment(text.rawText),
        entities: this.disambiguateEntities(text.rawText),
      };
      return acc;
    }, {});

    // Benchmark metrics from validation profile — never synthetic.
    const profile = await this._profileRepo.findByModelVersion(modelVersion)
      ?? await this._profileRepo.findLatest();

    const run = {
      id: generateId(),
      organizationId,
      runType,
      modelVersion,
      inputIds,
      outputPayload,
      benchmarkPrecision: profile?.precision ?? null,
      benchmarkRecall: profile?.recall ?? null,
      benchmarkF1: profile?.f1 ?? null,
      belowF1Threshold: profile ? (profile.f1 < this.getF1Threshold()) : false,
      createdBy: actorId,
      createdAt: Date.now(),
    };

    await this._runRepo.create(run);
    await auditService.log({
      actorId,
      action: 'nlp_run',
      entityType: 'nlpRun',
      entityId: run.id,
      metadata: { runType, modelVersion, inputCount: inputIds.length, belowF1Threshold: run.belowF1Threshold },
    });

    return run;
  }

  /**
   * Extracts top-N keywords via term frequency.
   * @param {string} text
   * @param {number} [topN=10]
   * @returns {string[]}
   */
  _extractKeywords(text, topN = 10) {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'in', 'on', 'at', 'to', 'and', 'or', 'of', 'it', 'for', 'with', 'this', 'that', 'was', 'are', 'be', 'by', 'from', 'as', 'but', 'not', 'have', 'had', 'has', 'he', 'she', 'they', 'we', 'you', 'i']);
    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) ?? [];
    const freq = new Map();
    for (const w of words) {
      if (!stopWords.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([w]) => w);
  }

  /**
   * Extractive summarization: returns the top-scoring sentences by keyword density.
   * @param {string} text
   * @param {number} [numSentences=3]
   * @returns {string}
   */
  _extractSummary(text, numSentences = 3) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
    if (sentences.length <= numSentences) return text;
    const keywords = new Set(this._extractKeywords(text));
    const scored = sentences.map((s) => {
      const words = s.toLowerCase().match(/\b[a-z]+\b/g) ?? [];
      const score = words.filter((w) => keywords.has(w)).length;
      return { sentence: s, score };
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, numSentences)
      .map((s) => s.sentence.trim())
      .join(' ');
  }

  /**
   * Topic classification via simple keyword-bag matching.
   * @param {string} text
   * @returns {string[]}
   */
  _classifyTopics(text) {
    const topics = {
      logistics: ['shipping', 'delivery', 'warehouse', 'stock', 'inventory', 'transport'],
      customer: ['complaint', 'refund', 'return', 'satisfaction', 'service', 'support'],
      finance: ['payment', 'invoice', 'price', 'discount', 'cost', 'billing'],
      product: ['quality', 'defect', 'style', 'size', 'color', 'brand'],
    };
    const lower = text.toLowerCase();
    return Object.entries(topics)
      .filter(([, keywords]) => keywords.some((k) => lower.includes(k)))
      .map(([topic]) => topic);
  }

  /**
   * Sentiment analysis via lexicon scoring.
   * @param {string} text
   * @returns {{ label: 'positive'|'negative'|'neutral'; score: number }}
   */
  _analyzeSentiment(text) {
    const positive = new Set(['good', 'great', 'excellent', 'happy', 'satisfied', 'love', 'perfect', 'wonderful', 'amazing', 'outstanding', 'positive', 'best', 'helpful']);
    const negative = new Set(['bad', 'poor', 'terrible', 'unhappy', 'dissatisfied', 'hate', 'awful', 'horrible', 'broken', 'worst', 'negative', 'disappointing', 'failed']);
    const words = text.toLowerCase().match(/\b[a-z]+\b/g) ?? [];
    let score = 0;
    for (const w of words) {
      if (positive.has(w)) score += 1;
      if (negative.has(w)) score -= 1;
    }
    const label = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
    return { label, score };
  }

  /**
   * Dictionary-based NER — recognizes capitalized noun sequences as entities.
   * @param {string} text
   * @returns {Array<{ text: string; type: string }>}
   */
  _extractEntities(text) {
    const entities = [];
    const namedEntityPattern = /\b[A-Z][a-z]+(?: [A-Z][a-z]+)*\b/g;
    for (const match of text.matchAll(namedEntityPattern)) {
      entities.push({ text: match[0], type: 'PROPER_NOUN' });
    }
    return entities;
  }

  _requireRole(...allowedRoles) {
    const user = authService.getCurrentUser();
    if (!user) throw new Error('Authentication required.');
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

export const nlpService = new NLPService();
