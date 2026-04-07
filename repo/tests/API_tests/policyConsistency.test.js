/**
 * Policy consistency tests — Prompt 1 regression coverage.
 *
 * Covers:
 *   1. Lookup versioning single-active invariant
 *   2. Risk RBAC alignment (route/UI/service)
 *   3. CRM read-only guest UX
 *   4. Dictionary update persistence await
 *   5. Accessibility — zero build warnings (svelte-ignore in place)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, waitFor } from '@testing-library/svelte';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { lookupDataService } from '../../src/services/LookupDataService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { currentUser } from '../../src/app/stores/auth.js';
import { ROLES, ROLE_ROUTES } from '../../src/app/router/routes.js';
import CRMPage from '../../src/pages/CRMPage.svelte';

const ADMIN_PASS = 'PolicyQA@12345';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'policy_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'PolicyCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('policy_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  currentUser.set(null);
  closeDB();
  closeAll();
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. LOOKUP VERSIONING — SINGLE-ACTIVE INVARIANT
// ══════════════════════════════════════════════════════════════════════════════

describe('Lookup versioning — single-active invariant', () => {
  it('createEntry produces exactly one active version', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'colors', organizationId: orgId, name: 'Red',
      actorId: adminUser.id, reasonNote: 'Adding red to palette',
    });

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);
    const activeVersions = history.filter((v) => v.isActive);
    expect(activeVersions.length).toBe(1);
  });

  it('deactivate + reactivate sequence never produces multiple active versions', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'sizes', organizationId: orgId, name: 'XL',
      actorId: adminUser.id, reasonNote: 'Adding XL size option',
    });

    await lookupDataService.deactivateEntry({
      store: 'sizes', entryId: entry.id, actorId: adminUser.id,
      reasonNote: 'Temporarily removing XL',
    });

    await lookupDataService.reactivateEntry({
      store: 'sizes', entryId: entry.id, actorId: adminUser.id,
      reasonNote: 'Restoring XL after review',
    });

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);
    const activeVersions = history.filter((v) => v.isActive);
    expect(activeVersions.length).toBe(1);
    expect(history.length).toBe(3); // create v1, deactivate v2, reactivate v3
    expect(history[0].versionNumber).toBe(3); // newest first
  });

  it('version numbering is monotonically increasing', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'brands', organizationId: orgId, name: 'BrandA',
      actorId: adminUser.id, reasonNote: 'Initial brand entry',
    });

    await lookupDataService.deactivateEntry({
      store: 'brands', entryId: entry.id, actorId: adminUser.id,
      reasonNote: 'Deactivating brand for review',
    });

    await lookupDataService.reactivateEntry({
      store: 'brands', entryId: entry.id, actorId: adminUser.id,
      reasonNote: 'Reactivating after approval',
    });

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);
    // Newest first: v3, v2, v1
    expect(history[0].versionNumber).toBe(3);
    expect(history[1].versionNumber).toBe(2);
    expect(history[2].versionNumber).toBe(1);
  });

  it('max-one-active invariant holds at repository level', async () => {
    const entry = await lookupDataService.createEntry({
      store: 'suppliers', organizationId: orgId, name: 'SupA',
      actorId: adminUser.id, reasonNote: 'Adding supplier entry',
    });

    // Trigger multiple mutations rapidly
    await lookupDataService.deactivateEntry({
      store: 'suppliers', entryId: entry.id, actorId: adminUser.id,
      reasonNote: 'Quick deactivation test',
    });
    await lookupDataService.reactivateEntry({
      store: 'suppliers', entryId: entry.id, actorId: adminUser.id,
      reasonNote: 'Quick reactivation test',
    });
    await lookupDataService.deactivateEntry({
      store: 'suppliers', entryId: entry.id, actorId: adminUser.id,
      reasonNote: 'Second deactivation test',
    });

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entry.id);
    const activeCount = history.filter((v) => v.isActive).length;
    expect(activeCount).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. RISK RBAC — ROUTE/SERVICE ALIGNMENT
// ══════════════════════════════════════════════════════════════════════════════

describe('Risk RBAC — route and service alignment', () => {
  it('store_manager has /risk-review route access', () => {
    expect(ROLE_ROUTES.store_manager.has('/risk-review')).toBe(true);
  });

  it('reviewer has /risk-review route access', () => {
    expect(ROLE_ROUTES.reviewer.has('/risk-review')).toBe(true);
  });

  it('reviewer cannot create rules (service rejects)', async () => {
    authService._currentUser = { id: 'rev-001', role: 'reviewer', organizationNodeId: orgId };
    await expect(
      riskReviewService.createRule({
        organizationId: orgId, name: 'Test Rule',
        ruleType: 'field_contains', targetEntityType: '*',
        parameters: { field: 'x', value: 'y' }, actorId: 'rev-001',
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('reviewer cannot update sensitive words (service rejects)', async () => {
    authService._currentUser = { id: 'rev-001', role: 'reviewer', organizationNodeId: orgId };
    await expect(
      riskReviewService.updateSensitiveWords(['test'], 'rev-001'),
    ).rejects.toThrow(/permission denied/i);
  });

  it('store_manager can create rules', async () => {
    authService._currentUser = { id: 'mgr-001', role: 'store_manager', organizationNodeId: orgId };
    const rule = await riskReviewService.createRule({
      organizationId: orgId, name: 'Mgr Rule',
      ruleType: 'field_contains', targetEntityType: '*',
      parameters: { field: 'notes', value: 'fraud' }, actorId: 'mgr-001',
    });
    expect(rule.name).toBe('Mgr Rule');
  });

  it('reviewer can view inbox', async () => {
    authService._currentUser = { id: 'rev-001', role: 'reviewer', organizationNodeId: orgId };
    const inbox = await riskReviewService.getInbox(orgId);
    expect(Array.isArray(inbox)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. CRM READ-ONLY GUEST UX
// ══════════════════════════════════════════════════════════════════════════════

describe('CRM — guest read-only controls', () => {
  it('guest does not see + New Customer button', async () => {
    authService._currentUser = { id: 'guest-001', role: 'guest', organizationNodeId: orgId };
    currentUser.set(authService._currentUser);

    render(CRMPage);
    await waitFor(() => {}, { timeout: 500 });

    expect(screen.queryByText('+ New Customer')).toBeNull();
  });

  it('guest sees Read Only badge', async () => {
    authService._currentUser = { id: 'guest-001', role: 'guest', organizationNodeId: orgId };
    currentUser.set(authService._currentUser);

    render(CRMPage);
    await waitFor(() => {
      expect(screen.getByText('Read Only')).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('admin sees + New Customer button', async () => {
    currentUser.set(authService._currentUser);

    render(CRMPage);
    await waitFor(() => {
      expect(screen.getByText('+ New Customer')).toBeTruthy();
    }, { timeout: 2000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. DICTIONARY UPDATE — PERSISTENCE AWAIT
// ══════════════════════════════════════════════════════════════════════════════

describe('Risk dictionary — awaited persistence', () => {
  it('updateSensitiveWords returns a promise (is async)', async () => {
    const result = riskReviewService.updateSensitiveWords(['fraud'], adminUser.id);
    expect(result).toBeInstanceOf(Promise);
    await result; // must await to prevent unhandled rejection after DB close
  });

  it('words persist after awaited update', async () => {
    await riskReviewService.updateSensitiveWords(['scam', 'phishing'], adminUser.id);
    expect(riskReviewService.getSensitiveWords()).toEqual(['scam', 'phishing']);

    // Simulate reload
    riskReviewService.loadSensitiveWordDictionary([]);
    await riskReviewService.loadPersistedDictionary(orgId);
    expect(riskReviewService.getSensitiveWords()).toEqual(['scam', 'phishing']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. ACCESSIBILITY — BUILD CLEAN
// ══════════════════════════════════════════════════════════════════════════════

describe('Accessibility — svelte-ignore directives in place', () => {
  const pages = [
    'OrdersPage.svelte', 'NLPPage.svelte', 'CRMPage.svelte',
    'AdminPage.svelte', 'MasterDataPage.svelte', 'OrgSetupPage.svelte',
    'RiskReviewPage.svelte', 'MessagesPage.svelte', 'TicketsPage.svelte',
  ];

  for (const page of pages) {
    it(`${page} — every inner modal div has svelte-ignore directive`, async () => {
      const fs = await import('fs');
      const path = await import('path');
      const content = fs.readFileSync(path.resolve('src/pages', page), 'utf8');

      // Count inner modal divs with click|stopPropagation
      const modalDivCount = (content.match(/on:click\|stopPropagation/g) || []).length;
      const ignoreCount = (content.match(/svelte-ignore a11y-no-noninteractive-element-interactions/g) || []).length;

      // Every modal div must have a preceding ignore directive
      if (modalDivCount > 0) {
        expect(ignoreCount).toBeGreaterThanOrEqual(modalDivCount);
      }
    });
  }
});
