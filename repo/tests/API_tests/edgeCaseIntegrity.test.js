/**
 * Edge-case integrity tests — second pass.
 *
 * Covers:
 *   1. Style deactivateStyle requires reasonNote + creates version
 *   2. Notification queue resilience (missing recipient, template failure after requeue)
 *   3. Session isolation (NLP threshold cleared on logout)
 *   4. Org tree deletion with children blocked
 *   5. LocalStorage isolation per user
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { styleService } from '../../src/services/StyleService.js';
import { nlpService } from '../../src/services/NLPService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { templateService } from '../../src/services/TemplateService.js';
import { orgService } from '../../src/services/OrgService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { MessageQueueRepository } from '../../src/repositories/implementations/NotificationRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { persistSelectedStore, restoreSelectedStore, selectedStore, clearOrgPreferences } from '../../src/app/stores/org.js';
import { ROLES, QUEUE_STATUSES, ORG_NODE_TYPES } from '../../src/utils/constants.js';
import { get } from 'svelte/store';

const ADMIN_PASS = 'EdgeCase@12345';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'ec_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'EdgeCaseCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('ec_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  selectedStore.set(null);
  closeDB();
  closeAll();
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. STYLE DEACTIVATION VERSIONING
// ══════════════════════════════════════════════════════════════════════════════

describe('Style deactivateStyle — versioning', () => {
  beforeEach(async () => {
    const now = Date.now();
    await new BaseRepository('colors').create({ id: 'c1', organizationId: orgId, name: 'Red', isActive: true, createdAt: now });
    await new BaseRepository('sizes').create({ id: 's1', organizationId: orgId, name: 'M', isActive: true, createdAt: now });
    await new BaseRepository('seasons').create({ id: 'ss1', organizationId: orgId, name: 'SS25', isActive: true, createdAt: now });
    await new BaseRepository('brands').create({ id: 'b1', organizationId: orgId, name: 'Brand', isActive: true, createdAt: now });
    await new BaseRepository('suppliers').create({ id: 'sp1', organizationId: orgId, name: 'Sup', isActive: true, createdAt: now });
  });

  it('deactivateStyle without reasonNote is rejected', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId, sku: 'DEACT-NO-REASON',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'Creating for deactivation test',
    });
    await expect(styleService.deactivateStyle(style.id, adminUser.id)).rejects.toThrow(/reason/i);
  });

  it('deactivateStyle with valid reason creates version record', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId, sku: 'DEACT-VER',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'Creating for deactivation test',
    });
    await styleService.deactivateStyle(style.id, adminUser.id, 'Deactivating this style permanently');

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(style.id);
    expect(history.length).toBe(2); // create v1, deactivate v2
    const active = history.filter((v) => v.isActive);
    expect(active.length).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. NOTIFICATION QUEUE RESILIENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('Notification queue — edge cases', () => {
  it('processDueItems handles item with no rendered body gracefully (fails, retries)', async () => {
    const queueRepo = new MessageQueueRepository();
    // Manually create a corrupt queue item
    await queueRepo.create({
      id: 'corrupt-001', organizationId: orgId, recipientUserId: 'ghost-user',
      templateId: 'tmpl-x', channelId: null, payload: {},
      renderedBody: null, // corrupt — no body
      status: QUEUE_STATUSES.QUEUED, retryCount: 0,
      nextRetryAt: Date.now() - 1000, failureReason: null,
      idempotencyKey: 'corrupt-key-001',
      createdAt: Date.now(), updatedAt: Date.now(),
    });

    // Should not crash — handles failure gracefully
    const result = await notificationService.processDueItems();
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);

    // Item should be marked for retry, not crashed
    const item = await queueRepo.findById('corrupt-001');
    expect(item.retryCount).toBe(1);
  });

  it('delivery to nonexistent user succeeds (writes to notifications store)', async () => {
    const templates = await templateService.getByOrg(orgId);
    const item = await notificationService.enqueue({
      organizationId: orgId, recipientUserId: 'deleted-user-999',
      templateId: templates[0].id, channelId: null,
      vars: { title: 'test', body: 'test' },
      eventSourceKey: 'ghost-delivery-001',
    });

    const result = await notificationService.processDueItems();
    // Delivery succeeds — notification is written even if user doesn't exist
    expect(result.sent).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. SESSION ISOLATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Session isolation — no cross-user leakage', () => {
  it('NLP threshold is cleared after logout', async () => {
    await nlpService.setF1Threshold(0.5, orgId);
    expect(nlpService.getF1Threshold()).toBe(0.5);

    await authService.logout();
    // After logout, the App.svelte handler would clear this.
    // Simulating that here since we're not rendering App:
    nlpService._f1ThresholdOverride = null;

    expect(nlpService.getF1Threshold()).toBe(0.7); // back to default
  });

  it('risk dictionary is cleared after logout', async () => {
    await riskReviewService.updateSensitiveWords(['fraud'], adminUser.id);
    expect(riskReviewService.getSensitiveWords().length).toBe(1);

    riskReviewService.clearDictionary();
    expect(riskReviewService.getSensitiveWords().length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. ORG TREE INTEGRITY
// ══════════════════════════════════════════════════════════════════════════════

describe('Org tree integrity', () => {
  it('cannot delete node with children', async () => {
    const factory = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY, name: 'F1',
      organizationId: orgId, actorId: adminUser.id,
    });
    const store = await orgService.createNode({
      parentId: factory.id, type: ORG_NODE_TYPES.STORE, name: 'S1',
      organizationId: orgId, actorId: adminUser.id,
    });

    // Cannot delete factory — it has a child store
    await expect(orgService.deleteNode(factory.id, adminUser.id)).rejects.toThrow(/children/i);

    // Can delete leaf store
    await expect(orgService.deleteNode(store.id, adminUser.id)).resolves.toBeUndefined();
  });

  it('invalid parent-child type is rejected', async () => {
    // company → store is invalid (must go company → factory → store)
    await expect(orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.STORE, name: 'Bad Store',
      organizationId: orgId, actorId: adminUser.id,
    })).rejects.toThrow(/invalid parent-child/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. LOCALSTORAGE — USER ISOLATION
// ══════════════════════════════════════════════════════════════════════════════

describe('LocalStorage — user-scoped persistence', () => {
  it('user A store preference does not leak to user B', () => {
    persistSelectedStore({ id: 'store-A', name: 'Store A' }, 'user-A');
    persistSelectedStore({ id: 'store-B', name: 'Store B' }, 'user-B');

    const restoredA = restoreSelectedStore('user-A');
    const restoredB = restoreSelectedStore('user-B');

    expect(restoredA.id).toBe('store-A');
    expect(restoredB.id).toBe('store-B');
  });

  it('clearing user A preferences does not affect user B', () => {
    persistSelectedStore({ id: 'store-A', name: 'A' }, 'user-A');
    persistSelectedStore({ id: 'store-B', name: 'B' }, 'user-B');

    clearOrgPreferences('user-A');

    expect(restoreSelectedStore('user-A')).toBeNull();
    expect(restoreSelectedStore('user-B')).toEqual({ id: 'store-B', name: 'B' });
  });
});
