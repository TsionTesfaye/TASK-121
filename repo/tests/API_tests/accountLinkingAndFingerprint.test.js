/**
 * Account linking (persisted) + device fingerprint tests.
 *
 * Covers:
 *   1. Link persists to IndexedDB
 *   2. Duplicate prevention (A-B == B-A)
 *   3. Self-link rejected
 *   4. Retrieve links for user
 *   5. Unlink removes record
 *   6. Fingerprint generation deterministic
 *   7. Fingerprint included in bid events
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
import { generateFingerprint } from '../../src/utils/fingerprint.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'LinkTest@12345';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'link_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'LinkTestCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('link_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// ACCOUNT LINKING — PERSISTENCE
// ══════════════════════════════════════════════════════════════════════════════

describe('Account linking — persisted', () => {
  let userA, userB;

  beforeEach(async () => {
    userA = await authService.createUser({
      username: 'user_a', password: ADMIN_PASS,
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });
    userB = await authService.createUser({
      username: 'user_b', password: ADMIN_PASS,
      role: ROLES.STORE_MANAGER, organizationNodeId: orgId,
    });
  });

  it('link persists and can be retrieved', async () => {
    const link = await authService.linkUserAccounts({
      userIdA: userA.id, userIdB: userB.id,
      reason: 'Shared device evidence found',
    });
    expect(link.id).toBeTruthy();
    expect(link.primaryUserId).toBe(userA.id);
    expect(link.linkedUserId).toBe(userB.id);

    // Retrieve
    const links = await authService.getLinkedAccounts(userA.id);
    expect(links.some((l) => l.id === link.id)).toBe(true);
  });

  it('duplicate link (A-B then A-B again) rejected', async () => {
    await authService.linkUserAccounts({
      userIdA: userA.id, userIdB: userB.id,
      reason: 'First link between accounts',
    });
    await expect(authService.linkUserAccounts({
      userIdA: userA.id, userIdB: userB.id,
      reason: 'Duplicate link attempt test',
    })).rejects.toThrow(/already linked/i);
  });

  it('reverse duplicate (B-A after A-B) also rejected', async () => {
    await authService.linkUserAccounts({
      userIdA: userA.id, userIdB: userB.id,
      reason: 'Forward direction link test',
    });
    await expect(authService.linkUserAccounts({
      userIdA: userB.id, userIdB: userA.id,
      reason: 'Reverse direction link test',
    })).rejects.toThrow(/already linked/i);
  });

  it('self-link rejected', async () => {
    await expect(authService.linkUserAccounts({
      userIdA: userA.id, userIdB: userA.id,
      reason: 'Self-link should never work',
    })).rejects.toThrow(/themselves/i);
  });

  it('unlink removes the record', async () => {
    const link = await authService.linkUserAccounts({
      userIdA: userA.id, userIdB: userB.id,
      reason: 'Link to be removed later',
    });

    await authService.unlinkAccounts(link.id);

    const links = await authService.getLinkedAccounts(userA.id);
    expect(links.some((l) => l.id === link.id)).toBe(false);
  });

  it('reason must be at least 10 characters', async () => {
    await expect(authService.linkUserAccounts({
      userIdA: userA.id, userIdB: userB.id, reason: 'short',
    })).rejects.toThrow(/10 characters/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DEVICE FINGERPRINT
// ══════════════════════════════════════════════════════════════════════════════

describe('Device fingerprint', () => {
  it('generates a deterministic string', () => {
    const fp1 = generateFingerprint();
    const fp2 = generateFingerprint();
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^fp_[0-9a-f]+$/);
  });

  it('same device different users produce SAME fingerprint', () => {
    // Fingerprint is device-only (no userId) — same device = same hash
    const fpA = generateFingerprint();
    const fpB = generateFingerprint();
    expect(fpA).toBe(fpB);
  });

  it('bid ingestion stores fingerprint when provided', async () => {
    const fp = generateFingerprint();
    const event = await riskReviewService.ingestBidEvent({
      organizationId: orgId,
      userId: 'bidder-fp-test',
      itemId: 'fp-item',
      bidAmount: 100,
      deviceFingerprint: fp,
      actorId: adminUser.id,
    });
    expect(event.deviceFingerprint).toBe(fp);
  });

  it('fingerprint clustering heuristic works with fingerprinted bids', async () => {
    const sharedFp = generateFingerprint();
    // Ingest enough bids from the same fingerprint to trigger clustering
    for (let i = 0; i < 6; i++) {
      await riskReviewService.ingestBidEvent({
        organizationId: orgId,
        userId: `bidder-${i}`,
        itemId: 'fp-cluster-item',
        bidAmount: 50 + i,
        deviceFingerprint: sharedFp,
        actorId: adminUser.id,
      });
    }

    const result = await riskReviewService.evaluateBiddingHeuristics({
      organizationId: orgId,
      itemId: 'fp-cluster-item',
      frequencyThreshold: 10, // won't trigger frequency
    });

    // Fingerprint clustering should detect the shared device
    expect(result.flagged).toBe(true);
    expect(result.evidence?.fingerprint).toBe(sharedFp);
  });
});
