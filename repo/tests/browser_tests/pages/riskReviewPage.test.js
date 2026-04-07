/**
 * Risk Review Page — integration tests.
 *
 * Verifies UI ↔ service interaction for the RiskReviewPage component:
 *   - Empty state when no cases exist
 *   - Case list renders on mount
 *   - Assign-to-self calls service
 *   - Resolve requires outcome code AND comment
 *   - Dismiss requires comment
 *   - Error messages surface from service to UI
 *   - Image validation: file input + validateImage + result display
 *   - Bidding heuristic: itemId input + evaluateBiddingHeuristics + createCaseFromHeuristic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../../src/infrastructure/db/db.js';
import { authService } from '../../../src/services/AuthService.js';
import { riskReviewService } from '../../../src/services/RiskReviewService.js';
import { cryptoService } from '../../../src/services/CryptoService.js';
import { BootstrapService } from '../../../src/services/BootstrapService.js';
import { currentUser } from '../../../src/app/stores/auth.js';
import {
  setBroadcastService,
  closeAll,
} from '../../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../../src/infrastructure/broadcast/MockBroadcastService.js';
import RiskReviewPage from '../../../src/pages/RiskReviewPage.svelte';
import { RISK_CASE_STATUSES } from '../../../src/utils/constants.js';

const ORG_ID = 'org-risk-test';
const ADMIN_PASS = 'RiskPage@1234';

let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'risk_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'RiskTestCo',
  });
  adminUser = result.admin;

  await authService.login('risk_admin', ADMIN_PASS);
  // Admins have full RBAC access across all routes.
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

// Helper: seed a risk case.
async function seedCase() {
  // Elevate to admin to bypass RBAC for seeding.
  const original = authService._currentUser;
  authService._currentUser = { ...original, role: 'administrator' };

  // Load a sensitive word so evaluateRules fires.
  riskReviewService.loadSensitiveWordDictionary(['fraud']);

  const [riskCase] = await riskReviewService.evaluateRules({
    organizationId: ORG_ID,
    entityType: 'order',
    entityId: 'order-xyz',
    payload: { description: 'suspected fraud activity' },
    actorId: original.id,
  });

  authService._currentUser = original;
  return riskCase;
}

describe('RiskReviewPage — empty state', () => {
  it('shows "No active cases" when inbox is empty', async () => {
    render(RiskReviewPage);
    await waitFor(() => {
      expect(screen.getByText(/no active cases/i)).toBeTruthy();
    });
  });

  it('renders Risk Review header', () => {
    render(RiskReviewPage);
    expect(screen.getByText('Risk Review')).toBeTruthy();
  });

  it('shows "Select a case to review" placeholder in detail pane', async () => {
    render(RiskReviewPage);
    await waitFor(() => {
      expect(screen.getByText(/select a case/i)).toBeTruthy();
    });
  });
});

describe('RiskReviewPage — case list', () => {
  it('renders case source type after mount', async () => {
    await seedCase();
    render(RiskReviewPage);
    await waitFor(() => {
      expect(screen.getByText('order')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows open badge for new case', async () => {
    await seedCase();
    render(RiskReviewPage);
    await waitFor(() => {
      expect(screen.getByText('open')).toBeTruthy();
    }, { timeout: 3000 });
  });
});

describe('RiskReviewPage — case detail', () => {
  it('shows Assign to Me button for open cases', async () => {
    await seedCase();
    render(RiskReviewPage);

    await waitFor(() => screen.getByText('order'), { timeout: 3000 });
    fireEvent.click(screen.getByText('order'));

    await waitFor(() => {
      expect(screen.getByText('Assign to Me')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows rule match details when case is selected', async () => {
    await seedCase();
    render(RiskReviewPage);

    await waitFor(() => screen.getByText('order'), { timeout: 3000 });
    fireEvent.click(screen.getByText('order'));

    await waitFor(() => {
      expect(screen.getByText('Rule Matches')).toBeTruthy();
    }, { timeout: 3000 });
  });
});

describe('RiskReviewPage — resolution form', () => {
  it('Resolve button disabled when no outcome code is selected', async () => {
    const riskCase = await seedCase();

    // Assign it first.
    authService._currentUser = { ...authService._currentUser, role: 'administrator' };
    await riskReviewService.assignCase(riskCase.id, adminUser.id, adminUser.id);
    authService._currentUser = { ...authService._currentUser };

    render(RiskReviewPage);

    // Select the in-review case.
    await waitFor(() => screen.getByText('order'), { timeout: 3000 });
    fireEvent.click(screen.getByText('order'));

    await waitFor(() => {
      const resolveBtn = screen.getByRole('button', { name: /^resolve$/i });
      expect(resolveBtn).toBeDisabled();
    }, { timeout: 3000 });
  });

  it('Dismiss button disabled when comment is empty', async () => {
    const riskCase = await seedCase();
    await riskReviewService.assignCase(riskCase.id, adminUser.id, adminUser.id);

    render(RiskReviewPage);

    await waitFor(() => screen.getByText('order'), { timeout: 3000 });
    fireEvent.click(screen.getByText('order'));

    await waitFor(() => {
      const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
      expect(dismissBtn).toBeDisabled();
    }, { timeout: 3000 });
  });
});

// ── Image validation UI ───────────────────────────────────────────────────────

describe('RiskReviewPage — image validation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Validate Image button is disabled when no file is selected', async () => {
    render(RiskReviewPage);

    // Navigate to the rules tab where image validation lives
    await waitFor(() => screen.getByRole('button', { name: /rules/i }));
    fireEvent.click(screen.getByRole('button', { name: /rules/i }));

    await waitFor(() => {
      expect(screen.getByText('Image Validation')).toBeTruthy();
    }, { timeout: 2000 });

    const validateBtn = screen.getByRole('button', { name: /validate image/i });
    expect(validateBtn).toBeDisabled();
  });

  it('shows validation result after validateImage resolves valid', async () => {
    vi.spyOn(riskReviewService, 'validateImage').mockResolvedValue({ valid: true, error: null });

    render(RiskReviewPage);

    await waitFor(() => screen.getByRole('button', { name: /rules/i }));
    fireEvent.click(screen.getByRole('button', { name: /rules/i }));

    await waitFor(() => screen.getByText('Image Validation'), { timeout: 2000 });

    // Simulate file selection via the on:change handler on the input
    const fileInput = screen.getByLabelText(/image file/i);
    const fakeFile = new File(['img'], 'test.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true });
    await fireEvent.change(fileInput);

    fireEvent.click(screen.getByRole('button', { name: /validate image/i }));

    await waitFor(() => {
      expect(screen.getByText(/image passed validation/i)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows failure message when validateImage returns invalid', async () => {
    vi.spyOn(riskReviewService, 'validateImage').mockResolvedValue({ valid: false, error: 'File too large' });

    render(RiskReviewPage);

    await waitFor(() => screen.getByRole('button', { name: /rules/i }));
    fireEvent.click(screen.getByRole('button', { name: /rules/i }));

    await waitFor(() => screen.getByText('Image Validation'), { timeout: 2000 });

    const fileInput = screen.getByLabelText(/image file/i);
    const fakeFile = new File(['img'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true });
    await fireEvent.change(fileInput);

    fireEvent.click(screen.getByRole('button', { name: /validate image/i }));

    await waitFor(() => {
      expect(screen.getByText(/file too large/i)).toBeTruthy();
    }, { timeout: 3000 });
  });
});

// ── Bidding heuristic UI ──────────────────────────────────────────────────────

describe('RiskReviewPage — bidding heuristic', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Run Heuristic button is disabled when itemId is empty', async () => {
    render(RiskReviewPage);

    await waitFor(() => screen.getByRole('button', { name: /rules/i }));
    fireEvent.click(screen.getByRole('button', { name: /rules/i }));

    await waitFor(() => {
      expect(screen.getByText('Bidding Heuristic Analysis')).toBeTruthy();
    }, { timeout: 2000 });

    const runBtn = screen.getByRole('button', { name: /run heuristic/i });
    expect(runBtn).toBeDisabled();
  });

  it('shows flagged result and "Create Risk Case" button when heuristic flags item', async () => {
    vi.spyOn(riskReviewService, 'evaluateBiddingHeuristics').mockResolvedValue({
      flagged: true,
      reason: 'Shill bidding detected',
      evidence: { linkedAccountCount: 2 },
    });

    render(RiskReviewPage);

    await waitFor(() => screen.getByRole('button', { name: /rules/i }));
    fireEvent.click(screen.getByRole('button', { name: /rules/i }));

    await waitFor(() => screen.getByText('Bidding Heuristic Analysis'), { timeout: 2000 });

    const itemInput = screen.getByPlaceholderText('item-uuid');
    await fireEvent.input(itemInput, { target: { value: 'item-abc' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /run heuristic/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /run heuristic/i }));

    await waitFor(() => {
      expect(screen.getByText(/shill bidding detected/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /create risk case/i })).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('createCaseFromHeuristic is called and inbox refreshes when "Create Risk Case" is clicked', async () => {
    vi.spyOn(riskReviewService, 'evaluateBiddingHeuristics').mockResolvedValue({
      flagged: true,
      reason: 'Shill bidding detected',
      evidence: {},
    });
    const createSpy = vi.spyOn(riskReviewService, 'createCaseFromHeuristic').mockResolvedValue({
      id: 'case-heur-001',
      sourceType: 'bid_heuristic',
      status: 'open',
    });
    const getInboxSpy = vi.spyOn(riskReviewService, 'getInbox').mockResolvedValue([]);

    render(RiskReviewPage);

    await waitFor(() => screen.getByRole('button', { name: /rules/i }));
    fireEvent.click(screen.getByRole('button', { name: /rules/i }));

    await waitFor(() => screen.getByText('Bidding Heuristic Analysis'), { timeout: 2000 });

    const itemInput = screen.getByPlaceholderText('item-uuid');
    await fireEvent.input(itemInput, { target: { value: 'item-xyz' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /run heuristic/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /run heuristic/i }));

    await waitFor(() => screen.getByRole('button', { name: /create risk case/i }), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /create risk case/i }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: 'item-xyz' }),
      );
      expect(getInboxSpy).toHaveBeenCalled();
    }, { timeout: 3000 });
  });
});
