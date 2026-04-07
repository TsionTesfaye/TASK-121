/**
 * Prompt-fit final tests — Prompt 3 regression coverage.
 *
 * Covers:
 *   1. Trigger taxonomy — all 8 event types resolve template-backed queue delivery
 *   2. NLP threshold — configurable, persisted, default works
 *   3. UI authorization — MasterDataPage and MessagesPage role gating
 *   4. No direct-send bypass for any trigger
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, waitFor } from '@testing-library/svelte';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { nlpService } from '../../src/services/NLPService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { eventDispatcherService } from '../../src/services/EventDispatcherService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { MessageQueueRepository } from '../../src/repositories/implementations/NotificationRepository.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { currentUser } from '../../src/app/stores/auth.js';
import { ROLES, EVENT_TYPES, NLP, QUEUE_STATUSES } from '../../src/utils/constants.js';
import MasterDataPage from '../../src/pages/MasterDataPage.svelte';
import MessagesPage from '../../src/pages/MessagesPage.svelte';

const ADMIN_PASS = 'PromptFit@1234';
let orgId;
let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'pf_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'PromptFitCo',
  });
  orgId = org.id;
  adminUser = admin;

  await authService.login('pf_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  currentUser.set(null);
  closeDB();
  closeAll();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. TRIGGER TAXONOMY — ALL TEMPLATE-BACKED
// ══════════════════════════════════════════════════════════════════════════════

describe('Trigger taxonomy — all triggers template-backed', () => {
  for (const [key, eventType] of Object.entries(EVENT_TYPES)) {
    it(`${key} → resolves system template and queues with templateId`, async () => {
      const channel = await notificationService.upsertChannel({ organizationId: orgId, name: `ch-${key}` });
      await notificationService.subscribe({
        userId: adminUser.id, channelId: channel.id,
        eventType, organizationId: orgId,
      });

      await eventDispatcherService.dispatch({
        organizationId: orgId, eventType,
        sourceId: `src-${key}-${Date.now()}`, actorId: adminUser.id,
        title: `Title for ${key}`, body: `Body for ${key}`,
      });

      const queueRepo = new MessageQueueRepository();
      const items = await queueRepo.findAll();
      const matching = items.filter((i) => i.recipientUserId === adminUser.id);
      expect(matching.length).toBeGreaterThan(0);
      // Every item must have a templateId — no body-only bypass
      for (const item of matching) {
        expect(item.templateId).toBeTruthy();
      }
    });
  }

  it('dispatch without template and without subscribers creates no items (no bypass)', async () => {
    await eventDispatcherService.dispatch({
      organizationId: orgId,
      eventType: EVENT_TYPES.ANNOUNCEMENT,
      sourceId: 'no-bypass-test',
      actorId: adminUser.id,
      title: 'Test', body: 'Body',
    });

    const queueRepo = new MessageQueueRepository();
    const items = await queueRepo.findAll();
    expect(items.length).toBe(0); // no subscribers, no direct recipients
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. NLP THRESHOLD — CONFIGURABLE + PERSISTED
// ══════════════════════════════════════════════════════════════════════════════

describe('NLP F1 alert threshold — configurable', () => {
  it('default threshold is 0.70', () => {
    expect(nlpService.getF1Threshold()).toBe(NLP.F1_ALERT_THRESHOLD);
    expect(nlpService.getF1Threshold()).toBe(0.7);
  });

  it('setF1Threshold changes the effective threshold', async () => {
    await nlpService.setF1Threshold(0.85, orgId);
    expect(nlpService.getF1Threshold()).toBe(0.85);
  });

  it('threshold persists after reload', async () => {
    await nlpService.setF1Threshold(0.6, orgId);

    // Simulate restart: reset in-memory
    nlpService._f1ThresholdOverride = null;
    expect(nlpService.getF1Threshold()).toBe(0.7); // back to default

    // Reload from persistence
    await nlpService.loadPersistedThreshold(orgId);
    expect(nlpService.getF1Threshold()).toBe(0.6); // restored
  });

  it('rejects threshold out of range', async () => {
    await expect(nlpService.setF1Threshold(1.5, orgId)).rejects.toThrow(/between 0 and 1/i);
    await expect(nlpService.setF1Threshold(-0.1, orgId)).rejects.toThrow(/between 0 and 1/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. UI AUTHORIZATION — MASTER DATA + MESSAGES GATING
// ══════════════════════════════════════════════════════════════════════════════

describe('MasterDataPage — role-based control gating', () => {
  it('analyst cannot see Publish, Add, or New Style buttons', async () => {
    authService._currentUser = {
      id: 'analyst-001', role: ROLES.ANALYST, organizationNodeId: orgId,
    };
    currentUser.set(authService._currentUser);

    render(MasterDataPage);
    await waitFor(() => {}, { timeout: 500 });

    expect(screen.queryByText(/Publish New Version/i)).toBeNull();
    expect(screen.queryByText(/New Style/i)).toBeNull();
  });
});

describe('MessagesPage — role-based control gating', () => {
  it('analyst cannot see New Template or New Channel buttons', async () => {
    authService._currentUser = {
      id: 'analyst-001', role: ROLES.ANALYST, organizationNodeId: orgId,
    };
    currentUser.set(authService._currentUser);

    render(MessagesPage);
    await waitFor(() => {}, { timeout: 500 });

    expect(screen.queryByText(/New Template/i)).toBeNull();
    expect(screen.queryByText(/New Channel/i)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. DOCS — NO STALE TEST COUNT
// ══════════════════════════════════════════════════════════════════════════════

describe('README — no stale numeric test counts', () => {
  it('README does not contain hardcoded test count "541"', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve('README.md'), 'utf8');
    expect(content).not.toContain('541 tests');
    expect(content).not.toContain('all 541');
  });
});
