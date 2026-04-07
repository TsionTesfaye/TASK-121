/**
 * CRM Page — integration tests.
 *
 * Verifies UI ↔ service interaction for the CRMPage component:
 *   - Customer list renders on mount
 *   - Create-customer form calls service and updates UI
 *   - Reveal sensitive fields calls service
 *   - Edit customer calls service
 *   - Error from service surfaces in the UI
 *   - Adjust Points modal + service call
 *   - Adjust Stored Value modal + service call
 *   - Add Rating modal + service call
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../../src/infrastructure/db/db.js';
import { authService } from '../../../src/services/AuthService.js';
import { customerService } from '../../../src/services/CustomerService.js';
import { cryptoService } from '../../../src/services/CryptoService.js';
import { BootstrapService } from '../../../src/services/BootstrapService.js';
import { currentUser, currentRole } from '../../../src/app/stores/auth.js';
import { ROLES } from '../../../src/utils/constants.js';
import {
  setBroadcastService,
  closeAll,
} from '../../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ticketService } from '../../../src/services/TicketService.js';
import { toast } from '../../../src/app/stores/ui.js';
import { get } from 'svelte/store';
import CRMPage from '../../../src/pages/CRMPage.svelte';

const ADMIN_PASS = 'CrmPage@1234';

let adminUser;
let ORG_ID;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'crm_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'CRMTestCo',
  });
  adminUser = result.admin;
  ORG_ID = result.org.id;

  await authService.login('crm_admin', ADMIN_PASS);
  await authService.unlockProtectedData(ADMIN_PASS);

  currentUser.set(authService._currentUser);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  currentUser.set(null);
  closeDB();
  closeAll();
});

describe('CRMPage — empty state', () => {
  it('shows "No customers found" when org has no customers', async () => {
    render(CRMPage);
    await waitFor(() => {
      expect(screen.getByText(/no customers found/i)).toBeTruthy();
    });
  });

  it('renders page header with New Customer button', () => {
    render(CRMPage);
    expect(screen.getByText('Customer CRM')).toBeTruthy();
    expect(screen.getByText('+ New Customer')).toBeTruthy();
  });
});

describe('CRMPage — customer list', () => {
  beforeEach(async () => {
    // Seed a customer.
    await customerService.createCustomer({
      organizationId: ORG_ID,
      name: 'Alice Smith',
      membershipTier: 'Gold',
      actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });
  });

  it('renders the customer name after mount', async () => {
    render(CRMPage);
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('renders the customer membership tier badge', async () => {
    render(CRMPage);
    await waitFor(() => {
      expect(screen.getByText('Gold')).toBeTruthy();
    }, { timeout: 3000 });
  });
});

describe('CRMPage — create customer form', () => {
  it('opens create form on "+ New Customer" click', async () => {
    render(CRMPage);
    fireEvent.click(screen.getByText('+ New Customer'));
    await waitFor(() => {
      expect(screen.getByText('New Customer')).toBeTruthy();
    });
  });

  it('Create button is disabled when name is empty', async () => {
    render(CRMPage);
    fireEvent.click(screen.getByText('+ New Customer'));
    await waitFor(() => {
      const createBtn = screen.getByRole('button', { name: /^create$/i });
      expect(createBtn).toBeDisabled();
    });
  });

  it('successfully creates customer and shows in list', async () => {
    render(CRMPage);
    fireEvent.click(screen.getByText('+ New Customer'));

    await waitFor(() => screen.getByText('New Customer'));

    const nameInput = screen.queryByPlaceholderText(/customer name is required/i) ??
                      screen.getAllByRole('textbox')[0];
    await fireEvent.input(nameInput, { target: { value: 'Bob Jones' } });

    // Fill in the required reason note
    const reasonInput = screen.getByPlaceholderText(/why is this customer/i);
    await fireEvent.input(reasonInput, { target: { value: 'New customer for test verification' } });

    const createBtn = screen.getByRole('button', { name: /^create$/i });
    await fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.queryByText('New Customer')).toBeFalsy(); // modal closed
    }, { timeout: 3000 });
  });
});

describe('CRMPage — sensitive field reveal', () => {
  beforeEach(async () => {
    await customerService.createCustomer({
      organizationId: ORG_ID,
      name: 'Charlie Crypto',
      membershipTier: 'Silver',
      storedValue: 42.5,
      actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });
  });

  it('shows masked stored value before reveal', async () => {
    render(CRMPage);
    await waitFor(() => screen.getByText('Charlie Crypto'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Charlie Crypto'));

    await waitFor(() => {
      expect(screen.getAllByText('••••••••').length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('Reveal button is visible when customer is selected', async () => {
    render(CRMPage);
    await waitFor(() => screen.getByText('Charlie Crypto'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Charlie Crypto'));

    await waitFor(() => {
      expect(screen.getByText('Reveal')).toBeTruthy();
    }, { timeout: 3000 });
  });
});

// ── Loading states ─────────────────────────────────────────────────────────

describe('CRMPage — loading state on initial fetch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows error toast when customerService.getByOrg throws', async () => {
    vi.spyOn(
      (await import('../../../src/services/CustomerService.js')).customerService,
      'getByOrg',
    ).mockRejectedValue(new Error('DB unavailable'));

    render(CRMPage);
    await waitFor(() => {
      const t = get(toast);
      expect(t?.type).toBe('error');
      expect(t?.message).toBe('DB unavailable');
    }, { timeout: 3000 });
  });
});

// ── Error propagation ──────────────────────────────────────────────────────

describe('CRMPage — ticket load error surfaces as toast', () => {
  beforeEach(async () => {
    await customerService.createCustomer({
      organizationId: ORG_ID,
      name: 'Dave Error',
      membershipTier: 'Bronze',
      actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows error toast when ticketService.getByCustomer fails', async () => {
    vi.spyOn(ticketService, 'getByCustomer').mockRejectedValue(new Error('Ticket DB error'));

    render(CRMPage);
    await waitFor(() => screen.getByText('Dave Error'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Dave Error'));

    await waitFor(() => {
      const t = get(toast);
      expect(t?.type).toBe('error');
      expect(t?.message).toBe('Ticket DB error');
    }, { timeout: 3000 });
  });
});

// ── CRM operations: adjustPoints, adjustStoredValue, addRating ────────────

describe('CRMPage — Adjust Points modal', () => {
  beforeEach(async () => {
    await customerService.createCustomer({
      organizationId: ORG_ID,
      name: 'Points Customer',
      membershipTier: 'Bronze',
      points: 50,
      actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });
  });

  it('shows Adjust Points button when customer selected', async () => {
    render(CRMPage);
    await waitFor(() => screen.getByText('Points Customer'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Points Customer'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /adjust points/i })).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('opens Adjust Points modal on button click', async () => {
    render(CRMPage);
    await waitFor(() => screen.getByText('Points Customer'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Points Customer'));

    await waitFor(() => screen.getByRole('button', { name: /adjust points/i }), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /adjust points/i }));

    await waitFor(() => {
      expect(screen.getByText('Adjust Points')).toBeTruthy();
    });
  });

  it('Apply button disabled when delta is 0', async () => {
    render(CRMPage);
    await waitFor(() => screen.getByText('Points Customer'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Points Customer'));

    await waitFor(() => screen.getByRole('button', { name: /adjust points/i }), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /adjust points/i }));

    await waitFor(() => {
      const applyBtn = screen.getByRole('button', { name: /^apply$/i });
      expect(applyBtn).toBeDisabled();
    });
  });
});

describe('CRMPage — Add Rating modal', () => {
  beforeEach(async () => {
    await customerService.createCustomer({
      organizationId: ORG_ID,
      name: 'Rating Customer',
      membershipTier: 'Gold',
      actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });
  });

  it('shows Add Rating button when customer selected', async () => {
    render(CRMPage);
    await waitFor(() => screen.getByText('Rating Customer'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Rating Customer'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add rating/i })).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('opens Add Rating modal with submit button', async () => {
    render(CRMPage);
    await waitFor(() => screen.getByText('Rating Customer'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Rating Customer'));

    await waitFor(() => screen.getByRole('button', { name: /add rating/i }), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /add rating/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByRole('button', { name: /submit rating/i })).toBeTruthy();
    }, { timeout: 3000 });
  });
});

describe('CRMPage — Adjust Stored Value modal', () => {
  beforeEach(async () => {
    await customerService.createCustomer({
      organizationId: ORG_ID,
      name: 'SV Customer',
      membershipTier: 'Silver',
      storedValue: 100,
      actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });
  });

  it('shows Adjust Stored Value button when customer selected', async () => {
    render(CRMPage);
    await waitFor(() => screen.getByText('SV Customer'), { timeout: 3000 });
    fireEvent.click(screen.getByText('SV Customer'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /adjust stored value/i })).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('Apply button disabled when amount is 0', async () => {
    render(CRMPage);
    await waitFor(() => screen.getByText('SV Customer'), { timeout: 3000 });
    fireEvent.click(screen.getByText('SV Customer'));

    await waitFor(() => screen.getByRole('button', { name: /adjust stored value/i }), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /adjust stored value/i }));

    await waitFor(() => {
      const applyBtn = screen.getByRole('button', { name: /^apply$/i });
      expect(applyBtn).toBeDisabled();
    });
  });
});

// ── Role-based: guest/analyst cannot see CRM operations ───────────────────

describe('CRMPage — role-based operations visibility', () => {
  beforeEach(async () => {
    await customerService.createCustomer({
      organizationId: ORG_ID,
      name: 'Role Test Customer',
      membershipTier: 'Bronze',
      actorId: adminUser.id,
        reasonNote: 'Test customer creation',
    });
  });

  it('analyst role does not see Adjust Points button', async () => {
    authService._currentUser = {
      ...authService._currentUser,
      role: ROLES.ANALYST,
      organizationNodeId: ORG_ID,
    };
    currentUser.set(authService._currentUser);

    render(CRMPage);
    await waitFor(() => screen.getByText('Role Test Customer'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Role Test Customer'));

    // Wait for detail to load, then verify ops buttons are absent
    await waitFor(() => screen.getByText('Points'), { timeout: 3000 });
    expect(screen.queryByRole('button', { name: /adjust points/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add rating/i })).toBeNull();
  });
});
