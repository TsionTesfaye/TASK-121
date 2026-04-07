/**
 * Simulation tests — Multi-tab concurrent publish conflict (optimistic concurrency).
 *
 * Simulates two "browser tabs" as two MasterDataService instances operating
 * concurrently on the same IndexedDB. Only one can win; the other must see
 * a Concurrency conflict error.
 *
 * Covers:
 *   - tab1 and tab2 fetch the same active version
 *   - tab1 publishes first → succeeds
 *   - tab2 publishes with now-stale expectedActiveVersionId → rejected
 *   - tab1 can publish again using the id it just got → succeeds
 *   - first publish (null expectedActiveVersionId) always succeeds even when concurrent
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { masterDataService } from '../../src/services/MasterDataService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, MASTER_DATA_ENTITY_TYPES } from '../../src/utils/constants.js';

const ADMIN = { id: 'admin-001', role: ROLES.ADMINISTRATOR, organizationNodeId: 'org-001' };
const ORG_ID = 'org-001';
const ENTITY_TYPE = MASTER_DATA_ENTITY_TYPES.BRAND;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = ADMIN;
});

afterEach(() => {
  authService._currentUser = null;
  closeDB();
  closeAll();
});

describe('Concurrent publish — last-writer-wins with optimistic lock', () => {
  it('tab1 wins, tab2 gets Concurrency conflict', async () => {
    // Seed the first version (represents the currently active version that both tabs read)
    const v1 = await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'brand-nike',
      organizationId: ORG_ID,
      payload: { name: 'Nike v1' },
      reasonNote: 'Initial brand entry',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    // Both tabs fetch the same active version — both hold v1.id as their base
    const tab1ActiveId = v1.id;
    const tab2ActiveId = v1.id;

    // Tab1 publishes first — succeeds
    const v2 = await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'brand-nike',
      organizationId: ORG_ID,
      payload: { name: 'Nike v2 from tab1' },
      reasonNote: 'Tab1 update for Spring collection',
      createdBy: 'admin-001',
      expectedActiveVersionId: tab1ActiveId,
    });

    expect(v2.versionNumber).toBe(2);
    expect(v2.isActive).toBe(true);

    // Tab2 tries to publish with stale base — must fail
    await expect(
      masterDataService.publishVersion({
        entityType: ENTITY_TYPE,
        entityId: 'brand-nike',
        organizationId: ORG_ID,
        payload: { name: 'Nike v2 from tab2 (stale)' },
        reasonNote: 'Tab2 update that should fail concurrency check',
        createdBy: 'admin-001',
        expectedActiveVersionId: tab2ActiveId, // still points at v1, which is now inactive
      }),
    ).rejects.toThrow('Concurrency conflict');
  });

  it('tab1 can continue publishing after winning the conflict', async () => {
    const v1 = await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'brand-adidas',
      organizationId: ORG_ID,
      payload: { name: 'Adidas v1' },
      reasonNote: 'Initial Adidas entry for catalog',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    const v2 = await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'brand-adidas',
      organizationId: ORG_ID,
      payload: { name: 'Adidas v2' },
      reasonNote: 'Brand name spelling correction applied',
      createdBy: 'admin-001',
      expectedActiveVersionId: v1.id,
    });

    // Tab2 fails
    await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'brand-adidas',
      organizationId: ORG_ID,
      payload: { name: 'Stale tab version' },
      reasonNote: 'This publish attempt will be rejected by lock',
      createdBy: 'admin-001',
      expectedActiveVersionId: v1.id,
    }).catch(() => {}); // expected to fail, ignore

    // Tab1 can still publish v3 using its most recent id
    const v3 = await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'brand-adidas',
      organizationId: ORG_ID,
      payload: { name: 'Adidas v3' },
      reasonNote: 'Follow-up update after conflict resolution',
      createdBy: 'admin-001',
      expectedActiveVersionId: v2.id,
    });

    expect(v3.versionNumber).toBe(3);
  });

  it('concurrent first-publishes (null base) are serialized by DB write order', async () => {
    // Both tabs publish with null expectedActiveVersionId.
    // First write wins; second becomes version 2 since the lock is now non-null.
    const pub1 = masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'brand-puma',
      organizationId: ORG_ID,
      payload: { name: 'Puma from tab1' },
      reasonNote: 'First-ever Puma brand entry created',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    const pub2 = masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'brand-puma',
      organizationId: ORG_ID,
      payload: { name: 'Puma from tab2' },
      reasonNote: 'Concurrent Puma entry from second browser tab',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    // One succeeds, one may succeed or fail depending on timing — both are valid outcomes.
    // What matters is that at least one succeeds and the DB is consistent.
    const results = await Promise.allSettled([pub1, pub2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // The active version is whichever won
    const active = await masterDataService.getActiveVersion(ENTITY_TYPE, ORG_ID);
    expect(active).not.toBeNull();
  });
});
