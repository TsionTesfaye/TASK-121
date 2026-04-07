/**
 * Integration tests — Hierarchical RBAC via OrgService.isInScope.
 *
 * Covers:
 *   - admin always granted access regardless of target node
 *   - user accessing own node (exact match)
 *   - user accessing child node (BFS subtree traversal)
 *   - user accessing grandchild node
 *   - user denied cross-branch access
 *   - user without organizationNodeId denied
 *   - hierarchy: company → factory → store → warehouse
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { orgService } from '../../src/services/OrgService.js';
import { orderService } from '../../src/services/OrderService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, ORG_NODE_TYPES } from '../../src/utils/constants.js';

const ADMIN = { id: 'admin-001', role: ROLES.ADMINISTRATOR, organizationNodeId: null };
const ORG_ID = 'org-test';

let companyNode, factoryNode, storeNode, warehouseNode;
let branchFactory, branchStore;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = ADMIN;

  // Build hierarchy: company → factory → store → warehouse
  //                         └─ branchFactory → branchStore
  companyNode = await orgService.createNode({
    parentId: null,
    type: ORG_NODE_TYPES.COMPANY,
    name: 'HQ',
    organizationId: ORG_ID,
    actorId: 'admin-001',
  });

  factoryNode = await orgService.createNode({
    parentId: companyNode.id,
    type: ORG_NODE_TYPES.FACTORY,
    name: 'Factory A',
    organizationId: ORG_ID,
    actorId: 'admin-001',
  });

  storeNode = await orgService.createNode({
    parentId: factoryNode.id,
    type: ORG_NODE_TYPES.STORE,
    name: 'Store A1',
    organizationId: ORG_ID,
    actorId: 'admin-001',
  });

  warehouseNode = await orgService.createNode({
    parentId: storeNode.id,
    type: ORG_NODE_TYPES.WAREHOUSE,
    name: 'Warehouse A1-1',
    organizationId: ORG_ID,
    actorId: 'admin-001',
  });

  // Separate branch: company → branchFactory → branchStore
  branchFactory = await orgService.createNode({
    parentId: companyNode.id,
    type: ORG_NODE_TYPES.FACTORY,
    name: 'Factory B',
    organizationId: ORG_ID,
    actorId: 'admin-001',
  });

  branchStore = await orgService.createNode({
    parentId: branchFactory.id,
    type: ORG_NODE_TYPES.STORE,
    name: 'Store B1',
    organizationId: ORG_ID,
    actorId: 'admin-001',
  });
});

afterEach(() => {
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ── Admin access ──────────────────────────────────────────────────────────────

describe('RBAC — admin access', () => {
  it('admin is always in scope for any node', async () => {
    expect(await orgService.isInScope(ADMIN, companyNode.id)).toBe(true);
    expect(await orgService.isInScope(ADMIN, storeNode.id)).toBe(true);
    expect(await orgService.isInScope(ADMIN, warehouseNode.id)).toBe(true);
    expect(await orgService.isInScope(ADMIN, branchStore.id)).toBe(true);
  });
});

// ── Own node access ───────────────────────────────────────────────────────────

describe('RBAC — user accessing own node', () => {
  it('user can access their own assigned node', async () => {
    const manager = { id: 'mgr-store', role: ROLES.STORE_MANAGER, organizationNodeId: storeNode.id };
    expect(await orgService.isInScope(manager, storeNode.id)).toBe(true);
  });

  it('factory manager can access their own factory', async () => {
    const manager = { id: 'mgr-factory', role: ROLES.STORE_MANAGER, organizationNodeId: factoryNode.id };
    expect(await orgService.isInScope(manager, factoryNode.id)).toBe(true);
  });
});

// ── Child node access (BFS subtree) ──────────────────────────────────────────

describe('RBAC — user accessing child nodes', () => {
  it('factory manager can access child store', async () => {
    const manager = { id: 'mgr-factory', role: ROLES.STORE_MANAGER, organizationNodeId: factoryNode.id };
    expect(await orgService.isInScope(manager, storeNode.id)).toBe(true);
  });

  it('factory manager can access grandchild warehouse', async () => {
    const manager = { id: 'mgr-factory', role: ROLES.STORE_MANAGER, organizationNodeId: factoryNode.id };
    expect(await orgService.isInScope(manager, warehouseNode.id)).toBe(true);
  });

  it('company-level user can access all nodes in the tree', async () => {
    const manager = { id: 'mgr-company', role: ROLES.STORE_MANAGER, organizationNodeId: companyNode.id };
    expect(await orgService.isInScope(manager, factoryNode.id)).toBe(true);
    expect(await orgService.isInScope(manager, storeNode.id)).toBe(true);
    expect(await orgService.isInScope(manager, warehouseNode.id)).toBe(true);
    expect(await orgService.isInScope(manager, branchFactory.id)).toBe(true);
    expect(await orgService.isInScope(manager, branchStore.id)).toBe(true);
  });

  it('store manager can access child warehouse', async () => {
    const manager = { id: 'mgr-store', role: ROLES.STORE_MANAGER, organizationNodeId: storeNode.id };
    expect(await orgService.isInScope(manager, warehouseNode.id)).toBe(true);
  });
});

// ── Cross-branch denial ───────────────────────────────────────────────────────

describe('RBAC — cross-branch access denied', () => {
  it('store A manager cannot access store B (different branch)', async () => {
    const manager = { id: 'mgr-store-a', role: ROLES.STORE_MANAGER, organizationNodeId: storeNode.id };
    expect(await orgService.isInScope(manager, branchStore.id)).toBe(false);
  });

  it('factory A manager cannot access factory B store', async () => {
    const manager = { id: 'mgr-factory-a', role: ROLES.STORE_MANAGER, organizationNodeId: factoryNode.id };
    expect(await orgService.isInScope(manager, branchStore.id)).toBe(false);
  });

  it('warehouse manager CAN access parent store (ancestor access)', async () => {
    const manager = { id: 'mgr-wh', role: ROLES.STORE_MANAGER, organizationNodeId: warehouseNode.id };
    // Ancestors are accessible — data owned by parent store is readable.
    expect(await orgService.isInScope(manager, storeNode.id)).toBe(true);
  });

  it('store A manager CAN access company root (ancestor access)', async () => {
    const manager = { id: 'mgr-store-a', role: ROLES.STORE_MANAGER, organizationNodeId: storeNode.id };
    // Company root is an ancestor — store users can access org-level data.
    expect(await orgService.isInScope(manager, companyNode.id)).toBe(true);
  });
});

// ── No org node ───────────────────────────────────────────────────────────────

describe('RBAC — user without organizationNodeId', () => {
  it('user with no organizationNodeId is denied', async () => {
    const unassigned = { id: 'user-unassigned', role: ROLES.STORE_MANAGER, organizationNodeId: null };
    expect(await orgService.isInScope(unassigned, storeNode.id)).toBe(false);
  });
});

// ── Service-level RBAC enforcement ───────────────────────────────────────────

describe('RBAC — service layer enforcement', () => {
  it('store manager can fetch orders for own store', async () => {
    authService._currentUser = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: storeNode.id };
    // getByStore returns empty list (no orders seeded) but does not throw
    const orders = await orderService.getByStore(storeNode.id);
    expect(Array.isArray(orders)).toBe(true);
  });

  it('store manager is denied access to cross-branch store', async () => {
    authService._currentUser = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: storeNode.id };
    await expect(orderService.getByStore(branchStore.id)).rejects.toThrow('Scope violation');
  });

  it('factory manager can fetch orders for child store', async () => {
    authService._currentUser = { id: 'mgr-factory', role: ROLES.STORE_MANAGER, organizationNodeId: factoryNode.id };
    const orders = await orderService.getByStore(storeNode.id);
    expect(Array.isArray(orders)).toBe(true);
  });
});
