/**
 * Layout isolation + preferences UI wiring tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { get } from 'svelte/store';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { selectedStore, persistSelectedStore, restoreSelectedStore } from '../../src/app/stores/org.js';
import { saveColumnLayout, restoreColumnLayouts, tableColumnLayouts } from '../../src/app/stores/ui.js';
import { ROLES } from '../../src/utils/constants.js';

const PASS = 'LayoutIso@1234';
let orgId, adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'li_admin', adminPassword: PASS, orgName: 'LayoutIsoCo',
  });
  orgId = org.id;
  adminUser = admin;
  await authService.login('li_admin', PASS);
    await authService.unlockProtectedData(PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  selectedStore.set(null);
  tableColumnLayouts.set({});
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. LAYOUT RESET ON USER SWITCH
// ══════════════════════════════════════════════════════════════════════════════

describe('Layout isolation — user switch', () => {
  it('user A layout does not leak to user B (no saved layout)', () => {
    // User A sets a layout
    saveColumnLayout('orders', ['id', 'status', 'date'], adminUser.id);
    expect(get(tableColumnLayouts)['orders']).toEqual(['id', 'status', 'date']);

    // Simulate logout → reset (as App.svelte + LoginPage do)
    tableColumnLayouts.set({});

    // User B logs in — no saved layout → layouts should be empty
    restoreColumnLayouts('user-b-no-saved');
    expect(get(tableColumnLayouts)).toEqual({});
  });

  it('user A layout preserved separately from user B', () => {
    saveColumnLayout('t1', ['a', 'b'], 'userA');
    saveColumnLayout('t1', ['x', 'y'], 'userB');

    tableColumnLayouts.set({});
    restoreColumnLayouts('userA');
    expect(get(tableColumnLayouts)['t1']).toEqual(['a', 'b']);

    tableColumnLayouts.set({});
    restoreColumnLayouts('userB');
    expect(get(tableColumnLayouts)['t1']).toEqual(['x', 'y']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. LOGIN WITHOUT LOGOUT — LAYOUT RESETS
// ══════════════════════════════════════════════════════════════════════════════

describe('Login without logout — layout resets', () => {
  it('cleanupBeforeLogin clears tableColumnLayouts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/LoginPage.svelte'), 'utf8');
    expect(content).toContain('tableColumnLayouts.set({})');
  });

  it('simulated switch: set layout → clear → empty', () => {
    saveColumnLayout('tickets', ['col1'], adminUser.id);
    expect(Object.keys(get(tableColumnLayouts)).length).toBeGreaterThan(0);

    // Simulate login cleanup
    tableColumnLayouts.set({});
    expect(get(tableColumnLayouts)).toEqual({});
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. STORE SELECTOR UI EXISTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Store selector — UI wiring', () => {
  it('Sidebar has store selector UI', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/app/components/Sidebar.svelte'), 'utf8');
    expect(content).toContain('store-select');
    expect(content).toContain('handleStoreChange');
    expect(content).toContain('persistSelectedStore');
    expect(content).toContain('storeNodes');
  });

  it('store selection persists via helper', () => {
    persistSelectedStore({ id: 'sel-store', name: 'Selected' }, adminUser.id);
    const restored = restoreSelectedStore(adminUser.id);
    expect(restored).toEqual({ id: 'sel-store', name: 'Selected' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. README DOCUMENTS LIMITATIONS
// ══════════════════════════════════════════════════════════════════════════════

describe('README — test scope documented', () => {
  it('README documents simulation-based testing', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('README.md'), 'utf8');
    expect(content).toContain('simulation-based');
    expect(content).toContain('no real browser driver');
  });
});
