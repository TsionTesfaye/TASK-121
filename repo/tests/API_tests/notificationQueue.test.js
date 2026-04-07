/**
 * Integration tests — Notification queue send/retry/fail behavior.
 *
 * Covers:
 *   - successful enqueue and delivery
 *   - deduplication via idempotency keys
 *   - retry schedule: 1 min, 5 min, 15 min
 *   - after 3 retries → Failed status
 *   - compact template length check post-substitution
 *   - placeholder missing causes Draft item
 *   - direct system notifications via notifyUser
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { templateService } from '../../src/services/TemplateService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, QUEUE_STATUSES, RETRY_SCHEDULE_MINUTES, MAX_RETRIES } from '../../src/utils/constants.js';
import { MessageQueueRepository } from '../../src/repositories/implementations/NotificationRepository.js';

const ADMIN = { id: 'admin-001', role: ROLES.ADMINISTRATOR, organizationNodeId: 'org-001' };
const ORG_ID = 'org-001';

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = ADMIN;
});

afterEach(() => {
  authService._currentUser = null;
  closeDB();
  closeAll();
  vi.useRealTimers();
});

async function makeTemplate(body, isCompact = false) {
  return templateService.createTemplate({
    organizationId: ORG_ID,
    name: 'Test Template',
    body,
    isCompact,
    actorId: 'admin-001',
  });
}

async function makeChannel() {
  return notificationService.upsertChannel({
    organizationId: ORG_ID,
    name: 'In-App Channel',
  });
}

// ── Successful queue and delivery ─────────────────────────────────────────────

describe('Enqueue and deliver', () => {
  it('enqueues a message and delivers it', async () => {
    const template = await makeTemplate('Hello {name}!');
    const channel = await makeChannel();

    const item = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'user-001',
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Alice' },
      eventSourceKey: 'order:001:placed',
    });

    expect(item.status).toBe(QUEUE_STATUSES.QUEUED);
    expect(item.renderedBody).toBe('Hello Alice!');

    const result = await notificationService.processDueItems();
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('item status is SENT after successful delivery', async () => {
    const template = await makeTemplate('Your order {id} is ready.');
    const channel = await makeChannel();
    const queueRepo = new MessageQueueRepository();

    const item = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'user-001',
      templateId: template.id,
      channelId: channel.id,
      vars: { id: 'ORD-123' },
      eventSourceKey: 'order:123:ready',
    });

    await notificationService.processDueItems();

    const updated = await queueRepo.findById(item.id);
    expect(updated.status).toBe(QUEUE_STATUSES.SENT);
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe('Queue deduplication', () => {
  it('returns the existing item for duplicate eventSourceKey within same minute', async () => {
    const template = await makeTemplate('Hello {name}!');
    const channel = await makeChannel();

    const item1 = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'user-001',
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Alice' },
      eventSourceKey: 'order:999:placed',
    });

    const item2 = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'user-001',
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Alice' },
      eventSourceKey: 'order:999:placed', // same key
    });

    expect(item2.id).toBe(item1.id);
  });

  it('does NOT deduplicate failed items — allows re-queue', async () => {
    const template = await makeTemplate('Hello {name}!');
    const channel = await makeChannel();
    const queueRepo = new MessageQueueRepository();

    const item1 = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'user-001',
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Bob' },
      eventSourceKey: 'unique:failed:key',
    });

    // Manually mark as failed
    await queueRepo.update(item1.id, { ...item1, status: QUEUE_STATUSES.FAILED });

    // Re-enqueue with same key — should create new item
    const item2 = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'user-001',
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Bob' },
      eventSourceKey: 'unique:failed:key',
    });

    expect(item2.id).not.toBe(item1.id);
  });
});

// ── Retry behavior ────────────────────────────────────────────────────────────

describe('Retry scheduling', () => {
  it('after first delivery failure, schedules retry at 1 minute', async () => {
    const template = await makeTemplate('Hello {name}!');
    const channel = await makeChannel();
    const queueRepo = new MessageQueueRepository();

    const item = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'user-001',
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Charlie' },
      eventSourceKey: 'retry:test:1',
    });

    // Manually corrupt renderedBody to force delivery failure
    await queueRepo.update(item.id, { ...item, renderedBody: null });

    const beforeRetry = Date.now();
    await notificationService.processDueItems();

    const updated = await queueRepo.findById(item.id);
    expect(updated.retryCount).toBe(1);
    expect(updated.nextRetryAt).toBeGreaterThan(beforeRetry);
    // Should be ~1 minute out
    expect(updated.nextRetryAt).toBeGreaterThanOrEqual(beforeRetry + RETRY_SCHEDULE_MINUTES[0] * 60_000 - 100);
  });

  it('after second delivery failure, schedules retry at 5 minutes', async () => {
    const template = await makeTemplate('Hello {name}!');
    const channel = await makeChannel();
    const queueRepo = new MessageQueueRepository();

    const item = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'user-001',
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Dave' },
      eventSourceKey: 'retry:test:2',
    });

    // Seed retryCount=1 (simulates first retry already consumed)
    let current = { ...item, renderedBody: null, retryCount: 1, nextRetryAt: Date.now() - 1000 };
    await queueRepo.update(item.id, current);

    const beforeRetry = Date.now();
    await notificationService.processDueItems();

    current = await queueRepo.findById(item.id);
    expect(current.retryCount).toBe(2);
    expect(current.nextRetryAt).toBeGreaterThanOrEqual(beforeRetry + RETRY_SCHEDULE_MINUTES[1] * 60_000 - 100);
  });

  it('after third delivery failure, schedules retry at 15 minutes', async () => {
    const template = await makeTemplate('Hello {name}!');
    const channel = await makeChannel();
    const queueRepo = new MessageQueueRepository();

    const item = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'user-001',
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Eve' },
      eventSourceKey: 'retry:test:3',
    });

    // Seed retryCount=2 (simulates first two retries already consumed)
    let current = { ...item, renderedBody: null, retryCount: 2, nextRetryAt: Date.now() - 1000 };
    await queueRepo.update(item.id, current);

    const beforeRetry = Date.now();
    await notificationService.processDueItems();

    current = await queueRepo.findById(item.id);
    expect(current.retryCount).toBe(3);
    expect(current.nextRetryAt).toBeGreaterThanOrEqual(beforeRetry + RETRY_SCHEDULE_MINUTES[2] * 60_000 - 100);
    // Must NOT be failed yet — the 3rd retry was just scheduled
    expect(current.status).not.toBe('Failed');
  });

  it('after all retries exhausted (MAX_RETRIES + 1 failures), status becomes FAILED', async () => {
    const template = await makeTemplate('Hello {name}!');
    const channel = await makeChannel();
    const queueRepo = new MessageQueueRepository();

    const item = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'user-001',
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Dave' },
      eventSourceKey: 'retry:test:fail',
    });

    // Corrupt body and simulate MAX_RETRIES + 1 delivery failures:
    // failures 1–3 schedule retries at +1, +5, +15 min; failure 4 → FAILED.
    let current = { ...item, renderedBody: null, nextRetryAt: Date.now() };
    await queueRepo.update(item.id, current);

    for (let i = 0; i < MAX_RETRIES + 1; i++) {
      // Make item due
      await queueRepo.update(item.id, { ...current, nextRetryAt: Date.now() - 1000, renderedBody: null });
      await notificationService.processDueItems();
      current = await queueRepo.findById(item.id);
    }

    expect(current.status).toBe(QUEUE_STATUSES.FAILED);
  });
});

// ── Template rendering failures create Draft items ────────────────────────────

describe('Template rendering failure → Draft item', () => {
  it('creates a Draft item when required placeholder is missing', async () => {
    const template = await makeTemplate('Hello {name} — order {missingField}!');
    const channel = await makeChannel();

    const item = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'user-001',
      templateId: template.id,
      channelId: channel.id,
      vars: { name: 'Eve' }, // missingField not provided
      eventSourceKey: 'draft:test:1',
    });

    expect(item.status).toBe(QUEUE_STATUSES.DRAFT);
    expect(item.renderedBody).toBeNull();
    expect(item.failureReason).toContain('missingField');
  });
});

// ── Compact template enforcement ──────────────────────────────────────────────

describe('Compact template enforcement', () => {
  it('enqueue fails when compact template exceeds 160 chars after substitution', async () => {
    const template = await makeTemplate('Hi {name}!', true /* isCompact */);
    const channel = await makeChannel();

    // Provide a name that makes the message exceed 160 chars
    await expect(
      notificationService.enqueue({
        organizationId: ORG_ID,
        recipientUserId: 'user-001',
        templateId: template.id,
        channelId: channel.id,
        vars: { name: 'A'.repeat(200) },
        eventSourceKey: 'compact:overflow:1',
      }),
    ).rejects.toThrow();
  });
});

// ── Direct system notification ────────────────────────────────────────────────

describe('notifyUser direct notification', () => {
  it('creates an in-app notification for a user', async () => {
    const notif = await notificationService.notifyUser('user-001', {
      type: 'order_status',
      title: 'Order ready',
      body: 'Your order is ready for pickup.',
    });

    expect(notif.userId).toBe('user-001');
    expect(notif.read).toBe(false);
    expect(notif.title).toBe('Order ready');
  });

  it('inbox contains the notification', async () => {
    authService._currentUser = { id: 'user-001', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_ID };

    await notificationService.notifyUser('user-001', {
      title: 'Test',
      body: 'Body',
    });

    const inbox = await notificationService.getInbox('user-001');
    expect(inbox.length).toBe(1);
    expect(inbox[0].read).toBe(false);
  });

  it('markRead marks the notification as read', async () => {
    authService._currentUser = { id: 'user-002', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_ID };

    const notif = await notificationService.notifyUser('user-002', {
      title: 'Test',
      body: 'Body',
    });

    await notificationService.markRead(notif.id);

    // Re-fetch inbox
    const inbox = await notificationService.getInbox('user-002');
    const found = inbox.find((n) => n.id === notif.id);
    expect(found.read).toBe(true);
  });
});
