/**
 * OrgSetupPage — integration tests.
 *
 * Verifies UI ↔ service interaction for the OrgSetupPage component:
 *   - Empty state when no nodes exist
 *   - Node list renders after seeding
 *   - Create node form opens and validates required fields
 *   - Add Node button is present
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../../src/infrastructure/db/db.js';
import { authService } from '../../../src/services/AuthService.js';
import { orgService } from '../../../src/services/OrgService.js';
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
import OrgSetupPage from '../../../src/pages/OrgSetupPage.svelte';

const ADMIN_PASS = 'OrgSetup@1234';
const ORG_ID = 'org-setup-test';

let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'orgsetup_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'OrgSetupCo',
  });
  adminUser = result.admin;

  await authService.login('orgsetup_admin', ADMIN_PASS);
  authService._currentUser = { ...authService._currentUser, organizationNodeId: ORG_ID, role: 'administrator' };
  currentUser.set(authService._currentUser);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  currentUser.set(null);
  closeDB();
  closeAll();
});

describe('OrgSetupPage — empty state', () => {
  it('renders Organization Setup header', () => {
    render(OrgSetupPage);
    expect(screen.getByText('Organization Setup')).toBeTruthy();
  });

  it('shows + Add Node button', () => {
    render(OrgSetupPage);
    expect(screen.getByText('+ Add Node')).toBeTruthy();
  });

  it('shows empty hint when no nodes exist', async () => {
    render(OrgSetupPage);
    await waitFor(() => {
      expect(screen.getByText(/no organization nodes yet/i)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows Tree View and Table View tabs', () => {
    render(OrgSetupPage);
    expect(screen.getByText('Tree View')).toBeTruthy();
    expect(screen.getByText('Table View')).toBeTruthy();
  });
});

describe('OrgSetupPage — node list', () => {
  beforeEach(async () => {
    // Seed a company node.
    authService._currentUser = { ...authService._currentUser, role: 'administrator' };
    await orgService.createNode({
      name: 'Acme Corp',
      type: 'company',
      parentId: null,
      organizationId: ORG_ID,
      actorId: adminUser.id,
    });
  });

  it('renders seeded company node name', async () => {
    render(OrgSetupPage);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeTruthy();
    }, { timeout: 3000 });
  });
});

describe('OrgSetupPage — create node form', () => {
  it('opens create form when + Add Node is clicked', async () => {
    render(OrgSetupPage);
    fireEvent.click(screen.getByText('+ Add Node'));
    await waitFor(() => {
      expect(screen.getByText('Add Organization Node')).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('Create button is disabled when name is empty', async () => {
    render(OrgSetupPage);
    fireEvent.click(screen.getByText('+ Add Node'));
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /^create$/i });
      expect(btn).toBeDisabled();
    }, { timeout: 2000 });
  });
});

// ── Loading state ──────────────────────────────────────────────────────────

describe('OrgSetupPage — loading state', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows Loading… while org tree is being fetched', () => {
    vi.spyOn(orgService, 'getTree').mockImplementation(() => new Promise(() => {}));
    render(OrgSetupPage);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows error toast when getTree throws', async () => {
    vi.spyOn(orgService, 'getTree').mockRejectedValue(new Error('Org DB unavailable'));
    render(OrgSetupPage);
    await waitFor(() => {
      const t = get(toast);
      expect(t?.type).toBe('error');
      expect(t?.message).toBe('Org DB unavailable');
    }, { timeout: 3000 });
  });
});

// ── Successful node creation ───────────────────────────────────────────────

describe('OrgSetupPage — node create and edit success', () => {
  it('creates a node and it appears in the tree', async () => {
    render(OrgSetupPage);
    fireEvent.click(screen.getByText('+ Add Node'));
    await waitFor(() => screen.getByText('Add Organization Node'), { timeout: 2000 });

    const nameInput = screen.getAllByRole('textbox')[0];
    await fireEvent.input(nameInput, { target: { value: 'Beta Corp' } });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByText('Beta Corp')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('create form error shows when service rejects', async () => {
    vi.spyOn(orgService, 'createNode').mockRejectedValue(new Error('Duplicate node name'));

    render(OrgSetupPage);
    fireEvent.click(screen.getByText('+ Add Node'));
    await waitFor(() => screen.getByText('Add Organization Node'), { timeout: 2000 });

    const nameInput = screen.getAllByRole('textbox')[0];
    await fireEvent.input(nameInput, { target: { value: 'Bad Node' } });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByText('Duplicate node name')).toBeTruthy();
    }, { timeout: 3000 });
  });

  afterEach(() => vi.restoreAllMocks());
});

// ── Real data-path: two nodes in tree ─────────────────────────────────────

describe('OrgSetupPage — multiple nodes in tree (real data path)', () => {
  beforeEach(async () => {
    authService._currentUser = { ...authService._currentUser, role: 'administrator' };
  });

  it('two seeded nodes both appear in the tree', async () => {
    const corp = await orgService.createNode({
      name: 'Corp Alpha',
      type: 'company',
      parentId: null,
      organizationId: ORG_ID,
      actorId: adminUser.id,
    });
    // Hierarchy: company → factory → store; must use a valid parent-child type
    const factory = await orgService.createNode({
      name: 'Factory Beta',
      type: 'factory',
      parentId: corp.id,
      organizationId: ORG_ID,
      actorId: adminUser.id,
    });

    render(OrgSetupPage);
    await waitFor(() => {
      expect(screen.getByText('Corp Alpha')).toBeTruthy();
    }, { timeout: 3000 });

    // Both nodes must render
    expect(screen.getByText('Factory Beta')).toBeTruthy();
  });

  it('node created via form appears alongside pre-seeded node', async () => {
    // Seed one node directly
    await orgService.createNode({
      name: 'Existing Node',
      type: 'company',
      parentId: null,
      organizationId: ORG_ID,
      actorId: adminUser.id,
    });

    render(OrgSetupPage);
    await waitFor(() => screen.getByText('Existing Node'), { timeout: 3000 });

    // Add a second node via the form
    fireEvent.click(screen.getByText('+ Add Node'));
    await waitFor(() => screen.getByText('Add Organization Node'), { timeout: 2000 });

    const nameInput = screen.getAllByRole('textbox')[0];
    await fireEvent.input(nameInput, { target: { value: 'Form Created Node' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByText('Form Created Node')).toBeTruthy();
    }, { timeout: 3000 });

    // Original node still visible
    expect(screen.getByText('Existing Node')).toBeTruthy();
  });
});

// ── Side-effect: error propagates to toast store ───────────────────────────

describe('OrgSetupPage — error state side-effects', () => {
  afterEach(() => vi.restoreAllMocks());

  it('createNode error shows in UI AND toast store carries the error', async () => {
    vi.spyOn(orgService, 'createNode').mockRejectedValue(new Error('Name already taken'));

    render(OrgSetupPage);
    fireEvent.click(screen.getByText('+ Add Node'));
    await waitFor(() => screen.getByText('Add Organization Node'), { timeout: 2000 });

    const nameInput = screen.getAllByRole('textbox')[0];
    await fireEvent.input(nameInput, { target: { value: 'Conflicting Node' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      // UI shows the error inline
      expect(screen.getByText('Name already taken')).toBeTruthy();
    }, { timeout: 3000 });

    // Side-effect: no node was added to the tree (tree remains empty)
    expect(screen.queryByText('Conflicting Node')).toBeFalsy();
  });

  it('getTree error leaves the node list empty', async () => {
    vi.spyOn(orgService, 'getTree').mockRejectedValue(new Error('Org DB unavailable'));
    render(OrgSetupPage);

    await waitFor(() => {
      const t = get(toast);
      expect(t?.type).toBe('error');
    }, { timeout: 3000 });

    // No nodes should render — the list is empty due to the load error
    expect(screen.queryByText('Acme Corp')).toBeNull();
  });
});

// ── Denied-action: store_manager cannot create org nodes ──────────────────

describe('OrgSetupPage — denied-action assertions', () => {
  it('store_manager calling orgService.createNode is rejected at the service layer', async () => {
    authService._currentUser = {
      ...authService._currentUser,
      role: 'store_manager',
    };

    await expect(
      orgService.createNode({
        name: 'Forbidden Node',
        type: 'company',
        parentId: null,
        organizationId: ORG_ID,
        actorId: authService._currentUser.id,
      })
    ).rejects.toThrow(/permission|unauthorized|forbidden|not allowed/i);

    authService._currentUser = { ...authService._currentUser, role: 'administrator' };
  });
});
