/**
 * Unit tests — RBAC permission guards across all services.
 *
 * Each service method that requires a specific role must throw
 * 'Permission denied' or 'Authentication required' when accessed
 * by an unauthorized or unauthenticated caller.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { orderService } from '../../src/services/OrderService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { masterDataService } from '../../src/services/MasterDataService.js';
import { orgService } from '../../src/services/OrgService.js';
import { styleService } from '../../src/services/StyleService.js';
import { nlpService } from '../../src/services/NLPService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { importExportService } from '../../src/services/ImportExportService.js';
import { templateService } from '../../src/services/TemplateService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
});

afterEach(() => {
  authService._currentUser = null;
  closeDB();
  closeAll();
});

function setActor(role, opts = {}) {
  authService._currentUser = {
    id: 'actor-001',
    role,
    organizationNodeId: opts.orgNodeId ?? 'org-001',
    ...opts,
  };
}

// ── Unauthenticated access ────────────────────────────────────────────────────

describe('Unauthenticated access is blocked', () => {
  it('customerService.createCustomer rejects unauthenticated', async () => {
    await expect(customerService.createCustomer({ organizationId: 'org-001', name: 'Alice', actorId: 'x', reasonNote: 'Test customer creation' }))
      .rejects.toThrow('Authentication required');
  });

  it('orderService.createOrder rejects unauthenticated', async () => {
    await expect(orderService.createOrder({ customerId: 'c1', organizationId: 'o1', storeId: 's1', actorId: 'x' }))
      .rejects.toThrow('Authentication required');
  });

  it('ticketService.createTicket rejects unauthenticated', async () => {
    await expect(
      ticketService.createTicket({ customerId: 'c1', organizationId: 'o1', storeId: 's1', subject: 'S', description: 'D', category: 'C', priority: 'low', actorId: 'x' }),
    ).rejects.toThrow('Authentication required');
  });

  it('masterDataService.publishVersion rejects unauthenticated', async () => {
    await expect(
      masterDataService.publishVersion({ entityType: 'color', entityId: 'e1', organizationId: 'o1', payload: {}, reasonNote: 'ten chars!', createdBy: 'x', expectedActiveVersionId: null }),
    ).rejects.toThrow('Authentication required');
  });

  it('orgService.createNode rejects unauthenticated', async () => {
    await expect(orgService.createNode({ parentId: null, type: 'company', name: 'Corp', organizationId: 'o1', actorId: 'x' }))
      .rejects.toThrow('Authentication required');
  });

  it('nlpService.runBatch rejects unauthenticated', async () => {
    await expect(nlpService.runBatch({ organizationId: 'o1', modelVersion: 'v1', actorId: 'x' }))
      .rejects.toThrow('Authentication required');
  });

  it('riskReviewService.getInbox rejects unauthenticated', async () => {
    await expect(riskReviewService.getInbox('o1')).rejects.toThrow('Authentication required');
  });

  it('importExportService.exportBackup rejects unauthenticated', async () => {
    await expect(importExportService.exportBackup({ actorId: 'x', backupPassphrase: 'secret' }))
      .rejects.toThrow('Authentication required');
  });
});

// ── ANALYST cannot perform privileged write operations ────────────────────────

describe('ANALYST role restrictions', () => {
  beforeEach(() => setActor(ROLES.ANALYST));

  it('cannot create a customer', async () => {
    await expect(customerService.createCustomer({ organizationId: 'org-001', name: 'Bob', actorId: 'actor-001', reasonNote: 'Test customer creation' }))
      .rejects.toThrow('Permission denied');
  });

  it('cannot publish master data version', async () => {
    await expect(
      masterDataService.publishVersion({ entityType: 'color', entityId: 'e1', organizationId: 'org-001', payload: {}, reasonNote: 'ten chars!', createdBy: 'actor-001', expectedActiveVersionId: null }),
    ).rejects.toThrow('Permission denied');
  });

  it('cannot create an org node', async () => {
    await expect(orgService.createNode({ parentId: null, type: 'company', name: 'Corp', organizationId: 'org-001', actorId: 'actor-001' }))
      .rejects.toThrow('Permission denied');
  });

  it('cannot resolve a risk case', async () => {
    await expect(riskReviewService.resolveCase({ caseId: 'c1', outcomeCode: 'no_issue', resolutionComment: 'ok', reviewerId: 'actor-001' }))
      .rejects.toThrow('Permission denied');
  });

  it('cannot export a backup', async () => {
    await expect(importExportService.exportBackup({ actorId: 'actor-001', backupPassphrase: 'pass' }))
      .rejects.toThrow('Permission denied');
  });

  it('cannot adjust stored value', async () => {
    await expect(customerService.adjustStoredValue('cust-001', 10, 'actor-001', 'Test reason note text'))
      .rejects.toThrow('Permission denied');
  });

  it('can run NLP analysis', async () => {
    // Should not throw permission error — analyst is allowed
    const run = await nlpService.runBatch({ organizationId: 'org-001', modelVersion: 'v1', actorId: 'actor-001' });
    expect(run).toBeDefined();
  });
});

// ── REVIEWER cannot modify data outside their domain ─────────────────────────

describe('REVIEWER role restrictions', () => {
  beforeEach(() => setActor(ROLES.REVIEWER));

  it('cannot create a customer', async () => {
    await expect(customerService.createCustomer({ organizationId: 'org-001', name: 'Carol', actorId: 'actor-001', reasonNote: 'Test customer creation' }))
      .rejects.toThrow('Permission denied');
  });

  it('cannot create an order', async () => {
    await expect(orderService.createOrder({ customerId: 'c1', organizationId: 'org-001', storeId: 'org-001', actorId: 'actor-001' }))
      .rejects.toThrow('Permission denied');
  });

  it('cannot publish master data', async () => {
    await expect(
      masterDataService.publishVersion({ entityType: 'color', entityId: 'e1', organizationId: 'org-001', payload: {}, reasonNote: 'ten chars!', createdBy: 'actor-001', expectedActiveVersionId: null }),
    ).rejects.toThrow('Permission denied');
  });

  it('can view NLP run history', async () => {
    const runs = await nlpService.getRunHistory('org-001');
    expect(Array.isArray(runs)).toBe(true);
  });

  it('can view the risk inbox', async () => {
    const inbox = await riskReviewService.getInbox('org-001');
    expect(Array.isArray(inbox)).toBe(true);
  });
});

// ── STORE_MANAGER can manage within their org, not others ────────────────────

describe('STORE_MANAGER scope enforcement', () => {
  beforeEach(() => setActor(ROLES.STORE_MANAGER, { orgNodeId: 'store-001' }));

  it('can create a customer in own org', async () => {
    // Will fail on crypto (session not unlocked) rather than RBAC
    await expect(customerService.createCustomer({ organizationId: 'store-001', name: 'Alice', actorId: 'actor-001', reasonNote: 'Test customer creation' }))
      .rejects.toThrow('Session is locked');
  });

  it('cannot create a customer in another org', async () => {
    await expect(customerService.createCustomer({ organizationId: 'store-002', name: 'Bob', actorId: 'actor-001', reasonNote: 'Test customer creation' }))
      .rejects.toThrow('Scope violation');
  });

  it('cannot publish master data to another org', async () => {
    await expect(
      masterDataService.publishVersion({ entityType: 'color', entityId: 'e1', organizationId: 'store-002', payload: {}, reasonNote: 'ten chars!', createdBy: 'actor-001', expectedActiveVersionId: null }),
    ).rejects.toThrow('Scope violation');
  });

  it('cannot create org nodes (admin only)', async () => {
    await expect(orgService.createNode({ parentId: null, type: 'company', name: 'Corp', organizationId: 'store-001', actorId: 'actor-001' }))
      .rejects.toThrow('Permission denied');
  });
});

// ── ADMINISTRATOR bypasses all role restrictions ──────────────────────────────

describe('ADMINISTRATOR bypasses role restrictions', () => {
  beforeEach(() => setActor(ROLES.ADMINISTRATOR));

  it('can create org nodes', async () => {
    const node = await orgService.createNode({ parentId: null, type: 'company', name: 'Corp', organizationId: 'org-admin', actorId: 'actor-001' });
    expect(node.type).toBe('company');
  });

  it('can access any org in masterData', async () => {
    const active = await masterDataService.getActiveVersion('color', 'any-org');
    expect(active).toBeNull();
  });

  it('can view risk inbox', async () => {
    const inbox = await riskReviewService.getInbox('any-org');
    expect(Array.isArray(inbox)).toBe(true);
  });
});

// ── GUEST cannot perform any write operations ─────────────────────────────────

describe('GUEST read-only enforcement', () => {
  beforeEach(() => {
    authService._currentUser = { id: 'guest-1', role: ROLES.GUEST, isGuest: true, organizationNodeId: null };
  });

  it('cannot create a customer', async () => {
    await expect(customerService.createCustomer({ organizationId: 'o1', name: 'G', actorId: 'guest-1', reasonNote: 'Test customer creation' }))
      .rejects.toThrow('Permission denied');
  });

  it('cannot create a ticket', async () => {
    await expect(
      ticketService.createTicket({ customerId: 'c1', organizationId: 'o1', storeId: 'o1', subject: 'S', description: 'D', category: 'C', priority: 'low', actorId: 'guest-1' }),
    ).rejects.toThrow('Permission denied');
  });
});
