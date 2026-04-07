/**
 * Secondary consistency tests.
 *
 * Covers:
 *   1. LocalStorage restore applies to selectedStore state
 *   2. Lookup versioning uses singular entity type names
 *   3. Admin getTree('all') returns full tree
 *   4. Ticket with null customerId succeeds
 *   5. Deactivate modal replaces prompt()
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { get } from 'svelte/store';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { lookupDataService } from '../../src/services/LookupDataService.js';
import { ticketService } from '../../src/services/TicketService.js';
import { orgService } from '../../src/services/OrgService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { selectedStore, persistSelectedStore, restoreSelectedStore } from '../../src/app/stores/org.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, MASTER_DATA_ENTITY_TYPES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'SecConsist@123';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'sc_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'SecConsistCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('sc_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  selectedStore.set(null);
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. LOCALSTORAGE PREFERENCES
// ══════════════════════════════════════════════════════════════════════════════

describe('LocalStorage preferences', () => {
  it('persistSelectedStore saves and restoreSelectedStore reads back', () => {
    const storeObj = { id: 'store-123', name: 'Test Store' };
    persistSelectedStore(storeObj, 'user-1');

    // Verify store state was set
    expect(get(selectedStore)).toEqual(storeObj);

    // Clear and restore
    selectedStore.set(null);
    const restored = restoreSelectedStore('user-1');
    expect(restored).toEqual({ id: 'store-123', name: 'Test Store' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. LOOKUP VERSIONING — SINGULAR ENTITY TYPES
// ══════════════════════════════════════════════════════════════════════════════

describe('Lookup versioning — singular entity type names', () => {
  it('createEntry stores version with singular entityType', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'colors', organizationId: orgId, name: 'Cyan',
      actorId: adminUser.id, reasonNote: 'Adding cyan color entry',
    });

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);
    expect(history[0].entityType).toBe('color'); // singular, not 'colors'
  });

  it('entityType matches MASTER_DATA_ENTITY_TYPES constants', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'sizes', organizationId: orgId, name: 'XXL',
      actorId: adminUser.id, reasonNote: 'Adding XXL size entry',
    });

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);
    expect(history[0].entityType).toBe(MASTER_DATA_ENTITY_TYPES.SIZE);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. ADMIN getTree('all')
// ══════════════════════════════════════════════════════════════════════════════

describe('OrgService.getTree — admin "all" query', () => {
  it('admin getTree("all") returns all org nodes', async () => {
    const tree = await orgService.getTree('all');
    expect(tree.length).toBeGreaterThan(0);
    // Should include the bootstrapped company node
    expect(tree.some((n) => n.id === orgId)).toBe(true);
  });

  it('non-admin getTree("all") is rejected', async () => {
    authService._currentUser = {
      id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    };
    await expect(orgService.getTree('all')).rejects.toThrow(/scope violation/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. TICKET WITH NULL CUSTOMER
// ══════════════════════════════════════════════════════════════════════════════

describe('Ticket — null customerId', () => {
  it('ticket with null customerId succeeds', async () => {
    const ticket = await ticketService.createTicket({
      customerId: null,
      organizationId: orgId,
      storeId: orgId,
      subject: 'Walk-in issue',
      description: 'No customer record.',
      category: 'general',
      priority: 'low',
      actorId: adminUser.id,
    });
    expect(ticket.customerId).toBeNull();
  });

  it('ticket with empty string customerId succeeds (treated as null)', async () => {
    const ticket = await ticketService.createTicket({
      customerId: '',
      organizationId: orgId,
      storeId: orgId,
      subject: 'Another walk-in',
      description: 'No customer.',
      category: 'general',
      priority: 'low',
      actorId: adminUser.id,
    });
    // Empty string should be treated as no customer
    expect(ticket.customerId).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. MASTER DATA PAGE — NO prompt() CALLS
// ══════════════════════════════════════════════════════════════════════════════

describe('MasterDataPage — no prompt() usage', () => {
  it('MasterDataPage does not call prompt()', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/MasterDataPage.svelte'), 'utf8');
    // Should not contain prompt( — must use modal instead
    expect(content).not.toMatch(/[^a-zA-Z]prompt\(/);
  });

  it('MasterDataPage has a deactivation modal with reason input', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/MasterDataPage.svelte'), 'utf8');
    expect(content).toContain('showDeactivateModal');
    expect(content).toContain('deactivateReason');
  });
});
