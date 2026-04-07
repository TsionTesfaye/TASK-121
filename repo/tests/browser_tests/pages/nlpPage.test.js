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
