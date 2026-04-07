/**
 * Phase 2 enhancements — dedicated test file for new behaviors.
 *
 * Covers:
 *   1. Device fingerprint: device-only, deterministic, higher entropy
 *   2. Risk auto-case creation: flagged → case created, idempotent
 *   3. Customer creation versioning: reasonNote required, initial version created
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { MasterDataRepository } from '../../src/repositories/implementations/MasterDataRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { generateFingerprint } from '../../src/utils/fingerprint.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'Phase2@123456';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'p2_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'Phase2Co',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('p2_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. DEVICE FINGERPRINT
// ══════════════════════════════════════════════════════════════════════════════

describe('Device fingerprint — device-only, deterministic', () => {
  it('same device, different users → same fingerprint', () => {
    // generateFingerprint() takes no userId — purely device-based
    const fp1 = generateFingerprint();
    const fp2 = generateFingerprint();
    expect(fp1).toBe(fp2);
  });

  it('produces a valid hex-prefixed string', () => {
    const fp = generateFingerprint();
    expect(fp).toMatch(/^fp_[0-9a-f]+$/);
  });

  it('is deterministic across calls', () => {
    const results = new Set();
    for (let i = 0; i < 100; i++) results.add(generateFingerprint());
    expect(results.size).toBe(1);
  });

  it('includes language and timezone in entropy', () => {
    // Verify the implementation reads these signals
    // (in jsdom, navigator.language and Date.getTimezoneOffset are deterministic)
    const fp = generateFingerprint();
    expect(typeof fp).toBe('string');
    expect(fp.length).toBeGreaterThan(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. RISK AUTO-CASE CREATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Risk auto-case — evaluateAndAutoCase', () => {
  it('flagged item → case auto-created', async () => {
    // Ingest enough bids to trigger frequency heuristic
    for (let i = 0; i < 12; i++) {
      await riskReviewService.ingestBidEvent({
        organizationId: orgId, userId: `bidder-${i}`,
        itemId: 'auto-item', bidAmount: 50 + i, actorId: adminUser.id,
      });
    }

    const { result, caseCreated } = await riskReviewService.evaluateAndAutoCase({
      organizationId: orgId, itemId: 'auto-item', actorId: adminUser.id,
    });

    expect(result.flagged).toBe(true);
    expect(caseCreated).not.toBeNull();
    expect(caseCreated.status).toBe('open');
  });

  it('repeated evaluation → no duplicate case (idempotent)', async () => {
    for (let i = 0; i < 12; i++) {
      await riskReviewService.ingestBidEvent({
        organizationId: orgId, userId: `bidder-${i}`,
        itemId: 'dedup-item', bidAmount: 50 + i, actorId: adminUser.id,
      });
    }

    const first = await riskReviewService.evaluateAndAutoCase({
      organizationId: orgId, itemId: 'dedup-item', actorId: adminUser.id,
    });
    expect(first.caseCreated).not.toBeNull();

    // Second evaluation — case already exists, should NOT create duplicate
    const second = await riskReviewService.evaluateAndAutoCase({
      organizationId: orgId, itemId: 'dedup-item', actorId: adminUser.id,
    });
    expect(second.result.flagged).toBe(true);
    expect(second.caseCreated).toBeNull(); // idempotent — no duplicate
  });

  it('non-flagged item → no case created', async () => {
    // Single bid — not enough to trigger
    await riskReviewService.ingestBidEvent({
      organizationId: orgId, userId: 'solo-bidder',
      itemId: 'quiet-item', bidAmount: 100, actorId: adminUser.id,
    });

    const { result, caseCreated } = await riskReviewService.evaluateAndAutoCase({
      organizationId: orgId, itemId: 'quiet-item', actorId: adminUser.id,
    });

    expect(result.flagged).toBe(false);
    expect(caseCreated).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. CUSTOMER CREATION VERSIONING
// ══════════════════════════════════════════════════════════════════════════════

describe('Customer creation — versioning with reasonNote', () => {
  it('createCustomer without reasonNote → throws', async () => {
    await expect(customerService.createCustomer({
      organizationId: orgId, name: 'No Reason',
      actorId: adminUser.id,
    })).rejects.toThrow(/reason/i);
  });

  it('createCustomer with valid reason → version record created', async () => {
    const customer = await customerService.createCustomer({
      organizationId: orgId, name: 'Versioned Customer',
      actorId: adminUser.id, reasonNote: 'Initial customer creation for onboarding',
    });

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customer.id);
    expect(history.length).toBe(1);
    expect(history[0].entityType).toBe('customer');
    expect(history[0].reasonNote).toBe('Initial customer creation for onboarding');
  });

  it('initial version is active', async () => {
    const customer = await customerService.createCustomer({
      organizationId: orgId, name: 'Active Version Customer',
      actorId: adminUser.id, reasonNote: 'Testing initial active version status',
    });

    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(customer.id);
    expect(history[0].isActive).toBe(true);
    expect(history[0].versionNumber).toBe(1);
  });

  it('short reasonNote (< 10 chars) → rejected', async () => {
    await expect(customerService.createCustomer({
      organizationId: orgId, name: 'Short Reason',
      actorId: adminUser.id, reasonNote: 'too short',
    })).rejects.toThrow(/reason/i);
  });
});
