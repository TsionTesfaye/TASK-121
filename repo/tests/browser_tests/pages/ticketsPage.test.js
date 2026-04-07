/**
 * TicketsPage — integration tests.
 *
 * Verifies UI ↔ service interaction for the TicketsPage component:
 *   - Empty state when no tickets exist
 *   - Create ticket modal (store_manager access)
 *   - Ticket list renders after seeding
 *   - SLA countdown visible in ticket row
 *   - Assign to Me action available for open tickets
 *   - Transition controls visible for in-progress tickets
 *   - Reviewer role can view but not create
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../../src/infrastructure/db/db.js';
import { authService } from '../../../src/services/AuthService.js';
import { ticketService } from '../../../src/services/TicketService.js';
import { cryptoService } from '../../../src/services/CryptoService.js';
import { BootstrapService } from '../../../src/services/BootstrapService.js';
import { currentUser } from '../../../src/app/stores/auth.js';
import {
  setBroadcastService,
  closeAll,
} from '../../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../../src/infrastructure/broadcast/MockBroadcastService.js';
import { CustomerRepository } from '../../../src/repositories/implementations/CustomerRepository.js';
import { OrgRepository } from '../../../src/repositories/implementations/OrgRepository.js';
import TicketsPage from '../../../src/pages/TicketsPage.svelte';
import { ROLES, TICKET_STATUSES } from '../../../src/utils/constants.js';

const ADMIN_PASS = 'Tickets@1234';
const ORG_ID = 'org-tickets-test';

let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'ticket_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'TicketTestCo',
  });
  adminUser = result.admin;

  await authService.login('ticket_admin', ADMIN_PASS);
  authService._currentUser = { ...authService._currentUser, organizationNodeId: ORG_ID };
  currentUser.set(authService._currentUser);

  // Seed org node for store validation.
  const orgRepo = new OrgRepository();
  await orgRepo.create({
    id: ORG_ID, name: 'Tickets Test Org', type: 'company', parentId: null,
    organizationId: ORG_ID, createdAt: Date.now(), updatedAt: Date.now(),
  });

  // Seed customer so ticket creation passes customer validation.
  const custRepo = new CustomerRepository();
  await custRepo.create({
    id: 'cust-001', organizationId: ORG_ID, name: 'Test Customer',
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
  currentUser.set(null);
  closeDB();
  closeAll();
  vi.restoreAllMocks();
});

async function seedTicket(overrides = {}) {
  return ticketService.createTicket({
    customerId: 'cust-001',
    organizationId: ORG_ID,
    storeId: ORG_ID,
    subject: overrides.subject ?? 'Test Issue',
    description: overrides.description ?? 'Something went wrong.',
    category: overrides.category ?? 'general',
    priority: overrides.priority ?? 'medium',
    actorId: adminUser.id,
    ...overrides,
  });
}

// ── Empty state ───────────────────────────────────────────────────────────────

describe('TicketsPage — empty state', () => {
  it('renders Ticket Management header', () => {
    render(TicketsPage);
    expect(screen.getByText('Ticket Management')).toBeTruthy();
  });

  it('shows "No tickets" when list is empty', async () => {
    render(TicketsPage);
    await waitFor(() => {
      expect(screen.getByText(/no tickets/i)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows "Select a ticket to view" placeholder in detail pane', async () => {
    render(TicketsPage);
    await waitFor(() => {
      expect(screen.getByText(/select a ticket/i)).toBeTruthy();
    }, { timeout: 3000 });
  });
});

// ── Create ticket ─────────────────────────────────────────────────────────────

describe('TicketsPage — create ticket modal', () => {
  it('shows + New Ticket button for admin', () => {
    render(TicketsPage);
    expect(screen.getByRole('button', { name: /new ticket/i })).toBeTruthy();
  });

  it('Create Ticket button disabled when subject or description empty', async () => {
    render(TicketsPage);
    fireEvent.click(screen.getByRole('button', { name: /new ticket/i }));

    await waitFor(() => screen.getByRole('dialog'));
    const createBtn = screen.getByRole('button', { name: /create ticket/i });
    expect(createBtn).toBeDisabled();
  });
});

// ── Ticket list ───────────────────────────────────────────────────────────────

describe('TicketsPage — ticket list', () => {
  it('renders ticket subject after seeding', async () => {
    await seedTicket({ subject: 'Return Request' });
    render(TicketsPage);
    await waitFor(() => {
      expect(screen.getByText('Return Request')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows SLA timer for seeded ticket', async () => {
    await seedTicket();
    render(TicketsPage);
    await waitFor(() => {
      expect(screen.getByText(/SLA:/i)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows status badge in ticket row', async () => {
    await seedTicket();
    render(TicketsPage);
    await waitFor(() => {
      expect(screen.getByText(TICKET_STATUSES.OPEN)).toBeTruthy();
    }, { timeout: 3000 });
  });
});

// ── Ticket detail + actions ───────────────────────────────────────────────────

describe('TicketsPage — ticket detail', () => {
  it('shows Assign to Me button when ticket is unassigned', async () => {
    await seedTicket({ subject: 'Assign Me' });
    render(TicketsPage);

    await waitFor(() => screen.getByText('Assign Me'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Assign Me'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /assign to me/i })).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows transition controls for open ticket', async () => {
    await seedTicket({ subject: 'Transition Me' });
    render(TicketsPage);

    await waitFor(() => screen.getByText('Transition Me'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Transition Me'));

    await waitFor(() => {
      expect(screen.getByText('Move to Status')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('Apply Transition button disabled when no status selected', async () => {
    await seedTicket({ subject: 'Trans Disabled' });
    render(TicketsPage);

    await waitFor(() => screen.getByText('Trans Disabled'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Trans Disabled'));

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /apply transition/i });
      expect(btn).toBeDisabled();
    }, { timeout: 3000 });
  });
});

// ── Role-based controls ───────────────────────────────────────────────────────

describe('TicketsPage — reviewer role', () => {
  it('reviewer does not see + New Ticket button', async () => {
    authService._currentUser = {
      id: 'reviewer-001',
      role: ROLES.REVIEWER,
      organizationNodeId: ORG_ID,
    };
    currentUser.set(authService._currentUser);

    render(TicketsPage);
    await waitFor(() => {}, { timeout: 500 });
    expect(screen.queryByRole('button', { name: /new ticket/i })).toBeNull();
  });
});
