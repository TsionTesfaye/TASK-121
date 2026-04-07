/**
 * Product completeness tests — account linking, bootstrap guard, store persistence.
 *
 * Covers:
 *   1. Account linking (user-to-user)
 *   2. Bootstrap route guard (already initialized → redirects)
 *   3. Store switcher persistence (save/restore)
 *   4. E2E simulation: login → create data → export → import → verify
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { importExportService } from '../../src/services/ImportExportService.js';
import { BootstrapService, bootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { persistSelectedStore, restoreSelectedStore } from '../../src/app/stores/org.js';
import { ROLES } from '../../src/utils/constants.js';
import { DB_VERSION } from '../../src/infrastructure/db/schema.js';

const ADMIN_PASS = 'ProdComp@12345';
const BACKUP_PASS = 'Backup@1234567';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'pc_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'ProdCompCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('pc_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. ACCOUNT LINKING
// ══════════════════════════════════════════════════════════════════════════════

describe('Account linking', () => {
  it('admin can link two user accounts', async () => {
    const userA = await authService.createUser({
      username: 'link_a', password: ADMIN_PASS,
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });
    const userB = await authService.createUser({
      username: 'link_b', password: ADMIN_PASS,
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });

    const link = await authService.linkUserAccounts({
      userIdA: userA.id, userIdB: userB.id, reason: 'Same person, different roles',
    });
    expect(link.primaryUserId).toBe(userA.id);
    expect(link.linkedUserId).toBe(userB.id);
    expect(link.createdAt).toBeGreaterThan(0);
  });

  it('cannot link user to themselves', async () => {
    await expect(authService.linkUserAccounts({
      userIdA: adminUser.id, userIdB: adminUser.id, reason: 'Self-link test reason note',
    })).rejects.toThrow(/themselves/i);
  });

  it('rejects nonexistent user', async () => {
    await expect(authService.linkUserAccounts({
      userIdA: adminUser.id, userIdB: 'ghost-user', reason: 'Bad link test reason note',
    })).rejects.toThrow(/not found/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. BOOTSTRAP ROUTE GUARD
// ══════════════════════════════════════════════════════════════════════════════

describe('Bootstrap route guard', () => {
  it('isBootstrapped returns true after bootstrap', async () => {
    const result = await bootstrapService.isBootstrapped();
    expect(result).toBe(true);
  });

  it('BootstrapPage has onMount guard checking isBootstrapped', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/BootstrapPage.svelte'), 'utf8');
    expect(content).toContain('isBootstrapped');
    expect(content).toContain("navigate('/login')");
    expect(content).toContain('ready');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. STORE PERSISTENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('Store switcher persistence', () => {
  it('persist → restore round-trip', () => {
    persistSelectedStore({ id: 'st-pc', name: 'PC Store' }, adminUser.id);
    const restored = restoreSelectedStore(adminUser.id);
    expect(restored).toEqual({ id: 'st-pc', name: 'PC Store' });
  });

  it('user A preferences isolated from user B', () => {
    persistSelectedStore({ id: 's-a', name: 'A' }, 'ua');
    persistSelectedStore({ id: 's-b', name: 'B' }, 'ub');
    expect(restoreSelectedStore('ua').id).toBe('s-a');
    expect(restoreSelectedStore('ub').id).toBe('s-b');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. E2E SIMULATION: login → create → export → import → verify
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E simulation — full data lifecycle', () => {
  it('create data → export → import → data persists', async () => {
    // Create customer
    const customer = await customerService.createCustomer({
      organizationId: orgId, name: 'Lifecycle Customer',
      storedValue: 42, actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });

    // Export
    const blob = await importExportService.exportBackup({
      actorId: adminUser.id, backupPassphrase: BACKUP_PASS,
    });

    // Import
    const file = new File([blob], 'lifecycle.json');
    const { snapshot, schemaVersion } = await importExportService.previewImport({
      file, backupPassphrase: BACKUP_PASS,
    });
    await importExportService.applyImport({ snapshot, schemaVersion, actorId: adminUser.id });

    // Re-login (import forces logout)
    await authService.login('pc_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

    // Verify data survived
    const customers = await customerService.getByOrg(orgId);
    expect(customers.some((c) => c.name === 'Lifecycle Customer')).toBe(true);
  });
});
