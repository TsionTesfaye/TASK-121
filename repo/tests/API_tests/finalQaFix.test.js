/**
 * Final QA fix tests — UI-service contract alignment + invariant consistency.
 *
 * Covers:
 *   1. Style UI contract (reasonNote required)
 *   2. Versioning invariant (per entityId, not entityType)
 *   3. Sensitive data cleared on lock
 *   4. Preference persistence wiring
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { styleService } from '../../src/services/StyleService.js';
import { lookupDataService } from '../../src/services/LookupDataService.js';
import { masterDataService } from '../../src/services/MasterDataService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { persistSelectedStore, restoreSelectedStore } from '../../src/app/stores/org.js';
import { ROLES, MASTER_DATA_ENTITY_TYPES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'FinalQA@12345';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'fq_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'FinalQACo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('fq_admin', ADMIN_PASS);
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
  await new BaseRepository('suppliers').create({ id: 'sp1', organizationId: orgId, name: 'Sup', isActive: true, createdAt: now });
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. STYLE UI CONTRACT — reasonNote required
// ══════════════════════════════════════════════════════════════════════════════

describe('Style UI contract — reasonNote enforcement', () => {
  beforeEach(seedMasterData);

  it('createStyle without reasonNote → rejected', async () => {
    await expect(styleService.createStyle({
      organizationId: orgId, sku: 'NO-REASON-SKU',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id,
    })).rejects.toThrow(/reason/i);
  });

  it('createStyle with valid reasonNote → succeeds + version created', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId, sku: 'REASON-SKU',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'New style for Q2 collection',
    });
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(style.id);
    expect(history.length).toBe(1);
    expect(history[0].reasonNote).toBe('New style for Q2 collection');
  });

  it('updateStyle without reasonNote → rejected', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId, sku: 'UPD-SKU',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'Initial version',
    });
    await expect(styleService.updateStyle(style.id, { sku: 'UPD-SKU-2' }, adminUser.id))
      .rejects.toThrow(/reason/i);
  });

  it('deactivateStyle without reasonNote → rejected', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId, sku: 'DEACT-SKU',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId, actorId: adminUser.id, reasonNote: 'Creating for deactivation',
    });
    await expect(styleService.deactivateStyle(style.id, adminUser.id))
      .rejects.toThrow(/reason/i);
  });

  it('MasterDataPage style form includes reason input', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/MasterDataPage.svelte'), 'utf8');
    expect(content).toContain('styleFormReason');
    expect(content).toContain('reasonNote: styleFormReason');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. VERSIONING INVARIANT — per entityId
// ══════════════════════════════════════════════════════════════════════════════

describe('Versioning invariant — per entityId, multiple entities allowed per type', () => {
  it('two different colors each have their own active version', async () => {
    const colorA = await lookupDataService.createEntry({
      store: 'colors', organizationId: orgId, name: 'Cyan',
      actorId: adminUser.id, reasonNote: 'Adding cyan color',
    });
    const colorB = await lookupDataService.createEntry({
      store: 'colors', organizationId: orgId, name: 'Magenta',
      actorId: adminUser.id, reasonNote: 'Adding magenta color',
    });

    const mdRepo = new MasterDataRepository();
    const histA = await mdRepo.findVersionHistory(colorA.id);
    const histB = await mdRepo.findVersionHistory(colorB.id);

    expect(histA.filter((v) => v.isActive).length).toBe(1);
    expect(histB.filter((v) => v.isActive).length).toBe(1);
  });

  it('updating one entity does not affect another', async () => {
    const entryA = await lookupDataService.createEntry({
      store: 'brands', organizationId: orgId, name: 'BrandA',
      actorId: adminUser.id, reasonNote: 'Creating brand A',
    });
    const entryB = await lookupDataService.createEntry({
      store: 'brands', organizationId: orgId, name: 'BrandB',
      actorId: adminUser.id, reasonNote: 'Creating brand B',
    });

    await lookupDataService.deactivateEntry({
      store: 'brands', entryId: entryA.id, actorId: adminUser.id,
      reasonNote: 'Deactivating brand A only',
    });

    const mdRepo = new MasterDataRepository();
    const activeA = (await mdRepo.findVersionHistory(entryA.id)).filter((v) => v.isActive);
    const activeB = (await mdRepo.findVersionHistory(entryB.id)).filter((v) => v.isActive);

    expect(activeA.length).toBe(1); // deactivation version is active
    expect(activeB.length).toBe(1); // unaffected
  });

  it('master data publishVersion per entityType/org has one active', async () => {
    await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.COLOR, entityId: 'md-color-001',
      organizationId: orgId, payload: { name: 'Red' },
      reasonNote: 'Publishing red color', createdBy: adminUser.id,
      expectedActiveVersionId: null,
    });

    const v1 = await masterDataService.getActiveVersion(MASTER_DATA_ENTITY_TYPES.COLOR, orgId);
    expect(v1).not.toBeNull();

    await masterDataService.publishVersion({
      entityType: MASTER_DATA_ENTITY_TYPES.COLOR, entityId: 'md-color-001',
      organizationId: orgId, payload: { name: 'Red v2' },
      reasonNote: 'Updating red color', createdBy: adminUser.id,
      expectedActiveVersionId: v1.id,
    });

    const v2 = await masterDataService.getActiveVersion(MASTER_DATA_ENTITY_TYPES.COLOR, orgId);
    expect(v2.payload.name).toBe('Red v2');
    expect(v2.id).not.toBe(v1.id);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. SENSITIVE DATA CLEARED ON LOCK
// ══════════════════════════════════════════════════════════════════════════════

describe('Sensitive data — cleared on lock', () => {
  it('CRMPage watches isLocked and clears sensitiveFields', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/CRMPage.svelte'), 'utf8');
    // Verify the reactive clear statement exists
    expect(content).toContain('$isLocked');
    expect(content).toContain('sensitiveFields = null');
  });

  it('CRMPage imports isLocked store', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/CRMPage.svelte'), 'utf8');
    expect(content).toContain('isLocked');
    expect(content).toMatch(/import.*isLocked.*from.*auth/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. PREFERENCE PERSISTENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('Preference persistence — per-user isolation', () => {
  it('persist → restore round-trip works', () => {
    persistSelectedStore({ id: 'st-final', name: 'Final Store' }, 'user-final');
    const restored = restoreSelectedStore('user-final');
    expect(restored).toEqual({ id: 'st-final', name: 'Final Store' });
  });

  it('user A preferences isolated from user B', () => {
    persistSelectedStore({ id: 'st-a', name: 'A' }, 'ua');
    persistSelectedStore({ id: 'st-b', name: 'B' }, 'ub');
    expect(restoreSelectedStore('ua').id).toBe('st-a');
    expect(restoreSelectedStore('ub').id).toBe('st-b');
  });
});
