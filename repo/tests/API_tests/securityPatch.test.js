/**
 * Critical security patch tests — cross-org authorization enforcement.
 *
 * Covers:
 *   1. Customer version history scope (derived from customer record)
 *   2. Ticket getByCustomer — forged orgId ignored
 *   3. Notification subscribe — foreign org binding rejected
 *   4. Notification enqueue — cross-org injection rejected
 *   5. Template rendering — org isolation
 *   6. Risk heuristics — org-scoped data
 *   7. Org tree read — scope enforcement
 *   8. Guest mode — true read-only
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { templateService } from '../../src/services/TemplateService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { orgService } from '../../src/services/OrgService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'SecPatch@12345';
const OTHER_ORG_ID = 'foreign-org-00000000';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'sec_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'SecPatchCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('sec_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

  // Seed customer for ticket tests.
  const custRepo = new CustomerRepository();
  await custRepo.create({
    id: 'cust-001', organizationId: orgId, name: 'SecPatch Customer',
    membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
    storedValueCiphertext: null, storedValueIv: null,
    allergiesCiphertext: null, allergiesIv: null,
    materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

function setForeignUser() {
  authService._currentUser = {
    id: 'foreign-001',
    role: ROLES.STORE_MANAGER,
    organizationNodeId: OTHER_ORG_ID,
  };
}

function setGuest() {
  authService._currentUser = {
    id: 'guest-001',
    role: ROLES.GUEST,
    organizationNodeId: orgId,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. CUSTOMER VERSION HISTORY — SCOPE ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe('Customer version history — cross-org access', () => {
  let customerId;

  beforeEach(async () => {
    const customer = await customerService.createCustomer({
      organizationId: orgId,
      name: 'Scoped Customer',
      actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });
    customerId = customer.id;
    await customerService.publishCustomerVersion({
      customerId, organizationId: orgId,
      reasonNote: 'Initial snapshot for scope test',
      actorId: adminUser.id,
    });
  });

  it('cross-org user cannot read version history', async () => {
    setForeignUser();
    await expect(
      customerService.getCustomerVersionHistory(customerId),
    ).rejects.toThrow(/scope violation/i);
  });

  it('cross-org user cannot read active version', async () => {
    setForeignUser();
    await expect(
      customerService.getActiveCustomerVersion(customerId),
    ).rejects.toThrow(/scope violation/i);
  });

  it('same-org user can read version history', async () => {
    authService._currentUser = {
      id: 'staff-same',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: orgId,
    };
    const history = await customerService.getCustomerVersionHistory(customerId);
    // createCustomer creates v1, publishCustomerVersion creates v2
    expect(history.length).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. TICKET BY CUSTOMER — FORGED ORG INPUT
// ══════════════════════════════════════════════════════════════════════════════

describe('Ticket getByCustomer — ignores caller-provided orgId', () => {
  let ticketId;

  beforeEach(async () => {
    const ticket = await ticketService.createTicket({
      customerId: 'cust-001',
      organizationId: orgId,
      storeId: orgId,
      subject: 'Forged org test',
      description: 'Testing forged orgId.',
      category: 'general',
      priority: 'low',
      actorId: adminUser.id,
    });
    ticketId = ticket.id;
  });

  it('cross-org user gets empty results even if they provide matching orgId', async () => {
    setForeignUser();
    // Caller passes orgId that matches the ticket — but scope is derived from data
    const tickets = await ticketService.getByCustomer('cust-001', orgId);
    expect(tickets.length).toBe(0);
  });

  it('same-org user gets tickets', async () => {
    authService._currentUser = {
      id: 'staff-same',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: orgId,
    };
    const tickets = await ticketService.getByCustomer('cust-001', orgId);
    expect(tickets.length).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. NOTIFICATION SUBSCRIBE — FOREIGN ORG BINDING
// ══════════════════════════════════════════════════════════════════════════════

describe('Notification subscribe — org scope', () => {
  it('user cannot subscribe to a foreign org', async () => {
    authService._currentUser = {
      id: 'staff-001',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: orgId,
    };
    await expect(
      notificationService.subscribe({
        userId: 'staff-001',
        channelId: null,
        eventType: 'order_status',
        organizationId: OTHER_ORG_ID,
      }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('user can subscribe to own org', async () => {
    authService._currentUser = {
      id: 'staff-001',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: orgId,
    };
    const sub = await notificationService.subscribe({
      userId: 'staff-001',
      channelId: null,
      eventType: 'order_status',
      organizationId: orgId,
    });
    expect(sub.organizationId).toBe(orgId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. NOTIFICATION ENQUEUE — CROSS-ORG INJECTION
// ══════════════════════════════════════════════════════════════════════════════

describe('Notification enqueue — cross-org injection', () => {
  it('non-admin cannot enqueue to foreign org', async () => {
    authService._currentUser = {
      id: 'staff-001',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: orgId,
    };

    // Get a template ID from the bootstrapped system templates
    const templates = await templateService.getByOrg(orgId);
    const templateId = templates[0]?.id;
    expect(templateId).toBeTruthy();

    await expect(
      notificationService.enqueue({
        organizationId: OTHER_ORG_ID,
        recipientUserId: 'victim-user',
        templateId,
        channelId: null,
        vars: { title: 'injected', body: 'payload' },
        eventSourceKey: 'inject:test:1',
      }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('valid enqueue within own org succeeds', async () => {
    const templates = await templateService.getByOrg(orgId);
    const templateId = templates[0]?.id;

    const item = await notificationService.enqueue({
      organizationId: orgId,
      recipientUserId: adminUser.id,
      templateId,
      channelId: null,
      vars: { title: 'valid', body: 'test' },
      eventSourceKey: 'valid:enqueue:1',
    });
    expect(item.organizationId).toBe(orgId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. TEMPLATE RENDERING — ORG ISOLATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Template rendering — org isolation', () => {
  it('cross-org user cannot render template from foreign org', async () => {
    const templates = await templateService.getByOrg(orgId);
    const templateId = templates[0]?.id;
    expect(templateId).toBeTruthy();

    setForeignUser();
    await expect(
      templateService.renderTemplate(templateId, { title: 'test', body: 'test' }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('same-org user can render template', async () => {
    const templates = await templateService.getByOrg(orgId);
    const templateId = templates[0]?.id;

    authService._currentUser = {
      id: 'staff-same',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: orgId,
    };
    const rendered = await templateService.renderTemplate(templateId, { title: 'hello', body: 'world' });
    expect(rendered).toContain('hello');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. RISK HEURISTICS — ORG-SCOPED DATA
// ══════════════════════════════════════════════════════════════════════════════

describe('Risk heuristics — org-scoped bid events', () => {
  it('bid events from other org do not contaminate heuristic results', async () => {
    // Ingest bid events with a FOREIGN organizationId for the same item
    await riskReviewService.ingestBidEvent({
      organizationId: OTHER_ORG_ID,
      userId: 'foreign-bidder',
      itemId: 'shared-item-001',
      bidAmount: 100,
      actorId: adminUser.id,
    });

    // Run heuristics scoped to OUR org — should see 0 events
    const result = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: orgId,
      itemId: 'shared-item-001',
    });
    // Not flagged because no events exist in OUR org for this item
    expect(result.flagged).toBe(false);
  });

  it('same-org bid events are included in heuristic analysis', async () => {
    // Ingest enough bid events in our org to exceed the frequency threshold
    for (let i = 0; i < 12; i++) {
      await riskReviewService.ingestBidEvent({
        organizationId: orgId,
        userId: `bidder-${i}`,
        itemId: 'hot-item-001',
        bidAmount: 50 + i,
        actorId: adminUser.id,
      });
    }

    const result = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: orgId,
      itemId: 'hot-item-001',
    });
    expect(result.flagged).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. ORG TREE READ — SCOPE ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe('Org tree — scope enforcement', () => {
  it('cross-org user cannot read org tree', async () => {
    setForeignUser();
    await expect(
      orgService.getTree(orgId),
    ).rejects.toThrow(/scope violation/i);
  });

  it('cross-org user cannot read subtree', async () => {
    setForeignUser();
    await expect(
      orgService.getSubtree(orgId),
    ).rejects.toThrow(/scope violation/i);
  });

  it('same-org user can read org tree', async () => {
    authService._currentUser = {
      id: 'staff-same',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: orgId,
    };
    const tree = await orgService.getTree(orgId);
    expect(tree.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. GUEST MODE — TRUE READ-ONLY
// ══════════════════════════════════════════════════════════════════════════════

describe('Guest mode — write operations rejected', () => {
  it('guest cannot subscribe', async () => {
    setGuest();
    await expect(
      notificationService.subscribe({
        userId: 'guest-001',
        channelId: null,
        eventType: 'order_status',
        organizationId: orgId,
      }),
    ).rejects.toThrow(/permission denied.*guest/i);
  });

  it('guest cannot enqueue', async () => {
    setGuest();
    const templates = await templateService.getByOrg(orgId);
    await expect(
      notificationService.enqueue({
        organizationId: orgId,
        recipientUserId: 'guest-001',
        templateId: templates[0]?.id ?? 'x',
        channelId: null,
        vars: { title: 't', body: 'b' },
        eventSourceKey: 'guest:test:1',
      }),
    ).rejects.toThrow(/permission denied.*guest/i);
  });

  it('guest cannot deleteSubscription', async () => {
    // Admin creates a subscription first
    const sub = await notificationService.subscribe({
      userId: adminUser.id,
      channelId: null,
      eventType: 'order_status',
      organizationId: orgId,
    });

    setGuest();
    await expect(
      notificationService.deleteSubscription(sub.id, 'guest-001'),
    ).rejects.toThrow(/permission denied.*guest/i);
  });

  it('guest can read own inbox', async () => {
    // Seed a notification for the guest
    await notificationService.notifyUser('guest-001', {
      title: 'Welcome', body: 'Hello guest.',
    });

    setGuest();
    const inbox = await notificationService.getInbox('guest-001');
    expect(inbox.length).toBe(1);
  });
});
