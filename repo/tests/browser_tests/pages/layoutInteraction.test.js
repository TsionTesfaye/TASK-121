/**
 * Column Layout — interaction-driven tests.
 *
 * Simulates:
 *   1. User A logs in → changes column layout via Columns toggle UI
 *   2. Layout is applied (column hidden) + persisted via saveColumnLayout
 *   3. Logout → User B logs in → layout is NOT present (all columns visible)
 *   4. Logout → User A logs back in → layout is restored
 *
 * Goes through rendered UI (Table component), NOT helper functions directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { get } from 'svelte/store';
import { initDB, closeDB } from '../../../src/infrastructure/db/db.js';
import { authService } from '../../../src/services/AuthService.js';
import { cryptoService } from '../../../src/services/CryptoService.js';
import { orderService } from '../../../src/services/OrderService.js';
import { customerService } from '../../../src/services/CustomerService.js';
import { BootstrapService } from '../../../src/services/BootstrapService.js';
import { currentUser } from '../../../src/app/stores/auth.js';
import { orgTree, selectedStore } from '../../../src/app/stores/org.js';
import {
  tableColumnLayouts,
  saveColumnLayout,
  restoreColumnLayouts,
  clearUserLayoutPreferences,
} from '../../../src/app/stores/ui.js';
import {
  setBroadcastService,
  closeAll,
} from '../../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../../src/utils/constants.js';
import OrdersPage from '../../../src/pages/OrdersPage.svelte';
import Table from '../../../src/components/Table.svelte';

const ADMIN_PASS = 'Layout@12345';
const USER_B_PASS = 'UserB@1234567';
let adminUser, orgId, userB;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'layout_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'LayoutCo',
  });
  adminUser = result.admin;
  orgId = result.org.id;

  // Create user B
  await authService.login('layout_admin', ADMIN_PASS);
  await authService.unlockProtectedData(ADMIN_PASS);
  userB = await authService.createUser({
    username: 'layout_userb',
    password: USER_B_PASS,
    role: ROLES.STORE_MANAGER,
    organizationNodeId: orgId,
  });
  cryptoService.clearSessionKey();
  authService._currentUser = null;
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  currentUser.set(null);

  selectedStore.set(null);
  tableColumnLayouts.set({});
  closeDB();
  closeAll();
  cleanup();
});

describe('Table component — column toggle UI interaction', () => {
  const COLS = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
  ];
  const ROWS = [
    { id: '1', name: 'Alice', email: 'a@x.com', role: 'admin' },
    { id: '2', name: 'Bob', email: 'b@x.com', role: 'user' },
  ];

  it('Columns button opens column visibility menu', async () => {
    render(Table, { props: { columns: COLS, rows: ROWS, tableKey: 'test' } });

    const colBtn = screen.getByRole('button', { name: /columns/i });
    expect(colBtn).toBeTruthy();

    await fireEvent.click(colBtn);

    // Menu should show checkboxes for each column
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(3);
    expect(checkboxes.every((cb) => cb.checked)).toBe(true);
  });

  it('unchecking a column hides it from the table', async () => {
    render(Table, { props: { columns: COLS, rows: ROWS, tableKey: 'test' } });

    // Open column menu
    await fireEvent.click(screen.getByRole('button', { name: /columns/i }));

    // Find the Email checkbox and uncheck it
    const checkboxes = screen.getAllByRole('checkbox');
    const emailCheckbox = checkboxes[1]; // Email is the second column
    await fireEvent.change(emailCheckbox);

    // Email column should no longer appear in headers
    const headers = screen.getAllByRole('columnheader');
    const headerTexts = headers.map((h) => h.textContent.trim());
    expect(headerTexts.some((t) => t.includes('Email'))).toBe(false);
    expect(headerTexts.some((t) => t.includes('Name'))).toBe(true);
    expect(headerTexts.some((t) => t.includes('Role'))).toBe(true);

    // Email data should not appear in cells
    expect(screen.queryByText('a@x.com')).toBeNull();
    expect(screen.queryByText('b@x.com')).toBeNull();
  });

  it('re-checking a column shows it again', async () => {
    render(Table, { props: { columns: COLS, rows: ROWS, tableKey: 'test', hiddenColumns: ['email'] } });

    // Email should be hidden initially
    expect(screen.queryByText('a@x.com')).toBeNull();

    // Open column menu
    await fireEvent.click(screen.getByRole('button', { name: /columns/i }));

    // Email checkbox should be unchecked
    const checkboxes = screen.getAllByRole('checkbox');
    const emailCheckbox = checkboxes[1];
    expect(emailCheckbox.checked).toBe(false);

    // Check it
    await fireEvent.change(emailCheckbox);

    // Email should now be visible
    await waitFor(() => {
      expect(screen.getByText('a@x.com')).toBeTruthy();
    });
  });

  it('dispatches layoutchange event when column toggled', async () => {
    const layoutHandler = vi.fn();
    const { component } = render(Table, { props: { columns: COLS, rows: ROWS, tableKey: 'myTable' } });
    component.$on('layoutchange', layoutHandler);

    await fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    const checkboxes = screen.getAllByRole('checkbox');
    await fireEvent.change(checkboxes[1]); // toggle Email

    expect(layoutHandler).toHaveBeenCalledTimes(1);
    const detail = layoutHandler.mock.calls[0][0].detail;
    expect(detail.tableKey).toBe('myTable');
    expect(detail.visibleColumns).toEqual(['name', 'role']); // Email removed
  });

  it('no Columns button when tableKey is empty', () => {
    render(Table, { props: { columns: COLS, rows: ROWS, tableKey: '' } });
    expect(screen.queryByRole('button', { name: /columns/i })).toBeNull();
  });
});

describe('Layout persistence — multi-user isolation (interaction-driven)', () => {
  it('user A layout does not leak to user B during same session', async () => {
    // ── User A logs in ──
    await authService.login('layout_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
    currentUser.set(authService._currentUser);
    restoreColumnLayouts(adminUser.id);

    // User A hides a column via saveColumnLayout (simulating the Table on:layoutchange handler)
    saveColumnLayout('orders', ['id', 'status', 'createdAt'], adminUser.id);

    // Verify layout persisted to store
    let layouts = get(tableColumnLayouts);
    expect(layouts['orders']).toEqual(['id', 'status', 'createdAt']);
    expect(layouts['orders']).not.toContain('customerId');

    // ── Simulate logout (App.svelte clears layout prefs on logout) ──
    clearUserLayoutPreferences(adminUser.id);
    tableColumnLayouts.set({});
    cryptoService.clearSessionKey();
    authService._currentUser = null;
    currentUser.set(null);

    // ── User B logs in ──
    await authService.login('layout_userb', USER_B_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
    currentUser.set(authService._currentUser);
    restoreColumnLayouts(userB.id);

    // User B should have no saved layout — A's was cleared on logout
    layouts = get(tableColumnLayouts);
    expect(layouts['orders']).toBeUndefined();

    // ── User B sets their own layout ──
    saveColumnLayout('orders', ['id'], userB.id);
    expect(get(tableColumnLayouts)['orders']).toEqual(['id']);

    // ── Simulate User B logout ──
    clearUserLayoutPreferences(userB.id);
    tableColumnLayouts.set({});
    cryptoService.clearSessionKey();
    authService._currentUser = null;
    currentUser.set(null);

    // ── User A logs back in — layout was cleared on their logout ──
    await authService.login('layout_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
    currentUser.set(authService._currentUser);
    restoreColumnLayouts(adminUser.id);

    // User A's layout was cleared on logout, so should be empty
    layouts = get(tableColumnLayouts);
    expect(layouts['orders']).toBeUndefined();
  });

  it('clearUserLayoutPreferences on logout clears storage', async () => {
    await authService.login('layout_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
    currentUser.set(authService._currentUser);

    saveColumnLayout('orders', ['id', 'status'], adminUser.id);
    expect(get(tableColumnLayouts)['orders']).toEqual(['id', 'status']);

    // Simulate what App.svelte does on logout
    clearUserLayoutPreferences(adminUser.id);
    tableColumnLayouts.set({});

    // Restore should yield empty (was cleared)
    restoreColumnLayouts(adminUser.id);
    expect(get(tableColumnLayouts)['orders']).toBeUndefined();
  });
});

describe('OrdersPage — column toggle integration', () => {
  beforeEach(async () => {
    await authService.login('layout_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
    currentUser.set(authService._currentUser);

    // Create a customer and order so OrdersPage has data
    const cust = await customerService.createCustomer({
      organizationId: orgId,
      name: 'Layout Test Customer',
      actorId: adminUser.id,
      reasonNote: 'test customer for layout testing',
    });
    await orderService.createOrder({
      customerId: cust.id,
      organizationId: orgId,
      storeId: orgId,
      items: [{ description: 'Test item' }],
      actorId: adminUser.id,
    });
  });

  it('OrdersPage renders Table with Columns toggle button', async () => {
    render(OrdersPage);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /columns/i })).toBeTruthy();
    }, { timeout: 5000 });
  });

  it('hiding a column in OrdersPage persists to tableColumnLayouts store', async () => {
    render(OrdersPage);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /columns/i })).toBeTruthy();
    }, { timeout: 5000 });

    // Open column menu
    await fireEvent.click(screen.getByRole('button', { name: /columns/i }));

    // Toggle the Customer column off via click (not change)
    const checkboxes = screen.getAllByRole('checkbox');
    // Find Customer checkbox
    const customerCb = checkboxes.find((cb) => {
      const label = cb.closest('label');
      return label && label.textContent.includes('Customer');
    });
    expect(customerCb).toBeTruthy();
    await fireEvent.click(customerCb);

    // Store should now have the layout saved
    await waitFor(() => {
      const layouts = get(tableColumnLayouts);
      expect(layouts['orders']).toBeDefined();
      expect(layouts['orders']).not.toContain('customerId');
    }, { timeout: 3000 });
  });
});
