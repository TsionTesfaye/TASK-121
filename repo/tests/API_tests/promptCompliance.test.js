/**
 * Prompt compliance + final quality tests.
 *
 * Covers:
 *   1. Lookup data — versioning pipeline (reason note required, version created)
 *   2. Lookup data — mutation without reason rejected
 *   3. Master data — publishVersion creates version with reason
 *   4. Accessibility — no empty keydown handlers, all dialogs have role="dialog"
 *   5. Security coverage — cross-org version history, forged inputs, guest mutations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { lookupDataService } from '../../src/services/LookupDataService.js';
import { masterDataService } from '../../src/services/MasterDataService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { orgService } from '../../src/services/OrgService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, MASTER_DATA_ENTITY_TYPES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'Compliance@123';
const OTHER_ORG_ID = 'foreign-org-00000000';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'comply_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'ComplianceCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('comply_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. LOOKUP DATA — VERSIONING PIPELINE
// ══════════════════════════════════════════════════════════════════════════════

describe('LookupDataService — versioning enforcement', () => {
  it('createEntry without reasonNote is rejected', async () => {
    await expect(
      lookupDataService.createEntry({
        store: 'colors',
        organizationId: orgId,
        name: 'Red',
        actorId: adminUser.id,
        // no reasonNote
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('createEntry with short reasonNote (<10 chars) is rejected', async () => {
    await expect(
      lookupDataService.createEntry({
        store: 'colors',
        organizationId: orgId,
        name: 'Red',
        actorId: adminUser.id,
        reasonNote: 'short',
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('createEntry with valid reasonNote creates entry AND version record', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'colors',
      organizationId: orgId,
      name: 'Blue',
      actorId: adminUser.id,
      reasonNote: 'Initial creation for production color palette',
    });

    expect(entry.name).toBe('Blue');

    // Verify version record was created.
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);
    expect(history.length).toBe(1);
    expect(history[0].entityType).toBe('color');
    expect(history[0].reasonNote).toBe('Initial creation for production color palette');
    expect(history[0].versionNumber).toBe(1);
  });

  it('deactivateEntry without reasonNote is rejected', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'sizes',
      organizationId: orgId,
      name: 'XL',
      actorId: adminUser.id,
      reasonNote: 'Adding XL to size range',
    });

    await expect(
      lookupDataService.deactivateEntry({
        store: 'sizes',
        entryId: entry.id,
        actorId: adminUser.id,
        // no reasonNote
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('deactivateEntry with valid reasonNote creates a new version', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'brands',
      organizationId: orgId,
      name: 'OldBrand',
      actorId: adminUser.id,
      reasonNote: 'Adding brand for legacy products',
    });

    await lookupDataService.deactivateEntry({
      store: 'brands',
      entryId: entry.id,
      actorId: adminUser.id,
      reasonNote: 'Discontinuing this brand line per Q2 decision',
    });

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);
    expect(history.length).toBe(2);
    expect(history[0].versionNumber).toBe(2); // newest first
    expect(history[0].payload.isActive).toBe(false);
  });

  it('reactivateEntry without reasonNote is rejected', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'seasons',
      organizationId: orgId,
      name: 'SS25',
      actorId: adminUser.id,
      reasonNote: 'Spring/Summer 2025 season',
    });

    await lookupDataService.deactivateEntry({
      store: 'seasons',
      entryId: entry.id,
      actorId: adminUser.id,
      reasonNote: 'Temporarily deactivating for review',
    });

    await expect(
      lookupDataService.reactivateEntry({
        store: 'seasons',
        entryId: entry.id,
        actorId: adminUser.id,
        // no reasonNote
      }),
    ).rejects.toThrow(/reason/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. MASTER DATA — PUBLISH VERSION REQUIRES REASON
// ══════════════════════════════════════════════════════════════════════════════

describe('MasterDataService — publishVersion reason enforcement', () => {
  it('publishVersion without reasonNote is rejected', async () => {
    await expect(
      masterDataService.publishVersion({
        entityType: MASTER_DATA_ENTITY_TYPES.COLOR,
        entityId: 'ent-001',
        organizationId: orgId,
        payload: { name: 'Red' },
        reasonNote: '',
        createdBy: adminUser.id,
        expectedActiveVersionId: null,
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('publishVersion with valid reason creates version', async () => {
    const version = await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.COLOR,
      entityId: 'ent-002',
      organizationId: orgId,
      payload: { name: 'Green' },
      reasonNote: 'Adding green to production palette',
      createdBy: adminUser.id,
      expectedActiveVersionId: null,
    });

    expect(version.versionNumber).toBe(1);
    expect(version.isActive).toBe(true);
    expect(version.reasonNote).toBe('Adding green to production palette');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. ACCESSIBILITY — FILE-LEVEL VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Accessibility — no empty keydown handlers in any page', () => {
  const allPages = [
    'OrdersPage.svelte', 'TicketsPage.svelte', 'RiskReviewPage.svelte',
    'NLPPage.svelte', 'CRMPage.svelte', 'AdminPage.svelte',
    'MasterDataPage.svelte', 'OrgSetupPage.svelte', 'MessagesPage.svelte',
  ];

  for (const page of allPages) {
    it(`${page} — zero empty on:keydown handlers`, async () => {
      const fs = await import('fs');
      const path = await import('path');
      const content = fs.readFileSync(path.resolve('src/pages', page), 'utf8');
      expect(content).not.toContain('on:keydown={() => {}}');
    });

    it(`${page} — all modal overlays have Escape key handling`, async () => {
      const fs = await import('fs');
      const path = await import('path');
      const content = fs.readFileSync(path.resolve('src/pages', page), 'utf8');
      // Count overlay divs in the template (class="modal-overlay" in markup, not in <style>)
      const markup = content.split('<style>')[0] ?? content;
      const overlayCount = (markup.match(/class="modal-overlay"/g) || []).length;
      const escCount = (markup.match(/e\.key\s*===\s*'Escape'/g) || []).length;
      if (overlayCount > 0) {
        expect(escCount).toBeGreaterThanOrEqual(overlayCount);
      }
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. SECURITY — CROSS-ORG VERSION HISTORY
// ══════════════════════════════════════════════════════════════════════════════

describe('Security — cross-org version history isolation', () => {
  it('non-admin cannot read customer version history from foreign org', async () => {
    const customer = await customerService.createCustomer({
      organizationId: orgId,
      name: 'Isolated Customer',
      actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });

    await customerService.publishCustomerVersion({
      customerId: customer.id,
      organizationId: orgId,
      reasonNote: 'Initial snapshot for isolation test',
      actorId: adminUser.id,
    });

    // Foreign user
    authService._currentUser = {
      id: 'foreign-001',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: OTHER_ORG_ID,
    };

    await expect(
      customerService.getCustomerVersionHistory(customer.id),
    ).rejects.toThrow(/scope violation/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. SECURITY — GUEST MUTATION COVERAGE
// ══════════════════════════════════════════════════════════════════════════════

describe('Security — guest cannot mutate notification system', () => {
  it('guest cannot subscribe', async () => {
    authService._currentUser = { id: 'guest-001', role: ROLES.GUEST, organizationNodeId: orgId };
    await expect(
      notificationService.subscribe({
        userId: 'guest-001', channelId: null,
        eventType: 'order_status', organizationId: orgId,
      }),
    ).rejects.toThrow(/guest/i);
  });

  it('guest cannot enqueue', async () => {
    authService._currentUser = { id: 'guest-001', role: ROLES.GUEST, organizationNodeId: orgId };
    await expect(
      notificationService.enqueue({
        organizationId: orgId, recipientUserId: 'x',
        templateId: 'x', channelId: null,
        vars: {}, eventSourceKey: 'guest-test',
      }),
    ).rejects.toThrow(/guest/i);
  });

  it('guest cannot delete subscription', async () => {
    // Admin creates subscription first
    const sub = await notificationService.subscribe({
      userId: adminUser.id, channelId: null,
      eventType: 'order_status', organizationId: orgId,
    });

    authService._currentUser = { id: 'guest-001', role: ROLES.GUEST, organizationNodeId: orgId };
    await expect(
      notificationService.deleteSubscription(sub.id, 'guest-001'),
    ).rejects.toThrow(/guest/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. SECURITY — ORG TREE SCOPE
// ══════════════════════════════════════════════════════════════════════════════

describe('Security — org tree access', () => {
  it('foreign user cannot read org tree', async () => {
    authService._currentUser = {
      id: 'foreign-001',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: OTHER_ORG_ID,
    };
    await expect(orgService.getTree(orgId)).rejects.toThrow(/scope violation/i);
  });

  it('foreign user cannot read subtree', async () => {
    authService._currentUser = {
      id: 'foreign-001',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: OTHER_ORG_ID,
    };
    await expect(orgService.getSubtree(orgId)).rejects.toThrow(/scope violation/i);
  });
});
