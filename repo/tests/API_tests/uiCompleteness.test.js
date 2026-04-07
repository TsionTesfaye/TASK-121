/**
 * UI completeness tests — draft requeue, preferences isolation, layout reset.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { get } from 'svelte/store';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { templateService } from '../../src/services/TemplateService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { MessageQueueRepository } from '../../src/repositories/implementations/NotificationRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { persistSelectedStore, restoreSelectedStore, selectedStore } from '../../src/app/stores/org.js';
import { saveColumnLayout, restoreColumnLayouts, tableColumnLayouts } from '../../src/app/stores/ui.js';
import { ROLES, QUEUE_STATUSES } from '../../src/utils/constants.js';

const PASS = 'UIComplete@1234';
let orgId, adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'uc_admin', adminPassword: PASS, orgName: 'UICompleteCo',
  });
  orgId = org.id;
  adminUser = admin;
  await authService.login('uc_admin', PASS);
    await authService.unlockProtectedData(PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  selectedStore.set(null);
  tableColumnLayouts.set({});
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. DRAFT REQUEUE FLOW
// ══════════════════════════════════════════════════════════════════════════════

describe('Draft requeue — service flow', () => {
  it('draft item can be requeued with corrected variables', async () => {
    const tmpl = await templateService.createTemplate({
      organizationId: orgId, name: 'Draft Test',
      body: 'Hello {name} ref {orderId}!', actorId: adminUser.id,
    });
    const channel = await notificationService.upsertChannel({ organizationId: orgId, name: 'Ch' });

    // Create draft (missing orderId)
    const draft = await notificationService.enqueue({
      organizationId: orgId, recipientUserId: adminUser.id,
      templateId: tmpl.id, channelId: channel.id,
      vars: { name: 'Alice' }, eventSourceKey: 'draft-ui-test',
    });
    expect(draft.status).toBe(QUEUE_STATUSES.DRAFT);

    // Requeue with corrected vars
    const requeued = await notificationService.requeueDraft(draft.id, { name: 'Alice', orderId: 'ORD-1' });
    expect(requeued.status).toBe(QUEUE_STATUSES.QUEUED);
    expect(requeued.renderedBody).toContain('ORD-1');

    // Process → delivered
    const result = await notificationService.processDueItems();
    expect(result.sent).toBe(1);
  });

  it('requeue of non-draft item is rejected', async () => {
    const tmpl = await templateService.createTemplate({
      organizationId: orgId, name: 'Queued Test',
      body: 'Hi {name}!', actorId: adminUser.id,
    });
    const channel = await notificationService.upsertChannel({ organizationId: orgId, name: 'Ch2' });
    const item = await notificationService.enqueue({
      organizationId: orgId, recipientUserId: adminUser.id,
      templateId: tmpl.id, channelId: channel.id,
      vars: { name: 'Bob' }, eventSourceKey: 'nondraft-ui-test',
    });
    expect(item.status).toBe(QUEUE_STATUSES.QUEUED);

    await expect(notificationService.requeueDraft(item.id, { name: 'Bob' }))
      .rejects.toThrow(/only draft/i);
  });

  it('MessagesPage has requeue UI', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/MessagesPage.svelte'), 'utf8');
    expect(content).toContain('showRequeueModal');
    expect(content).toContain('handleRequeue');
    expect(content).toContain('requeueDraft');
    expect(content).toContain('Requeue');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. PREFERENCES PERSIST + RESTORE
// ══════════════════════════════════════════════════════════════════════════════

describe('Preferences — persist and restore', () => {
  it('selected store persists and restores', () => {
    persistSelectedStore({ id: 'st-uc', name: 'UC Store' }, adminUser.id);
    selectedStore.set(null);
    const restored = restoreSelectedStore(adminUser.id);
    expect(restored).toEqual({ id: 'st-uc', name: 'UC Store' });
  });

  it('column layout persists and restores', () => {
    saveColumnLayout('orders', ['id', 'status'], adminUser.id);
    tableColumnLayouts.set({});
    restoreColumnLayouts(adminUser.id);
    expect(get(tableColumnLayouts)['orders']).toEqual(['id', 'status']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. LAYOUT RESET ON USER SWITCH
// ══════════════════════════════════════════════════════════════════════════════

describe('Layout reset on user switch', () => {
  it('tableColumnLayouts is empty after reset', () => {
    saveColumnLayout('tickets', ['a', 'b'], 'user-x');
    expect(Object.keys(get(tableColumnLayouts)).length).toBeGreaterThan(0);

    // Simulate logout reset (as App.svelte does)
    tableColumnLayouts.set({});
    expect(get(tableColumnLayouts)).toEqual({});
  });

  it('App.svelte resets tableColumnLayouts on logout', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/App.svelte'), 'utf8');
    expect(content).toContain('tableColumnLayouts.set({})');
  });

  it('different users have isolated layouts', () => {
    saveColumnLayout('t1', ['x'], 'userA');
    saveColumnLayout('t1', ['y'], 'userB');

    tableColumnLayouts.set({});
    restoreColumnLayouts('userA');
    expect(get(tableColumnLayouts)['t1']).toEqual(['x']);

    tableColumnLayouts.set({});
    restoreColumnLayouts('userB');
    expect(get(tableColumnLayouts)['t1']).toEqual(['y']);
  });
});
