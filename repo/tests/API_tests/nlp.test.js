/**
 * Integration tests — NLP topic clustering and entity disambiguation.
 *
 * Covers:
 *   - topic classification returns correct topic labels
 *   - multiple topics detected in multi-topic text
 *   - no topics returned for unrelated text
 *   - clusterTopics groups texts by dominant topic after a batch run
 *   - clusterTopics returns empty for org with no runs
 *   - disambiguateEntities classifies ORG entities
 *   - disambiguateEntities classifies LOCATION entities
 *   - disambiguateEntities classifies PRODUCT entities
 *   - disambiguateEntities defaults to PERSON for unclassified proper nouns
 *   - disambiguateEntities returns empty for text with no capitalized entities
 *   - run execution stores disambiguated entity types (not raw PROPER_NOUN)
 *   - getRunDetail returns disambiguated entities in output payload
 *   - raw PROPER_NOUN type no longer appears in batch run output
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { nlpService } from '../../src/services/NLPService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN = { id: 'admin-001', role: ROLES.ADMINISTRATOR, organizationNodeId: 'org-nlp' };
const ORG_ID = 'org-nlp';

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = ADMIN;
});

afterEach(() => {
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ── Topic classification ──────────────────────────────────────────────────────

describe('NLP — topic classification', () => {
  it('classifies logistics topic', () => {
    const service = nlpService;
    const topics = service._classifyTopics('The delivery was delayed due to warehouse inventory shortage.');
    expect(topics).toContain('logistics');
  });

  it('classifies customer topic', () => {
    const topics = nlpService._classifyTopics('The customer filed a complaint about the refund process.');
    expect(topics).toContain('customer');
  });

  it('classifies finance topic', () => {
    const topics = nlpService._classifyTopics('The invoice shows an incorrect price after the discount was applied.');
    expect(topics).toContain('finance');
  });

  it('classifies product topic', () => {
    const topics = nlpService._classifyTopics('There was a defect in the product quality affecting the color.');
    expect(topics).toContain('product');
  });

  it('returns multiple topics for multi-domain text', () => {
    const topics = nlpService._classifyTopics('Customer complaint about delivery and refund of defective product.');
    expect(topics.length).toBeGreaterThanOrEqual(2);
    expect(topics).toContain('customer');
    expect(topics).toContain('logistics');
  });

  it('returns empty array for unrelated text', () => {
    const topics = nlpService._classifyTopics('The weather was nice today and the sun was shining brightly.');
    expect(topics).toEqual([]);
  });
});

// ── Topic clustering ──────────────────────────────────────────────────────────

describe('NLP — clusterTopics', () => {
  it('returns empty object when no runs exist', async () => {
    const clusters = await nlpService.clusterTopics(ORG_ID);
    expect(clusters).toEqual({});
  });

  it('clusters texts by dominant topic after batch run', async () => {
    // Import two texts: one logistics, one finance
    await nlpService.importText({
      organizationId: ORG_ID,
      sourceType: 'note',
      sourceId: 'note-1',
      filename: 'logistics.txt',
      rawText: 'The delivery shipment was delayed at the warehouse due to inventory issues.',
      actorId: 'admin-001',
    });

    await nlpService.importText({
      organizationId: ORG_ID,
      sourceType: 'note',
      sourceId: 'note-2',
      filename: 'finance.txt',
      rawText: 'The invoice shows incorrect billing. Please review payment and cost discounts.',
      actorId: 'admin-001',
    });

    await nlpService.runBatch({
      organizationId: ORG_ID,
      modelVersion: 'v1.0',
      actorId: 'admin-001',
    });

    const clusters = await nlpService.clusterTopics(ORG_ID);
    const allTextIds = Object.values(clusters).flat();
    expect(allTextIds.length).toBe(2);
    // At least one known topic cluster should exist
    const knownTopics = ['logistics', 'customer', 'finance', 'product', 'uncategorized'];
    const clusterKeys = Object.keys(clusters);
    expect(clusterKeys.every((k) => knownTopics.includes(k))).toBe(true);
  });

  it('uses most recent run for clustering', async () => {
    await nlpService.importText({
      organizationId: ORG_ID,
      sourceType: 'note',
      sourceId: 'note-3',
      filename: 'support.txt',
      rawText: 'Customer support complaint about return and refund policy.',
      actorId: 'admin-001',
    });

    // Run twice
    await nlpService.runBatch({ organizationId: ORG_ID, modelVersion: 'v1.0', actorId: 'admin-001' });
    await nlpService.runBatch({ organizationId: ORG_ID, modelVersion: 'v1.1', actorId: 'admin-001' });

    const clusters = await nlpService.clusterTopics(ORG_ID);
    const allTextIds = Object.values(clusters).flat();
    expect(allTextIds.length).toBe(1);
  });
});

// ── Entity disambiguation ─────────────────────────────────────────────────────

describe('NLP — entity disambiguation', () => {
  it('classifies entity as ORG when corporate suffix present', () => {
    const entities = nlpService.disambiguateEntities('We contacted Acme Corp about the shipment delay.');
    const acme = entities.find((e) => e.text === 'Acme Corp');
    expect(acme).toBeTruthy();
    expect(acme.type).toBe('ORG');
  });

  it('classifies entity as ORG for "inc" suffix', () => {
    const entities = nlpService.disambiguateEntities('The vendor is Retail Solutions Inc for this contract.');
    const org = entities.find((e) => e.text.includes('Retail'));
    expect(org).toBeTruthy();
    // Entity text may be "Retail Solutions" or "Retail Solutions Inc" depending on pattern
    expect(org.type).toBe('ORG');
  });

  it('classifies entity as LOCATION when location indicator present', () => {
    const entities = nlpService.disambiguateEntities('The store located in Manchester is our largest branch.');
    const loc = entities.find((e) => e.text === 'Manchester');
    expect(loc).toBeTruthy();
    expect(loc.type).toBe('LOCATION');
  });

  it('classifies entity as PRODUCT when product indicator present', () => {
    const entities = nlpService.disambiguateEntities('The Alpha Series product line is being discontinued.');
    const prod = entities.find((e) => e.text.includes('Alpha'));
    expect(prod).toBeTruthy();
    expect(prod.type).toBe('PRODUCT');
  });

  it('defaults to PERSON for unclassified proper nouns', () => {
    const entities = nlpService.disambiguateEntities('John Smith reviewed the case and approved it.');
    const person = entities.find((e) => e.text === 'John Smith');
    expect(person).toBeTruthy();
    expect(person.type).toBe('PERSON');
  });

  it('returns empty array for text with no capitalized entities', () => {
    const entities = nlpService.disambiguateEntities('the quick brown fox jumps over the lazy dog.');
    expect(entities).toEqual([]);
  });

  it('handles multiple entities with different types', () => {
    // Keep person and org clearly separated from location/product contexts
    const personText = 'Jane Doe approved the purchase order yesterday.';
    const orgText = 'Retail Solutions Inc supplied the goods under contract.';

    const persons = nlpService.disambiguateEntities(personText);
    const orgs = nlpService.disambiguateEntities(orgText);

    expect(persons.some((e) => e.type === 'PERSON')).toBe(true);
    expect(orgs.some((e) => e.type === 'ORG')).toBe(true);
  });
});

// ── Disambiguation wired into run pipeline ────────────────────────────────────

describe('NLP — disambiguated entities in run output', () => {
  it('batch run stores disambiguated entity types, not raw PROPER_NOUN', async () => {
    // Text with a clear ORG entity so we can verify the type is resolved
    await nlpService.importText({
      organizationId: ORG_ID,
      sourceType: 'vendor_note',
      sourceId: 'vn-001',
      filename: 'vendor.txt',
      rawText: 'Acme Corp delivered the order on time and within budget.',
      actorId: 'admin-001',
    });

    const run = await nlpService.runBatch({
      organizationId: ORG_ID,
      modelVersion: 'v1.0',
      actorId: 'admin-001',
    });

    const outputEntries = Object.values(run.outputPayload);
    expect(outputEntries.length).toBe(1);

    const entities = outputEntries[0].entities;
    expect(Array.isArray(entities)).toBe(true);

    // All entity types must be resolved (not left as raw PROPER_NOUN)
    const acme = entities.find((e) => e.text.includes('Acme'));
    expect(acme).toBeTruthy();
    expect(acme.type).toBe('ORG');
    expect(acme.type).not.toBe('PROPER_NOUN');
  });

  it('getRunDetail returns output with disambiguated entity types', async () => {
    await nlpService.importText({
      organizationId: ORG_ID,
      sourceType: 'review',
      sourceId: 'rv-001',
      filename: 'review.txt',
      rawText: 'John Smith praised the delivery service near Manchester city.',
      actorId: 'admin-001',
    });

    const run = await nlpService.runBatch({
      organizationId: ORG_ID,
      modelVersion: 'v1.0',
      actorId: 'admin-001',
    });

    const detail = await nlpService.getRunDetail(run.id);
    const entities = Object.values(detail.outputPayload)[0].entities;

    // No raw PROPER_NOUN should remain in stored run output
    expect(entities.every((e) => e.type !== 'PROPER_NOUN')).toBe(true);
  });

  it('PROPER_NOUN type no longer appears in batch run output — regression', async () => {
    await nlpService.importText({
      organizationId: ORG_ID,
      sourceType: 'note',
      sourceId: 'n-regression',
      filename: 'regression.txt',
      rawText: 'Global Logistics Ltd handled the shipment from Berlin warehouse.',
      actorId: 'admin-001',
    });

    const run = await nlpService.runBatch({
      organizationId: ORG_ID,
      modelVersion: 'v1.0',
      actorId: 'admin-001',
    });

    const allEntities = Object.values(run.outputPayload).flatMap((o) => o.entities);
    const rawTypes = allEntities.filter((e) => e.type === 'PROPER_NOUN');
    expect(rawTypes).toHaveLength(0);
  });
});
