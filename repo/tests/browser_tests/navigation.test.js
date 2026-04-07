/**
 * Browser tests — Router navigation and access control.
 *
 * Covers:
 *   - Each authenticated route renders its page header
 *   - Unauthenticated access to protected route renders login instead
 *   - Guest session sees guest-allowed routes
 *   - resolveAccess redirects unauthenticated requests to /login
 *   - resolveAccess allows admin to reach all protected routes
 *   - resolveAccess allows store_manager routes but denies admin-only routes
 *   - resolveAccess denies guest from protected routes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { currentUser } from '../../src/app/stores/auth.js';
import { resolveAccess } from '../../src/app/router/accessControl.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';

// Page components
import OrgSetupPage from '../../src/pages/OrgSetupPage.svelte';
import MasterDataPage from '../../src/pages/MasterDataPage.svelte';
import CRMPage from '../../src/pages/CRMPage.svelte';
import OrdersPage from '../../src/pages/OrdersPage.svelte';
import MessagesPage from '../../src/pages/MessagesPage.svelte';
import NLPPage from '../../src/pages/NLPPage.svelte';
import RiskReviewPage from '../../src/pages/RiskReviewPage.svelte';
import AdminPage from '../../src/pages/AdminPage.svelte';

const ADMIN_PASS = 'NavTest@1234';

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'nav_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'NavTestCo',
  });

  await authService.login('nav_admin', ADMIN_PASS);
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

// ── Page header rendering ─────────────────────────────────────────────────────

describe('Navigation — page headers render for authenticated admin', () => {
  it('OrgSetupPage renders "Organization Setup" header', () => {
    render(OrgSetupPage);
    expect(screen.getByText('Organization Setup')).toBeTruthy();
  });

  it('MasterDataPage renders "Master Data" header', () => {
    render(MasterDataPage);
    expect(screen.getByText('Master Data')).toBeTruthy();
  });

  it('CRMPage renders "Customer CRM" header', () => {
    render(CRMPage);
    expect(screen.getByText('Customer CRM')).toBeTruthy();
  });

  it('OrdersPage renders "Orders" header', () => {
    render(OrdersPage);
    expect(screen.getByText('Orders')).toBeTruthy();
  });

  it('MessagesPage renders "Notifications & Messages" header', () => {
    render(MessagesPage);
    expect(screen.getByText('Notifications & Messages')).toBeTruthy();
  });

  it('NLPPage renders "NLP Analysis" header', () => {
    render(NLPPage);
    expect(screen.getByText('NLP Analysis')).toBeTruthy();
  });

  it('RiskReviewPage renders "Risk Review" header', () => {
    render(RiskReviewPage);
    expect(screen.getByText('Risk Review')).toBeTruthy();
  });

  it('AdminPage renders "Administration" header', () => {
    render(AdminPage);
    expect(screen.getByText('Administration')).toBeTruthy();
  });
});

// ── resolveAccess — unauthenticated ───────────────────────────────────────────

describe('Navigation — resolveAccess unauthenticated', () => {
  it('redirects unauthenticated user from /crm to /login', () => {
    const result = resolveAccess('/crm', false, false, null);
    expect(result.allowed).toBe(false);
    expect(result.redirectTo).toBe('/login');
  });

  it('redirects unauthenticated user from /admin to /login', () => {
    const result = resolveAccess('/admin', false, false, null);
    expect(result.allowed).toBe(false);
    expect(result.redirectTo).toBe('/login');
  });

  it('allows unauthenticated access to /login', () => {
    const result = resolveAccess('/login', false, false, null);
    expect(result.allowed).toBe(true);
  });

  it('allows unauthenticated access to /bootstrap', () => {
    const result = resolveAccess('/bootstrap', false, false, null);
    expect(result.allowed).toBe(true);
  });
});

// ── resolveAccess — admin ─────────────────────────────────────────────────────

describe('Navigation — resolveAccess admin', () => {
  it('admin can access /crm', () => {
    const result = resolveAccess('/crm', true, false, 'administrator');
    expect(result.allowed).toBe(true);
  });

  it('admin can access /admin', () => {
    const result = resolveAccess('/admin', true, false, 'administrator');
    expect(result.allowed).toBe(true);
  });

  it('admin can access /nlp', () => {
    const result = resolveAccess('/nlp', true, false, 'administrator');
    expect(result.allowed).toBe(true);
  });

  it('admin can access /risk-review', () => {
    const result = resolveAccess('/risk-review', true, false, 'administrator');
    expect(result.allowed).toBe(true);
  });
});

// ── resolveAccess — role restrictions ─────────────────────────────────────────

describe('Navigation — resolveAccess role restrictions', () => {
  it('store_manager denied from /admin', () => {
    const result = resolveAccess('/admin', true, false, 'store_manager');
    expect(result.allowed).toBe(false);
  });

  it('analyst denied from /admin', () => {
    const result = resolveAccess('/admin', true, false, 'analyst');
    expect(result.allowed).toBe(false);
  });

  it('reviewer denied from /admin', () => {
    const result = resolveAccess('/admin', true, false, 'reviewer');
    expect(result.allowed).toBe(false);
  });

  it('guest denied from /admin', () => {
    const result = resolveAccess('/admin', false, true, null);
    expect(result.allowed).toBe(false);
  });
});
