/**
 * AdminPage — integration tests.
 *
 * Verifies UI ↔ service interaction for the AdminPage component:
 *   - User list renders after mount
 *   - Create user form opens and validates required fields
 *   - Backup tab renders export controls
 *   - Deactivate button present for active users
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../../src/infrastructure/db/db.js';
import { authService } from '../../../src/services/AuthService.js';
import { cryptoService } from '../../../src/services/CryptoService.js';
import { BootstrapService } from '../../../src/services/BootstrapService.js';
import { currentUser } from '../../../src/app/stores/auth.js';
import {
  setBroadcastService,
  closeAll,
} from '../../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../../src/infrastructure/broadcast/MockBroadcastService.js';
import { toast } from '../../../src/app/stores/ui.js';
import { get } from 'svelte/store';
import AdminPage from '../../../src/pages/AdminPage.svelte';

const ADMIN_PASS = 'AdminPage@1234';

let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'site_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'AdminCo',
  });
  adminUser = result.admin;

  await authService.login('site_admin', ADMIN_PASS);
  authService._currentUser = { ...authService._currentUser, role: 'administrator' };
  currentUser.set(authService._currentUser);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  currentUser.set(null);
  closeDB();
  closeAll();
});

describe('AdminPage — user list', () => {
  it('renders Administration header', () => {
    render(AdminPage);
    expect(screen.getByText('Administration')).toBeTruthy();
  });

  it('shows + New User button', () => {
    render(AdminPage);
    expect(screen.getByText('+ New User')).toBeTruthy();
  });

  it('renders the bootstrapped admin user in the list', async () => {
    render(AdminPage);
    await waitFor(() => {
      expect(screen.getByText('site_admin')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows Users and Backup tabs', () => {
    render(AdminPage);
    expect(screen.getByRole('button', { name: /^users$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^backup$/i })).toBeTruthy();
  });
});

describe('AdminPage — create user form', () => {
  it('opens create user form on + New User click', async () => {
    render(AdminPage);
    fireEvent.click(screen.getByText('+ New User'));
    await waitFor(() => {
      expect(screen.getByText('Create User')).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('Create User button disabled when username is empty', async () => {
    render(AdminPage);
    fireEvent.click(screen.getByText('+ New User'));
    await waitFor(() => screen.getByText('New User'), { timeout: 2000 });

    const btn = screen.getByRole('button', { name: /^create user$/i });
    expect(btn).toBeDisabled();
  });

  it('Create User button disabled when password is empty', async () => {
    render(AdminPage);
    fireEvent.click(screen.getByText('+ New User'));
    await waitFor(() => screen.getByText('New User'), { timeout: 2000 });

    const inputs = screen.getAllByRole('textbox');
    await fireEvent.input(inputs[0], { target: { value: 'new_user' } });

    const btn = screen.getByRole('button', { name: /^create user$/i });
    expect(btn).toBeDisabled();
  });
});

describe('AdminPage — backup tab', () => {
  it('Backup tab shows export section', async () => {
    render(AdminPage);
    await waitFor(() => screen.getByRole('button', { name: /^backup$/i }), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /^backup$/i }));
    await waitFor(() => {
      expect(screen.getByText(/export backup/i)).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('Export & Download button disabled when passphrase is empty', async () => {
    render(AdminPage);
    await waitFor(() => screen.getByRole('button', { name: /^backup$/i }), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /^backup$/i }));
    await waitFor(() => screen.getByText(/export backup/i), { timeout: 2000 });

    const btn = screen.getByRole('button', { name: /export & download/i });
    expect(btn).toBeDisabled();
  });
});

// ── Loading state ──────────────────────────────────────────────────────────

describe('AdminPage — loading state', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows Loading… while user list is being fetched', () => {
    vi.spyOn(authService, 'listUsers').mockImplementation(() => new Promise(() => {}));
    render(AdminPage);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows error toast when listUsers throws', async () => {
    vi.spyOn(authService, 'listUsers').mockRejectedValue(new Error('Permission denied'));
    render(AdminPage);
    await waitFor(() => {
      const t = get(toast);
      expect(t?.type).toBe('error');
      expect(t?.message).toBe('Permission denied');
    }, { timeout: 3000 });
  });
});

// ── Deactivate user ────────────────────────────────────────────────────────

describe('AdminPage — deactivate user', () => {
  it('successfully deactivates a second user and list refreshes', async () => {
    // Create a second user to deactivate.
    await authService.createUser({
      username: 'to_deactivate',
      password: 'Deactivate@123',
      role: 'store_manager',
      organizationNodeId: adminUser.organizationNodeId,
    });

    render(AdminPage);
    await waitFor(() => screen.getByText('to_deactivate'), { timeout: 3000 });

    // Stub confirm() to auto-approve.
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const btn = screen.getByRole('button', { name: /^deactivate$/i });
    await fireEvent.click(btn);

    await waitFor(() => {
      const t = get(toast);
      expect(t?.type).toBe('success');
    }, { timeout: 3000 });
  });

  afterEach(() => vi.restoreAllMocks());
});

// ── Real data-path: create user → appears in list ─────────────────────────

describe('AdminPage — created user appears in list (real data path)', () => {
  it('new user appears in the list after form submission', async () => {
    render(AdminPage);
    await waitFor(() => screen.getByText('+ New User'), { timeout: 3000 });
    fireEvent.click(screen.getByText('+ New User'));
    await waitFor(() => screen.getByText('New User'), { timeout: 2000 });

    // Fill username — the input has no placeholder, query by position in modal
    await waitFor(() => screen.getAllByRole('textbox').length > 0);
    const usernameInput = screen.getAllByRole('textbox')[0];
    await fireEvent.input(usernameInput, { target: { value: 'real_new_user' } });

    // Fill password (type="password" inputs won't appear in getAllByRole('textbox'))
    const passwordInput = document.querySelector('input[type="password"]');
    await fireEvent.input(passwordInput, { target: { value: 'NewUser@1234' } });

    // Use administrator role — no organizationNodeId required
    const roleSelect = document.querySelector('select');
    if (roleSelect) {
      await fireEvent.change(roleSelect, { target: { value: 'administrator' } });
    }

    const createBtn = screen.getByRole('button', { name: /^create user$/i });
    await fireEvent.click(createBtn);

    // After creation, the user should appear in the list
    await waitFor(() => {
      expect(screen.getByText('real_new_user')).toBeTruthy();
    }, { timeout: 5000 });
  });

  it('deactivated user shows inactive status in the list', async () => {
    await authService.createUser({
      username: 'inactive_target',
      password: 'Target@12345',
      role: 'store_manager',
      organizationNodeId: adminUser.organizationNodeId,
    });

    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(AdminPage);
    await waitFor(() => screen.getByText('inactive_target'), { timeout: 3000 });

    const deactivateBtn = screen.getByRole('button', { name: /^deactivate$/i });
    await fireEvent.click(deactivateBtn);

    await waitFor(() => {
      // After deactivation the user should be marked inactive in the UI
      expect(screen.getByText(/inactive/i)).toBeTruthy();
    }, { timeout: 3000 });

    vi.restoreAllMocks();
  });
});

// ── Side-effect: error leaves user list empty ──────────────────────────────

describe('AdminPage — error state side-effects', () => {
  afterEach(() => vi.restoreAllMocks());

  it('listUsers error: toast store shows error AND user list remains empty', async () => {
    vi.spyOn(authService, 'listUsers').mockRejectedValue(new Error('Permission denied'));
    render(AdminPage);

    await waitFor(() => {
      const t = get(toast);
      expect(t?.type).toBe('error');
      expect(t?.message).toBe('Permission denied');
    }, { timeout: 3000 });

    // Side-effect: no user rows should be rendered since the load failed
    expect(screen.queryByText('site_admin')).toBeNull();
  });
});

// ── Denied-action: non-admin cannot create users ───────────────────────────

describe('AdminPage — denied-action assertions', () => {
  it('store_manager calling createUser is rejected at the service layer', async () => {
    // Switch current user to store_manager role
    authService._currentUser = {
      ...authService._currentUser,
      role: 'store_manager',
    };

    await expect(
      authService.createUser({
        username: 'forbidden_user',
        password: 'Forbidden@1234',
        role: 'analyst',
        organizationNodeId: adminUser.organizationNodeId,
      })
    ).rejects.toThrow(/permission|unauthorized|forbidden|not allowed/i);

    // Restore admin role
    authService._currentUser = { ...authService._currentUser, role: 'administrator' };
  });

  it('analyst calling createUser is rejected at the service layer', async () => {
    authService._currentUser = {
      ...authService._currentUser,
      role: 'analyst',
    };

    await expect(
      authService.createUser({
        username: 'analyst_created',
        password: 'Analyst@1234',
        role: 'reviewer',
        organizationNodeId: adminUser.organizationNodeId,
      })
    ).rejects.toThrow(/permission|unauthorized|forbidden|not allowed/i);

    authService._currentUser = { ...authService._currentUser, role: 'administrator' };
  });
});
