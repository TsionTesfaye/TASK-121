/**
 * Org context resolution tests — ensures non-admin users work with empty orgTree.
 *
 * Covers:
 *   1. resolveOrgContext with empty tree uses nodeId fallback
 *   2. resolveRootOrgId resolves to root company via repository
 *   3. Store manager with store-level node can create orders/tickets
 *   4. Dictionary persistence resolves to root org
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { OrderService } from '../../src/services/OrderService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { orgService } from '../../src/services/OrgService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { resolveOrgContext, resolveRootOrgId } from '../../src/app/stores/org.js';
import { ROLES, ORG_NODE_TYPES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'OrgCtx@1234567';
const MGR_PASS = 'OrgCtx@1234567';
let companyId;
let storeId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'ctx_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'CtxTestCo',
  });
  companyId = org.id;
  adminUser = admin;

  await authService.login('ctx_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

  // Build hierarchy: company → factory → store
  const factory = await orgService.createNode({
    parentId: companyId, type: ORG_NODE_TYPES.FACTORY, name: 'F1',
    organizationId: companyId, actorId: adminUser.id,
  });
  const store = await orgService.createNode({
    parentId: factory.id, type: ORG_NODE_TYPES.STORE, name: 'S1',
    organizationId: companyId, actorId: adminUser.id,
  });
  storeId = store.id;

  // Create store manager assigned to the store node
  await authService.createUser({
    username: 'store_mgr', password: MGR_PASS,
    role: ROLES.STORE_MANAGER, organizationNodeId: storeId,
  });

  // Seed customer at company level
  const custRepo = new CustomerRepository();
  await custRepo.create({
    id: 'cust-ctx', organizationId: companyId, name: 'Ctx Customer',
    membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
    storedValueCiphertext: null, storedValueIv: null,
    allergiesCiphertext: null, allergiesIv: null,
    materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. RESOLVE ORG CONTEXT — EMPTY TREE FALLBACK
// ══════════════════════════════════════════════════════════════════════════════

describe('resolveOrgContext — empty tree fallback', () => {
  it('with populated tree → resolves root orgId correctly', async () => {
    const tree = await orgService.getTree(companyId);
    const ctx = resolveOrgContext({ organizationNodeId: storeId }, tree);
    expect(ctx.organizationId).toBe(companyId);
    expect(ctx.storeId).toBe(storeId);
  });

  it('with empty tree → falls back to nodeId (may be incorrect for child nodes)', () => {
    const ctx = resolveOrgContext({ organizationNodeId: storeId }, []);
    // Without tree, can't resolve → falls back to nodeId
    expect(ctx.storeId).toBe(storeId);
    // organizationId equals nodeId when tree is empty (the fallback)
    expect(ctx.organizationId).toBe(storeId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. RESOLVE ROOT ORG ID — REPOSITORY LOOKUP
// ══════════════════════════════════════════════════════════════════════════════

describe('resolveRootOrgId — repository-backed', () => {
  it('resolves store node to root company via repository', async () => {
    const rootId = await resolveRootOrgId(storeId);
    expect(rootId).toBe(companyId);
  });

  it('resolves company node to itself', async () => {
    const rootId = await resolveRootOrgId(companyId);
    expect(rootId).toBe(companyId);
  });

  it('returns nodeId for nonexistent node', async () => {
    const rootId = await resolveRootOrgId('ghost-node');
    expect(rootId).toBe('ghost-node');
  });

  it('returns empty for null input', async () => {
    const rootId = await resolveRootOrgId(null);
    expect(rootId).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. STORE MANAGER E2E — WORKS WITH HIERARCHY
// ══════════════════════════════════════════════════════════════════════════════

describe('Store manager at store node — end-to-end', () => {
  beforeEach(async () => {
    await authService.logout();
    await authService.login('store_mgr', MGR_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
  });

  it('can create order with correct org/store split', async () => {
    const svc = new OrderService();
    const order = await svc.createOrder({
      customerId: 'cust-ctx',
      organizationId: companyId,
      storeId,
      items: [],
      actorId: authService.getCurrentUser().id,
    });
    expect(order.organizationId).toBe(companyId);
    expect(order.storeId).toBe(storeId);
  });

  it('can create ticket with correct org/store split', async () => {
    const ticket = await ticketService.createTicket({
      customerId: 'cust-ctx',
      organizationId: companyId,
      storeId,
      subject: 'Store mgr ticket', description: 'Test',
      category: 'general', priority: 'low',
      actorId: authService.getCurrentUser().id,
    });
    expect(ticket.organizationId).toBe(companyId);
    expect(ticket.storeId).toBe(storeId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. DICTIONARY PERSISTENCE — ROOT ORG RESOLUTION
// ══════════════════════════════════════════════════════════════════════════════

describe('Dictionary persistence — resolves to root org', () => {
  it('store manager updates dictionary → persists at root org', async () => {
    await authService.logout();
    await authService.login('store_mgr', MGR_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

    await riskReviewService.updateSensitiveWords(['fraud', 'scam'], authService.getCurrentUser().id);

    // Clear and reload from the ROOT org (should find the data)
    riskReviewService.clearDictionary();
    await riskReviewService.loadPersistedDictionary(companyId);
    expect(riskReviewService.getSensitiveWords()).toEqual(['fraud', 'scam']);
  });

  it('App.svelte seeds orgTree on user change', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/App.svelte'), 'utf8');
    expect(content).toContain('repo.findById($currentUser.organizationNodeId)');
    expect(content).toContain('orgTree.set([node])');
  });
});
