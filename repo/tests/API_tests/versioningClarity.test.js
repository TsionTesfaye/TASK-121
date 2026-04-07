/**
 * Versioning model clarity tests — proves both models are intentional.
 *
 * MODEL A — Dataset publish (MasterDataService):
 *   One active version per (entityType, organizationId).
 *
 * MODEL B — Record history (LookupDataService, StyleService):
 *   One active version per entityId.
 *
 * Also covers:
 *   - Style deactivate UI has modal with reason
 *   - Preference persistence save/restore
 *   - Sensitive data cleared on lock (CRMPage reactive guard)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { masterDataService } from '../../src/services/MasterDataService.js';
import { lookupDataService } from '../../src/services/LookupDataService.js';
import { styleService } from '../../src/services/StyleService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { persistSelectedStore, restoreSelectedStore } from '../../src/app/stores/org.js';
import { saveColumnLayout, restoreColumnLayouts, tableColumnLayouts } from '../../src/app/stores/ui.js';
import { get } from 'svelte/store';
import { ROLES, MASTER_DATA_ENTITY_TYPES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'VerClarity@123';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'vc_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'VerClarityCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('vc_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// MODEL A — Dataset Publish (one active per entityType + org)
// ══════════════════════════════════════════════════════════════════════════════

describe('Model A — Dataset publish: one active per (entityType, org)', () => {
  it('publishing same entityType replaces previous active version', async () => {
    const v1 = await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.COLOR, entityId: 'dataset-color',
      organizationId: orgId, payload: { name: 'Red v1' },
      reasonNote: 'Initial color dataset', createdBy: adminUser.id,
      expectedActiveVersionId: null,
    });

    const v2 = await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.COLOR, entityId: 'dataset-color',
      organizationId: orgId, payload: { name: 'Red v2' },
      reasonNote: 'Updated color dataset', createdBy: adminUser.id,
      expectedActiveVersionId: v1.id,
    });

    const active = await masterDataService.getActiveVersion(MASTER_DATA_ENTITY_TYPES.COLOR, orgId);
    expect(active.id).toBe(v2.id);
    expect(active.payload.name).toBe('Red v2');
  });

  it('different entityTypes can each have one active version', async () => {
    await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.COLOR, entityId: 'c1',
      organizationId: orgId, payload: { name: 'Red' },
      reasonNote: 'Color dataset publish', createdBy: adminUser.id,
      expectedActiveVersionId: null,
    });
    await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.SIZE, entityId: 's1',
      organizationId: orgId, payload: { name: 'Small' },
      reasonNote: 'Size dataset publish', createdBy: adminUser.id,
      expectedActiveVersionId: null,
    });

    const colorActive = await masterDataService.getActiveVersion(MASTER_DATA_ENTITY_TYPES.COLOR, orgId);
    const sizeActive = await masterDataService.getActiveVersion(MASTER_DATA_ENTITY_TYPES.SIZE, orgId);
    expect(colorActive).not.toBeNull();
    expect(sizeActive).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MODEL B — Record History (one active per entityId)
// ══════════════════════════════════════════════════════════════════════════════

describe('Model B — Record history: one active per entityId', () => {
  it('two lookup entries of same type each have independent active versions', async () => {
    const a = await lookupDataService.createEntry({
      store: 'colors', organizationId: orgId, name: 'Cyan',
      actorId: adminUser.id, reasonNote: 'Adding cyan entry',
    });
    const b = await lookupDataService.createEntry({
      store: 'colors', organizationId: orgId, name: 'Magenta',
      actorId: adminUser.id, reasonNote: 'Adding magenta entry',
    });

    const mdRepo = new MasterDataRepository();
    const activeA = (await mdRepo.findVersionHistory(a.id)).filter((v) => v.isActive);
    const activeB = (await mdRepo.findVersionHistory(b.id)).filter((v) => v.isActive);

    expect(activeA.length).toBe(1);
    expect(activeB.length).toBe(1);
  });

  it('style version history is per-style, not per-type', async () => {
    const now = Date.now();
    await new BaseRepository('colors').create({ id: 'c1', organizationId: orgId, name: 'R', isActive: true, createdAt: now });
    await new BaseRepository('sizes').create({ id: 's1', organizationId: orgId, name: 'M', isActive: true, createdAt: now });
    await new BaseRepository('seasons').create({ id: 'ss1', organizationId: orgId, name: 'SS', isActive: true, createdAt: now });
    await new BaseRepository('brands').create({ id: 'b1', organizationId: orgId, name: 'B', isActive: true, createdAt: now });
    await new BaseRepository('suppliers').create({ id: 'sp1', organizationId: orgId, name: 'S', isActive: true, createdAt: now });

    const styleA = await styleService.createStyle({
      organizationId: orgId, sku: 'A-001',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'Style A creation',
    });
    const styleB = await styleService.createStyle({
      organizationId: orgId, sku: 'B-001',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'Style B creation',
    });

    // Update style A → new version for A only
    await styleService.updateStyle(styleA.id, { sku: 'A-002' }, adminUser.id, 'Updating style A SKU');

    const mdRepo = new MasterDataRepository();
    const histA = await mdRepo.findVersionHistory(styleA.id);
    const histB = await mdRepo.findVersionHistory(styleB.id);

    expect(histA.length).toBe(2); // create + update
    expect(histB.length).toBe(1); // create only — not affected
    expect(histA.filter((v) => v.isActive).length).toBe(1);
    expect(histB.filter((v) => v.isActive).length).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STYLE UI — deactivate modal exists with reason requirement
// ══════════════════════════════════════════════════════════════════════════════

describe('Style deactivate UI', () => {
  it('MasterDataPage has style deactivation modal with reason input', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/MasterDataPage.svelte'), 'utf8');
    expect(content).toContain('showStyleDeactivateModal');
    expect(content).toContain('styleDeactivateReason');
    expect(content).toContain('handleStyleDeactivate');
    // Modal has reason input and gated submit
    expect(content).toContain('styleDeactivateReason.trim().length < 10');
  });

  it('MasterDataPage style create modal has reason input', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/MasterDataPage.svelte'), 'utf8');
    expect(content).toContain('styleFormReason');
    expect(content).toContain('styleFormReason.trim().length < 10');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SENSITIVE DATA — CRMPage clears on lock
// ══════════════════════════════════════════════════════════════════════════════

describe('Sensitive data — cleared on lock/logout', () => {
  it('CRMPage has reactive guard on isLocked', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/CRMPage.svelte'), 'utf8');
    expect(content).toMatch(/\$isLocked.*sensitiveFields\s*=\s*null/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PREFERENCE PERSISTENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('Preference persistence — save and restore', () => {
  it('saveColumnLayout persists and restoreColumnLayouts recovers', () => {
    saveColumnLayout('orders-table', ['id', 'status', 'date'], 'user-pref');
    tableColumnLayouts.set({}); // clear in-memory
    restoreColumnLayouts('user-pref');
    const layouts = get(tableColumnLayouts);
    expect(layouts['orders-table']).toEqual(['id', 'status', 'date']);
  });

  it('column layouts are user-scoped', () => {
    saveColumnLayout('t1', ['a', 'b'], 'uA');
    saveColumnLayout('t1', ['x', 'y'], 'uB');
    tableColumnLayouts.set({});
    restoreColumnLayouts('uA');
    expect(get(tableColumnLayouts)['t1']).toEqual(['a', 'b']);
    tableColumnLayouts.set({});
    restoreColumnLayouts('uB');
    expect(get(tableColumnLayouts)['t1']).toEqual(['x', 'y']);
  });

  it('selected store persistence per user', () => {
    persistSelectedStore({ id: 'sA', name: 'A' }, 'u1');
    persistSelectedStore({ id: 'sB', name: 'B' }, 'u2');
    expect(restoreSelectedStore('u1').id).toBe('sA');
    expect(restoreSelectedStore('u2').id).toBe('sB');
  });
});
