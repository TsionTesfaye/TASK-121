/**
 * Router / RBAC access-control tests.
 *
 * Tests the pure `resolveAccess` helper extracted from Router.svelte.
 * Covers every role × route combination to prevent regressions of
 * the guest-route-bypass bug and future RBAC drift.
 */

import { describe, it, expect } from 'vitest';
import { resolveAccess, canAccess } from '../../src/app/router/accessControl.js';
import { ROLE_ROUTES, PUBLIC_ROUTES } from '../../src/app/router/routes.js';

// ── Public routes ──────────────────────────────────────────────────────────────

describe('Public routes', () => {
  it('unauthenticated user can access /login', () => {
    const r = resolveAccess('/login', false, false, null);
    expect(r.allowed).toBe(true);
    expect(r.redirectTo).toBeNull();
  });

  it('unauthenticated user can access /bootstrap', () => {
    const r = resolveAccess('/bootstrap', false, false, null);
    expect(r.allowed).toBe(true);
  });

  it('unauthenticated user accessing /crm is redirected to /login', () => {
    const r = resolveAccess('/crm', false, false, null);
    expect(r.allowed).toBe(false);
    expect(r.redirectTo).toBe('/login');
  });

  it('unauthenticated user accessing /admin is redirected to /login', () => {
    const r = resolveAccess('/admin', false, false, null);
    expect(r.allowed).toBe(false);
    expect(r.redirectTo).toBe('/login');
  });
});

// ── Guest sessions ─────────────────────────────────────────────────────────────

describe('Guest role', () => {
  it('guest can access /crm', () => {
    const r = resolveAccess('/crm', false, true, null);
    expect(r.allowed).toBe(true);
  });

  it('guest cannot access /orders — redirected to first allowed route (/crm)', () => {
    const r = resolveAccess('/orders', false, true, null);
    expect(r.allowed).toBe(false);
    expect(r.redirectTo).toBe('/crm');
  });

  it('guest cannot access /admin', () => {
    const r = resolveAccess('/admin', false, true, null);
    expect(r.allowed).toBe(false);
    expect(r.redirectTo).toBe('/crm');
  });

  it('guest cannot access /nlp', () => {
    const r = resolveAccess('/nlp', false, true, null);
    expect(r.allowed).toBe(false);
  });

  it('guest cannot access /risk-review', () => {
    const r = resolveAccess('/risk-review', false, true, null);
    expect(r.allowed).toBe(false);
  });

  it('guest cannot access /master-data', () => {
    const r = resolveAccess('/master-data', false, true, null);
    expect(r.allowed).toBe(false);
  });

  it('guest cannot access /messages', () => {
    const r = resolveAccess('/messages', false, true, null);
    expect(r.allowed).toBe(false);
  });

  it('guest can still access public routes (/login)', () => {
    const r = resolveAccess('/login', false, true, null);
    expect(r.allowed).toBe(true);
  });
});

// ── store_manager ──────────────────────────────────────────────────────────────

describe('store_manager role', () => {
  const allowed = [...(ROLE_ROUTES['store_manager'] ?? [])];

  it.each(allowed)('can access %s', (route) => {
    const r = resolveAccess(route, true, false, 'store_manager');
    expect(r.allowed).toBe(true);
  });

  it('cannot access /admin', () => {
    const r = resolveAccess('/admin', true, false, 'store_manager');
    expect(r.allowed).toBe(false);
  });

  it('cannot access /nlp', () => {
    const r = resolveAccess('/nlp', true, false, 'store_manager');
    expect(r.allowed).toBe(false);
  });

  it('can access /risk-review', () => {
    const r = resolveAccess('/risk-review', true, false, 'store_manager');
    expect(r.allowed).toBe(true);
  });

  it('cannot access /org-setup', () => {
    const r = resolveAccess('/org-setup', true, false, 'store_manager');
    expect(r.allowed).toBe(false);
  });
});

// ── analyst ────────────────────────────────────────────────────────────────────

describe('analyst role', () => {
  it('can access /nlp', () => {
    const r = resolveAccess('/nlp', true, false, 'analyst');
    expect(r.allowed).toBe(true);
  });

  it('can access /crm', () => {
    const r = resolveAccess('/crm', true, false, 'analyst');
    expect(r.allowed).toBe(true);
  });

  it('cannot access /orders', () => {
    const r = resolveAccess('/orders', true, false, 'analyst');
    expect(r.allowed).toBe(false);
  });

  it('cannot access /admin', () => {
    const r = resolveAccess('/admin', true, false, 'analyst');
    expect(r.allowed).toBe(false);
  });

  it('cannot access /risk-review', () => {
    const r = resolveAccess('/risk-review', true, false, 'analyst');
    expect(r.allowed).toBe(false);
  });

  it('cannot access /messages', () => {
    const r = resolveAccess('/messages', true, false, 'analyst');
    expect(r.allowed).toBe(false);
  });
});

// ── reviewer ───────────────────────────────────────────────────────────────────

describe('reviewer role', () => {
  it('can access /risk-review', () => {
    const r = resolveAccess('/risk-review', true, false, 'reviewer');
    expect(r.allowed).toBe(true);
  });

  it('cannot access /crm', () => {
    const r = resolveAccess('/crm', true, false, 'reviewer');
    expect(r.allowed).toBe(false);
    expect(r.redirectTo).toBe('/risk-review');
  });

  it('cannot access /orders', () => {
    const r = resolveAccess('/orders', true, false, 'reviewer');
    expect(r.allowed).toBe(false);
  });

  it('cannot access /nlp — redirected to first allowed (/risk-review)', () => {
    const r = resolveAccess('/nlp', true, false, 'reviewer');
    expect(r.allowed).toBe(false);
    expect(r.redirectTo).toBe('/risk-review');
  });

  it('cannot access /admin', () => {
    const r = resolveAccess('/admin', true, false, 'reviewer');
    expect(r.allowed).toBe(false);
  });
});

// ── administrator ──────────────────────────────────────────────────────────────

describe('administrator role', () => {
  const allProtectedRoutes = ['/crm', '/orders', '/master-data', '/messages', '/nlp', '/risk-review', '/org-setup', '/admin'];

  it.each(allProtectedRoutes)('can access %s', (route) => {
    const r = resolveAccess(route, true, false, 'administrator');
    expect(r.allowed).toBe(true);
  });
});

// ── canAccess helper ──────────────────────────────────────────────────────────

describe('canAccess helper', () => {
  it('returns true for guest accessing /crm', () => {
    expect(canAccess('/crm', null, true)).toBe(true);
  });

  it('returns false for guest accessing /orders', () => {
    expect(canAccess('/orders', null, true)).toBe(false);
  });

  it('returns true for store_manager accessing /orders', () => {
    expect(canAccess('/orders', 'store_manager')).toBe(true);
  });

  it('returns false for store_manager accessing /admin', () => {
    expect(canAccess('/admin', 'store_manager')).toBe(false);
  });
});

// ── Redirect invariants ────────────────────────────────────────────────────────

describe('Redirect invariants', () => {
  it('when redirected, redirectTo is always a valid known route', () => {
    const roles = ['guest', 'store_manager', 'analyst', 'reviewer', 'administrator'];
    const routes = ['/crm', '/orders', '/master-data', '/messages', '/nlp', '/risk-review', '/org-setup', '/admin'];
    const knownRoutes = new Set([...routes, '/login', '/bootstrap']);

    for (const role of roles) {
      const isGuest = role === 'guest';
      const isAuth = !isGuest;
      const effectiveRole = isGuest ? null : role;

      for (const route of routes) {
        const r = resolveAccess(route, isAuth, isGuest, effectiveRole);
        if (!r.allowed) {
          expect(knownRoutes.has(r.redirectTo)).toBe(true);
        }
      }
    }
  });

  it('redirectTo is null when access is allowed', () => {
    const r = resolveAccess('/crm', true, false, 'store_manager');
    expect(r.allowed).toBe(true);
    expect(r.redirectTo).toBeNull();
  });
});

// ── ROLE_ROUTES completeness ───────────────────────────────────────────────────

describe('ROLE_ROUTES completeness', () => {
  it('all defined roles have at least one allowed route', () => {
    const roles = ['administrator', 'store_manager', 'analyst', 'reviewer', 'guest'];
    for (const role of roles) {
      expect(ROLE_ROUTES[role]?.size ?? 0).toBeGreaterThan(0);
    }
  });

  it('PUBLIC_ROUTES contains /login and /bootstrap', () => {
    expect(PUBLIC_ROUTES.has('/login')).toBe(true);
    expect(PUBLIC_ROUTES.has('/bootstrap')).toBe(true);
  });

  it('guest only has /crm in ROLE_ROUTES', () => {
    expect(ROLE_ROUTES['guest'].has('/crm')).toBe(true);
    expect(ROLE_ROUTES['guest'].size).toBe(1);
  });
});
