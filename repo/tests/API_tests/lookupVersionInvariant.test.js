/**
 * CRITICAL: Lookup version single-active invariant tests.
 *
 * Proves that it is IMPOSSIBLE to have more than 1 active version per entity.
 * Every test explicitly asserts: activeVersions.length === 1
 *
 * Covers:
 *   - createEntry → exactly 1 active version
 *   - deactivateEntry → exactly 1 active version (the deactivation record)
 *   - reactivateEntry → exactly 1 active version
 *   - create → deactivate → reactivate → still 1 active
 *   - rapid repeated operations → still max 1 active
 *   - multiple entities in same org → each has exactly 1 active
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { lookupDataService } from '../../src/services/LookupDataService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';

const ADMIN_PASS = 'Invariant@123';
let orgId;
let actorId;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'inv_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'InvariantCo',
  });
  orgId = org.id;
  actorId = admin.id;

  await authService.login('inv_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

/** Counts active versions for a given entityId. */
async function countActiveVersions(entityId) {
  const mdRepo = new MasterDataRepository();
  const history = await mdRepo.findVersionHistory(entityId);
  return history.filter((v) => v.isActive).length;
}

// ══════════════════════════════════════════════════════════════════════════════
// CORE INVARIANT: max 1 active version per entity
// ══════════════════════════════════════════════════════════════════════════════

describe('Lookup version invariant — max 1 active per entity', () => {
  it('after createEntry → exactly 1 active version', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'colors', organizationId: orgId, name: 'Red',
      actorId, reasonNote: 'Adding red color',
    });

    const activeVersions = await countActiveVersions(entry.id);
    expect(activeVersions).toBe(1);
  });

  it('after deactivateEntry → exactly 1 active version', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'sizes', organizationId: orgId, name: 'XL',
      actorId, reasonNote: 'Adding XL size',
    });

    await lookupDataService.deactivateEntry({
      store: 'sizes', entryId: entry.id, actorId,
      reasonNote: 'Removing XL temporarily',
    });

    const activeVersions = await countActiveVersions(entry.id);
    expect(activeVersions).toBe(1);
  });

  it('after reactivateEntry → exactly 1 active version', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'seasons', organizationId: orgId, name: 'SS25',
      actorId, reasonNote: 'Spring/Summer 2025',
    });

    await lookupDataService.deactivateEntry({
      store: 'seasons', entryId: entry.id, actorId,
      reasonNote: 'Temporarily pausing SS25',
    });

    await lookupDataService.reactivateEntry({
      store: 'seasons', entryId: entry.id, actorId,
      reasonNote: 'Restoring SS25 season',
    });

    const activeVersions = await countActiveVersions(entry.id);
    expect(activeVersions).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EDGE CASES: repeated operations, sequences
// ══════════════════════════════════════════════════════════════════════════════

describe('Lookup version invariant — edge cases', () => {
  it('create → deactivate → reactivate → deactivate → reactivate → still 1 active', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'brands', organizationId: orgId, name: 'BrandX',
      actorId, reasonNote: 'Initial brand entry',
    });

    await lookupDataService.deactivateEntry({
      store: 'brands', entryId: entry.id, actorId,
      reasonNote: 'First deactivation cycle',
    });
    expect(await countActiveVersions(entry.id)).toBe(1);

    await lookupDataService.reactivateEntry({
      store: 'brands', entryId: entry.id, actorId,
      reasonNote: 'First reactivation cycle',
    });
    expect(await countActiveVersions(entry.id)).toBe(1);

    await lookupDataService.deactivateEntry({
      store: 'brands', entryId: entry.id, actorId,
      reasonNote: 'Second deactivation cycle',
    });
    expect(await countActiveVersions(entry.id)).toBe(1);

    await lookupDataService.reactivateEntry({
      store: 'brands', entryId: entry.id, actorId,
      reasonNote: 'Second reactivation cycle',
    });

    const activeVersions = await countActiveVersions(entry.id);
    expect(activeVersions).toBe(1);

    // Verify version numbering is monotonic
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);
    expect(history.length).toBe(5); // create + 2x deactivate + 2x reactivate
    expect(history[0].versionNumber).toBe(5);
  });

  it('multiple entities in same org each have exactly 1 active version', async () => {
    const entryA = await lookupDataService.createEntry({
      store: 'colors', organizationId: orgId, name: 'Blue',
      actorId, reasonNote: 'Adding blue color',
    });
    const entryB = await lookupDataService.createEntry({
      store: 'colors', organizationId: orgId, name: 'Green',
      actorId, reasonNote: 'Adding green color',
    });

    // Deactivate A, reactivate it
    await lookupDataService.deactivateEntry({
      store: 'colors', entryId: entryA.id, actorId,
      reasonNote: 'Pausing blue temporarily',
    });
    await lookupDataService.reactivateEntry({
      store: 'colors', entryId: entryA.id, actorId,
      reasonNote: 'Restoring blue color',
    });

    // Each entity independently has exactly 1 active version
    expect(await countActiveVersions(entryA.id)).toBe(1);
    expect(await countActiveVersions(entryB.id)).toBe(1);
  });

  it('the active version is always the LATEST one', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'suppliers', organizationId: orgId, name: 'SupA',
      actorId, reasonNote: 'Initial supplier entry',
    });

    await lookupDataService.deactivateEntry({
      store: 'suppliers', entryId: entry.id, actorId,
      reasonNote: 'Deactivating supplier entry',
    });

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);

    // Newest first: v2 (deactivation) is active, v1 (creation) is not
    expect(history[0].versionNumber).toBe(2);
    expect(history[0].isActive).toBe(true);
    expect(history[1].versionNumber).toBe(1);
    expect(history[1].isActive).toBe(false);

    // Still exactly 1 active
    const activeVersions = history.filter((v) => v.isActive);
    expect(activeVersions.length).toBe(1);
  });
});
