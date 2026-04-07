/**
 * Sidebar + Auth UI — integration tests.
 *
 * Tests the Sidebar component directly (no DB dependency) for RBAC-gated
 * menu visibility, and tests auth UI flows (lock/unlock/logout) that are
 * driven by Svelte stores.
 *
 * Covers:
 *   - Each role sees only its allowed nav items (DOM-level verification)
 *   - Admin-only routes hidden from non-admin roles
 *   - Lock screen driven by isLocked store
 *   - Username and role rendered in sidebar
 *   - Lock and Log out buttons dispatch events
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import {
  currentUser,
  isAuthenticated,
  isLocked,
  isGuest,
  clearAuthStores,
} from '../../src/app/stores/auth.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import Sidebar from '../../src/app/components/Sidebar.svelte';

function setRole(role, username = 'testuser') {
  const user = { id: 'user-1', username, role, organizationNodeId: 'org-1', isActive: true };
  currentUser.set(user);
  isAuthenticated.set(true);
  isLocked.set(false);
  isGuest.set(false);
}

beforeEach(() => {
  setBroadcastService(new MockBroadcastService());
});

afterEach(() => {
  clearAuthStores();
  closeAll();
});

// ── Sidebar RBAC visibility ───────────────────────────────────────────────────

describe('Sidebar — role-based menu visibility', () => {
  it('administrator sees all 8 nav items', () => {
    setRole('administrator');
    render(Sidebar);

    expect(screen.getByText('CRM')).toBeTruthy();
    expect(screen.getByText('Orders')).toBeTruthy();
    expect(screen.getByText('Master Data')).toBeTruthy();
    expect(screen.getByText('Messages')).toBeTruthy();
    expect(screen.getByText('NLP Analysis')).toBeTruthy();
    expect(screen.getByText('Risk Review')).toBeTruthy();
    expect(screen.getByText('Org Setup')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('store_manager sees CRM, Orders, Messages, Master Data', () => {
    setRole('store_manager');
    render(Sidebar);

    expect(screen.getByText('CRM')).toBeTruthy();
    expect(screen.getByText('Orders')).toBeTruthy();
    expect(screen.getByText('Messages')).toBeTruthy();
    expect(screen.getByText('Master Data')).toBeTruthy();
  });

  it('store_manager does NOT see Admin, NLP Analysis, Org Setup but sees Risk Review', () => {
    setRole('store_manager');
    render(Sidebar);

    expect(screen.queryByText('Admin')).toBeNull();
    expect(screen.queryByText('NLP Analysis')).toBeNull();
    expect(screen.queryByText('Org Setup')).toBeNull();
    // store_manager CAN access Risk Review (evaluate rules, manage heuristics)
    expect(screen.queryByText('Risk Review')).toBeTruthy();
  });

  it('analyst sees NLP Analysis and CRM only', () => {
    setRole('analyst');
    render(Sidebar);

    expect(screen.getByText('NLP Analysis')).toBeTruthy();
    expect(screen.getByText('CRM')).toBeTruthy();
  });

  it('analyst does NOT see Admin, Orders, Risk Review, Org Setup', () => {
    setRole('analyst');
    render(Sidebar);

    expect(screen.queryByText('Admin')).toBeNull();
    expect(screen.queryByText('Orders')).toBeNull();
    expect(screen.queryByText('Risk Review')).toBeNull();
    expect(screen.queryByText('Org Setup')).toBeNull();
  });

  it('reviewer sees only Risk Review', () => {
    setRole('reviewer');
    render(Sidebar);

    expect(screen.getByText('Risk Review')).toBeTruthy();
    expect(screen.queryByText('CRM')).toBeNull();
    expect(screen.queryByText('Orders')).toBeNull();
    expect(screen.queryByText('Admin')).toBeNull();
    expect(screen.queryByText('NLP Analysis')).toBeNull();
    expect(screen.queryByText('Org Setup')).toBeNull();
  });

  it('guest sees only CRM', () => {
    currentUser.set({ id: 'guest-1', username: 'guest', role: 'guest', isGuest: true });
    isAuthenticated.set(false);
    isGuest.set(true);
    isLocked.set(false);
    render(Sidebar);

    expect(screen.getByText('CRM')).toBeTruthy();
    expect(screen.queryByText('Orders')).toBeNull();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('shows username and role badge in sidebar', () => {
    setRole('administrator', 'alice_admin');
    render(Sidebar);

    expect(screen.getByText('alice_admin')).toBeTruthy();
    expect(screen.getByText('administrator')).toBeTruthy();
  });

  it('sidebar is hidden when not authenticated and not guest', () => {
    clearAuthStores();
    render(Sidebar);

    expect(screen.queryByText('CRM')).toBeNull();
    expect(screen.queryByText('Log out')).toBeNull();
  });

  it('sidebar is hidden when session is locked', () => {
    setRole('administrator');
    isLocked.set(true);
    render(Sidebar);

    expect(screen.queryByText('CRM')).toBeNull();
  });
});

// ── Sidebar controls ──────────────────────────────────────────────────────────

describe('Sidebar — Lock and Log out controls', () => {
  it('renders Lock button', () => {
    setRole('administrator');
    render(Sidebar);

    expect(screen.getByRole('button', { name: /^lock$/i })).toBeTruthy();
  });

  it('renders Log out button', () => {
    setRole('administrator');
    render(Sidebar);

    expect(screen.getByRole('button', { name: /^log out$/i })).toBeTruthy();
  });

  it('Lock button dispatches lock event', async () => {
    setRole('administrator');
    let lockFired = false;
    const { component } = render(Sidebar);
    component.$on('lock', () => { lockFired = true; });

    fireEvent.click(screen.getByRole('button', { name: /^lock$/i }));
    expect(lockFired).toBe(true);
  });

  it('Log out button dispatches logout event', async () => {
    setRole('administrator');
    let logoutFired = false;
    const { component } = render(Sidebar);
    component.$on('logout', () => { logoutFired = true; });

    fireEvent.click(screen.getByRole('button', { name: /^log out$/i }));
    expect(logoutFired).toBe(true);
  });
});
