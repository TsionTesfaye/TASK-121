/**
 * Integration tests — Cross-org scope enforcement.
 *
 * Verifies that non-admin users cannot read or mutate data outside their
 * assigned organization subtree.
 *
 * Covers:
 *   - CustomerService: cross-org create and read denied
 *   - LookupDataService: cross-org create and list denied
 *   - NotificationService: cross-org upsertChannel and getQueueByOrg denied
 *   - RiskReviewService: cross-org ingestBidEvent and getInbox denied
 *   - Cross-branch denial (sibling org nodes)
 *   - Nested descendant allow (user in parent can access child)
 *   - Out-of-scope reads and writes on additional service methods
 *   - NLPService: cross-org runBatch, runIncremental, getRunHistory, clusterTopics denied
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { lookupDataService } from '../../src/services/LookupDataService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { masterDataService } from '../../src/services/MasterDataService.js';
import { nlpService } from '../../src/services/NLPService.js';
import { orgService } from '../../src/services/OrgService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { CustomerRepository } from '../../src/repositories/implementations/CustomerRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, ORG_NODE_TYPES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'ScopeTest@1234';
const OTHER_ORG_ID = 'foreign-org-00000000';

let myOrgId;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { org } = await bs.bootstrap({
    adminUsername: 'scope_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'ScopeTestCo',
  });

  myOrgId = org.id;
  await authService.login('scope_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

  // Seed customers used by ticket tests (with known IDs).
  const custRepo = new CustomerRepository();
  for (const id of ['cust-001', 'cust-002']) {
    await custRepo.create({
      id, organizationId: myOrgId, name: `Customer ${id}`,
      membershipTier: 'Bronze', points: 0, ratingAverage: 0, ratingCount: 0,
      storedValueCiphertext: null, storedValueIv: null,
      allergiesCiphertext: null, allergiesIv: null,
      materialRestrictionsCiphertext: null, materialRestrictionsIv: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  }
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

function setNonAdmin() {
  authService._currentUser = {
    id: 'staff-001',
    role: ROLES.STORE_MANAGER,
    organizationNodeId: myOrgId,
  };
}

function setReviewer() {
  authService._currentUser = {
    id: 'reviewer-001',
    role: ROLES.REVIEWER,
    organizationNodeId: myOrgId,
  };
}

// ── CustomerService ───────────────────────────────────────────────────────────

describe('Scope enforcement — CustomerService', () => {
  it('store_manager cannot create a customer in a foreign org', async () => {
    setNonAdmin();
    await expect(
      customerService.createCustomer({
        organizationId: OTHER_ORG_ID,
        name: 'Intruder Customer',
        actorId: 'staff-001',
        reasonNote: 'Test customer creation',
      }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('store_manager cannot list customers from a foreign org', async () => {
    setNonAdmin();
    await expect(customerService.getByOrg(OTHER_ORG_ID)).rejects.toThrow(/scope violation/i);
  });
});

// ── LookupDataService ─────────────────────────────────────────────────────────

describe('Scope enforcement — LookupDataService', () => {
  it('store_manager cannot create a lookup entry in a foreign org', async () => {
    setNonAdmin();
    await expect(
      lookupDataService.createEntry({
        store: 'colors',
        organizationId: OTHER_ORG_ID,
        name: 'Red',
        actorId: 'staff-001',
        reasonNote: 'Scope test entry creation',
      }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('store_manager cannot list lookup entries from a foreign org', async () => {
    setNonAdmin();
    await expect(
      lookupDataService.listEntries('colors', OTHER_ORG_ID),
    ).rejects.toThrow(/scope violation/i);
  });
});

// ── NotificationService ───────────────────────────────────────────────────────

describe('Scope enforcement — NotificationService', () => {
  it('store_manager cannot create a channel in a foreign org', async () => {
    setNonAdmin();
    await expect(
      notificationService.upsertChannel({
        organizationId: OTHER_ORG_ID,
        name: 'Intruder Channel',
      }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('store_manager cannot read the queue for a foreign org', async () => {
    setNonAdmin();
    await expect(notificationService.getQueueByOrg(OTHER_ORG_ID)).rejects.toThrow(/scope violation/i);
  });

  it('store_manager cannot list channels for a foreign org', async () => {
    setNonAdmin();
    await expect(notificationService.getChannels(OTHER_ORG_ID)).rejects.toThrow(/scope violation/i);
  });
});

// ── RiskReviewService ─────────────────────────────────────────────────────────

describe('Scope enforcement — RiskReviewService', () => {
  it('store_manager cannot ingest a bid event for a foreign org', async () => {
    setNonAdmin();
    await expect(
      riskReviewService.ingestBidEvent({
        organizationId: OTHER_ORG_ID,
        bidId: 'bid-001',
        bidderId: 'user-x',
        itemId: 'item-1',
        amount: 100,
        currency: 'USD',
      }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('reviewer cannot view risk inbox for a foreign org', async () => {
    setReviewer();
    await expect(riskReviewService.getInbox(OTHER_ORG_ID)).rejects.toThrow(/scope violation/i);
  });
});

// ── Org hierarchy: cross-branch denial & nested descendant allow ──────────────

describe('Scope enforcement — org hierarchy (cross-branch & descendant)', () => {
  let rootOrgId;
  let factoryAId;
  let factoryBId;
  let adminUser;

  beforeEach(async () => {
    // Re-use the already-bootstrapped org from global beforeEach.
    // myOrgId is the root company node.
    rootOrgId = myOrgId;
    adminUser = authService._currentUser;

    // Create two sibling factory nodes under the root company.
    const factoryA = await orgService.createNode({
      parentId: rootOrgId,
      type: ORG_NODE_TYPES.FACTORY,
      name: 'Factory A',
      organizationId: rootOrgId,
      actorId: adminUser.id,
    });
    factoryAId = factoryA.id;

    const factoryB = await orgService.createNode({
      parentId: rootOrgId,
      type: ORG_NODE_TYPES.FACTORY,
      name: 'Factory B',
      organizationId: rootOrgId,
      actorId: adminUser.id,
    });
    factoryBId = factoryB.id;
  });

  it('user assigned to Factory A cannot read customers from sibling Factory B', async () => {
    authService._currentUser = {
      id: 'staff-branch',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: factoryAId,
    };
    await expect(customerService.getByOrg(factoryBId)).rejects.toThrow(/scope violation/i);
  });

  it('user assigned to Factory A cannot create customers in sibling Factory B', async () => {
    authService._currentUser = {
      id: 'staff-branch',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: factoryAId,
    };
    await expect(
      customerService.createCustomer({
        organizationId: factoryBId,
        name: 'Cross-Branch Customer',
        actorId: 'staff-branch',
        reasonNote: 'Test customer creation',
      }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('user assigned to root company can read customers from child Factory A', async () => {
    // Admin creates a customer in factoryA
    await customerService.createCustomer({
      organizationId: factoryAId,
      name: 'Descendant Customer',
      actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });

    // Non-admin user with root org access should be able to read factoryA
    authService._currentUser = {
      id: 'root-staff',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: rootOrgId,
    };
    const customers = await customerService.getByOrg(factoryAId);
    expect(customers.length).toBe(1);
    expect(customers[0].name).toBe('Descendant Customer');
  });

  it('user assigned to root company can read lookup entries from child factory', async () => {
    authService._currentUser = {
      id: 'root-staff',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: rootOrgId,
    };
    // Create lookup entry in factoryA (admin created it)
    authService._currentUser = adminUser;
    await lookupDataService.createEntry({
      store: 'colors', organizationId: factoryAId, name: 'Blue', actorId: adminUser.id, reasonNote: 'Seeding blue for scope test',
    });

    // Non-admin root user should be able to list
    authService._currentUser = {
      id: 'root-staff',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: rootOrgId,
    };
    const entries = await lookupDataService.listEntries('colors', factoryAId);
    expect(entries.length).toBe(1);
  });

  it('user assigned to Factory A cannot write lookup entries in Factory B', async () => {
    authService._currentUser = {
      id: 'staff-a',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: factoryAId,
    };
    await expect(
      lookupDataService.createEntry({
        store: 'colors', organizationId: factoryBId, name: 'Red', actorId: 'staff-a', reasonNote: 'Cross-branch test entry',
      }),
    ).rejects.toThrow(/scope violation/i);
  });
});

// ── TicketService ─────────────────────────────────────────────────────────────

describe('Scope enforcement — TicketService', () => {
  it('store_manager cannot assign a ticket belonging to a foreign org', async () => {
    // Admin creates a ticket in myOrgId
    const ticket = await ticketService.createTicket({
      customerId: 'cust-001',
      organizationId: myOrgId,
      storeId: myOrgId,
      subject: 'Test ticket',
      description: 'Scope test description.',
      category: 'general',
      priority: 'low',
      actorId: authService._currentUser.id,
    });

    // Non-admin user from a DIFFERENT org tries to assign it
    authService._currentUser = {
      id: 'intruder',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: OTHER_ORG_ID,
    };
    await expect(
      ticketService.assignTicket(ticket.id, 'intruder', 'intruder'),
    ).rejects.toThrow(/scope violation/i);
  });

  it('store_manager cannot transition a ticket belonging to a foreign org', async () => {
    const ticket = await ticketService.createTicket({
      customerId: 'cust-002',
      organizationId: myOrgId,
      storeId: myOrgId,
      subject: 'Transition test',
      description: 'Scope test for transition.',
      category: 'returns',
      priority: 'medium',
      actorId: authService._currentUser.id,
    });

    authService._currentUser = {
      id: 'intruder',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: OTHER_ORG_ID,
    };
    await expect(
      ticketService.transitionTicket(ticket.id, 'in_progress', 'intruder'),
    ).rejects.toThrow(/scope violation/i);
  });
});

// ── RiskReviewService.evaluateRules ───────────────────────────────────────────

describe('Scope enforcement — RiskReviewService.evaluateRules', () => {
  it('store_manager cannot evaluate rules against a foreign org', async () => {
    authService._currentUser = {
      id: 'staff-001',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: myOrgId,
    };
    await expect(
      riskReviewService.evaluateRules({
        organizationId: OTHER_ORG_ID,
        entityType: 'product',
        entityId: 'prod-001',
        payload: { description: 'test' },
        actorId: 'staff-001',
      }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('store_manager cannot evaluate bidding heuristics for a foreign org', async () => {
    authService._currentUser = {
      id: 'staff-001',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: myOrgId,
    };
    await expect(
      riskReviewService.evaluateBiddingHeuristics({
        organizationId: OTHER_ORG_ID,
        itemId: 'item-foreign',
      }),
    ).rejects.toThrow(/scope violation/i);
  });
});

// ── MasterDataService reads ───────────────────────────────────────────────────

describe('Scope enforcement — MasterDataService reads', () => {
  it('store_manager cannot read active version from a foreign org', async () => {
    authService._currentUser = {
      id: 'staff-001',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: myOrgId,
    };
    await expect(
      masterDataService.getActiveVersion('color', OTHER_ORG_ID),
    ).rejects.toThrow(/scope violation/i);
  });

  it('store_manager cannot read all active versions from a foreign org', async () => {
    authService._currentUser = {
      id: 'staff-001',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: myOrgId,
    };
    await expect(
      masterDataService.getAllActiveVersions(OTHER_ORG_ID),
    ).rejects.toThrow(/scope violation/i);
  });
});

// ── NLPService scope enforcement ──────────────────────────────────────────────

describe('Scope enforcement — NLPService', () => {
  function setAnalyst() {
    authService._currentUser = {
      id: 'analyst-001',
      role: ROLES.ANALYST,
      organizationNodeId: myOrgId,
    };
  }

  it('analyst cannot run batch NLP on a foreign org', async () => {
    setAnalyst();
    await expect(
      nlpService.runBatch({
        organizationId: OTHER_ORG_ID,
        modelVersion: 'v1',
        actorId: 'analyst-001',
      }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('analyst cannot run incremental NLP on a foreign org', async () => {
    setAnalyst();
    await expect(
      nlpService.runIncremental({
        organizationId: OTHER_ORG_ID,
        modelVersion: 'v1',
        actorId: 'analyst-001',
      }),
    ).rejects.toThrow(/scope violation/i);
  });

  it('analyst cannot retrieve run history for a foreign org', async () => {
    setAnalyst();
    await expect(
      nlpService.getRunHistory(OTHER_ORG_ID),
    ).rejects.toThrow(/scope violation/i);
  });

  it('analyst cannot cluster topics for a foreign org', async () => {
    setAnalyst();
    await expect(
      nlpService.clusterTopics(OTHER_ORG_ID),
    ).rejects.toThrow(/scope violation/i);
  });
});

// ── TicketService — getTicketDetail + getOverdue scope ────────────────────────

describe('Scope enforcement — TicketService reads', () => {
  it('store_manager cannot view ticket detail from a foreign org', async () => {
    // Admin creates a ticket in myOrgId
    const ticket = await ticketService.createTicket({
      customerId: 'cust-001',
      organizationId: myOrgId,
      storeId: myOrgId,
      subject: 'Detail scope test',
      description: 'Testing scope.',
      category: 'general',
      priority: 'low',
      actorId: authService._currentUser.id,
    });

    // Non-admin from a DIFFERENT org tries to read it
    authService._currentUser = {
      id: 'intruder',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: OTHER_ORG_ID,
    };
    await expect(
      ticketService.getTicketDetail(ticket.id),
    ).rejects.toThrow(/scope violation/i);
  });

  it('store_manager getOverdue only returns tickets within own org', async () => {
    // Admin creates ticket in myOrgId with past SLA
    const ticket = await ticketService.createTicket({
      customerId: 'cust-001',
      organizationId: myOrgId,
      storeId: myOrgId,
      subject: 'Overdue scope test',
      description: 'SLA test.',
      category: 'general',
      priority: 'high',
      actorId: authService._currentUser.id,
      slaHours: 0,
    });

    // Mark as overdue
    await ticketService.evaluateOverdue();

    // Non-admin from different org should see 0 overdue tickets
    authService._currentUser = {
      id: 'outsider',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: OTHER_ORG_ID,
    };
    const overdue = await ticketService.getOverdue();
    expect(overdue.length).toBe(0);
  });
});

// ── MasterDataService — getVersionHistory isolation ───────────────────────────

describe('Scope enforcement — MasterData version history isolation', () => {
  it('same entityId across orgs returns only own-org versions', async () => {
    const sharedEntityId = 'shared-entity-001';
    const { MasterDataRepository } = await import('../../src/repositories/implementations/MasterDataRepository.js');
    const mdRepo = new MasterDataRepository();

    // Create version in myOrgId
    await mdRepo.create({
      id: 'v-mine',
      organizationId: myOrgId,
      entityType: 'color',
      entityId: sharedEntityId,
      versionNumber: 1,
      payload: { name: 'Red' },
      reasonNote: 'Initial my-org version',
      isActive: true,
      createdBy: authService._currentUser.id,
      createdAt: Date.now(),
    });

    // Create version with same entityId in OTHER org
    await mdRepo.create({
      id: 'v-foreign',
      organizationId: OTHER_ORG_ID,
      entityType: 'color',
      entityId: sharedEntityId,
      versionNumber: 1,
      payload: { name: 'Blue' },
      reasonNote: 'Foreign org version',
      isActive: true,
      createdBy: 'foreign-actor',
      createdAt: Date.now(),
    });

    // Non-admin in myOrgId queries version history
    setNonAdmin();
    const history = await masterDataService.getVersionHistory(sharedEntityId, myOrgId);

    // Must only see own-org version
    expect(history.length).toBe(1);
    expect(history[0].organizationId).toBe(myOrgId);
    expect(history.some((v) => v.organizationId === OTHER_ORG_ID)).toBe(false);
  });
});

// ── NotificationService — deleteSubscription RBAC ─────────────────────────────

describe('Scope enforcement — deleteSubscription RBAC', () => {
  it('user can delete own subscription', async () => {
    setNonAdmin();
    const sub = await notificationService.subscribe({
      userId: 'staff-001',
      channelId: null,
      eventType: 'order_status',
      organizationId: myOrgId,
    });

    // Should not throw
    await expect(
      notificationService.deleteSubscription(sub.id, 'staff-001'),
    ).resolves.toBeUndefined();
  });

  it('user cannot delete another user\'s subscription', async () => {
    // Admin creates a subscription for admin
    const sub = await notificationService.subscribe({
      userId: authService._currentUser.id,
      channelId: null,
      eventType: 'order_status',
      organizationId: myOrgId,
    });

    // Non-admin tries to delete it
    authService._currentUser = {
      id: 'attacker',
      role: ROLES.STORE_MANAGER,
      organizationNodeId: myOrgId,
    };
    await expect(
      notificationService.deleteSubscription(sub.id, 'attacker'),
    ).rejects.toThrow(/permission denied/i);
  });

  it('admin can delete any subscription', async () => {
    setNonAdmin();
    const sub = await notificationService.subscribe({
      userId: 'staff-001',
      channelId: null,
      eventType: 'order_status',
      organizationId: myOrgId,
    });

    // Switch back to admin
    await authService.login('scope_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
    await expect(
      notificationService.deleteSubscription(sub.id, authService._currentUser.id),
    ).resolves.toBeUndefined();
  });
});
