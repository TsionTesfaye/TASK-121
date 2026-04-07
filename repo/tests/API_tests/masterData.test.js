/**
 * Integration tests — Master Data versioning.
 *
 * Covers:
 *   - full publish flow
 *   - stale-publish rejection (optimistic concurrency)
 *   - version history accumulation
 *   - reason note enforcement
 *   - RBAC: analyst cannot publish
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
const ENTITY_TYPE = MASTER_DATA_ENTITY_TYPES.COLOR;

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

describe('Master data publish flow', () => {
  it('publishes the first version with version number 1', async () => {
    const v = await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'color-red',
      organizationId: ORG_ID,
      payload: { name: 'Red', hex: '#FF0000' },
      reasonNote: 'Initial color release',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    expect(v.versionNumber).toBe(1);
    expect(v.isActive).toBe(true);
    expect(v.entityType).toBe(ENTITY_TYPE);
  });

  it('getActiveVersion returns the published version', async () => {
    await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'color-blue',
      organizationId: ORG_ID,
      payload: { name: 'Blue' },
      reasonNote: 'Adding blue color',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    const active = await masterDataService.getActiveVersion(ENTITY_TYPE, ORG_ID);
    expect(active).not.toBeNull();
    expect(active.payload.name).toBe('Blue');
  });

  it('publishes second version with version number 2', async () => {
    const v1 = await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'color-green',
      organizationId: ORG_ID,
      payload: { name: 'Green v1' },
      reasonNote: 'Initial green release',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    const v2 = await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'color-green',
      organizationId: ORG_ID,
      payload: { name: 'Green v2' },
      reasonNote: 'Updated green shade to forest',
      createdBy: 'admin-001',
      expectedActiveVersionId: v1.id,
    });

    expect(v2.versionNumber).toBe(2);
    expect(v2.isActive).toBe(true);

    // Previous version is deactivated
    const active = await masterDataService.getActiveVersion(ENTITY_TYPE, ORG_ID);
    expect(active.id).toBe(v2.id);
  });

  it('accumulates version history', async () => {
    await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'color-yellow',
      organizationId: ORG_ID,
      payload: { name: 'Yellow v1' },
      reasonNote: 'Initial yellow',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    const activeV1 = await masterDataService.getActiveVersion(ENTITY_TYPE, ORG_ID);

    await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'color-yellow',
      organizationId: ORG_ID,
      payload: { name: 'Yellow v2' },
      reasonNote: 'Updated yellow brightness',
      createdBy: 'admin-001',
      expectedActiveVersionId: activeV1.id,
    });

    const history = await masterDataService.getVersionHistory('color-yellow');
    expect(history.length).toBe(2);
  });
});

// ── Stale publish rejection ───────────────────────────────────────────────────

describe('Stale publish rejection (optimistic concurrency)', () => {
  it('rejects a publish when expectedActiveVersionId is stale', async () => {
    const v1 = await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'color-orange',
      organizationId: ORG_ID,
      payload: { name: 'Orange' },
      reasonNote: 'Initial orange',
      createdBy: 'admin-001',
      expectedActiveVersionId: null,
    });

    // Simulate tab 2 publishing a version first
    await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'color-orange',
      organizationId: ORG_ID,
      payload: { name: 'Orange v2' },
      reasonNote: 'Tab 2 published this',
      createdBy: 'admin-001',
      expectedActiveVersionId: v1.id,
    });

    // Now tab 1 tries to publish with the OLD expectedActiveVersionId
    await expect(
      masterDataService.publishVersion({
        entityType: ENTITY_TYPE,
        entityId: 'color-orange',
        organizationId: ORG_ID,
        payload: { name: 'Orange v3 from stale tab' },
        reasonNote: 'This should fail due to conflict',
        createdBy: 'admin-001',
        expectedActiveVersionId: v1.id, // stale!
      }),
    ).rejects.toThrow('Concurrency conflict');
  });
});

// ── Reason note enforcement ───────────────────────────────────────────────────

describe('Reason note enforcement', () => {
  it('rejects reason notes shorter than 10 chars', async () => {
    await expect(
      masterDataService.publishVersion({
        entityType: ENTITY_TYPE,
        entityId: 'color-x',
        organizationId: ORG_ID,
        payload: {},
        reasonNote: 'short',
        createdBy: 'admin-001',
        expectedActiveVersionId: null,
      }),
    ).rejects.toThrow();
  });

  it('rejects whitespace-only reason notes', async () => {
    await expect(
      masterDataService.publishVersion({
        entityType: ENTITY_TYPE,
        entityId: 'color-x',
        organizationId: ORG_ID,
        payload: {},
        reasonNote: '          ',
        createdBy: 'admin-001',
        expectedActiveVersionId: null,
      }),
    ).rejects.toThrow();
  });
});

// ── RBAC ─────────────────────────────────────────────────────────────────────

describe('Master data RBAC', () => {
  it('ANALYST cannot publish a version', async () => {
    authService._currentUser = { id: 'analyst-001', role: ROLES.ANALYST, organizationNodeId: ORG_ID };
    await expect(
      masterDataService.publishVersion({
        entityType: ENTITY_TYPE,
        entityId: 'color-z',
        organizationId: ORG_ID,
        payload: {},
        reasonNote: 'Analyst trying to publish',
        createdBy: 'analyst-001',
        expectedActiveVersionId: null,
      }),
    ).rejects.toThrow('Permission denied');
  });

  it('STORE_MANAGER can publish for their org', async () => {
    authService._currentUser = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_ID };
    const v = await masterDataService.publishVersion({
      entityType: ENTITY_TYPE,
      entityId: 'color-mgr',
      organizationId: ORG_ID,
      payload: { name: 'Manager Color' },
      reasonNote: 'Store manager publishing',
      createdBy: 'mgr-001',
      expectedActiveVersionId: null,
    });
    expect(v.versionNumber).toBe(1);
  });

  it('STORE_MANAGER cannot publish for another org', async () => {
    authService._currentUser = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_ID };
    await expect(
      masterDataService.publishVersion({
        entityType: ENTITY_TYPE,
        entityId: 'color-other',
        organizationId: 'other-org',
        payload: {},
        reasonNote: 'Cross-org publish attempt',
        createdBy: 'mgr-001',
        expectedActiveVersionId: null,
      }),
    ).rejects.toThrow('Scope violation');
  });
});

// ── Unknown entity type ───────────────────────────────────────────────────────

describe('Invalid entity type rejection', () => {
  it('rejects unknown entity types', async () => {
    await expect(
      masterDataService.publishVersion({
        entityType: 'invalid_type',
        entityId: 'e1',
        organizationId: ORG_ID,
        payload: {},
        reasonNote: 'This should fail',
        createdBy: 'admin-001',
        expectedActiveVersionId: null,
      }),
    ).rejects.toThrow('Unknown entity type');
  });
});
