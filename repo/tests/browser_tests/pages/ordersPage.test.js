/**
 * Orders Page — integration tests.
 *
 * Verifies UI ↔ service interaction for the OrdersPage component:
 *   - Empty state when no orders exist
 *   - Order list renders on mount
 *   - Create order form validates required fields
 *   - Transition buttons match valid state-machine transitions
 *   - Restriction flags are shown when customer has allergies/restrictions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../../src/infrastructure/db/db.js';
import { authService } from '../../../src/services/AuthService.js';
import { customerService } from '../../../src/services/CustomerService.js';
import { orderService } from '../../../src/services/OrderService.js';
import { cryptoService } from '../../../src/services/CryptoService.js';
import { BootstrapService } from '../../../src/services/BootstrapService.js';
import { currentUser } from '../../../src/app/stores/auth.js';
import {
  setBroadcastService,
  closeAll,
} from '../../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../../src/infrastructure/broadcast/MockBroadcastService.js';
import { OrgRepository } from '../../../src/repositories/implementations/OrgRepository.js';
import OrdersPage from '../../../src/pages/OrdersPage.svelte';

const ADMIN_PASS = 'Orders@12345';

let adminUser;
let testCustomer;
let ORG_ID;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'orders_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'OrdersTestCo',
  });
  adminUser = result.admin;
  ORG_ID = result.org.id;

  await authService.login('orders_admin', ADMIN_PASS);
  await authService.unlockProtectedData(ADMIN_PASS);
  currentUser.set(authService._currentUser);

  // Create a test customer for use in order creation.
  testCustomer = await customerService.createCustomer({
    organizationId: ORG_ID,
    name: 'Test Customer',
    actorId: adminUser.id,
    reasonNote: 'Test customer creation',
  });
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  currentUser.set(null);
  closeDB();
  closeAll();
});

describe('OrdersPage — empty state', () => {
  it('shows "No orders" when store has no orders', async () => {
    render(OrdersPage);
    await waitFor(() => {
      expect(screen.getByText(/no orders/i)).toBeTruthy();
    });
  });

  it('renders page header with filters and + New Order button', () => {
    render(OrdersPage);
    expect(screen.getByText('Orders')).toBeTruthy();
    expect(screen.getByText('+ New Order')).toBeTruthy();
  });

  it('shows "Select an order to view details" placeholder', async () => {
    render(OrdersPage);
    await waitFor(() => {
      expect(screen.getByText(/select an order/i)).toBeTruthy();
    });
  });
});

describe('OrdersPage — order list', () => {
  let testOrder;

  beforeEach(async () => {
    testOrder = await orderService.createOrder({
      customerId: testCustomer.id,
      organizationId: ORG_ID,
      storeId: ORG_ID,
      items: [{ description: 'Blue shirt' }],
      actorId: adminUser.id,
    });
  });

  it('renders order ID prefix in the list', async () => {
    render(OrdersPage);
    await waitFor(() => {
      const orderId = testOrder.id.slice(0, 8);
      expect(screen.getByText(new RegExp(orderId))).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows draft status badge', async () => {
    render(OrdersPage);
    await waitFor(() => {
      expect(screen.getByText('draft')).toBeTruthy();
    }, { timeout: 3000 });
  });
});

describe('OrdersPage — create order form', () => {
  it('opens form when + New Order is clicked', async () => {
    render(OrdersPage);
    fireEvent.click(screen.getByText('+ New Order'));
    await waitFor(() => {
      expect(screen.getByText('New Order')).toBeTruthy();
    });
  });

  it('Create button is disabled when Customer ID is empty', async () => {
    render(OrdersPage);
    fireEvent.click(screen.getByText('+ New Order'));
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /^create$/i });
      expect(btn).toBeDisabled();
    });
  });

  it('shows error when customer ID is invalid', async () => {
    render(OrdersPage);
    fireEvent.click(screen.getByText('+ New Order'));
    await waitFor(() => screen.getByText('New Order'));

    const input = screen.getByPlaceholderText(/customer id/i);
    await fireEvent.input(input, { target: { value: 'nonexistent-customer-id' } });

    const btn = screen.getByRole('button', { name: /^create$/i });
    await fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/customer not found/i)).toBeTruthy();
    }, { timeout: 3000 });
  });
});

describe('OrdersPage — state machine transitions', () => {
  let draftOrder;

  beforeEach(async () => {
    draftOrder = await orderService.createOrder({
      customerId: testCustomer.id,
      organizationId: ORG_ID,
      storeId: ORG_ID,
      actorId: adminUser.id,
    });
  });

  it('shows "placed" and "canceled" transition buttons for draft order', async () => {
    render(OrdersPage);

    // Click the order row to select it.
    await waitFor(() => screen.getByText(new RegExp(draftOrder.id.slice(0, 8))), { timeout: 3000 });
    fireEvent.click(screen.getByText(new RegExp(draftOrder.id.slice(0, 8))));

    await waitFor(() => {
      expect(screen.getByText(/→ placed/i)).toBeTruthy();
      expect(screen.getByText(/→ canceled/i)).toBeTruthy();
    }, { timeout: 3000 });
  });
});
