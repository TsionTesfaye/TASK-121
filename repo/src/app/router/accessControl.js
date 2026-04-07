/**
 * accessControl.js — pure RBAC access-control helper.
 *
 * Extracted from Router.svelte so the routing logic can be unit-tested
 * without a running Svelte component tree or browser environment.
 *
 * All parameters are plain values; no Svelte stores or DOM access.
 */

import { ROLE_ROUTES, PUBLIC_ROUTES } from './routes.js';

/**
 * Determines whether a session may access a path and, if not, where to redirect.
 *
 * @param {string}       path           Hash path being requested (e.g. '/crm')
 * @param {boolean}      authenticated  True when a non-guest user is logged in
 * @param {boolean}      guest          True when a guest session is active
 * @param {string|null}  role           Current user's role, or null for guests
 * @returns {{ allowed: boolean; redirectTo: string | null }}
 */
export function resolveAccess(path, authenticated, guest, role) {
  // Unauthenticated, non-guest → any protected route redirects to login.
  if (!authenticated && !guest && !PUBLIC_ROUTES.has(path)) {
    return { allowed: false, redirectTo: '/login' };
  }

  // Compute effective role (authenticated users use their role; guests use 'guest').
  const effectiveRole = role ?? (guest ? 'guest' : null);

  if (effectiveRole && !PUBLIC_ROUTES.has(path)) {
    const allowed = ROLE_ROUTES[effectiveRole] ?? new Set();
    if (!allowed.has(path)) {
      // Redirect to the first accessible route for this role, or login.
      const defaultForRole = [...allowed][0] ?? '/login';
      return { allowed: false, redirectTo: defaultForRole };
    }
  }

  return { allowed: true, redirectTo: null };
}

/**
 * Returns true if `path` is accessible by any session with the given
 * authenticated / guest / role combination.
 *
 * Convenience wrapper used by nav-rendering code.
 *
 * @param {string}      path
 * @param {string|null} role
 * @param {boolean}     guest
 * @returns {boolean}
 */
export function canAccess(path, role, guest = false) {
  const authenticated = !guest && role !== null;
  const { allowed } = resolveAccess(path, authenticated, guest, role);
  return allowed;
}
