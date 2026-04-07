/**
 * E2E Simulation — Style SKU flow with reference validation.
 *
 * Covers:
 *   - Create style with all valid active references
 *   - Reject style referencing a deactivated color
 *   - Reject style referencing a deactivated supplier
 *   - Deactivate style
 *   - Org scope enforced (wrong org rejected)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { StyleService } from '../../src/services/StyleService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const MANAGER = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: 'org-001' };
const ORG_ID = 'org-001';

// Reference IDs shared across tests.
const REF = {
  colorId: 'col-001',
  sizeId: 'siz-001',
  seasonId: 'sea-001',
  brandId: 'brd-001',
  supplierId: 'sup-001',
};

async function seedRefs({ deactivateColor = false, deactivateSupplier = false } = {}) {
  const colorRepo = new BaseRepository('colors');
  const sizeRepo = new BaseRepository('sizes');
  const seasonRepo = new BaseRepository('seasons');
  const brandRepo = new BaseRepository('brands');
  const supplierRepo = new BaseRepository('suppliers');

  await colorRepo.create({ id: REF.colorId, name: 'Red', isActive: !deactivateColor });
  await sizeRepo.create({ id: REF.sizeId, name: 'M', isActive: true });
  await seasonRepo.create({ id: REF.seasonId, name: 'Summer', isActive: true });
  await brandRepo.create({ id: REF.brandId, name: 'BrandX', isActive: true });
  await supplierRepo.create({ id: REF.supplierId, name: 'SupplierCo', isActive: !deactivateSupplier });
}

function buildStyle(override = {}) {
  return {
    organizationId: ORG_ID,
    sku: 'SKU-001',
    storeId: ORG_ID,
    actorId: MANAGER.id,
    reasonNote: 'Test style creation',
    ...REF,
    ...override,
  };
}

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = MANAGER;
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
});

describe('Style SKU flow', () => {
  it('creates style with all active references', async () => {
    await seedRefs();
    const svc = new StyleService();
    const style = await svc.createStyle(buildStyle());
    expect(style.sku).toBe('SKU-001');
    expect(style.isActive).toBe(true);
    expect(style.colorId).toBe(REF.colorId);
  });

  it('rejects style referencing a deactivated color', async () => {
    await seedRefs({ deactivateColor: true });
    const svc = new StyleService();
    await expect(svc.createStyle(buildStyle())).rejects.toThrow(/deactivated color/i);
  });

  it('rejects style referencing a deactivated supplier', async () => {
    await seedRefs({ deactivateSupplier: true });
    const svc = new StyleService();
    await expect(svc.createStyle(buildStyle())).rejects.toThrow(/deactivated supplier/i);
  });

  it('rejects style when a reference entity does not exist', async () => {
    await seedRefs();
    const svc = new StyleService();
    await expect(
      svc.createStyle(buildStyle({ brandId: 'nonexistent-brand' })),
    ).rejects.toThrow(/not found/i);
  });

  it('deactivates an existing style', async () => {
    await seedRefs();
    const svc = new StyleService();
    const style = await svc.createStyle(buildStyle());
    await svc.deactivateStyle(style.id, MANAGER.id, 'Deactivating style for test');

    const styles = await svc.getByOrg(ORG_ID);
    const found = styles.find((s) => s.id === style.id);
    expect(found.isActive).toBe(false);
  });

  it('org scope enforced: wrong org manager cannot create style', async () => {
    await seedRefs();
    authService._currentUser = { id: 'other-mgr', role: ROLES.STORE_MANAGER, organizationNodeId: 'other-org' };
    const svc = new StyleService();
    await expect(svc.createStyle(buildStyle())).rejects.toThrow(/scope/i);
  });
});
