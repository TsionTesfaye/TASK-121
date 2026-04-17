/**
 * MasterDataPage — integration tests.
 *
 * Verifies UI ↔ service interaction for the MasterDataPage component:
 *   - Page header and entity type tabs render
 *   - Empty state when no versions exist
 *   - Publish New Version modal opens
 *   - Reason note validation (min 10 chars) gates the publish button
 *   - Version data renders after publishing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../../src/infrastructure/db/db.js';
import { authService } from '../../../src/services/AuthService.js';
import { masterDataService } from '../../../src/services/MasterDataService.js';
import { cryptoService } from '../../../src/services/CryptoService.js';
import { BootstrapService } from '../../../src/services/BootstrapService.js';
import { currentUser } from '../../../src/app/stores/auth.js';
import {
  setBroadcastService,
  closeAll,
} from '../../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../../src/infrastructure/broadcast/MockBroadcastService.js';
import { toast } from '../../../src/app/stores/ui.js';
import { get } from 'svelte/store';
import MasterDataPage from '../../../src/pages/MasterDataPage.svelte';

const ADMIN_PASS = 'MasterData@1234';
const ORG_ID = 'org-masterdata-test';

let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'md_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'MasterDataCo',
  });
  adminUser = result.admin;

  await authService.login('md_admin', ADMIN_PASS);
  authService._currentUser = { ...authService._currentUser, organizationNodeId: ORG_ID };
  currentUser.set(authService._currentUser);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  currentUser.set(null);
  closeDB();
  closeAll();
});

describe('MasterDataPage — empty state', () => {
  it('renders Master Data header', () => {
    render(MasterDataPage);
    expect(screen.getByText('Master Data')).toBeTruthy();
  });

  it('shows + Publish New Version button', () => {
    render(MasterDataPage);
    expect(screen.getByText('+ Publish New Version')).toBeTruthy();
  });

  it('shows empty hint for active entity type', async () => {
    render(MasterDataPage);
    await waitFor(() => {
      expect(screen.getByText(/no active version/i)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('renders entity type tab buttons', () => {
    render(MasterDataPage);
    // First entity type should be 'color' based on MASTER_DATA_ENTITY_TYPES
    expect(screen.getByRole('button', { name: /color/i })).toBeTruthy();
  });
});

describe('MasterDataPage — publish modal', () => {
  it('opens publish modal when + Publish New Version is clicked', async () => {
    render(MasterDataPage);
    fireEvent.click(screen.getByText('+ Publish New Version'));
    await waitFor(() => {
      expect(screen.getByText(/publish new version/i)).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('Publish button is disabled when reason note is too short', async () => {
    render(MasterDataPage);
    fireEvent.click(screen.getByText('+ Publish New Version'));
    await waitFor(() => screen.getByText(/publish new version/i), { timeout: 2000 });

    const btn = screen.getByRole('button', { name: /^publish$/i });
    expect(btn).toBeDisabled();
  });

  it('Publish button enables when reason note is at least 10 chars', async () => {
    render(MasterDataPage);
    fireEvent.click(screen.getByText('+ Publish New Version'));
    await waitFor(() => screen.getByText(/publish new version/i), { timeout: 2000 });

    const noteInput = screen.getByPlaceholderText(/why are you publishing/i);
    await fireEvent.input(noteInput, { target: { value: 'Initial version for color catalog' } });

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /^publish$/i });
      expect(btn).not.toBeDisabled();
    }, { timeout: 1000 });
  });
});

describe('MasterDataPage — version list', () => {
  beforeEach(async () => {
    // Publish a version directly via service.
    authService._currentUser = { ...authService._currentUser, role: 'administrator' };
    await masterDataService.publishVersion({
      organizationId: ORG_ID,
      entityType: 'color',
      entityId: 'color-catalog-v1',
      payload: { colors: ['red', 'blue'] },
      reasonNote: 'Initial color catalog for tests',
      actorId: adminUser.id,
    });
  });

  it('renders published version card after mount', async () => {
    render(MasterDataPage);
    await waitFor(() => {
      expect(screen.getByText('Initial color catalog for tests')).toBeTruthy();
    }, { timeout: 3000 });
  });
});

// ── Loading state ──────────────────────────────────────────────────────────

describe('MasterDataPage — loading state', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows Loading… while active versions are being fetched', () => {
    vi.spyOn(masterDataService, 'getAllActiveVersions').mockImplementation(() => new Promise(() => {}));
    render(MasterDataPage);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows error toast when getAllActiveVersions throws', async () => {
    vi.spyOn(masterDataService, 'getAllActiveVersions').mockRejectedValue(new Error('Master data unavailable'));
    render(MasterDataPage);
    await waitFor(() => {
      const t = get(toast);
      expect(t?.type).toBe('error');
      expect(t?.message).toBe('Master data unavailable');
    }, { timeout: 3000 });
  });
});

// ── View history loading ───────────────────────────────────────────────────

describe('MasterDataPage — history loading state', () => {
  beforeEach(async () => {
    authService._currentUser = { ...authService._currentUser, role: 'administrator' };
    await masterDataService.publishVersion({
      organizationId: ORG_ID,
      entityType: 'color',
      entityId: 'color-v1',
      payload: { colors: ['red'] },
      reasonNote: 'History loading test version',
      actorId: adminUser.id,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('View history button is disabled while history loads', async () => {
    vi.spyOn(masterDataService, 'getVersionHistory').mockImplementation(() => new Promise(() => {}));

    render(MasterDataPage);
    await waitFor(() => screen.getByText('History loading test version'), { timeout: 3000 });

    // Button starts as "View history" — click it to start loading
    fireEvent.click(screen.getByRole('button', { name: /view history/i }));

    // While loading, button text changes to "Loading…" and is disabled
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /loading/i });
      expect(btn).toBeDisabled();
    }, { timeout: 2000 });
  });
});

// ── Real data-path: version published via form appears in card ─────────────

describe('MasterDataPage — version published via UI form (real data path)', () => {
  it('published version reason note appears in the version card', async () => {
    render(MasterDataPage);
    fireEvent.click(screen.getByText('+ Publish New Version'));
    await waitFor(() => screen.getByText(/publish new version/i), { timeout: 2000 });

    const noteInput = screen.getByPlaceholderText(/why are you publishing/i);
    await fireEvent.input(noteInput, { target: { value: 'Initial catalog for UI form test' } });

    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));

    // After publishing, the version card with the reason note should appear
    await waitFor(() => {
      expect(screen.getByText('Initial catalog for UI form test')).toBeTruthy();
    }, { timeout: 5000 });
  });

  it('publishing two versions: both reason notes visible in version list', async () => {
    authService._currentUser = { ...authService._currentUser, role: 'administrator' };

    await masterDataService.publishVersion({
      organizationId: ORG_ID,
      entityType: 'color',
      entityId: 'color-v1',
      payload: { colors: ['red'] },
      reasonNote: 'First real version for count test',
      actorId: adminUser.id,
    });
    await masterDataService.publishVersion({
      organizationId: ORG_ID,
      entityType: 'size',
      entityId: 'size-v1',
      payload: { sizes: ['S', 'M'] },
      reasonNote: 'Second real version for count test',
      actorId: adminUser.id,
    });

    render(MasterDataPage);
    await waitFor(() => {
      expect(screen.getByText('First real version for count test')).toBeTruthy();
    }, { timeout: 3000 });

    // Navigate to size tab to verify second version
    const sizeTab = screen.queryByRole('button', { name: /size/i });
    if (sizeTab) {
      fireEvent.click(sizeTab);
      await waitFor(() => {
        expect(screen.getByText('Second real version for count test')).toBeTruthy();
      }, { timeout: 3000 });
    }
  });
});

// ── Side-effect: error leaves version list empty ───────────────────────────

describe('MasterDataPage — error state side-effects', () => {
  afterEach(() => vi.restoreAllMocks());

  it('getAllActiveVersions error: no version cards are rendered', async () => {
    vi.spyOn(masterDataService, 'getAllActiveVersions').mockRejectedValue(
      new Error('Master data unavailable'),
    );

    render(MasterDataPage);

    await waitFor(() => {
      const t = get(toast);
      expect(t?.type).toBe('error');
      expect(t?.message).toBe('Master data unavailable');
    }, { timeout: 3000 });

    // Side-effect: no version cards visible — list is empty due to load failure
    expect(screen.queryByText(/reason note/i)).toBeNull();
    expect(screen.queryByText(/initial/i)).toBeNull();
  });
});

// ── Denied-action: analyst cannot publish versions ────────────────────────

describe('MasterDataPage — denied-action assertions', () => {
  it('analyst calling publishVersion is rejected at the service layer', async () => {
    authService._currentUser = {
      ...authService._currentUser,
      role: 'analyst',
    };

    await expect(
      masterDataService.publishVersion({
        organizationId: ORG_ID,
        entityType: 'color',
        entityId: 'forbidden-color',
        payload: { colors: ['green'] },
        reasonNote: 'Forbidden publish attempt by analyst',
        actorId: authService._currentUser.id,
      })
    ).rejects.toThrow(/permission|unauthorized|forbidden|not allowed/i);

    authService._currentUser = { ...authService._currentUser, role: 'administrator' };
  });
});
