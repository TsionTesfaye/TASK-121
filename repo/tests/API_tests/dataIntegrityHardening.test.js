/**
 * Data integrity hardening tests — import validation, full restore, versioning invariant.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { importExportService } from '../../src/services/ImportExportService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { lookupDataService } from '../../src/services/LookupDataService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { DB_VERSION } from '../../src/infrastructure/db/schema.js';
import { generateId } from '../../src/utils/idGenerator.js';

const PASS = 'DataHard@12345';
const BACKUP = 'Backup@1234567';
let orgId, adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'dh_admin', adminPassword: PASS, orgName: 'DataHardCo',
  });
  orgId = org.id;
  adminUser = admin;
  await authService.login('dh_admin', PASS);
    await authService.unlockProtectedData(PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. STRICT IMPORT VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Import — strict field validation', () => {
  it('rejects customer record missing organizationId', async () => {
    await expect(importExportService.applyImport({
      snapshot: { customers: [{ id: generateId(), name: 'Bad' }] },
      schemaVersion: DB_VERSION, actorId: adminUser.id,
    })).rejects.toThrow(/missing required field 'organizationId'/i);
  });

  it('rejects customer record missing name', async () => {
    await expect(importExportService.applyImport({
      snapshot: { customers: [{ id: generateId(), organizationId: orgId }] },
      schemaVersion: DB_VERSION, actorId: adminUser.id,
    })).rejects.toThrow(/missing required field 'name'/i);
  });

  it('rejects user record missing username', async () => {
    await expect(importExportService.applyImport({
      snapshot: { users: [{ id: generateId(), role: 'admin' }] },
      schemaVersion: DB_VERSION, actorId: adminUser.id,
    })).rejects.toThrow(/missing required field 'username'/i);
  });

  it('rejects order record missing status', async () => {
    await expect(importExportService.applyImport({
      snapshot: { orders: [{ id: generateId(), organizationId: orgId, customerId: 'x' }] },
      schemaVersion: DB_VERSION, actorId: adminUser.id,
    })).rejects.toThrow(/missing required field 'status'/i);
  });

  it('accepts valid records with all required fields', async () => {
    await expect(importExportService.applyImport({
      snapshot: {
        customers: [{ id: generateId(), organizationId: orgId, name: 'Valid', membershipTier: 'Bronze' }],
      },
      schemaVersion: DB_VERSION, actorId: adminUser.id,
    })).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. FULL RESTORE CLEARS PREVIOUS DATA
// ══════════════════════════════════════════════════════════════════════════════

describe('Import — full restore mode', () => {
  it('import replaces existing data (not merges)', async () => {
    // Create customer A
    const custRepo = new CustomerRepository();
    await custRepo.create({
      id: 'old-cust', organizationId: orgId, name: 'Old Customer',
      membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
      storedValueCiphertext: null, storedValueIv: null,
      allergiesCiphertext: null, allergiesIv: null,
      materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });

    // Import with only customer B (no customer A)
    await importExportService.applyImport({
      snapshot: {
        customers: [{
          id: 'new-cust', organizationId: orgId, name: 'New Customer',
          membershipTier: 'Gold', points: 100, ratingAverage: 0, ratingCount: 0,
          createdAt: Date.now(), updatedAt: Date.now(),
        }],
      },
      schemaVersion: DB_VERSION, actorId: adminUser.id,
    });

    // Re-login
    await authService.login('dh_admin', PASS);
    await authService.unlockProtectedData(PASS);

    // Old customer should be gone, new customer exists
    const all = await custRepo.findAll();
    expect(all.some((c) => c.id === 'old-cust')).toBe(false);
    expect(all.some((c) => c.id === 'new-cust')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. VERSIONING INVARIANT — ALWAYS ONE ACTIVE
// ══════════════════════════════════════════════════════════════════════════════

describe('Versioning invariant — single active per entity', () => {
  it('rapid create/deactivate/reactivate → exactly 1 active', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'colors', organizationId: orgId, name: 'Rapid',
      actorId: adminUser.id, reasonNote: 'Rapid invariant test',
    });

    for (let i = 0; i < 3; i++) {
      await lookupDataService.deactivateEntry({
        store: 'colors', entryId: entry.id, actorId: adminUser.id,
        reasonNote: `Deactivation cycle ${i + 1}`,
      });
      await lookupDataService.reactivateEntry({
        store: 'colors', entryId: entry.id, actorId: adminUser.id,
        reasonNote: `Reactivation cycle ${i + 1}`,
      });
    }

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);
    const activeCount = history.filter((v) => v.isActive).length;
    expect(activeCount).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. IMPORT ATOMICITY — FAILURE LEAVES SYSTEM UNCHANGED
// ══════════════════════════════════════════════════════════════════════════════

describe('Import atomicity — failure does not corrupt', () => {
  it('invalid record in snapshot prevents ALL writes', async () => {
    const custRepo = new CustomerRepository();
    await custRepo.create({
      id: 'pre-import', organizationId: orgId, name: 'Pre-Import',
      membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
      storedValueCiphertext: null, storedValueIv: null,
      allergiesCiphertext: null, allergiesIv: null,
      materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });

    // Try import with invalid users record (missing username)
    await expect(importExportService.applyImport({
      snapshot: {
        customers: [{ id: 'new-valid', organizationId: orgId, name: 'Valid' }],
        users: [{ id: 'bad-user', role: 'admin' }], // missing username
      },
      schemaVersion: DB_VERSION, actorId: adminUser.id,
    })).rejects.toThrow(/missing required field/i);

    // Pre-existing data should still be there (import rejected before writing)
    const all = await custRepo.findAll();
    expect(all.some((c) => c.id === 'pre-import')).toBe(true);
    expect(all.some((c) => c.id === 'new-valid')).toBe(false);
  });
});
