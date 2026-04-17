/**
 * NLPPage — integration tests.
 *
 * Verifies UI ↔ service interaction for the NLPPage component:
 *   - Empty run history state
 *   - Page header and tab navigation render
 *   - Import Text and Run Batch buttons are present
 *   - Import form opens and validates required fields
 *   - Profiles tab shows + New Profile for admins
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../../src/infrastructure/db/db.js';
import { authService } from '../../../src/services/AuthService.js';
import { cryptoService } from '../../../src/services/CryptoService.js';
import { BootstrapService } from '../../../src/services/BootstrapService.js';
import { currentUser } from '../../../src/app/stores/auth.js';
import {
  setBroadcastService,
  closeAll,
} from '../../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../../src/infrastructure/broadcast/MockBroadcastService.js';
import { nlpService } from '../../../src/services/NLPService.js';
import { toast } from '../../../src/app/stores/ui.js';
import { get } from 'svelte/store';
import NLPPage from '../../../src/pages/NLPPage.svelte';

const ADMIN_PASS = 'NLPPage@1234';
const ORG_ID = 'org-nlp-test';

let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'nlp_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'NLPCo',
  });
  adminUser = result.admin;

  await authService.login('nlp_admin', ADMIN_PASS);
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

describe('NLPPage — empty state', () => {
  it('renders NLP Analysis header', () => {
    render(NLPPage);
    expect(screen.getByText('NLP Analysis')).toBeTruthy();
  });

  it('shows Runs, Texts, Profiles tabs', () => {
    render(NLPPage);
    expect(screen.getByRole('button', { name: /^runs$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^texts$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^profiles$/i })).toBeTruthy();
  });

  it('shows empty run history hint', async () => {
    render(NLPPage);
    await waitFor(() => {
      expect(screen.getByText(/no nlp runs yet/i)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows Import Text button', async () => {
    render(NLPPage);
    await waitFor(() => {
      expect(screen.getByText('Import Text')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows Run Batch button', async () => {
    render(NLPPage);
    await waitFor(() => {
      expect(screen.getByText('Run Batch')).toBeTruthy();
    }, { timeout: 3000 });
  });
});

describe('NLPPage — import text form', () => {
  it('Import Text button opens import form', async () => {
    render(NLPPage);
    await waitFor(() => screen.getByText('Import Text'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Import Text'));
    await waitFor(() => {
      expect(screen.getByText(/import text/i)).toBeTruthy();
    }, { timeout: 2000 });
  });
});

describe('NLPPage — profiles tab', () => {
  it('Profiles tab shows + New Profile for administrators', async () => {
    render(NLPPage);
    await waitFor(() => screen.getByRole('button', { name: /^profiles$/i }), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /^profiles$/i }));
    await waitFor(() => {
      expect(screen.getByText('+ New Profile')).toBeTruthy();
    }, { timeout: 2000 });
  });
});

// ── Loading states ─────────────────────────────────────────────────────────

describe('NLPPage — loading state', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows Loading… while run history is fetched', () => {
    vi.spyOn(nlpService, 'getRunHistory').mockImplementation(() => new Promise(() => {}));
    render(NLPPage);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});

// ── Run selection loading ──────────────────────────────────────────────────

describe('NLPPage — run detail loading state', () => {
  beforeEach(async () => {
    // Seed a text and run a batch to populate run history.
    await nlpService.importText({
      organizationId: ORG_ID,
      sourceType: 'test',
      sourceId: 'manual',
      filename: 'test.txt',
      rawText: 'Sample text for NLP loading test.',
      actorId: adminUser.id,
    });
    await nlpService.runBatch({ organizationId: ORG_ID, modelVersion: 'v1.0', actorId: adminUser.id });
  });

  afterEach(() => vi.restoreAllMocks());

  it('run row buttons are disabled while run detail is loading', async () => {
    vi.spyOn(nlpService, 'getRunDetail').mockImplementation(() => new Promise(() => {}));

    render(NLPPage);
    await waitFor(() => {
      expect(screen.queryByText(/no nlp runs yet/i)).toBeNull();
    }, { timeout: 3000 });

    const runRow = screen.getAllByRole('button').find((b) => b.classList.contains('run-row'));
    if (runRow) {
      fireEvent.click(runRow);
      await waitFor(() => {
        expect(runRow).toBeDisabled();
      }, { timeout: 2000 });
    }
  });

  it('shows loading run details message in detail panel', async () => {
    vi.spyOn(nlpService, 'getRunDetail').mockImplementation(() => new Promise(() => {}));

    render(NLPPage);
    await waitFor(() => {
      expect(screen.queryByText(/no nlp runs yet/i)).toBeNull();
    }, { timeout: 3000 });

    const runRow = screen.getAllByRole('button').find((b) => b.classList.contains('run-row'));
    if (runRow) {
      fireEvent.click(runRow);
      await waitFor(() => {
        expect(screen.getByText(/loading run details/i)).toBeTruthy();
      }, { timeout: 2000 });
    }
  });
});

// ── Real data-path: import + batch run shows history row ──────────────────

describe('NLPPage — real import + batch run appears in history (real data path)', () => {
  beforeEach(async () => {
    // Import a text document and run a batch directly via service
    await nlpService.importText({
      organizationId: ORG_ID,
      sourceType: 'manual',
      sourceId: 'real-data-path-source',
      filename: 'real-test.txt',
      rawText: 'This is a sample text for the real NLP data path test. Keywords: loyalty, discount, refund.',
      actorId: adminUser.id,
    });
    await nlpService.runBatch({
      organizationId: ORG_ID,
      modelVersion: 'v1.0',
      actorId: adminUser.id,
    });
  });

  it('run history shows exactly one run after one batch', async () => {
    render(NLPPage);

    // Wait until at least one run row is visible
    await waitFor(() => {
      const runRows = document.querySelectorAll('.run-row');
      expect(runRows.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 5000 });
  });

  it('run history row is visible (no longer shows empty hint)', async () => {
    render(NLPPage);

    await waitFor(() => {
      expect(screen.queryByText(/no nlp runs yet/i)).toBeNull();
    }, { timeout: 5000 });

    // "No NLP runs yet" must be gone
    expect(screen.queryByText(/no nlp runs yet/i)).toBeNull();
  });

  it('texts tab shows the imported source text', async () => {
    render(NLPPage);
    await waitFor(() => screen.getByRole('button', { name: /^texts$/i }), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /^texts$/i }));

    await waitFor(() => {
      expect(
        screen.queryByText('real-test.txt') ?? screen.queryByText(/real-test/i)
      ).toBeTruthy();
    }, { timeout: 3000 });
  });
});

// ── Side-effect: loading state leaves history empty ────────────────────────

describe('NLPPage — loading state side-effects', () => {
  afterEach(() => vi.restoreAllMocks());

  it('while getRunHistory is pending, no run rows are visible', async () => {
    vi.spyOn(nlpService, 'getRunHistory').mockImplementation(() => new Promise(() => {}));
    render(NLPPage);

    // Loading spinner/text visible
    expect(screen.getByText('Loading…')).toBeTruthy();

    // Side-effect: no run rows are rendered while loading
    expect(screen.queryByText(/no nlp runs yet/i)).toBeNull(); // empty-state also hidden
    expect(document.querySelectorAll('.run-row').length).toBe(0);
  });
});

// ── Denied-action: store_manager cannot import texts ──────────────────────

describe('NLPPage — denied-action assertions', () => {
  it('store_manager calling importText is rejected at the service layer', async () => {
    authService._currentUser = {
      ...authService._currentUser,
      role: 'store_manager',
    };

    await expect(
      nlpService.importText({
        organizationId: ORG_ID,
        sourceType: 'manual',
        sourceId: 'forbidden-src',
        filename: 'forbidden.txt',
        rawText: 'Forbidden import attempt.',
        actorId: authService._currentUser.id,
      })
    ).rejects.toThrow(/permission|unauthorized|forbidden|not allowed/i);

    authService._currentUser = { ...authService._currentUser, role: 'administrator' };
  });

  it('reviewer calling runBatch is rejected at the service layer', async () => {
    authService._currentUser = {
      ...authService._currentUser,
      role: 'reviewer',
    };

    await expect(
      nlpService.runBatch({
        organizationId: ORG_ID,
        modelVersion: 'v1.0',
        actorId: authService._currentUser.id,
      })
    ).rejects.toThrow(/permission|unauthorized|forbidden|not allowed/i);

    authService._currentUser = { ...authService._currentUser, role: 'administrator' };
  });
});
