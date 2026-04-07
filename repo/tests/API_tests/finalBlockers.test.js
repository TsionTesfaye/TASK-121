/**
 * Final QA blocker regression tests.
 *
 * Covers:
 *   1. Style versioning (reasonNote, version records, single-active)
 *   2. Scheduler/notification auth decoupling (system dispatch without login)
 *   3. Auth message hardening (all failures return same message)
 *   4. RBAC — revealSensitiveFields allows store_manager
 *   5. CryptoService shared key primitives
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { styleService } from '../../src/services/StyleService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { templateService } from '../../src/services/TemplateService.js';
import { eventDispatcherService } from '../../src/services/EventDispatcherService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, EVENT_TYPES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'FinalBlock@123';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'fb_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'FinalBlockerCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('fb_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

async function seedMasterData() {
  const now = Date.now();
  await new BaseRepository('colors').create({ id: 'c1', organizationId: orgId, name: 'Red', isActive: true, createdAt: now });
  await new BaseRepository('sizes').create({ id: 's1', organizationId: orgId, name: 'M', isActive: true, createdAt: now });
  await new BaseRepository('seasons').create({ id: 'ss1', organizationId: orgId, name: 'SS25', isActive: true, createdAt: now });
  await new BaseRepository('brands').create({ id: 'b1', organizationId: orgId, name: 'Brand', isActive: true, createdAt: now });
  await new BaseRepository('suppliers').create({ id: 'sp1', organizationId: orgId, name: 'Supplier', isActive: true, createdAt: now });
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. STYLE VERSIONING
// ══════════════════════════════════════════════════════════════════════════════

describe('Style versioning', () => {
  beforeEach(seedMasterData);

  it('createStyle without reasonNote is rejected', async () => {
    await expect(
      styleService.createStyle({
        organizationId: orgId, sku: 'NO-REASON',
        colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
        storeId: orgId, actorId: adminUser.id,
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('updateStyle without reasonNote is rejected', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId, sku: 'UPD-REASON',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'Initial creation',
    });
    await expect(
      styleService.updateStyle(style.id, { sku: 'UPD-2' }, adminUser.id),
    ).rejects.toThrow(/reason/i);
  });

  it('valid createStyle creates version record', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId, sku: 'VER-CREATE',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'First style version',
    });
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(style.id);
    expect(history.length).toBe(1);
    expect(history[0].entityType).toBe('style');
    expect(history[0].isActive).toBe(true);
  });

  it('updateStyle creates new version + deactivates previous', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId, sku: 'VER-UPDATE',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'Creation version',
    });
    await styleService.updateStyle(style.id, { sku: 'VER-UPDATE-2' }, adminUser.id, 'Update version reason');

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(style.id);
    expect(history.length).toBe(2);
    const active = history.filter((v) => v.isActive);
    expect(active.length).toBe(1);
    expect(active[0].versionNumber).toBe(2);
  });

  it('getStyleVersionHistory returns history', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId, sku: 'VER-HIST',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'History test creation',
    });
    const history = await styleService.getStyleVersionHistory(style.id);
    expect(history.length).toBe(1);
  });

  it('getActiveStyleVersion returns active version', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId, sku: 'VER-ACTIVE',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'Active version test',
    });
    const active = await styleService.getActiveStyleVersion(style.id);
    expect(active).not.toBeNull();
    expect(active.isActive).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. SCHEDULER/NOTIFICATION AUTH DECOUPLING
// ══════════════════════════════════════════════════════════════════════════════

describe('Scheduler auth decoupling', () => {
  it('processDueItems works when no user is logged in', async () => {
    // Enqueue an item while logged in
    const templates = await templateService.getByOrg(orgId);
    await notificationService.enqueue({
      organizationId: orgId, recipientUserId: adminUser.id,
      templateId: templates[0].id, channelId: null,
      vars: { title: 'test', body: 'test' },
      eventSourceKey: 'scheduler-test-1',
    });

    // Log out — simulate scheduler running without authenticated user
    await authService.logout();

    // processDueItems should still work
    const result = await notificationService.processDueItems();
    expect(result.sent).toBe(1);
  });

  it('dispatch works when triggered by system (no login)', async () => {
    // Subscribe while logged in
    const channel = await notificationService.upsertChannel({ organizationId: orgId, name: 'sys-ch' });
    await notificationService.subscribe({
      userId: adminUser.id, channelId: channel.id,
      eventType: EVENT_TYPES.DEADLINE_APPROACHING, organizationId: orgId,
    });

    // Log out — simulate scheduler-triggered dispatch
    await authService.logout();

    // System dispatch should succeed (evaluateOverdue path)
    await expect(
      eventDispatcherService.dispatch({
        organizationId: orgId,
        eventType: EVENT_TYPES.DEADLINE_APPROACHING,
        sourceId: 'ticket-sys-001',
        actorId: 'system',
        title: 'SLA overdue',
        body: 'Ticket exceeded SLA.',
        recipientUserIds: [adminUser.id],
      }),
    ).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. AUTH MESSAGE HARDENING
// ══════════════════════════════════════════════════════════════════════════════

describe('Auth message hardening — all return same message', () => {
  it('wrong password returns "Invalid credentials."', async () => {
    await expect(authService.login('fb_admin', 'WrongPass@1234')).rejects.toThrow('Invalid credentials.');
  });

  it('nonexistent user returns "Invalid credentials."', async () => {
    await expect(authService.login('nobody', 'AnyPass@12345')).rejects.toThrow('Invalid credentials.');
  });

  it('locked account returns "Invalid credentials."', async () => {
    for (let i = 0; i < 5; i++) {
      await authService.login('fb_admin', 'Wrong@12345678').catch(() => {});
    }
    await expect(authService.login('fb_admin', ADMIN_PASS)).rejects.toThrow('Invalid credentials.');
  });

  it('deactivated account returns "Invalid credentials."', async () => {
    const user = await authService.createUser({
      username: 'deact_test', password: 'Deact@1234567',
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });
    await authService.deactivateAccount(user.id);
    await expect(authService.login('deact_test', 'Deact@1234567')).rejects.toThrow('Invalid credentials.');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. RBAC — revealSensitiveFields
// ══════════════════════════════════════════════════════════════════════════════

describe('revealSensitiveFields RBAC', () => {
  let customerId;

  beforeEach(async () => {
    const c = await customerService.createCustomer({
      organizationId: orgId, name: 'Sensitive Customer',
      storedValue: 100, actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });
    customerId = c.id;
  });

  it('store_manager can reveal sensitive fields', async () => {
    authService._currentUser = {
      id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    };
    const fields = await customerService.revealSensitiveFields(customerId);
    expect(fields.storedValue).toBeDefined();
  });

  it('analyst cannot reveal sensitive fields', async () => {
    authService._currentUser = {
      id: 'analyst-001', role: ROLES.ANALYST, organizationNodeId: orgId,
    };
    await expect(customerService.revealSensitiveFields(customerId)).rejects.toThrow(/permission denied/i);
  });

  it('reviewer cannot reveal sensitive fields', async () => {
    authService._currentUser = {
      id: 'rev-001', role: ROLES.REVIEWER, organizationNodeId: orgId,
    };
    await expect(customerService.revealSensitiveFields(customerId)).rejects.toThrow(/permission denied/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. CRYPTO — SHARED KEY PRIMITIVES
// ══════════════════════════════════════════════════════════════════════════════

describe('CryptoService — shared key support', () => {
  it('setSessionKey allows encryption/decryption with externally provided key', async () => {
    const key = await cryptoService.deriveKeyRaw('SharedPass@123', adminUser.passwordSalt);
    cryptoService.setSessionKey(key);

    const encrypted = await cryptoService.encrypt('secret data');
    const decrypted = await cryptoService.decrypt(encrypted.ciphertext, encrypted.iv);
    expect(decrypted).toBe('secret data');
  });

  it('two users deriving from same password+salt get same key', async () => {
    const keyA = await cryptoService.deriveKeyRaw('OrgPass@12345', adminUser.passwordSalt);
    const keyB = await cryptoService.deriveKeyRaw('OrgPass@12345', adminUser.passwordSalt);

    // Encrypt with keyA, decrypt with keyB
    cryptoService.setSessionKey(keyA);
    const encrypted = await cryptoService.encrypt('shared secret');

    cryptoService.setSessionKey(keyB);
    const decrypted = await cryptoService.decrypt(encrypted.ciphertext, encrypted.iv);
    expect(decrypted).toBe('shared secret');
  });
});
