/**
 * Integration tests — Persistence and profile retrieval.
 *
 * Covers:
 *   - Risk dictionary: add words → persist → reload → still present
 *   - NLP profiles: create profile → listProfiles returns it
 *   - NLP profiles: list ordered newest-first
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { riskReviewService } from '../../src/services/RiskReviewService.js';
import { nlpService } from '../../src/services/NLPService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'Persist@12345';
let orgId;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { org } = await bs.bootstrap({
    adminUsername: 'persist_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'PersistCo',
  });
  orgId = org.id;

  await authService.login('persist_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
});

// ── Risk dictionary persistence ───────────────────────────────────────────────

describe('Risk dictionary persistence', () => {
  it('persists sensitive words to IndexedDB and reloads them', async () => {
    // Update the dictionary — this persists to appConfig
    await riskReviewService.updateSensitiveWords(['fraud', 'scam', 'banned'], authService._currentUser.id);

    // Verify in-memory
    expect(riskReviewService.getSensitiveWords()).toEqual(['fraud', 'scam', 'banned']);

    // Simulate app restart: clear in-memory state
    riskReviewService.loadSensitiveWordDictionary([]);
    expect(riskReviewService.getSensitiveWords()).toEqual([]);

    // Reload from IndexedDB
    await riskReviewService.loadPersistedDictionary(orgId);
    expect(riskReviewService.getSensitiveWords()).toEqual(['fraud', 'scam', 'banned']);
  });

  it('dictionary is org-scoped — different org gets empty dictionary', async () => {
    await riskReviewService.updateSensitiveWords(['contraband'], authService._currentUser.id);

    // Clear in-memory
    riskReviewService.loadSensitiveWordDictionary([]);

    // Load from a different org — should be empty
    await riskReviewService.loadPersistedDictionary('other-org-999');
    expect(riskReviewService.getSensitiveWords()).toEqual([]);
  });
});

// ── NLP profiles — listProfiles ───────────────────────────────────────────────

describe('NLP validation profiles', () => {
  it('listProfiles returns created profiles', async () => {
    await nlpService.createValidationProfile({
      modelVersion: 'v1.0',
      corpusName: 'benchmark-2024',
      precision: 0.9,
      recall: 0.85,
      f1: 0.87,
      labeledSampleCount: 500,
      actorId: authService._currentUser.id,
    });

    const profiles = await nlpService.listProfiles();
    expect(profiles.length).toBe(1);
    expect(profiles[0].modelVersion).toBe('v1.0');
  });

  it('listProfiles returns newest first', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();

    await nlpService.createValidationProfile({
      modelVersion: 'v1.0',
      corpusName: 'old-corpus',
      precision: 0.8, recall: 0.8, f1: 0.8,
      labeledSampleCount: 100,
      actorId: authService._currentUser.id,
    });

    // Advance time so the second profile has a later createdAt.
    vi.advanceTimersByTime(1000);

    await nlpService.createValidationProfile({
      modelVersion: 'v2.0',
      corpusName: 'new-corpus',
      precision: 0.95, recall: 0.9, f1: 0.92,
      labeledSampleCount: 1000,
      actorId: authService._currentUser.id,
    });

    const profiles = await nlpService.listProfiles();
    expect(profiles.length).toBe(2);
    expect(profiles[0].modelVersion).toBe('v2.0');
    expect(profiles[1].modelVersion).toBe('v1.0');

    vi.useRealTimers();
  });

  it('profile persists across service instances', async () => {
    await nlpService.createValidationProfile({
      modelVersion: 'v3.0',
      corpusName: 'persist-test',
      precision: 0.88, recall: 0.85, f1: 0.86,
      labeledSampleCount: 200,
      actorId: authService._currentUser.id,
    });

    // Simulate new service instance (same DB)
    const { NLPService } = await import('../../src/services/NLPService.js');
    const freshService = new NLPService();

    // Auth is still active — listProfiles should find the persisted profile
    const profiles = await freshService.listProfiles();
    expect(profiles.length).toBe(1);
    expect(profiles[0].modelVersion).toBe('v3.0');
  });
});
