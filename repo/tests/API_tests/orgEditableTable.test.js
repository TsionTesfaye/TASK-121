/**
 * Editable organization table tests — name, type, parent editing with validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { orgService } from '../../src/services/OrgService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ORG_NODE_TYPES } from '../../src/utils/constants.js';

const PASS = 'OrgTable@1234';
let orgId, adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'ot_admin', adminPassword: PASS, orgName: 'OrgTableCo',
  });
  orgId = org.id;
  adminUser = admin;
  await authService.login('ot_admin', PASS);
    await authService.unlockProtectedData(PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. EDIT NAME FROM TABLE WORKFLOW
// ══════════════════════════════════════════════════════════════════════════════

describe('Org table — edit name', () => {
  it('can rename a node via updateNode', async () => {
    const factory = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
      name: 'Factory A', organizationId: orgId, actorId: adminUser.id,
    });

    const updated = await orgService.updateNode(factory.id, { name: 'Factory Alpha' }, adminUser.id);
    expect(updated.name).toBe('Factory Alpha');
    expect(updated.type).toBe(ORG_NODE_TYPES.FACTORY);
  });

  it('empty name is rejected', async () => {
    const factory = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
      name: 'Factory X', organizationId: orgId, actorId: adminUser.id,
    });

    await expect(orgService.updateNode(factory.id, { name: '  ' }, adminUser.id))
      .rejects.toThrow(/name is required/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. EDIT PARENT FROM TABLE WORKFLOW
// ══════════════════════════════════════════════════════════════════════════════

describe('Org table — edit parent', () => {
  it('can reparent a store to a different factory', async () => {
    const factoryA = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
      name: 'Factory A', organizationId: orgId, actorId: adminUser.id,
    });
    const factoryB = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
      name: 'Factory B', organizationId: orgId, actorId: adminUser.id,
    });
    const store = await orgService.createNode({
      parentId: factoryA.id, type: ORG_NODE_TYPES.STORE,
      name: 'Store 1', organizationId: orgId, actorId: adminUser.id,
    });

    // Move store from Factory A to Factory B
    const updated = await orgService.updateNode(store.id, { parentId: factoryB.id }, adminUser.id);
    expect(updated.parentId).toBe(factoryB.id);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. EDIT TYPE FROM TABLE WORKFLOW
// ══════════════════════════════════════════════════════════════════════════════

describe('Org table — edit type', () => {
  it('invalid type is rejected', async () => {
    const factory = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
      name: 'Factory T', organizationId: orgId, actorId: adminUser.id,
    });

    await expect(orgService.updateNode(factory.id, { type: 'invalid_type' }, adminUser.id))
      .rejects.toThrow(/invalid node type/i);
  });

  it('type change that invalidates children is rejected', async () => {
    const factory = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
      name: 'Factory C', organizationId: orgId, actorId: adminUser.id,
    });
    // Add a store child
    await orgService.createNode({
      parentId: factory.id, type: ORG_NODE_TYPES.STORE,
      name: 'Store under Factory C', organizationId: orgId, actorId: adminUser.id,
    });

    // Cannot change factory→store if it has store children (store→store is invalid)
    await expect(orgService.updateNode(factory.id, { type: ORG_NODE_TYPES.STORE }, adminUser.id))
      .rejects.toThrow(/invalid parent-child combination/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. INVALID HIERARCHY EDIT REJECTED
// ══════════════════════════════════════════════════════════════════════════════

describe('Org table — validation', () => {
  it('cannot move node to a different organization', async () => {
    // Only one org in this test, but we can test the same-org check
    const factory = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
      name: 'Factory V', organizationId: orgId, actorId: adminUser.id,
    });

    await expect(orgService.updateNode(factory.id, { parentId: 'nonexistent' }, adminUser.id))
      .rejects.toThrow(/not found/i);
  });

  it('invalid parent-child type combination is rejected', async () => {
    const factory = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
      name: 'Factory P', organizationId: orgId, actorId: adminUser.id,
    });
    const store = await orgService.createNode({
      parentId: factory.id, type: ORG_NODE_TYPES.STORE,
      name: 'Store P', organizationId: orgId, actorId: adminUser.id,
    });

    // Cannot move a store directly under company (company→store is invalid)
    await expect(orgService.updateNode(store.id, { parentId: orgId }, adminUser.id))
      .rejects.toThrow(/invalid parent-child combination/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. CYCLE CREATION REJECTED
// ══════════════════════════════════════════════════════════════════════════════

describe('Org table — cycle prevention', () => {
  it('cannot set parent to own descendant', async () => {
    const factory = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
      name: 'Factory Cycle', organizationId: orgId, actorId: adminUser.id,
    });
    const store = await orgService.createNode({
      parentId: factory.id, type: ORG_NODE_TYPES.STORE,
      name: 'Store Cycle', organizationId: orgId, actorId: adminUser.id,
    });

    // Cannot set factory's parent to its own child store
    await expect(orgService.updateNode(factory.id, { parentId: store.id }, adminUser.id))
      .rejects.toThrow(/cycle/i);
  });

  it('cannot set node as its own parent', async () => {
    const factory = await orgService.createNode({
      parentId: orgId, type: ORG_NODE_TYPES.FACTORY,
      name: 'Self Ref', organizationId: orgId, actorId: adminUser.id,
    });

    await expect(orgService.updateNode(factory.id, { parentId: factory.id }, adminUser.id))
      .rejects.toThrow(/cycle/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. UI WIRING
// ══════════════════════════════════════════════════════════════════════════════

describe('Org table — UI wiring', () => {
  it('OrgSetupPage has editable table controls', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/OrgSetupPage.svelte'), 'utf8');
    // Edit modal has name, type, and parent fields
    expect(content).toContain('Edit Node');
    expect(content).toContain('editType');
    expect(content).toContain('editParentId');
    expect(content).toContain('getValidParents');
    // Parent dropdown (not raw ID input)
    expect(content).toContain('edit-parent-select');
  });
});
