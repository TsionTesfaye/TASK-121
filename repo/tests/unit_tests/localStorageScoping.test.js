/**
 * LocalStorage user-scoping tests.
 *
 * Verifies that column layout and selected-store preferences are isolated
 * per user and do NOT leak between different user accounts on the same device.
 *
 * This directly tests the security fix for cross-user localStorage leakage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  saveColumnLayout,
  restoreColumnLayouts,
  clearUserLayoutPreferences,
  tableColumnLayouts,
} from '../../src/app/stores/ui.js';
import {
  persistSelectedStore,
  restoreSelectedStore,
  clearOrgPreferences,
  selectedStore,
} from '../../src/app/stores/org.js';
import { get } from 'svelte/store';

const USER_A = 'user-alice-001';
const USER_B = 'user-bob-002';

beforeEach(() => {
  localStorage.clear();
  // Reset stores to default state.
  tableColumnLayouts.set({});
  selectedStore.set(null);
});

afterEach(() => {
  localStorage.clear();
});

// ── Column layout scoping ─────────────────────────────────────────────────────

describe('Column layout preferences — user scoping', () => {
  it('saves with user-scoped key', () => {
    saveColumnLayout('orders', ['id', 'status'], USER_A);
    expect(localStorage.getItem(`retailops:column_layouts:${USER_A}`)).not.toBeNull();
    expect(localStorage.getItem(`retailops:column_layouts:${USER_B}`)).toBeNull();
  });

  it('different users get different storage keys', () => {
    saveColumnLayout('orders', ['id', 'status'], USER_A);
    saveColumnLayout('orders', ['id', 'status', 'created'], USER_B);

    const rawA = JSON.parse(localStorage.getItem(`retailops:column_layouts:${USER_A}`));
    const rawB = JSON.parse(localStorage.getItem(`retailops:column_layouts:${USER_B}`));

    expect(rawA.orders).toEqual(['id', 'status']);
    expect(rawB.orders).toEqual(['id', 'status', 'created']);
  });

  it('restoring user A preferences does not load user B data', () => {
    saveColumnLayout('customers', ['name', 'tier'], USER_A);
    saveColumnLayout('customers', ['name', 'email', 'tier'], USER_B);

    // Reset store, then restore for user A.
    tableColumnLayouts.set({});
    restoreColumnLayouts(USER_A);
    const layouts = get(tableColumnLayouts);
    expect(layouts.customers).toEqual(['name', 'tier']);
  });

  it('restoring user B does not expose user A data', () => {
    saveColumnLayout('orders', ['id', 'status', 'amount'], USER_A);

    tableColumnLayouts.set({});
    restoreColumnLayouts(USER_B); // B has no saved data
    const layouts = get(tableColumnLayouts);
    expect(layouts.orders).toBeUndefined();
  });

  it('clearUserLayoutPreferences removes only that user\'s key', () => {
    saveColumnLayout('orders', ['id', 'status'], USER_A);
    saveColumnLayout('orders', ['id', 'status'], USER_B);

    clearUserLayoutPreferences(USER_A);

    expect(localStorage.getItem(`retailops:column_layouts:${USER_A}`)).toBeNull();
    expect(localStorage.getItem(`retailops:column_layouts:${USER_B}`)).not.toBeNull();
  });

  it('clearUserLayoutPreferences is a no-op when userId is empty', () => {
    saveColumnLayout('orders', ['id'], USER_A);
    clearUserLayoutPreferences(''); // should not throw
    expect(localStorage.getItem(`retailops:column_layouts:${USER_A}`)).not.toBeNull();
  });

  it('persist/restore round-trip preserves all table keys', () => {
    saveColumnLayout('orders', ['id', 'status'], USER_A);
    saveColumnLayout('customers', ['name', 'tier'], USER_A);

    tableColumnLayouts.set({});
    restoreColumnLayouts(USER_A);

    const layouts = get(tableColumnLayouts);
    expect(layouts.orders).toEqual(['id', 'status']);
    expect(layouts.customers).toEqual(['name', 'tier']);
  });
});

// ── Selected store scoping ────────────────────────────────────────────────────

describe('Selected store preferences — user scoping', () => {
  it('saves with user-scoped key', () => {
    persistSelectedStore({ id: 'store-1', name: 'Downtown' }, USER_A);
    expect(localStorage.getItem(`retailops:last_store:${USER_A}`)).not.toBeNull();
    expect(localStorage.getItem(`retailops:last_store:${USER_B}`)).toBeNull();
  });

  it('different users can store different selected stores', () => {
    persistSelectedStore({ id: 'store-1', name: 'Downtown' }, USER_A);
    persistSelectedStore({ id: 'store-2', name: 'Uptown' }, USER_B);

    const storeA = restoreSelectedStore(USER_A);
    const storeB = restoreSelectedStore(USER_B);

    expect(storeA.id).toBe('store-1');
    expect(storeB.id).toBe('store-2');
  });

  it('restoring user A store does not reveal user B selection', () => {
    persistSelectedStore({ id: 'store-2', name: 'Uptown' }, USER_B);
    const storeA = restoreSelectedStore(USER_A);
    expect(storeA).toBeNull();
  });

  it('clearOrgPreferences removes only that user\'s store key', () => {
    persistSelectedStore({ id: 'store-1', name: 'Downtown' }, USER_A);
    persistSelectedStore({ id: 'store-2', name: 'Uptown' }, USER_B);

    clearOrgPreferences(USER_A);

    expect(restoreSelectedStore(USER_A)).toBeNull();
    expect(restoreSelectedStore(USER_B)).not.toBeNull();
  });

  it('persistSelectedStore(null) removes the key', () => {
    persistSelectedStore({ id: 'store-1', name: 'Downtown' }, USER_A);
    persistSelectedStore(null, USER_A);
    expect(restoreSelectedStore(USER_A)).toBeNull();
  });

  it('returns null when no stored value exists', () => {
    expect(restoreSelectedStore('nonexistent-user')).toBeNull();
  });
});
