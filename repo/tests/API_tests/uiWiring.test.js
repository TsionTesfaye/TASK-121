/**
 * UI wiring tests — LocalStorage persistence, NLP clustering, F1 threshold.
 *
 * Covers:
 *   1. Store selection auto-persists to LocalStorage
 *   2. Column layout persistence round-trip
 *   3. NLP clustering exposed in UI
 *   4. F1 threshold configurable via service + persisted
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { get } from 'svelte/store';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { nlpService } from '../../src/services/NLPService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { selectedStore, persistSelectedStore, restoreSelectedStore } from '../../src/app/stores/org.js';
import { saveColumnLayout, restoreColumnLayouts, tableColumnLayouts } from '../../src/app/stores/ui.js';
import { ROLES, NLP } from '../../src/utils/constants.js';

const ADMIN_PASS = 'UIWiring@12345';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'wiring_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'WiringCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('wiring_admin', ADMIN_PASS);
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
// 1. STORE SELECTION PERSISTENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('Store selection persistence', () => {
  it('persistSelectedStore saves to localStorage', () => {
    persistSelectedStore({ id: 'st-wire', name: 'Wire Store' }, adminUser.id);
    const restored = restoreSelectedStore(adminUser.id);
    expect(restored).toEqual({ id: 'st-wire', name: 'Wire Store' });
  });

  it('setting selectedStore and persisting survives reload', () => {
    persistSelectedStore({ id: 'st-reload', name: 'Reload Store' }, adminUser.id);

    // Simulate page reload — clear in-memory, restore from storage
    selectedStore.set(null);
    const restored = restoreSelectedStore(adminUser.id);
    expect(restored).toEqual({ id: 'st-reload', name: 'Reload Store' });
  });

  it('App.svelte has auto-persist reactive block', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/App.svelte'), 'utf8');
    expect(content).toContain('persistSelectedStore($selectedStore');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. COLUMN LAYOUT PERSISTENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('Column layout persistence', () => {
  it('saveColumnLayout → restoreColumnLayouts round-trip', () => {
    saveColumnLayout('orders', ['id', 'status'], adminUser.id);
    tableColumnLayouts.set({}); // clear memory
    restoreColumnLayouts(adminUser.id);
    const layouts = get(tableColumnLayouts);
    expect(layouts['orders']).toEqual(['id', 'status']);
  });

  it('column layouts are user-scoped', () => {
    saveColumnLayout('t1', ['a'], 'u1');
    saveColumnLayout('t1', ['x'], 'u2');
    tableColumnLayouts.set({});
    restoreColumnLayouts('u1');
    expect(get(tableColumnLayouts)['t1']).toEqual(['a']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. NLP CLUSTERING EXPOSED
// ══════════════════════════════════════════════════════════════════════════════

describe('NLP clustering — UI exposure', () => {
  it('clusterTopics returns empty when no runs exist', async () => {
    const result = await nlpService.clusterTopics(orgId);
    expect(result).toEqual({});
  });

  it('NLPPage has clusters tab', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/NLPPage.svelte'), 'utf8');
    expect(content).toContain("'clusters'");
    expect(content).toContain('loadClusters');
    expect(content).toContain('Run Topic Clustering');
    expect(content).toContain('cluster-group');
  });

  it('RBAC: analyst can cluster (service enforces role)', async () => {
    authService._currentUser = { id: 'analyst', role: ROLES.ANALYST, organizationNodeId: orgId };
    const result = await nlpService.clusterTopics(orgId);
    expect(typeof result).toBe('object');
  });

  it('RBAC: guest cannot cluster', async () => {
    authService._currentUser = { id: 'guest', role: ROLES.GUEST, organizationNodeId: orgId };
    await expect(nlpService.clusterTopics(orgId)).rejects.toThrow(/permission denied/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. F1 THRESHOLD CONFIGURABLE
// ══════════════════════════════════════════════════════════════════════════════

describe('F1 threshold — configurable via UI', () => {
  it('default threshold is 0.70', () => {
    expect(nlpService.getF1Threshold()).toBe(NLP.F1_ALERT_THRESHOLD);
  });

  it('setF1Threshold changes effective value', async () => {
    await nlpService.setF1Threshold(0.85, orgId);
    expect(nlpService.getF1Threshold()).toBe(0.85);
  });

  it('threshold persists and restores', async () => {
    await nlpService.setF1Threshold(0.6, orgId);
    nlpService._f1ThresholdOverride = null;
    await nlpService.loadPersistedThreshold(orgId);
    expect(nlpService.getF1Threshold()).toBe(0.6);
  });

  it('NLPPage has threshold control (admin only)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/NLPPage.svelte'), 'utf8');
    expect(content).toContain('Save Threshold');
    expect(content).toContain('setF1Threshold');
    expect(content).toContain('isAdmin');
  });
});
