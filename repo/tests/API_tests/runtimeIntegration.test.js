/**
 * Runtime integration tests — Prompt 2 regression coverage.
 *
 * Covers:
 *   1. Dictionary lifecycle (load/clear on session/org boundaries)
 *   2. Draft notification recovery (Draft → Queued → Sent)
 *   3. Store/org hierarchy enforcement in orders and tickets
 *   4. Import apply forces logout
 *   5. Guest trial scoped to real org
 *   6. Admin user provisioning validates org node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { templateService } from '../../src/services/TemplateService.js';
import { importExportService } from '../../src/services/ImportExportService.js';
import { OrderService } from '../../src/services/OrderService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { OrgRepository } from '../../src/repositories/implementations/OrgRepository.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, QUEUE_STATUSES, ORG_NODE_TYPES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'Runtime@12345';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'rt_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'RuntimeCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('rt_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. DICTIONARY LIFECYCLE
// ══════════════════════════════════════════════════════════════════════════════

describe('Dictionary lifecycle — load/clear on boundaries', () => {
  it('loadPersistedDictionary populates from IndexedDB', async () => {
    await riskReviewService.updateSensitiveWords(['fraud', 'scam'], adminUser.id);

    riskReviewService.clearDictionary();
    expect(riskReviewService.getSensitiveWords()).toEqual([]);

    await riskReviewService.loadPersistedDictionary(orgId);
    expect(riskReviewService.getSensitiveWords()).toEqual(['fraud', 'scam']);
  });

  it('clearDictionary removes in-memory state', async () => {
    await riskReviewService.updateSensitiveWords(['test'], adminUser.id);
    riskReviewService.clearDictionary();
    expect(riskReviewService.getSensitiveWords()).toEqual([]);
  });

  it('different org does not inherit previous org words', async () => {
    await riskReviewService.updateSensitiveWords(['orgA-word'], adminUser.id);

    riskReviewService.clearDictionary();
    await riskReviewService.loadPersistedDictionary('other-org-999');
    expect(riskReviewService.getSensitiveWords()).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. DRAFT NOTIFICATION RECOVERY
// ══════════════════════════════════════════════════════════════════════════════

describe('Draft notification recovery — requeueDraft', () => {
  it('missing placeholder creates Draft item', async () => {
    const template = await templateService.createTemplate({
      organizationId: orgId,
      name: 'Draft Test',
      body: 'Hello {name} — order {orderId}!',
      actorId: adminUser.id,
    });
    const channel = await notificationService.upsertChannel({ organizationId: orgId, name: 'In-App' });

    const item = await notificationService.enqueue({
      organizationId: orgId,
      recipientUserId: adminUser.id,
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Alice' }, // orderId missing
      eventSourceKey: 'draft:recovery:1',
    });

    expect(item.status).toBe(QUEUE_STATUSES.DRAFT);
    expect(item.failureReason).toContain('orderId');
  });

  it('requeueDraft transitions Draft → Queued with corrected vars', async () => {
    const template = await templateService.createTemplate({
      organizationId: orgId,
      name: 'Requeue Test',
      body: 'Hello {name} — order {orderId}!',
      actorId: adminUser.id,
    });
    const channel = await notificationService.upsertChannel({ organizationId: orgId, name: 'In-App' });

    const draft = await notificationService.enqueue({
      organizationId: orgId,
      recipientUserId: adminUser.id,
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Bob' }, // orderId missing
      eventSourceKey: 'draft:recovery:2',
    });

    expect(draft.status).toBe(QUEUE_STATUSES.DRAFT);

    // Correct the missing variable and requeue
    const requeued = await notificationService.requeueDraft(draft.id, {
      name: 'Bob',
      orderId: 'ORD-42',
    });

    expect(requeued.status).toBe(QUEUE_STATUSES.QUEUED);
    expect(requeued.renderedBody).toContain('ORD-42');
    expect(requeued.failureReason).toBeNull();
  });

  it('requeued item processes through normal lifecycle', async () => {
    const template = await templateService.createTemplate({
      organizationId: orgId,
      name: 'Lifecycle Test',
      body: 'Item {ref} ready.',
      actorId: adminUser.id,
    });
    const channel = await notificationService.upsertChannel({ organizationId: orgId, name: 'In-App' });

    const draft = await notificationService.enqueue({
      organizationId: orgId,
      recipientUserId: adminUser.id,
      templateId: template.id,
      channelId: channel.id,
      vars: {}, // ref missing
      eventSourceKey: 'draft:lifecycle:1',
    });

    const requeued = await notificationService.requeueDraft(draft.id, { ref: 'X-123' });
    expect(requeued.status).toBe(QUEUE_STATUSES.QUEUED);

    const result = await notificationService.processDueItems();
    expect(result.sent).toBe(1);

    const inbox = await notificationService.getInbox(adminUser.id);
    expect(inbox.length).toBeGreaterThan(0);
  });

  it('rejects requeue of non-Draft item', async () => {
    const template = await templateService.createTemplate({
      organizationId: orgId,
      name: 'NonDraft Test',
      body: 'Hello {name}!',
      actorId: adminUser.id,
    });
    const channel = await notificationService.upsertChannel({ organizationId: orgId, name: 'In-App' });

    const item = await notificationService.enqueue({
      organizationId: orgId,
      recipientUserId: adminUser.id,
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Charlie' },
      eventSourceKey: 'nondraft:test:1',
    });

    expect(item.status).toBe(QUEUE_STATUSES.QUEUED);
    await expect(
      notificationService.requeueDraft(item.id, { name: 'Charlie' }),
    ).rejects.toThrow(/only draft/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. STORE/ORG HIERARCHY ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe('Store/org hierarchy enforcement', () => {
  let storeId;

  beforeEach(async () => {
    const factory = await (await import('../../src/services/OrgService.js')).orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY, name: 'F1',
      organizationId: orgId, actorId: adminUser.id,
    });
    const store = await (await import('../../src/services/OrgService.js')).orgService.createNode({
      parentId: factory.id, type: ORG_NODE_TYPES.STORE, name: 'S1',
      organizationId: orgId, actorId: adminUser.id,
    });
    storeId = store.id;
  });

  it('order rejects nonexistent storeId', async () => {
    const custRepo = new CustomerRepository();
    await custRepo.create({
      id: 'cust-h', organizationId: orgId, name: 'H Customer',
      membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
      storedValueCiphertext: null, storedValueIv: null,
      allergiesCiphertext: null, allergiesIv: null,
      materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    const svc = new OrderService();
    await expect(
      svc.createOrder({ customerId: 'cust-h', organizationId: orgId, storeId: 'ghost', items: [], actorId: adminUser.id }),
    ).rejects.toThrow(/not found/i);
  });

  it('order rejects wrong node type as store', async () => {
    const custRepo = new CustomerRepository();
    await custRepo.create({
      id: 'cust-h2', organizationId: orgId, name: 'H2 Customer',
      membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
      storedValueCiphertext: null, storedValueIv: null,
      allergiesCiphertext: null, allergiesIv: null,
      materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    // Use a factory ID as storeId
    const orgRepo = new OrgRepository();
    const factories = (await orgRepo.findByOrganization(orgId)).filter((n) => n.type === 'factory');
    const factoryId = factories[0].id;

    const svc = new OrderService();
    await expect(
      svc.createOrder({ customerId: 'cust-h2', organizationId: orgId, storeId: factoryId, items: [], actorId: adminUser.id }),
    ).rejects.toThrow(/expected 'store'/i);
  });

  it('ticket rejects store from different org', async () => {
    const custRepo = new CustomerRepository();
    await custRepo.create({
      id: 'cust-h3', organizationId: orgId, name: 'H3 Customer',
      membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
      storedValueCiphertext: null, storedValueIv: null,
      allergiesCiphertext: null, allergiesIv: null,
      materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });

    await expect(
      ticketService.createTicket({
        customerId: 'cust-h3', organizationId: orgId, storeId: 'foreign-store',
        subject: 'Test', description: 'Desc', category: 'general', priority: 'low',
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('valid org/store chain passes', async () => {
    const custRepo = new CustomerRepository();
    await custRepo.create({
      id: 'cust-valid', organizationId: orgId, name: 'Valid Customer',
      membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
      storedValueCiphertext: null, storedValueIv: null,
      allergiesCiphertext: null, allergiesIv: null,
      materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    const svc = new OrderService();
    const order = await svc.createOrder({
      customerId: 'cust-valid', organizationId: orgId, storeId: storeId, items: [], actorId: adminUser.id,
    });
    expect(order.storeId).toBe(storeId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. IMPORT APPLY FORCES LOGOUT
// ══════════════════════════════════════════════════════════════════════════════

describe('Import apply — forces logout', () => {
  it('user is logged out after applyImport', async () => {
    expect(authService.isAuthenticated()).toBe(true);

    await importExportService.applyImport({
      snapshot: {},
      schemaVersion: (await import('../../src/infrastructure/db/schema.js')).DB_VERSION,
      actorId: adminUser.id,
    });

    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getCurrentUser()).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. GUEST TRIAL — SCOPED TO REAL ORG
// ══════════════════════════════════════════════════════════════════════════════

describe('Guest trial — scoped to org', () => {
  it('guest session has a valid organizationNodeId', async () => {
    const guest = await authService.createGuestSession(() => {});
    expect(guest.organizationNodeId).toBeTruthy();
    expect(guest.role).toBe(ROLES.GUEST);
  });

  it('guest cannot mutate', async () => {
    await authService.createGuestSession(() => {});
    await expect(
      notificationService.subscribe({
        userId: authService.getCurrentUser().id,
        channelId: null, eventType: 'order_status',
        organizationId: orgId,
      }),
    ).rejects.toThrow(/guest/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. ADMIN USER PROVISIONING — ORG NODE VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Admin user provisioning — org node validation', () => {
  it('rejects store_manager with nonexistent org node', async () => {
    await expect(
      authService.createUser({
        username: 'bad_user',
        password: 'ValidPass@1234',
        role: ROLES.STORE_MANAGER,
        organizationNodeId: 'nonexistent-node',
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects store_manager with null org node', async () => {
    await expect(
      authService.createUser({
        username: 'null_user',
        password: 'ValidPass@1234',
        role: ROLES.STORE_MANAGER,
        organizationNodeId: null,
      }),
    ).rejects.toThrow(/requires.*organizationNodeId/i);
  });

  it('accepts administrator without org node validation', async () => {
    const user = await authService.createUser({
      username: 'new_admin',
      password: 'AdminPass@1234',
      role: ROLES.ADMINISTRATOR,
      organizationNodeId: null,
    });
    expect(user.role).toBe(ROLES.ADMINISTRATOR);
  });

  it('accepts store_manager with valid org node', async () => {
    const user = await authService.createUser({
      username: 'valid_mgr',
      password: 'MgrPass@12345',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: orgId,
    });
    expect(user.organizationNodeId).toBe(orgId);
  });
});
