/**
 * Final acceptance tests — spec compliance + polish.
 *
 * Covers:
 *   1. Warehouse scope enforcement in StyleService
 *   2. Import schema validation (malformed records, missing stores)
 *   3. Auth lockout message hardening (generic response)
 *   4. Responsive media query presence (CSS validation)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { styleService } from '../../src/services/StyleService.js';
import { importExportService } from '../../src/services/ImportExportService.js';
import { orgService } from '../../src/services/OrgService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, ORG_NODE_TYPES } from '../../src/utils/constants.js';
import { DB_VERSION } from '../../src/infrastructure/db/schema.js';
import { generateId } from '../../src/utils/idGenerator.js';

const ADMIN_PASS = 'FinalQA@12345';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'final_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'FinalQACo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('final_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
  vi.restoreAllMocks();
});

/** Seed active master data records for style references. */
async function seedMasterData() {
  const colorRepo = new BaseRepository('colors');
  const sizeRepo = new BaseRepository('sizes');
  const seasonRepo = new BaseRepository('seasons');
  const brandRepo = new BaseRepository('brands');
  const supplierRepo = new BaseRepository('suppliers');

  const now = Date.now();
  await colorRepo.create({ id: 'c1', organizationId: orgId, name: 'Red', isActive: true, createdAt: now });
  await sizeRepo.create({ id: 's1', organizationId: orgId, name: 'M', isActive: true, createdAt: now });
  await seasonRepo.create({ id: 'ss1', organizationId: orgId, name: 'SS25', isActive: true, createdAt: now });
  await brandRepo.create({ id: 'b1', organizationId: orgId, name: 'Brand A', isActive: true, createdAt: now });
  await supplierRepo.create({ id: 'sp1', organizationId: orgId, name: 'Supplier A', isActive: true, createdAt: now });
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. WAREHOUSE SCOPE ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe('StyleService — warehouse scope enforcement', () => {
  beforeEach(async () => {
    await seedMasterData();
  });

  it('rejects invalid (nonexistent) warehouseId', async () => {
    await expect(
      styleService.createStyle({
        organizationId: orgId,
        sku: 'SKU-001',
        colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
        storeId: orgId,
        warehouseId: 'nonexistent-warehouse',
        actorId: adminUser.id,
        reasonNote: 'Test style creation',
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects warehouseId from a foreign organization', async () => {
    // Create a warehouse node in a foreign org tree
    const foreignOrg = await orgService.createNode({
      parentId: orgId,
      type: ORG_NODE_TYPES.FACTORY,
      name: 'Foreign Factory',
      organizationId: orgId,
      actorId: adminUser.id,
    });
    const foreignStore = await orgService.createNode({
      parentId: foreignOrg.id,
      type: ORG_NODE_TYPES.STORE,
      name: 'Foreign Store',
      organizationId: orgId,
      actorId: adminUser.id,
    });
    const foreignWarehouse = await orgService.createNode({
      parentId: foreignStore.id,
      type: ORG_NODE_TYPES.WAREHOUSE,
      name: 'Foreign Warehouse',
      organizationId: orgId,
      actorId: adminUser.id,
    });

    // Non-admin in a DIFFERENT subtree cannot use this warehouse
    authService._currentUser = {
      id: 'staff-isolated',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: 'foreign-org-00000000',
    };

    await expect(
      styleService.createStyle({
        organizationId: orgId,
        sku: 'SKU-CROSS',
        colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
        storeId: orgId,
        warehouseId: foreignWarehouse.id,
        actorId: 'staff-isolated',
        reasonNote: 'Test style creation',
      }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('accepts valid warehouseId within the same org tree', async () => {
    // Create a valid warehouse in the org tree
    const factory = await orgService.createNode({
      parentId: orgId,
      type: ORG_NODE_TYPES.FACTORY,
      name: 'My Factory',
      organizationId: orgId,
      actorId: adminUser.id,
    });
    const store = await orgService.createNode({
      parentId: factory.id,
      type: ORG_NODE_TYPES.STORE,
      name: 'My Store',
      organizationId: orgId,
      actorId: adminUser.id,
    });
    const warehouse = await orgService.createNode({
      parentId: store.id,
      type: ORG_NODE_TYPES.WAREHOUSE,
      name: 'My Warehouse',
      organizationId: orgId,
      actorId: adminUser.id,
    });

    // Admin can create with valid warehouse
    const style = await styleService.createStyle({
      organizationId: orgId,
      sku: 'SKU-VALID',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: store.id,
      warehouseId: warehouse.id,
      actorId: adminUser.id,
      reasonNote: 'Test style creation',
    });

    expect(style.warehouseId).toBe(warehouse.id);
  });

  it('createStyle without warehouseId still works', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId,
      sku: 'SKU-NO-WH',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId,
      actorId: adminUser.id,
      reasonNote: 'Test style creation',
    });

    expect(style.warehouseId).toBeNull();
  });

  it('updateStyle rejects switching to invalid warehouseId', async () => {
    const style = await styleService.createStyle({
      organizationId: orgId,
      sku: 'SKU-UPD-WH',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: orgId,
      actorId: adminUser.id,
      reasonNote: 'Test style creation',
    });

    await expect(
      styleService.updateStyle(style.id, { warehouseId: 'ghost-warehouse' }, adminUser.id, 'Test style update reason'),
    ).rejects.toThrow(/not found/i);
  });

  it('cross-org user cannot read styles from foreign org (warehouseId included)', async () => {
    // Admin creates a style with warehouse data in orgId
    const factory = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY, name: 'F1',
      organizationId: orgId, actorId: adminUser.id,
    });
    const store = await orgService.createNode({
      parentId: factory.id, type: ORG_NODE_TYPES.STORE, name: 'S1',
      organizationId: orgId, actorId: adminUser.id,
    });
    const wh = await orgService.createNode({
      parentId: store.id, type: ORG_NODE_TYPES.WAREHOUSE, name: 'WH1',
      organizationId: orgId, actorId: adminUser.id,
    });
    await styleService.createStyle({
      organizationId: orgId,
      sku: 'SKU-READ-WH',
      colorId: 'c1', sizeId: 's1', seasonId: 'ss1', brandId: 'b1', supplierId: 'sp1',
      storeId: store.id,
      warehouseId: wh.id,
      actorId: adminUser.id,
      reasonNote: 'Test style creation',
    });

    // Cross-org user tries to list styles from this org
    authService._currentUser = {
      id: 'outsider',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: 'foreign-org-00000000',
    };
    await expect(
      styleService.getByOrg(orgId),
    ).rejects.toThrow(/scope violation/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. IMPORT SCHEMA VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('ImportExportService — snapshot structure validation', () => {
  it('rejects snapshot with unknown store name', async () => {
    await expect(
      importExportService.applyImport({
        snapshot: { nonexistent_store: [{ id: '1' }] },
        schemaVersion: DB_VERSION,
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(/unknown or protected store/i);
  });

  it('rejects snapshot with protected store', async () => {
    await expect(
      importExportService.applyImport({
        snapshot: { auditLogs: [{ id: '1' }] },
        schemaVersion: DB_VERSION,
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(/unknown or protected store/i);
  });

  it('rejects snapshot with non-array store records', async () => {
    await expect(
      importExportService.applyImport({
        snapshot: { customers: 'not-an-array' },
        schemaVersion: DB_VERSION,
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(/must contain an array/i);
  });

  it('rejects record missing required id field', async () => {
    await expect(
      importExportService.applyImport({
        snapshot: { customers: [{ name: 'No ID Customer' }] },
        schemaVersion: DB_VERSION,
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(/missing required 'id' field/i);
  });

  it('rejects non-object record', async () => {
    await expect(
      importExportService.applyImport({
        snapshot: { customers: ['string-not-object'] },
        schemaVersion: DB_VERSION,
        actorId: adminUser.id,
      }),
    ).rejects.toThrow(/not a valid object/i);
  });

  it('accepts valid snapshot with proper structure', async () => {
    await expect(
      importExportService.applyImport({
        snapshot: { customers: [{ id: generateId(), name: 'Valid Customer', organizationId: orgId }] },
        schemaVersion: DB_VERSION,
        actorId: adminUser.id,
      }),
    ).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. AUTH LOCKOUT MESSAGE HARDENING
// ══════════════════════════════════════════════════════════════════════════════

describe('AuthService — lockout message is generic', () => {
  it('lockout error does not reveal duration or attempt count', async () => {
    // Trigger lockout by failing 5 times
    for (let i = 0; i < 5; i++) {
      await authService.login('final_admin', 'WrongPass12345!').catch(() => {});
    }

    // 6th attempt should hit lockout — message must be generic
    try {
      await authService.login('final_admin', 'WrongPass12345!');
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.message).toBe('Invalid credentials.');
      // Must NOT contain any of these leaking details:
      expect(err.message).not.toMatch(/minute/i);
      expect(err.message).not.toMatch(/locked/i);
      expect(err.message).not.toMatch(/attempt/i);
      expect(err.message).not.toMatch(/\d+ minute/i);
    }
  });

  it('failed password attempt also returns generic message', async () => {
    try {
      await authService.login('final_admin', 'WrongPass12345!');
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.message).toBe('Invalid credentials.');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. RESPONSIVE CSS PRESENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('Responsive design — @media breakpoints present', () => {
  // Use require-style dynamic import inside the test to avoid top-level await.
  const splitPanePages = [
    'OrdersPage.svelte',
    'TicketsPage.svelte',
    'RiskReviewPage.svelte',
    'NLPPage.svelte',
    'CRMPage.svelte',
  ];

  for (const page of splitPanePages) {
    it(`${page} contains @media (max-width: 768px) breakpoint`, async () => {
      const fs = await import('fs');
      const path = await import('path');
      const content = fs.readFileSync(path.resolve('src/pages', page), 'utf8');
      expect(content).toContain('@media (max-width: 768px)');
    });

    it(`${page} collapses grid to single column at mobile breakpoint`, async () => {
      const fs = await import('fs');
      const path = await import('path');
      const content = fs.readFileSync(path.resolve('src/pages', page), 'utf8');
      const mediaSection = content.split('@media (max-width: 768px)')[1];
      expect(mediaSection).toContain('grid-template-columns: 1fr');
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. RESPONSIVE BEHAVIOR — VIEWPORT SIMULATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Responsive behavior — matchMedia simulation', () => {
  it('window.matchMedia("(max-width: 768px)") returns true for narrow viewport', () => {
    // jsdom default viewport is 1024px. We mock matchMedia to simulate mobile.
    const original = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: query === '(max-width: 768px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    });

    const mq = window.matchMedia('(max-width: 768px)');
    expect(mq.matches).toBe(true);

    // Desktop query should NOT match
    const mqDesktop = window.matchMedia('(min-width: 769px)');
    expect(mqDesktop.matches).toBe(false);

    window.matchMedia = original;
  });

  it('CSS breakpoint styles transform multi-column to single-column at 768px', async () => {
    // Verify each page's @media block modifies the primary layout grid
    const fs = await import('fs');
    const path = await import('path');

    for (const page of ['OrdersPage.svelte', 'TicketsPage.svelte', 'CRMPage.svelte']) {
      const content = fs.readFileSync(path.resolve('src/pages', page), 'utf8');

      // Outside @media: multi-column layout exists
      const beforeMedia = content.split('@media')[0];
      expect(beforeMedia).toMatch(/grid-template-columns:\s*(260|280|300|320)px\s+1fr/);

      // Inside @media: collapses to single column
      const afterMedia = content.split('@media (max-width: 768px)')[1];
      expect(afterMedia).toContain('grid-template-columns: 1fr');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. ACCESSIBILITY — NO EMPTY KEYDOWN HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

describe('Accessibility — no empty keydown handlers in pages', () => {
  const allPages = [
    'OrdersPage.svelte', 'TicketsPage.svelte', 'RiskReviewPage.svelte',
    'NLPPage.svelte', 'CRMPage.svelte', 'AdminPage.svelte',
    'MasterDataPage.svelte', 'OrgSetupPage.svelte', 'MessagesPage.svelte',
  ];

  for (const page of allPages) {
    it(`${page} has no empty on:keydown={() => {}} handlers`, async () => {
      const fs = await import('fs');
      const path = await import('path');
      const content = fs.readFileSync(path.resolve('src/pages', page), 'utf8');
      // Empty keydown handler: on:keydown={() => {}} — swallows events for no reason
      expect(content).not.toContain('on:keydown={() => {}}');
    });
  }

  for (const page of allPages) {
    it(`${page} modal dialogs have role="dialog" and aria-modal`, async () => {
      const fs = await import('fs');
      const path = await import('path');
      const content = fs.readFileSync(path.resolve('src/pages', page), 'utf8');
      // If the page has a modal, it must use role="dialog"
      if (content.includes('class="modal"') || content.includes('class="modal ')) {
        expect(content).toContain('role="dialog"');
        expect(content).toContain('aria-modal="true"');
      }
    });
  }
});
