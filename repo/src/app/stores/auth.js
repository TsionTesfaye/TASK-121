/**
 * Auth Svelte store.
 * Mirrors the AuthService session state into reactive Svelte stores
 * so components can subscribe without directly coupling to the service.
 */
import { writable, derived } from 'svelte/store';

/** @type {import('svelte/store').Writable<object | null>} */
export const currentUser = writable(null);

/** @type {import('svelte/store').Writable<boolean>} */
export const isLocked = writable(false);

/** @type {import('svelte/store').Writable<boolean>} */
export const isAuthenticated = writable(false);

/** @type {import('svelte/store').Writable<boolean>} */
export const isGuest = writable(false);

/** Derived: current user's role string. */
export const currentRole = derived(currentUser, ($user) => $user?.role ?? null);

/** Derived: true if the user is an admin. */
export const isAdmin = derived(currentRole, ($role) => $role === 'administrator');

/**
 * Syncs all auth stores from the AuthService after a session state change.
 * @param {import('../../services/AuthService.js').AuthService} authService
 */
export function syncAuthStores(authService) {
  currentUser.set(authService.getCurrentUser());
  isLocked.set(authService.isLocked());
  isAuthenticated.set(authService.isAuthenticated());
  isGuest.set(authService.isGuest());
}

/** Resets all auth stores to unauthenticated state. */
export function clearAuthStores() {
  currentUser.set(null);
  isLocked.set(false);
  isAuthenticated.set(false);
  isGuest.set(false);
}
