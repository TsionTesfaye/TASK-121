/**
 * Cross-Org Read Access — break tests confirming all read methods enforce org scope.
 *
 * Every test confirms that a user from org-B CANNOT read data belonging to org-A.
 *
 * Covers:
 *   - OrderService.getByCustomer: cross-org customer orders blocked
 *   - OrderService.getOrderDetail: cross-org order detail blocked
 *   - TicketService.getByCustomer: cross-org customer tickets blocked
 *   - TicketService.getByStore: cross-org store tickets blocked
 *   - StyleService.getByOrg: cross-org org styles blocked
 *   - StyleService.getByStore: cross-org store styles blocked
 *   - NLPService.runBatch: only processes own-org texts
 *   - NLPService.runIncremental: only processes own-org texts
 *   - NLPService.getRunDetail: cross-org run detail blocked
 *   - ImportExportService.applyImport: missing schemaVersion rejected
 *   - ImportExportService.applyImport: mismatched schemaVersion rejected
 *   - Admin correctly bypasses all org scope restrictions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { OrderService } from '../../src/services/OrderService.js';
import { TicketService } from '../../src/services/TicketService.js';
import { StyleService } from '../../src/services/StyleService.js';
import { NLPService } from '../../src/services/NLPService.js';
import { ImportExportService } from '../../src/services/ImportExportService.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { OrderRepository } from '../../src/repositories/implementations/OrderRepository.js';
import { TicketRepository } from '../../src/repositories/implementations/TicketRepository.js';
import { StyleRepository } from '../../src/repositories/implementations/StyleRepository.js';
import { NLPRunRepository } from '../../src/repositories/implementations/NLPRepository.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, ORDER_STATUSES, TICKET_STATUSES } from '../../src/utils/constants.js';
import { generateId } from '../../src/utils/idGenerator.js';
import { DB_VERSION } from '../../src/infrastructure/db/schema.js';

const ORG_A = 'org-alpha';
const ORG_B = 'org-beta';

const MGR_A = { id: 'mgr-a', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_A };
const MGR_B = { id: 'mgr-b', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_B };
const ANALYST_A = { id: 'analyst-a', role: ROLES.ANALYST, organizationNodeId: ORG_A };
const ANALYST_B = { id: 'analyst-b', role: ROLES.ANALYST, organizationNodeId: ORG_B };
const REVIEWER_B = { id: 'rev-b', role: ROLES.REVIEWER, organizationNodeId: ORG_B };
const ADMIN = { id: 'admin-x', role: ROLES.ADMINISTRATOR, organizationNodeId: null };

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedCustomer(orgId) {
  const repo = new CustomerRepository();
  const c = { id: generateId(), organizationId: orgId, name: 'Test', membershipTier: 'Bronze', points: 0, createdAt: Date.now(), updatedAt: Date.now() };
  await repo.create(c);
  return c;
}

async function seedOrder(customerId, orgId, storeId) {
  const repo = new OrderRepository();
  const o = { id: generateId(), customerId, organizationId: orgId, storeId, items: [], status: ORDER_STATUSES.DRAFT, restrictionFlags: {}, createdAt: Date.now(), updatedAt: Date.now() };
  await repo.create(o);
  return o;
}

async function seedTicket(customerId, orgId, storeId) {
  const repo = new TicketRepository();
  const t = { id: generateId(), customerId, organizationId: orgId, storeId, subject: 'T', description: 'D', category: 'general', priority: 'medium', status: TICKET_STATUSES.OPEN, slaDueAt: Date.now() + 3600000, isOverdue: false, assignedTo: null, createdAt: Date.now(), updatedAt: Date.now(), resolvedAt: null, closedBy: null };
  await repo.create(t);
  return t;
}

async function seedStyle(orgId, storeId) {
  const repo = new StyleRepository();
  const s = { id: generateId(), organizationId: orgId, sku: `SKU-${orgId}`, storeId, isActive: true, createdAt: Date.now(), updatedAt: Date.now() };
  await repo.create(s);
  return s;
}

async function seedNLPRun(orgId) {
  const repo = new NLPRunRepository();
  const r = { id: generateId(), organizationId: orgId, runType: 'batch', modelVersion: 'v1.0', inputIds: [], outputPayload: {}, createdBy: 'analyst-a', createdAt: Date.now() };
  await repo.create(r);
  return r;
}

async function seedImportedText(orgId, rawText = 'Sample review text.') {
  const repo = new BaseRepository('importedTexts');
  const t = { id: generateId(), organizationId: orgId, sourceType: 'review', sourceId: 's1', filename: 'f.txt', rawText, sizeBytes: rawText.length, importedAt: Date.now(), updatedAt: Date.now() };
  await repo.create(t);
  return t;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

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

// ── OrderService read scope ───────────────────────────────────────────────────

describe('OrderService.getByCustomer — cross-org blocked', () => {
  it('mgr-B cannot read orders of an org-A customer', async () => {
    const customer = await seedCustomer(ORG_A);
    await seedOrder(customer.id, ORG_A, ORG_A);
    authService._currentUser = MGR_B;
    const svc = new OrderService();
    await expect(svc.getByCustomer(customer.id)).rejects.toThrow(/scope violation/i);
  });

  it('admin can read orders of any org customer', async () => {
    const customer = await seedCustomer(ORG_A);
    await seedOrder(customer.id, ORG_A, ORG_A);
    authService._currentUser = ADMIN;
    const svc = new OrderService();
    const orders = await svc.getByCustomer(customer.id);
    expect(orders.length).toBe(1);
  });

  it('returns empty array (not scope error) when customer not found', async () => {
    authService._currentUser = MGR_B;
    const svc = new OrderService();
    const result = await svc.getByCustomer('nonexistent-customer-id');
    expect(result).toEqual([]);
  });
});

describe('OrderService.getOrderDetail — cross-org blocked', () => {
  it('mgr-B cannot read detail of an org-A order', async () => {
    const customer = await seedCustomer(ORG_A);
    const order = await seedOrder(customer.id, ORG_A, ORG_A);
    authService._currentUser = MGR_B;
    const svc = new OrderService();
    await expect(svc.getOrderDetail(order.id)).rejects.toThrow(/scope violation/i);
  });

  it('admin can read detail of any org order', async () => {
    const customer = await seedCustomer(ORG_A);
    const order = await seedOrder(customer.id, ORG_A, ORG_A);
    authService._currentUser = ADMIN;
    const svc = new OrderService();
    const detail = await svc.getOrderDetail(order.id);
    expect(detail.order.id).toBe(order.id);
  });

  it('mgr-A can read their own org order detail', async () => {
    const customer = await seedCustomer(ORG_A);
    const order = await seedOrder(customer.id, ORG_A, ORG_A);
    authService._currentUser = MGR_A;
    const svc = new OrderService();
    const detail = await svc.getOrderDetail(order.id);
    expect(detail.order.id).toBe(order.id);
  });
});

// ── TicketService read scope ──────────────────────────────────────────────────

describe('TicketService.getByCustomer — cross-org blocked', () => {
  it('mgr-B cannot read tickets of an org-A customer (returns empty — scope filters results)', async () => {
    const customer = await seedCustomer(ORG_A);
    await seedTicket(customer.id, ORG_A, ORG_A);
    authService._currentUser = MGR_B;
    const svc = new TicketService();
    // getByCustomer now derives scope from data — returns empty for cross-org
    const tickets = await svc.getByCustomer(customer.id, ORG_A);
    expect(tickets.length).toBe(0);
  });

  it('mgr-A can read tickets of an org-A customer', async () => {
    const customer = await seedCustomer(ORG_A);
    await seedTicket(customer.id, ORG_A, ORG_A);
    authService._currentUser = MGR_A;
    const svc = new TicketService();
    const tickets = await svc.getByCustomer(customer.id, ORG_A);
    expect(tickets.length).toBe(1);
  });

  it('admin can read tickets for any org', async () => {
    const customer = await seedCustomer(ORG_A);
    await seedTicket(customer.id, ORG_A, ORG_A);
    authService._currentUser = ADMIN;
    const svc = new TicketService();
    const tickets = await svc.getByCustomer(customer.id, ORG_A);
    expect(tickets.length).toBe(1);
  });
});

describe('TicketService.getByStore — cross-org blocked', () => {
  it('mgr-B cannot list tickets for org-A store', async () => {
    authService._currentUser = MGR_B;
    const svc = new TicketService();
    await expect(svc.getByStore(ORG_A)).rejects.toThrow(/scope violation/i);
  });

  it('mgr-A can list tickets for their own store', async () => {
    const customer = await seedCustomer(ORG_A);
    await seedTicket(customer.id, ORG_A, ORG_A);
    authService._currentUser = MGR_A;
    const svc = new TicketService();
    const tickets = await svc.getByStore(ORG_A);
    expect(tickets.length).toBe(1);
  });
});

// ── StyleService read scope ───────────────────────────────────────────────────

describe('StyleService.getByOrg — cross-org blocked', () => {
  it('mgr-B cannot list styles for org-A', async () => {
    authService._currentUser = MGR_B;
    const svc = new StyleService();
    await expect(svc.getByOrg(ORG_A)).rejects.toThrow(/scope violation/i);
  });

  it('mgr-A can list styles for their own org', async () => {
    await seedStyle(ORG_A, ORG_A);
    authService._currentUser = MGR_A;
    const svc = new StyleService();
    const styles = await svc.getByOrg(ORG_A);
    expect(styles.length).toBe(1);
  });
});

describe('StyleService.getByStore — cross-org blocked', () => {
  it('mgr-B cannot list styles for org-A store', async () => {
    authService._currentUser = MGR_B;
    const svc = new StyleService();
    await expect(svc.getByStore(ORG_A)).rejects.toThrow(/scope violation/i);
  });

  it('admin can list styles for any org', async () => {
    await seedStyle(ORG_A, ORG_A);
    authService._currentUser = ADMIN;
    const svc = new StyleService();
    const styles = await svc.getByStore(ORG_A);
    expect(styles.length).toBe(1);
  });
});

// ── NLPService org isolation ──────────────────────────────────────────────────

describe('NLPService.runBatch — org isolation', () => {
  it('runBatch for org-A only processes org-A texts', async () => {
    await seedImportedText(ORG_A, 'Alpha org review text.');
    await seedImportedText(ORG_B, 'Beta org review text.');
    authService._currentUser = ANALYST_A;
    const svc = new NLPService();
    const run = await svc.runBatch({ organizationId: ORG_A, modelVersion: 'v1.0', actorId: ANALYST_A.id });
    expect(run.inputIds.length).toBe(1);
    expect(run.organizationId).toBe(ORG_A);
  });

  it('runBatch for org-B does not include org-A texts', async () => {
    await seedImportedText(ORG_A, 'Alpha org text only.');
    authService._currentUser = ANALYST_B;
    const svc = new NLPService();
    const run = await svc.runBatch({ organizationId: ORG_B, modelVersion: 'v1.0', actorId: ANALYST_B.id });
    expect(run.inputIds.length).toBe(0);
  });
});

describe('NLPService.runIncremental — org isolation', () => {
  it('runIncremental for org-A only processes org-A texts', async () => {
    await seedImportedText(ORG_B, 'Beta org text not for A.');
    await seedImportedText(ORG_A, 'Alpha org new text.');
    authService._currentUser = ANALYST_A;
    const svc = new NLPService();
    const run = await svc.runIncremental({ organizationId: ORG_A, modelVersion: 'v1.0', actorId: ANALYST_A.id });
    expect(run.inputIds.length).toBe(1);
    expect(run.organizationId).toBe(ORG_A);
  });
});

describe('NLPService.getRunDetail — cross-org blocked', () => {
  it('reviewer-B cannot read an org-A NLP run', async () => {
    const run = await seedNLPRun(ORG_A);
    authService._currentUser = REVIEWER_B;
    const svc = new NLPService();
    await expect(svc.getRunDetail(run.id)).rejects.toThrow(/scope violation/i);
  });

  it('analyst-A can read their own org NLP run', async () => {
    const run = await seedNLPRun(ORG_A);
    authService._currentUser = ANALYST_A;
    const svc = new NLPService();
    const detail = await svc.getRunDetail(run.id);
    expect(detail.id).toBe(run.id);
  });

  it('admin can read any org NLP run', async () => {
    const run = await seedNLPRun(ORG_A);
    authService._currentUser = ADMIN;
    const svc = new NLPService();
    const detail = await svc.getRunDetail(run.id);
    expect(detail.id).toBe(run.id);
  });
});

// ── ImportExportService schema validation ─────────────────────────────────────

describe('ImportExportService.applyImport — schema bypass blocked', () => {
  it('rejects applyImport called without schemaVersion', async () => {
    authService._currentUser = ADMIN;
    const svc = new ImportExportService();
    await expect(
      svc.applyImport({ snapshot: {}, actorId: ADMIN.id }),
    ).rejects.toThrow(/schema version is required/i);
  });

  it('rejects applyImport with mismatched schema version', async () => {
    authService._currentUser = ADMIN;
    const svc = new ImportExportService();
    await expect(
      svc.applyImport({ snapshot: {}, schemaVersion: 9999, actorId: ADMIN.id }),
    ).rejects.toThrow(/mismatch|migration/i);
  });

  it('accepts applyImport with correct schema version', async () => {
    authService._currentUser = ADMIN;
    const svc = new ImportExportService();
    await expect(
      svc.applyImport({ snapshot: {}, schemaVersion: DB_VERSION, actorId: ADMIN.id }),
    ).resolves.toBeUndefined();
  });
});
