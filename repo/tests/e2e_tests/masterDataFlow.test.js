/**
 * E2E Simulation — Master data versioning flow.
 *
 * Covers:
 *   - Publish first version (no prior active)
 *   - Active version is retrievable
 *   - Publish second version deactivates first
 *   - Version history ordered newest-first
 *   - Stale expectedActiveVersionId → concurrency conflict rejected
 *   - Reason note is required
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { MasterDataService } from '../../src/services/MasterDataService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, MASTER_DATA_ENTITY_TYPES } from '../../src/utils/constants.js';

const ADMIN = { id: 'admin-001', role: ROLES.ADMINISTRATOR, organizationNodeId: 'org-001' };
const ORG_ID = 'org-001';
const ENTITY_ID = 'brand-entity-v1';
const ENTITY_TYPE = MASTER_DATA_ENTITY_TYPES.BRAND;

function publish(svc, override = {}) {
  return svc.publishVersion({
    entityType: ENTITY_TYPE,
    entityId: ENTITY_ID,
    organizationId: ORG_ID,
    payload: { items: ['burger', 'fries'] },
    reasonNote: 'Initial menu release.',
    createdBy: ADMIN.id,
    expectedActiveVersionId: null,
    ...override,
  });
}

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = ADMIN;
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
});

describe('Master data versioning', () => {
  it('publishes first version with no prior active', async () => {
    const svc = new MasterDataService();
    const v1 = await publish(svc);
    expect(v1.versionNumber).toBe(1);
    expect(v1.isActive).toBe(true);
  });

  it('active version is retrievable after publish', async () => {
    const svc = new MasterDataService();
    const v1 = await publish(svc);
    const active = await svc.getActiveVersion(ENTITY_TYPE, ORG_ID);
    expect(active.id).toBe(v1.id);
    expect(active.isActive).toBe(true);
  });

  it('publishing a second version deactivates the first', async () => {
    const svc = new MasterDataService();
    const v1 = await publish(svc);
    const v2 = await publish(svc, { expectedActiveVersionId: v1.id, reasonNote: 'Menu refresh.' });

    expect(v2.versionNumber).toBe(2);
    expect(v2.isActive).toBe(true);

    const active = await svc.getActiveVersion(ENTITY_TYPE, ORG_ID);
    expect(active.id).toBe(v2.id);
  });

  it('version history lists all versions ordered newest first', async () => {
    const svc = new MasterDataService();
    const v1 = await publish(svc);
    const v2 = await publish(svc, { expectedActiveVersionId: v1.id, reasonNote: 'Menu refresh.' });

    const history = await svc.getVersionHistory(ENTITY_ID);
    expect(history[0].versionNumber).toBeGreaterThanOrEqual(history[1].versionNumber);
    expect(history.some((v) => v.id === v1.id)).toBe(true);
    expect(history.some((v) => v.id === v2.id)).toBe(true);
  });

  it('stale expectedActiveVersionId → concurrency conflict rejected', async () => {
    const svc = new MasterDataService();
    const v1 = await publish(svc);
    // Publish v2 legitimately — v1 is now inactive.
    await publish(svc, { expectedActiveVersionId: v1.id, reasonNote: 'Menu refresh.' });

    // Now try to publish using v1 as expected active (stale).
    await expect(
      publish(svc, { expectedActiveVersionId: v1.id, reasonNote: 'Conflict attempt.' }),
    ).rejects.toThrow(/concurrency/i);
  });

  it('missing reason note is rejected', async () => {
    const svc = new MasterDataService();
    await expect(
      publish(svc, { reasonNote: '' }),
    ).rejects.toThrow(/reason/i);
  });
});
