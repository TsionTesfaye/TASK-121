/**
 * UI Svelte store.
 * Lightweight state for navigation, layout preferences, and modals.
 */
import { writable } from 'svelte/store';

/** @type {import('svelte/store').Writable<string>} Current hash-based route path. */
export const currentPath = writable('/login');

/** @type {import('svelte/store').Writable<boolean>} Global loading overlay. */
export const isLoading = writable(false);

/** @type {import('svelte/store').Writable<{ type: 'success'|'error'|'info'|'warning'; message: string } | null>} */
export const toast = writable(null);

/** @type {import('svelte/store').Writable<Record<string, string[]>>} Per-table column layout preferences. */
export const tableColumnLayouts = writable({});

/** @type {import('svelte/store').Writable<boolean>} Sidebar collapsed state. */
export const sidebarCollapsed = writable(false);

/**
 * Navigates to a route by updating the hash.
 * @param {string} path
 */
export function navigate(path) {
  window.location.hash = path;
}

/**
 * Shows a toast notification that auto-dismisses after `durationMs`.
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {string} message
 * @param {number} [durationMs=4000]
 */
export function showToast(type, message, durationMs = 4000) {
  toast.set({ type, message });
  setTimeout(() => toast.set(null), durationMs);
}

// ── LocalStorage key helpers (user-scoped) ────────────────────────────────────

/**
 * Returns the user-scoped LocalStorage key for column layouts.
 * Scoped by userId to prevent cross-user leakage when multiple users
 * share the same device and browser profile.
 *
 * @param {string} [userId]
 * @returns {string}
 */
function colLayoutKey(userId) {
  return userId ? `retailops:column_layouts:${userId}` : 'retailops:column_layouts';
}

/**
 * Persists table column layout preferences to LocalStorage.
 * @param {string} tableKey
 * @param {string[]} columns
 * @param {string} [userId]  Current user's ID for key scoping.
 */
export function saveColumnLayout(tableKey, columns, userId = '') {
  tableColumnLayouts.update((layouts) => {
    const updated = { ...layouts, [tableKey]: columns };
    try {
      localStorage.setItem(colLayoutKey(userId), JSON.stringify(updated));
    } catch {
      // Non-fatal.
    }
    return updated;
  });
}

/**
 * Restores all column layout preferences from LocalStorage.
 * @param {string} [userId]  Current user's ID for key scoping.
 */
export function restoreColumnLayouts(userId = '') {
  try {
    const raw = localStorage.getItem(colLayoutKey(userId));
    if (raw) tableColumnLayouts.set(JSON.parse(raw));
  } catch {
    // Non-fatal.
  }
}

/**
 * Removes a user's column layout preferences from LocalStorage.
 * Call on logout to prevent stale preferences persisting for new sessions.
 * @param {string} userId
 */
export function clearUserLayoutPreferences(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(colLayoutKey(userId));
  } catch {
    // Non-fatal.
  }
}
