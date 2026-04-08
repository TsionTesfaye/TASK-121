/**
 * E2E Smoke Flow — single flow covering:
 *   1. Login as admin
 *   2. Navigate to messages → queue tab
 *   3. Requeue a draft
 *   4. Verify success
 *   5. Change column layout (save via service)
 *   6. Logout
 *   7. Login as different user
 *   8. Verify layout isolation (no layout from previous user)
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
import {
  setBroadcastService,
  closeAll,
} from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import {
  saveColumnLayout,
  restoreColumnLayouts,
  clearUserLayoutPreferences,
  tableColumnLayouts,
} from '../../src/app/stores/ui.js';
import { ROLES, QUEUE_STATUSES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'Smoke@1234567';
const USER_B_PASS = 'SmokeB@1234567';

let adminUser, userB, orgId;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'smoke_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'SmokeCo',
  });
  adminUser = result.admin;
  orgId = result.org.id;

  // Create user B
  await authService.login('smoke_admin', ADMIN_PASS);
  await authService.unlockProtectedData(ADMIN_PASS);
  userB = await authService.createUser({
    username: 'smoke_userb',
    password: USER_B_PASS,
    role: ROLES.STORE_MANAGER,
    organizationNodeId: orgId,
  });

  // Create a template with placeholder
  await templateService.createTemplate({
    organizationId: orgId,
    name: 'Smoke Template',
    body: 'Hi {name}, welcome!',
    isCompact: false,
    actorId: adminUser.id,
  });

  // Create channel
  await notificationService.upsertChannel({ organizationId: orgId, name: 'in-app' });

  // Reset for test flow
  cryptoService.clearSessionKey();
  authService._currentUser = null;
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  tableColumnLayouts.set({});
  closeDB();
  closeAll();
});

describe('E2E Smoke — login, requeue, layout, isolation', () => {
  it('full flow: login → requeue draft → change layout → logout → user B login → verify isolation', async () => {
    // ═══════════════════════════════════════════════════════════════
    // Step 1: Login as admin
    // ═══════════════════════════════════════════════════════════════
    const loginResult = await authService.login('smoke_admin', ADMIN_PASS);
    expect(loginResult).toBeTruthy();
    await authService.unlockProtectedData(ADMIN_PASS);
    expect(cryptoService.isUnlocked()).toBe(true);

    // ═══════════════════════════════════════════════════════════════
    // Step 2: Navigate to messages — create a Draft by enqueuing with missing vars
    // ═══════════════════════════════════════════════════════════════
    const templates = await templateService.getByOrg(orgId);
    const tpl = templates.find((t) => t.name === 'Smoke Template');
    expect(tpl).toBeTruthy();

    await notificationService.enqueue({
      organizationId: orgId,
      recipientUserId: adminUser.id,
      templateId: tpl.id,
      channelId: 'in-app',
      vars: {}, // missing {name}
      eventSourceKey: 'smoke-draft-1',
    });

    // Verify draft was created
    let queue = await notificationService.getQueueByOrg(orgId);
    expect(queue.length).toBe(1);
    expect(queue[0].status).toBe(QUEUE_STATUSES.DRAFT);
    expect(queue[0].failureReason).toMatch(/missing/i);

    // ═══════════════════════════════════════════════════════════════
    // Step 3: Requeue draft — through service (as UI handler calls it)
    // ═══════════════════════════════════════════════════════════════
    const requeued = await notificationService.requeueDraft(queue[0].id, { name: 'Alice' });
    expect(requeued.status).toBe(QUEUE_STATUSES.QUEUED);
    expect(requeued.renderedBody).toContain('Alice');
    expect(requeued.failureReason).toBeNull();

    // ═══════════════════════════════════════════════════════════════
    // Step 4: Verify success — queue shows Queued, not Draft
    // ═══════════════════════════════════════════════════════════════
    queue = await notificationService.getQueueByOrg(orgId);
    expect(queue[0].status).toBe(QUEUE_STATUSES.QUEUED);

    // ═══════════════════════════════════════════════════════════════
    // Step 5: Change layout — save column layout (as OrdersPage handler does)
    // ═══════════════════════════════════════════════════════════════
    restoreColumnLayouts(adminUser.id);
    saveColumnLayout('orders', ['id', 'status'], adminUser.id);
    saveColumnLayout('queue', ['status', 'recipientUserId'], adminUser.id);

    let layouts = get(tableColumnLayouts);
    expect(layouts['orders']).toEqual(['id', 'status']);
    expect(layouts['queue']).toEqual(['status', 'recipientUserId']);

    // ═══════════════════════════════════════════════════════════════
    // Step 6: Logout (as App.svelte handleLogout does)
    // ═══════════════════════════════════════════════════════════════
    const uid = authService.getCurrentUser()?.id;
    await authService.logout();
    // App.svelte clears layout prefs on logout to prevent cross-user leakage
    clearUserLayoutPreferences(uid);
    tableColumnLayouts.set({});

    // ═══════════════════════════════════════════════════════════════
    // Step 7: Login as user B
    // ═══════════════════════════════════════════════════════════════
    await authService.login('smoke_userb', USER_B_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

    // Restore B's layouts — should be empty
    restoreColumnLayouts(userB.id);
    layouts = get(tableColumnLayouts);

    // ═══════════════════════════════════════════════════════════════
    // Step 8: Verify layout isolation — user B has NO layout from user A
    // ═══════════════════════════════════════════════════════════════
    expect(layouts['orders']).toBeUndefined();
    expect(layouts['queue']).toBeUndefined();

    // ── Bonus: log back in as admin — layout was cleared on logout ──
    await authService.logout();
    tableColumnLayouts.set({});
    await authService.login('smoke_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
    restoreColumnLayouts(adminUser.id);
    layouts = get(tableColumnLayouts);
    // Layouts were cleared on logout, so should be empty
    expect(layouts['orders']).toBeUndefined();
    expect(layouts['queue']).toBeUndefined();
  });
});
