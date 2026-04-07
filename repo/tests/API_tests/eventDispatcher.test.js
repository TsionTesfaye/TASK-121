/**
 * Integration tests — EventDispatcherService routing.
 *
 * All delivery paths are template-backed and go through the message queue.
 * The dispatcher resolves system templates from SYSTEM_TEMPLATES for each event type.
 * Direct recipients (recipientUserIds) receive queue items that are processed by
 * processDueItems(); subscription-based recipients likewise receive queue items.
 *
 * Covers:
 *   - dispatch with recipientUserIds → template-rendered queue item → inbox
 *   - dispatch to subscriber → queue item created with template
 *   - dispatch with no subscribers → no queue items added for subscription path
 *   - non-fatal: dispatch never throws even if enqueue fails
 *   - org-scoped subscription: cross-org subscribers do not receive events
 *   - body-only enqueue rejected (templateId required)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { templateService } from '../../src/services/TemplateService.js';
import { eventDispatcherService } from '../../src/services/EventDispatcherService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, EVENT_TYPES, QUEUE_STATUSES } from '../../src/utils/constants.js';
import { MessageQueueRepository } from '../../src/repositories/implementations/NotificationRepository.js';

const ADMIN_PASS = 'EvtDisp@12345';
let ORG_ID;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  // Bootstrap seeds system templates for every EVENT_TYPE.
  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'evt_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'EvtDispCo',
  });
  ORG_ID = org.id;

  await authService.login('evt_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
  vi.restoreAllMocks();
});

// ── Direct recipient delivery (queue path) ───────────────────────────────────
// The direct path now uses enqueue() — notifications are processed via processDueItems()
// before they appear in the inbox.

describe('EventDispatcher — direct recipient delivery (queue-driven)', () => {
  it('dispatches notification to explicit recipientUserId via queue (template-backed)', async () => {
    const actorId = authService._currentUser.id;
    await eventDispatcherService.dispatch({
      organizationId: ORG_ID,
      eventType: EVENT_TYPES.ORDER_STATUS_CHANGED,
      sourceId: 'order-001',
      actorId,
      title: 'Order ready',
      body: 'Your order is ready for pickup.',
      recipientUserIds: [actorId],
    });

    // Queue item must exist and be template-backed
    const queueRepo = new MessageQueueRepository();
    const items = await queueRepo.findAll();
    const item = items.find((i) => i.recipientUserId === actorId);
    expect(item).toBeTruthy();
    expect(item.templateId).toBeTruthy(); // template-backed, not body-only

    // Process queue → notification appears in inbox
    await notificationService.processDueItems();
    const inbox = await notificationService.getInbox(actorId);
    expect(inbox.length).toBeGreaterThan(0);
  });

  it('dispatches to multiple recipients via queue', async () => {
    const actorId = authService._currentUser.id;
    await eventDispatcherService.dispatch({
      organizationId: ORG_ID,
      eventType: EVENT_TYPES.ORDER_STATUS_CHANGED,
      sourceId: 'order-multi',
      actorId,
      title: 'Multi Dispatch',
      body: 'Sent to two users.',
      recipientUserIds: [actorId, 'user-002'],
    });

    await notificationService.processDueItems();

    // Admin received it
    const adminInbox = await notificationService.getInbox(actorId);
    expect(adminInbox.length).toBeGreaterThan(0);

    // user-002 received it
    authService._currentUser = { id: 'user-002', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_ID };
    const userInbox = await notificationService.getInbox('user-002');
    expect(userInbox.length).toBeGreaterThan(0);
  });

  it('dispatch is non-fatal even if enqueue throws', async () => {
    vi.spyOn(notificationService, 'enqueue').mockRejectedValue(new Error('DB error'));

    // Should not throw
    await expect(
      eventDispatcherService.dispatch({
        organizationId: ORG_ID,
        eventType: EVENT_TYPES.ORDER_STATUS_CHANGED,
        sourceId: 'order-002',
        actorId: 'admin-001',
        title: 'Test',
        body: 'Test body.',
        recipientUserIds: ['admin-001'],
      }),
    ).resolves.toBeUndefined();
  });
});

// ── Subscription-based delivery ───────────────────────────────────────────────

describe('EventDispatcher — subscription → queue delivery', () => {
  it('enqueues a templated message for a subscriber (explicit templateId)', async () => {
    const actorId = authService._currentUser.id;
    const template = await templateService.createTemplate({
      organizationId: ORG_ID,
      name: 'Order Status Custom',
      body: 'Order {orderId} is now {status}.',
      isCompact: false,
      actorId,
    });

    const channel = await notificationService.upsertChannel({
      organizationId: ORG_ID,
      name: 'In-App',
    });

    await notificationService.subscribe({
      userId: actorId,
      channelId: channel.id,
      eventType: EVENT_TYPES.ORDER_STATUS_CHANGED,
      organizationId: ORG_ID,
    });

    await eventDispatcherService.dispatch({
      organizationId: ORG_ID,
      eventType: EVENT_TYPES.ORDER_STATUS_CHANGED,
      sourceId: 'order-sub-001',
      actorId,
      templateId: template.id,
      vars: { orderId: 'order-sub-001', status: 'ready' },
    });

    const queueRepo = new MessageQueueRepository();
    const allItems = await queueRepo.findAll();
    const queued = allItems.filter((i) => i.recipientUserId === actorId);
    expect(queued.length).toBeGreaterThan(0);
    expect(queued[0].renderedBody).toContain('order-sub-001');
    expect(queued[0].renderedBody).toContain('ready');
  });

  it('no queue items created when no subscribers exist and no direct recipients', async () => {
    const actorId = authService._currentUser.id;

    await eventDispatcherService.dispatch({
      organizationId: ORG_ID,
      eventType: EVENT_TYPES.RISK_CASE_FLAGGED,
      sourceId: 'case-001',
      actorId,
      title: 'Risk flagged',
      body: 'Case 001.',
    });

    const queueRepo = new MessageQueueRepository();
    const allItems = await queueRepo.findAll();
    expect(allItems.length).toBe(0);
  });

  it('subscriber in a different org does NOT receive the event (org-scope enforcement)', async () => {
    const actorId = authService._currentUser.id;
    const OTHER_ORG = 'org-other-999';
    // Subscribe user to ORDER_STATUS_CHANGED in a DIFFERENT org
    await notificationService.subscribe({
      userId: actorId,
      channelId: null,
      eventType: EVENT_TYPES.ORDER_STATUS_CHANGED,
      organizationId: OTHER_ORG,
    });

    // Dispatch the event for ORG_ID (not OTHER_ORG)
    await eventDispatcherService.dispatch({
      organizationId: ORG_ID,
      eventType: EVENT_TYPES.ORDER_STATUS_CHANGED,
      sourceId: 'order-cross',
      actorId,
      title: 'Cross-org event',
      body: 'Should not arrive.',
    });

    // Subscription-based queue items must not be created for the other org's subscriber
    const queueRepo = new MessageQueueRepository();
    const items = await queueRepo.findAll();
    expect(items.length).toBe(0);
  });

  it('dispatch without explicit templateId resolves system template and enqueues', async () => {
    const actorId = authService._currentUser.id;
    const channel = await notificationService.upsertChannel({ organizationId: ORG_ID, name: 'In-App' });
    await notificationService.subscribe({
      userId: actorId,
      channelId: channel.id,
      eventType: EVENT_TYPES.TICKET_ASSIGNED,
      organizationId: ORG_ID,
    });

    await eventDispatcherService.dispatch({
      organizationId: ORG_ID,
      eventType: EVENT_TYPES.TICKET_ASSIGNED,
      sourceId: 'ticket-resolved',
      actorId,
      title: 'Ticket assigned to you',
      body: 'Ticket #X has been assigned.',
      // No templateId — dispatcher resolves system template automatically
    });

    const queueRepo = new MessageQueueRepository();
    const items = await queueRepo.findAll();
    const forUser = items.filter((i) => i.recipientUserId === actorId);
    expect(forUser.length).toBeGreaterThan(0);
    expect(forUser[0].templateId).toBeTruthy(); // template-backed
    expect(forUser[0].renderedBody).toContain('Ticket assigned to you');
  });

  it('enqueue rejects body-only without templateId', async () => {
    await expect(
      notificationService.enqueue({
        organizationId: ORG_ID,
        recipientUserId: authService._currentUser.id,
        channelId: null,
        vars: {},
        eventSourceKey: 'reject-body-only',
      }),
    ).rejects.toThrow(/templateId is required/i);
  });
});

// ── Subscription management ───────────────────────────────────────────────────

describe('NotificationService — subscription management', () => {
  it('getSubscriptionsByEventType returns matching subscriptions', async () => {
    const actorId = authService._currentUser.id;
    const channel = await notificationService.upsertChannel({ organizationId: ORG_ID, name: 'Ch1' });
    await notificationService.subscribe({ userId: actorId, channelId: channel.id, eventType: EVENT_TYPES.TICKET_ASSIGNED, organizationId: ORG_ID });
    await notificationService.subscribe({ userId: actorId, channelId: channel.id, eventType: EVENT_TYPES.ORDER_STATUS_CHANGED, organizationId: ORG_ID });

    const subs = await notificationService.getSubscriptionsByEventType(EVENT_TYPES.TICKET_ASSIGNED);
    expect(subs.length).toBe(1);
    expect(subs[0].eventType).toBe(EVENT_TYPES.TICKET_ASSIGNED);
  });

  it('getSubscriptions returns all subscriptions for a user', async () => {
    const actorId = authService._currentUser.id;
    const channel = await notificationService.upsertChannel({ organizationId: ORG_ID, name: 'Ch2' });
    await notificationService.subscribe({ userId: actorId, channelId: channel.id, eventType: EVENT_TYPES.TICKET_ASSIGNED, organizationId: ORG_ID });
    await notificationService.subscribe({ userId: actorId, channelId: channel.id, eventType: EVENT_TYPES.ORDER_STATUS_CHANGED, organizationId: ORG_ID });

    const subs = await notificationService.getSubscriptions(actorId);
    expect(subs.length).toBe(2);
  });

  it('deleteSubscription removes subscription', async () => {
    const actorId = authService._currentUser.id;
    const channel = await notificationService.upsertChannel({ organizationId: ORG_ID, name: 'Ch3' });
    const sub = await notificationService.subscribe({ userId: actorId, channelId: channel.id, eventType: EVENT_TYPES.TICKET_ASSIGNED, organizationId: ORG_ID });

    await notificationService.deleteSubscription(sub.id, actorId);

    const remaining = await notificationService.getSubscriptions(actorId);
    expect(remaining.find((s) => s.id === sub.id)).toBeUndefined();
  });

  it('deleteSubscription throws for unknown subscription', async () => {
    await expect(
      notificationService.deleteSubscription('nonexistent-id', authService._currentUser.id),
    ).rejects.toThrow('not found');
  });

  it('non-admin cannot subscribe for another user', async () => {
    authService._currentUser = { id: 'staff-001', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_ID };
    await expect(
      notificationService.subscribe({
        userId: 'other-user',
        channelId: null,
        eventType: EVENT_TYPES.TICKET_ASSIGNED,
        organizationId: ORG_ID,
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('non-admin cannot view another user\'s subscriptions', async () => {
    authService._currentUser = { id: 'staff-001', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_ID };
    await expect(
      notificationService.getSubscriptions('other-user'),
    ).rejects.toThrow(/permission denied/i);
  });
});
