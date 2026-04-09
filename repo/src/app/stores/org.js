/**
 * Organization Svelte store.
 * Tracks the currently selected organization node for store-scoped views.
 */
import { writable, derived } from 'svelte/store';
import { OrgRepository } from '../../repositories/implementations/OrgRepository.js';

/** @type {import('svelte/store').Writable<object | null>} Active org root node. */
export const selectedOrg = writable(null);

/** @type {import('svelte/store').Writable<object | null>} Currently selected store node. */
export const selectedStore = writable(null);

/** @type {import('svelte/store').Writable<object[]>} Full flat tree for the active org. */
export const orgTree = writable([]);

/** Derived: company-level root nodes. */
export const companyNodes = derived(orgTree, ($tree) =>
  $tree.filter((n) => n.type === 'company'),
);

/** Derived: store nodes within the active org. */
export const storeNodes = derived(orgTree, ($tree) =>
  $tree.filter((n) => n.type === 'store'),
);

/**
 * Resolves the org context for store-scoped service calls.
 * - organizationId: the root company/org node that owns the data
 * - storeId: the user's assigned node (may be a store, factory, or company)
 *
 * When the user is assigned to a store node, the organizationId is resolved
 * from the node's `organizationId` field (set at creation). When assigned to
 * the company root, both values are the same (flat hierarchy).
 *
 * @param {object} user  The current user (must have organizationNodeId).
 * @param {object[]} tree  The flat org tree array.
 * @returns {{ organizationId: string; storeId: string }}
 */
export function resolveOrgContext(user, tree) {
  const nodeId = user?.organizationNodeId;
  if (!nodeId) return { organizationId: '', storeId: '' };

  const node = tree.find((n) => n.id === nodeId);
  // The node's `organizationId` field always points to the root company.
  const organizationId = node?.organizationId ?? nodeId;
  return { organizationId, storeId: nodeId };
}

/**
 * Resolves the root organization ID from a user's assigned node via repository lookup.
 * Used when the orgTree Svelte store is empty (non-admin users who haven't loaded the tree).
 * This is the authoritative fallback — it reads directly from IndexedDB.
 *
 * @param {string} nodeId  The user's organizationNodeId.
 * @returns {Promise<string>}  The root company organizationId.
 */
export async function resolveRootOrgId(nodeId) {
  if (!nodeId) return nodeId;
  try {
    const repo = new OrgRepository();
    const node = await repo.findById(nodeId);
    return node?.organizationId ?? nodeId;
  } catch {
    return nodeId; // DB not ready or node doesn't exist — fall back safely
  }
}

// ── LocalStorage key helpers (user-scoped) ────────────────────────────────────

/**
 * Returns the user-scoped LocalStorage key for the selected store.
 * Scoped by userId to prevent cross-user preference leakage.
 *
 * @param {string} [userId]
 * @returns {string}
 */
function storeKey(userId) {
  return userId ? `retailops:last_store:${userId}` : 'retailops:last_store';
}

/**
 * Persists the selected store to LocalStorage for session continuity.
 * @param {object | null} store
 * @param {string} [userId]  Current user's ID for key scoping.
 */
export function persistSelectedStore(store, userId = '') {
  selectedStore.set(store);
  try {
    if (store) {
      localStorage.setItem(storeKey(userId), JSON.stringify({ id: store.id, name: store.name }));
    } else {
      localStorage.removeItem(storeKey(userId));
    }
  } catch {
    // LocalStorage write failure is non-fatal.
  }
}

/**
 * Restores the last selected store from LocalStorage.
 * @param {string} [userId]  Current user's ID for key scoping.
 * @returns {{ id: string; name: string } | null}
 */
export function restoreSelectedStore(userId = '') {
  try {
    const raw = localStorage.getItem(storeKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Removes a user's selected-store preference from LocalStorage.
 * Call on logout to prevent stale preferences persisting for new sessions.
 * @param {string} userId
 */
export function clearOrgPreferences(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(storeKey(userId));
  } catch {
    // Non-fatal.
  }
}
