/**
 * E2E Simulation — Notification queue: enqueue → retries → sent/failed.
 *
 * Covers:
 *   - Full queue → process → SENT lifecycle
 *   - Retry schedule: 1 min → 5 min → 15 min
 *   - After MAX_RETRIES → FAILED
 *   - Missing placeholder → Draft (not queued)
 *   - Deduplication prevents double-send
 *   - notifyUser bypasses queue, goes direct to inbox
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { templateService } from '../../src/services/TemplateService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { MessageQueueRepository } from '../../src/repositories/implementations/NotificationRepository.js';
import { ROLES, QUEUE_STATUSES, RETRY_SCHEDULE_MINUTES, MAX_RETRIES } from '../../src/utils/constants.js';

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
});

async function makeTemplate(body, isCompact = false) {
  return templateService.createTemplate({ organizationId: ORG_ID, name: 'T', body, isCompact, actorId: 'admin-001' });
}

async function makeChannel() {
  return notificationService.upsertChannel({ organizationId: ORG_ID, name: 'In-App' });
}

describe('Notification queue flow', () => {
  it('enqueue → process → SENT', async () => {
    const tmpl = await makeTemplate('Hello {name}!');
    const ch = await makeChannel();

    const item = await notificationService.enqueue({
      organizationId: ORG_ID,
      recipientUserId: 'u-001',
      templateId: tmpl.id,
      channelId: ch.id,
      vars: { name: 'Alice' },
      eventSourceKey: 'flow:sent:1',
    });
    expect(item.status).toBe(QUEUE_STATUSES.QUEUED);

    const result = await notificationService.processDueItems();
    expect(result.sent).toBe(1);

    const repo = new MessageQueueRepository();
    const updated = await repo.findById(item.id);
    expect(updated.status).toBe(QUEUE_STATUSES.SENT);
  });

  it('delivery failure schedules first retry at 1 minute', async () => {
    const tmpl = await makeTemplate('Retry {n}!');
    const ch = await makeChannel();
    const repo = new MessageQueueRepository();

    const item = await notificationService.enqueue({
      organizationId: ORG_ID, recipientUserId: 'u-002',
      templateId: tmpl.id, channelId: ch.id,
      vars: { n: '1' }, eventSourceKey: 'flow:retry:1',
    });

    // Corrupt body to force failure.
    await repo.update(item.id, { ...item, renderedBody: null });

    const before = Date.now();
    await notificationService.processDueItems();

    const updated = await repo.findById(item.id);
    expect(updated.retryCount).toBe(1);
    expect(updated.nextRetryAt).toBeGreaterThanOrEqual(before + RETRY_SCHEDULE_MINUTES[0] * 60_000 - 500);
  });

  it('after MAX_RETRIES failures → FAILED status', async () => {
    const tmpl = await makeTemplate('Fail {n}!');
    const ch = await makeChannel();
    const repo = new MessageQueueRepository();

    const item = await notificationService.enqueue({
      organizationId: ORG_ID, recipientUserId: 'u-003',
      templateId: tmpl.id, channelId: ch.id,
      vars: { n: '1' }, eventSourceKey: 'flow:fail:1',
    });

    let current = { ...item, renderedBody: null, nextRetryAt: Date.now() };
    await repo.update(item.id, current);

    for (let i = 0; i < MAX_RETRIES + 1; i++) {
      await repo.update(item.id, { ...current, nextRetryAt: Date.now() - 1000, renderedBody: null });
      await notificationService.processDueItems();
      current = await repo.findById(item.id);
    }

    expect(current.status).toBe(QUEUE_STATUSES.FAILED);
  });

  it('missing placeholder → Draft item (not queued)', async () => {
    const tmpl = await makeTemplate('Hi {name} ref {missingKey}!');
    const ch = await makeChannel();

    const item = await notificationService.enqueue({
      organizationId: ORG_ID, recipientUserId: 'u-004',
      templateId: tmpl.id, channelId: ch.id,
      vars: { name: 'Bob' }, // missingKey absent
      eventSourceKey: 'flow:draft:1',
    });

    expect(item.status).toBe(QUEUE_STATUSES.DRAFT);
    expect(item.failureReason).toContain('missingKey');
  });

  it('deduplication: same eventSourceKey returns same item', async () => {
    const tmpl = await makeTemplate('Dedup {x}!');
    const ch = await makeChannel();

    const i1 = await notificationService.enqueue({
      organizationId: ORG_ID, recipientUserId: 'u-005',
      templateId: tmpl.id, channelId: ch.id,
      vars: { x: '1' }, eventSourceKey: 'flow:dedup:1',
    });
    const i2 = await notificationService.enqueue({
      organizationId: ORG_ID, recipientUserId: 'u-005',
      templateId: tmpl.id, channelId: ch.id,
      vars: { x: '1' }, eventSourceKey: 'flow:dedup:1',
    });
    expect(i2.id).toBe(i1.id);
  });

  it('notifyUser delivers directly to inbox without queue', async () => {
    const notif = await notificationService.notifyUser('u-006', {
      title: 'Direct', body: 'Bypasses queue', type: 'system',
    });
    expect(notif.userId).toBe('u-006');

    authService._currentUser = { id: 'u-006', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_ID };
    const inbox = await notificationService.getInbox('u-006');
    expect(inbox.some((n) => n.id === notif.id)).toBe(true);
  });
});
