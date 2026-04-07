/**
 * Risk ingestion + heuristic flow tests.
 *
 * Covers:
 *   1. Bid event ingestion → heuristic detects frequency
 *   2. Linked account ingestion → heuristic detects cross-bidder links
 *   3. Full flow: ingest → evaluate → create case
 *   4. UI has ingestion forms (file-level check)
 *   5. Error logging sanitized
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'RiskIngest@123';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'ri_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'RiskIngestCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('ri_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. BID EVENT INGESTION + HEURISTIC
// ══════════════════════════════════════════════════════════════════════════════

describe('Bid event ingestion → heuristic flow', () => {
  it('ingested bid events are detected by frequency heuristic', async () => {
    // Ingest enough bids to exceed the default threshold (10)
    for (let i = 0; i < 12; i++) {
      await riskReviewService.ingestBidEvent({
        organizationId: orgId,
        userId: `bidder-${i}`,
        itemId: 'hot-item',
        bidAmount: 50 + i,
        actorId: adminUser.id,
      });
    }

    const result = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: orgId,
      itemId: 'hot-item',
    });

    expect(result.flagged).toBe(true);
    expect(result.reason).toContain('frequency');
  });

  it('few bids do not trigger heuristic', async () => {
    await riskReviewService.ingestBidEvent({
      organizationId: orgId,
      userId: 'single-bidder',
      itemId: 'quiet-item',
      bidAmount: 100,
      actorId: adminUser.id,
    });

    const result = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: orgId,
      itemId: 'quiet-item',
    });

    expect(result.flagged).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. LINKED ACCOUNT INGESTION + HEURISTIC
// ══════════════════════════════════════════════════════════════════════════════

describe('Linked account ingestion → heuristic flow', () => {
  it('linked accounts between bidders trigger heuristic', async () => {
    // Two bidders on same item
    await riskReviewService.ingestBidEvent({
      organizationId: orgId, userId: 'user-A', itemId: 'link-item',
      bidAmount: 100, actorId: adminUser.id,
    });
    await riskReviewService.ingestBidEvent({
      organizationId: orgId, userId: 'user-B', itemId: 'link-item',
      bidAmount: 120, actorId: adminUser.id,
    });

    // Link them
    await riskReviewService.ingestLinkedAccount({
      organizationId: orgId,
      primaryUserId: 'user-A',
      linkedUserId: 'user-B',
      evidenceType: 'shared_address',
      evidenceDetails: 'Same shipping address',
      actorId: adminUser.id,
    });

    const result = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: orgId,
      itemId: 'link-item',
    });

    expect(result.flagged).toBe(true);
    expect(result.reason).toContain('linked-account');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. FULL E2E FLOW: ingest → evaluate → create case
// ══════════════════════════════════════════════════════════════════════════════

describe('Full risk flow: ingest → evaluate → create case', () => {
  it('end-to-end: bid events + linked accounts → heuristic flags → case created', async () => {
    // Step 1: Ingest bid events from linked users
    await riskReviewService.ingestBidEvent({
      organizationId: orgId, userId: 'shill-A', itemId: 'auction-001',
      bidAmount: 200, actorId: adminUser.id,
    });
    await riskReviewService.ingestBidEvent({
      organizationId: orgId, userId: 'shill-B', itemId: 'auction-001',
      bidAmount: 250, actorId: adminUser.id,
    });

    // Step 2: Ingest linked account
    await riskReviewService.ingestLinkedAccount({
      organizationId: orgId,
      primaryUserId: 'shill-A', linkedUserId: 'shill-B',
      evidenceType: 'same_device', evidenceDetails: 'Identical fingerprint',
      actorId: adminUser.id,
    });

    // Step 3: Run heuristic
    const result = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: orgId, itemId: 'auction-001',
    });
    expect(result.flagged).toBe(true);

    // Step 4: Create case from result
    const riskCase = await riskReviewService.createCaseFromHeuristic({
      organizationId: orgId, itemId: 'auction-001',
      heuristicResult: result, actorId: adminUser.id,
    });
    expect(riskCase).not.toBeNull();
    expect(riskCase.status).toBe('open');

    // Step 5: Verify in inbox
    authService._currentUser = { ...authService._currentUser, role: ROLES.REVIEWER };
    const inbox = await riskReviewService.getInbox(orgId);
    expect(inbox.some((c) => c.id === riskCase.id)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. UI HAS INGESTION FORMS
// ══════════════════════════════════════════════════════════════════════════════

describe('RiskReviewPage — ingestion UI', () => {
  it('has bid event ingestion form', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/RiskReviewPage.svelte'), 'utf8');
    expect(content).toContain('handleIngestBid');
    expect(content).toContain('Add Bid Event');
    expect(content).toContain('bidItemId');
    expect(content).toContain('bidAmount');
  });

  it('has linked account ingestion form', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/pages/RiskReviewPage.svelte'), 'utf8');
    expect(content).toContain('handleIngestLink');
    expect(content).toContain('Add Linked Account');
    expect(content).toContain('linkPrimary');
    expect(content).toContain('linkLinked');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. ERROR LOGGING SANITIZED
// ══════════════════════════════════════════════════════════════════════════════

describe('Error logging sanitized', () => {
  it('App.svelte uses err.message, not err object', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/App.svelte'), 'utf8');
    expect(content).toContain("console.error('[App] Startup error:', err.message)");
    expect(content).not.toContain("console.error('[App] Startup error:', err)");
  });

  it('SchedulerService uses err.message', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('src/services/SchedulerService.js'), 'utf8');
    expect(content).not.toMatch(/console\.error\([^)]*,\s*err\s*\)/);
  });
});
