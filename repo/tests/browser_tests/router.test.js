/**
 * Browser tests — Router.svelte component behavior.
 *
 * Focuses on what navigation.test.js does NOT cover: the Router component's
 * own logic — rendering the correct page based on store state, handling hash
 * fallback to DEFAULT_ROUTE, and responding to auth state changes.
 *
 * Covers:
 *   — Unauthenticated + /login → renders login form
 *   — Unauthenticated + /crm  → guard redirect, renders login form
 *   — Unknown hash            → falls back to /login, renders login form
 *   — Authenticated admin + /crm → renders CRM page
 *   — Loading placeholder before onMount fires
 *   — Auth state transition: stores flip unauthenticated → authenticated
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

// ── Unauthenticated helpers ───────────────────────────────────────────────────
import {
  clearAuthStores,
  isAuthenticated,
  isGuest,
  currentRole,
  currentUser,
} from '../../src/app/stores/auth.js';
import { currentPath } from '../../src/app/stores/ui.js';

// ── DB / auth helpers (authenticated suites) ─────────────────────────────────
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { cryptoService } from '../../src/services/CryptoService.js';

// ── Broadcast ─────────────────────────────────────────────────────────────────
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';

// ── Component under test ──────────────────────────────────────────────────────
import Router from '../../src/app/router/Router.svelte';

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Unauthenticated — no DB required
// ─────────────────────────────────────────────────────────────────────────────

describe('Router — unauthenticated', () => {
  beforeEach(() => {
    setBroadcastService(new MockBroadcastService());
    clearAuthStores();
  });

  afterEach(() => {
    clearAuthStores();
    closeAll();
  });

  it('renders login form when currentPath is /login', async () => {
    currentPath.set('/login');
    render(Router);

    await waitFor(() => {
      expect(document.querySelector('input[autocomplete="username"]')).toBeTruthy();
      expect(document.querySelector('input[autocomplete="current-password"]')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('renders "Sign In" button on login page', async () => {
    currentPath.set('/login');
    render(Router);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('guard redirect: renders login form when currentPath is /crm and not authenticated', async () => {
    // isAuthenticated and isGuest are false (clearAuthStores was called)
    currentPath.set('/crm');
    render(Router);

    // Router must redirect to /login and render LoginPage, not CRMPage
    await waitFor(() => {
      expect(document.querySelector('input[autocomplete="username"]')).toBeTruthy();
    }, { timeout: 3000 });

    expect(screen.queryByText('Customer CRM')).toBeNull();
  });

  it('guard redirect does not render CRM content for /admin path when unauthenticated', async () => {
    currentPath.set('/admin');
    render(Router);

    await waitFor(() => {
      expect(document.querySelector('input[autocomplete="username"]')).toBeTruthy();
    }, { timeout: 3000 });

    expect(screen.queryByText('Administration')).toBeNull();
  });

  it('unknown hash falls back to /login and renders login form', async () => {
    // An unrecognised path — routes['/unknown'] is undefined, so Router falls
    // through to routes[DEFAULT_ROUTE] which is LoginPage.
    currentPath.set('/unknown-route-xyz');
    render(Router);

    await waitFor(() => {
      expect(document.querySelector('input[autocomplete="username"]')).toBeTruthy();
    }, { timeout: 3000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Authenticated admin — DB required
// ─────────────────────────────────────────────────────────────────────────────

describe('Router — authenticated admin', () => {
  beforeEach(async () => {
    setBroadcastService(new MockBroadcastService());
    await initDB(new IDBFactory());

    const bs = new BootstrapService();
    await bs.bootstrap({
      adminUsername: 'router_admin',
      adminPassword: 'RouterTest@1234',
      orgName: 'RouterTestCo',
    });
  });

  afterEach(() => {
    cryptoService.clearSessionKey();
    authService._currentUser = null;
    currentUser.set(null);
    clearAuthStores();
    window.location.hash = '';
    closeDB();
    closeAll();
  });

  it('renders CRM page when hash is /crm and logged in as admin', async () => {
    await authService.login('router_admin', 'RouterTest@1234');
    currentUser.set(authService._currentUser);
    isAuthenticated.set(true);
    isGuest.set(false);

    // Set hash so onMount's onHashChange() reads /crm and does not override currentPath.
    window.location.hash = '#/crm';
    currentPath.set('/crm');
    render(Router);

    await waitFor(() => {
      expect(screen.getByText('Customer CRM')).toBeTruthy();
    }, { timeout: 5000 });
  });

  it('does not render the login form once authenticated admin is at /crm', async () => {
    await authService.login('router_admin', 'RouterTest@1234');
    currentUser.set(authService._currentUser);
    isAuthenticated.set(true);
    isGuest.set(false);

    window.location.hash = '#/crm';
    currentPath.set('/crm');
    render(Router);

    await waitFor(() => {
      expect(screen.getByText('Customer CRM')).toBeTruthy();
    }, { timeout: 5000 });

    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('renders successfully without throwing when no path is set (loading placeholder or login)', async () => {
    // Render with empty hash — Router should fall back to DEFAULT_ROUTE (/login).
    clearAuthStores();
    window.location.hash = '';
    currentPath.set('/login');

    const { container } = render(Router);

    // The component must render without throwing and show either the loading
    // placeholder or the login page.
    const hasLoading = container.querySelector('p') !== null;
    const hasLogin   = container.querySelector('input[autocomplete="username"]') !== null;
    expect(hasLoading || hasLogin).toBe(true);
  });

  it('authenticated admin at /admin renders Administration page', async () => {
    await authService.login('router_admin', 'RouterTest@1234');
    currentUser.set(authService._currentUser);
    isAuthenticated.set(true);
    isGuest.set(false);

    window.location.hash = '#/admin';
    currentPath.set('/admin');
    render(Router);

    await waitFor(() => {
      expect(screen.getByText('Administration')).toBeTruthy();
    }, { timeout: 5000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: Auth state transition — DB required
// ─────────────────────────────────────────────────────────────────────────────

describe('Router — auth state transition', () => {
  beforeEach(async () => {
    setBroadcastService(new MockBroadcastService());
    await initDB(new IDBFactory());

    const bs = new BootstrapService();
    await bs.bootstrap({
      adminUsername: 'router_admin',
      adminPassword: 'RouterTest@1234',
      orgName: 'RouterTestCo',
    });
  });

  afterEach(() => {
    cryptoService.clearSessionKey();
    authService._currentUser = null;
    currentUser.set(null);
    clearAuthStores();
    window.location.hash = '';
    closeDB();
    closeAll();
  });

  it('page updates from login form to CRM when stores flip unauthenticated → authenticated', async () => {
    // Start unauthenticated at /login
    clearAuthStores();
    window.location.hash = '#/login';
    currentPath.set('/login');
    render(Router);

    // Confirm login form is visible initially
    await waitFor(() => {
      expect(document.querySelector('input[autocomplete="username"]')).toBeTruthy();
    }, { timeout: 3000 });

    // Simulate successful login: update hash, auth stores, and path
    await authService.login('router_admin', 'RouterTest@1234');
    currentUser.set(authService._currentUser);
    isAuthenticated.set(true);
    isGuest.set(false);
    window.location.hash = '#/crm';
    currentPath.set('/crm');

    // Router's reactive statement re-evaluates; CRM page should now render
    await waitFor(() => {
      expect(screen.getByText('Customer CRM')).toBeTruthy();
    }, { timeout: 5000 });

    // Login form inputs should no longer be in the DOM
    expect(document.querySelector('input[autocomplete="username"]')).toBeNull();
  });

  it('page reverts to login when stores flip authenticated → unauthenticated', async () => {
    // Start authenticated at /crm
    await authService.login('router_admin', 'RouterTest@1234');
    currentUser.set(authService._currentUser);
    isAuthenticated.set(true);
    isGuest.set(false);
    window.location.hash = '#/crm';
    currentPath.set('/crm');

    render(Router);

    await waitFor(() => {
      expect(screen.getByText('Customer CRM')).toBeTruthy();
    }, { timeout: 5000 });

    // Simulate logout: clear auth stores and navigate to /login
    clearAuthStores();
    window.location.hash = '#/login';
    currentPath.set('/login');

    // Router re-evaluates; LoginPage should now render
    await waitFor(() => {
      expect(document.querySelector('input[autocomplete="username"]')).toBeTruthy();
    }, { timeout: 3000 });
  });
});
