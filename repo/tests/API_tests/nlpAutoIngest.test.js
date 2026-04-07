/**
 * NLP automatic ingestion tests — CRM/ticket notes auto-imported for analysis.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { nlpService } from '../../src/services/NLPService.js';
import { orgService } from '../../src/services/OrgService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ORG_NODE_TYPES } from '../../src/utils/constants.js';

const PASS = 'NlpAutoIngest@1234';
let orgId, adminUser, storeId;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'nlp_admin', adminPassword: PASS, orgName: 'NLPIngestCo',
  });
  orgId = org.id;
  adminUser = admin;
  await authService.login('nlp_admin', PASS);
    await authService.unlockProtectedData(PASS);

  // Create org hierarchy: company → factory → store
  const factory = await orgService.createNode({
    parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
    name: 'NLP Factory', organizationId: orgId, actorId: adminUser.id,
  });
  const store = await orgService.createNode({
    parentId: factory.id, type: ORG_NODE_TYPES.STORE,
    name: 'NLP Store', organizationId: orgId, actorId: adminUser.id,
  });
  storeId = store.id;
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. CRM NOTE → NLP INGESTION
// ══════════════════════════════════════════════════════════════════════════════

describe('NLP auto-ingest — CRM notes', () => {
  it('creating a customer note is auto-ingested on incremental run', async () => {
    // Create a customer (creates a version with reasonNote)
    await customerService.createCustomer({
      organizationId: orgId, name: 'NLP Customer',
      actorId: adminUser.id, reasonNote: 'Customer created for shipping analysis',
    });

    // Run incremental — should auto-ingest the CRM note
    const run = await nlpService.runIncremental({
      organizationId: orgId, modelVersion: 'v1.0', actorId: adminUser.id,
    });

    expect(run.inputIds.length).toBeGreaterThan(0);

    // Verify text was ingested
    const texts = await nlpService.getImportedTexts(orgId);
    const crmNote = texts.find((t) => t.sourceType === 'customer_note');
    expect(crmNote).toBeTruthy();
    expect(crmNote.rawText).toContain('shipping analysis');
  });

  it('updating a customer also ingests the new note', async () => {
    const cust = await customerService.createCustomer({
      organizationId: orgId, name: 'Update Test',
      actorId: adminUser.id, reasonNote: 'Initial creation note for NLP test',
    });

    await customerService.updateCustomer(cust.id, { name: 'Updated Name' }, adminUser.id,
      'Customer name updated due to quality feedback concerns');

    const run = await nlpService.runIncremental({
      organizationId: orgId, modelVersion: 'v1.0', actorId: adminUser.id,
    });

    // Should have both version notes
    const texts = await nlpService.getImportedTexts(orgId);
    const crmNotes = texts.filter((t) => t.sourceType === 'customer_note');
    expect(crmNotes.length).toBeGreaterThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. TICKET NOTE → NLP INGESTION
// ══════════════════════════════════════════════════════════════════════════════

describe('NLP auto-ingest — ticket notes', () => {
  it('ticket event comments are auto-ingested', async () => {
    // Create a customer and ticket with a comment
    const cust = await customerService.createCustomer({
      organizationId: orgId, name: 'Ticket Customer',
      actorId: adminUser.id, reasonNote: 'Customer for ticket ingestion test',
    });

    const ticket = await ticketService.createTicket({
      customerId: cust.id, organizationId: orgId, storeId,
      subject: 'Delivery complaint', description: 'The delivery was terrible and late.',
      category: 'logistics', priority: 'high', actorId: adminUser.id,
    });

    // Assign with a comment (creates an event with comment)
    await ticketService.assignTicket(ticket.id, adminUser.id, adminUser.id);

    // Transition with a comment
    await ticketService.transitionTicket(ticket.id, 'resolved', adminUser.id,
      'Resolved by refunding the customer for the poor delivery experience');

    // Run incremental — should auto-ingest ticket event comments
    const run = await nlpService.runIncremental({
      organizationId: orgId, modelVersion: 'v1.0', actorId: adminUser.id,
    });

    expect(run.inputIds.length).toBeGreaterThan(0);

    const texts = await nlpService.getImportedTexts(orgId);
    const ticketNotes = texts.filter((t) => t.sourceType === 'ticket_note');
    expect(ticketNotes.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. NO DUPLICATE RE-PROCESSING
// ══════════════════════════════════════════════════════════════════════════════

describe('NLP auto-ingest — idempotency', () => {
  it('running incremental twice does not duplicate ingested notes', async () => {
    await customerService.createCustomer({
      organizationId: orgId, name: 'Dedup Customer',
      actorId: adminUser.id, reasonNote: 'Idempotency test note for dedup check',
    });

    // First incremental
    await nlpService.runIncremental({
      organizationId: orgId, modelVersion: 'v1.0', actorId: adminUser.id,
    });

    const textsAfterFirst = await nlpService.getImportedTexts(orgId);
    const countAfterFirst = textsAfterFirst.filter((t) => t.sourceType === 'customer_note').length;

    // Second incremental (no new data)
    await nlpService.runIncremental({
      organizationId: orgId, modelVersion: 'v1.0', actorId: adminUser.id,
    });

    const textsAfterSecond = await nlpService.getImportedTexts(orgId);
    const countAfterSecond = textsAfterSecond.filter((t) => t.sourceType === 'customer_note').length;

    // Same count — no duplicates
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. MANUAL IMPORT STILL WORKS
// ══════════════════════════════════════════════════════════════════════════════

describe('NLP auto-ingest — manual import preserved', () => {
  it('manual import works alongside auto-ingestion', async () => {
    // Manual import
    await nlpService.importText({
      organizationId: orgId, sourceType: 'manual_review',
      sourceId: 'manual_1', filename: 'review.txt',
      rawText: 'This product has excellent quality and great shipping speed.',
      actorId: adminUser.id,
    });

    // Create CRM note for auto-ingest
    await customerService.createCustomer({
      organizationId: orgId, name: 'Manual+Auto Customer',
      actorId: adminUser.id, reasonNote: 'Manual import alongside auto-ingest test note',
    });

    // Run incremental
    const run = await nlpService.runIncremental({
      organizationId: orgId, modelVersion: 'v1.0', actorId: adminUser.id,
    });

    const texts = await nlpService.getImportedTexts(orgId);
    const manualTexts = texts.filter((t) => t.sourceType === 'manual_review');
    const crmTexts = texts.filter((t) => t.sourceType === 'customer_note');

    expect(manualTexts.length).toBe(1);
    expect(crmTexts.length).toBeGreaterThan(0);
    expect(run.inputIds.length).toBeGreaterThan(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. UI CONFIRMATION
// ══════════════════════════════════════════════════════════════════════════════

describe('NLP auto-ingest — UI confirmation', () => {
  it('NLPPage indicates auto-ingestion of CRM/ticket notes', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/NLPPage.svelte'), 'utf8');
    expect(content).toContain('auto-ingest');
    expect(content).toContain('CRM');
    expect(content).toContain('ticket');
  });
});
