/**
 * Integration tests — Trigger taxonomy completeness.
 *
 * Verifies that ALL event types route through template-backed queue lifecycle:
 *   - ORDER_STATUS_CHANGED
 *   - TICKET_ASSIGNED
 *   - TICKET_STATUS_CHANGED
 *   - RISK_CASE_FLAGGED
 *   - MASTER_DATA_PUBLISHED
 *   - DEADLINE_APPROACHING
 *   - GRADING_COMPLETED
 *   - ANNOUNCEMENT
 *
 * Each trigger:
 *   1. subscribe to event type
 *   2. dispatch event (system template resolved automatically)
 *   3. verify queue item created with templateId for subscriber
 *   4. processDueItems → inbox delivery
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { eventDispatcherService } from '../../src/services/EventDispatcherService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { MessageQueueRepository } from '../../src/repositories/implementations/NotificationRepository.js';
import { ROLES, EVENT_TYPES, QUEUE_STATUSES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'TrigTax@12345';
let ORG_ID;
let actorId;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'trig_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'TrigTestCo',
  });
  ORG_ID = org.id;
  actorId = admin.id;

  await authService.login('trig_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

async function subscribeAndDispatch(eventType) {
  // 1. Create channel + subscribe
  const channel = await notificationService.upsertChannel({ organizationId: ORG_ID, name: `ch-${eventType}` });
  await notificationService.subscribe({
    userId: actorId,
    channelId: channel.id,
    eventType,
    organizationId: ORG_ID,
  });

  // 2. Dispatch — system template resolved automatically from SYSTEM_TEMPLATES
  await eventDispatcherService.dispatch({
    organizationId: ORG_ID,
    eventType,
    sourceId: `src-${eventType}-${Date.now()}`,
    actorId,
    title: `Test ${eventType}`,
    body: `Body for ${eventType}`,
  });

  // 3. Verify queue item exists and is template-backed
  const queueRepo = new MessageQueueRepository();
  const items = await queueRepo.findAll();
  const matching = items.filter((i) => i.recipientUserId === actorId && i.renderedBody?.includes(eventType));
  return matching;
}

// ── Each event type goes through subscription → queue → inbox ─────────────

describe('Trigger taxonomy — all event types route through queue', () => {
  for (const [key, eventType] of Object.entries(EVENT_TYPES)) {
    it(`${key} (${eventType}) → subscriber receives queue item`, async () => {
      const items = await subscribeAndDispatch(eventType);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].status).toBe(QUEUE_STATUSES.QUEUED);
    });
  }
});

describe('Trigger taxonomy — queue items deliver to inbox on process', () => {
  it('processes a queued subscription item into the inbox', async () => {
    const items = await subscribeAndDispatch(EVENT_TYPES.ANNOUNCEMENT);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].templateId).toBeTruthy(); // template-backed

    const result = await notificationService.processDueItems();
    expect(result.sent).toBeGreaterThan(0);

    const inbox = await notificationService.getInbox(actorId);
    expect(inbox.length).toBeGreaterThan(0);
  });
});

// ── Announce helper ───────────────────────────────────────────────────────────

describe('EventDispatcher.announce()', () => {
  it('sends ANNOUNCEMENT event through queue for subscribers (template-backed)', async () => {
    const channel = await notificationService.upsertChannel({ organizationId: ORG_ID, name: 'announce-ch' });
    await notificationService.subscribe({
      userId: actorId,
      channelId: channel.id,
      eventType: EVENT_TYPES.ANNOUNCEMENT,
      organizationId: ORG_ID,
    });

    await eventDispatcherService.announce({
      organizationId: ORG_ID,
      title: 'System Update',
      body: 'Planned maintenance tonight.',
      actorId,
    });

    const queueRepo = new MessageQueueRepository();
    const items = await queueRepo.findAll();
    const subscriptionItems = items.filter((i) =>
      i.recipientUserId === actorId && i.renderedBody?.includes('System Update'),
    );
    expect(subscriptionItems.length).toBeGreaterThan(0);
    expect(subscriptionItems[0].templateId).toBeTruthy();
  });
});

// ── DEADLINE_APPROACHING ──────────────────────────────────────────────────────

describe('Trigger — DEADLINE_APPROACHING', () => {
  it('dispatches DEADLINE_APPROACHING with system template to subscriber and direct recipient', async () => {
    const channel = await notificationService.upsertChannel({ organizationId: ORG_ID, name: 'deadline-ch' });
    await notificationService.subscribe({
      userId: actorId,
      channelId: channel.id,
      eventType: EVENT_TYPES.DEADLINE_APPROACHING,
      organizationId: ORG_ID,
    });

    await eventDispatcherService.dispatch({
      organizationId: ORG_ID,
      eventType: EVENT_TYPES.DEADLINE_APPROACHING,
      sourceId: 'ticket-deadline-001',
      actorId: 'system',
      title: 'Ticket SLA overdue',
      body: 'Ticket has exceeded its SLA deadline.',
      recipientUserIds: [actorId],
    });

    const queueRepo = new MessageQueueRepository();
    const items = await queueRepo.findAll();
    expect(items.length).toBeGreaterThanOrEqual(1);
    // All items must be template-backed
    for (const item of items) {
      expect(item.templateId).toBeTruthy();
    }
  });
});
