/**
 * E2E Simulation — NLP flow: import → batch run → incremental run.
 *
 * Covers:
 *   - Import text records
 *   - Batch run processes all imported texts
 *   - Run output contains expected NLP fields per text
 *   - Incremental run only processes texts since last run
 *   - Run history tracks both runs
 *   - Empty text import is rejected
 *   - ANALYST role required; STORE_MANAGER rejected
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { NLPService } from '../../src/services/NLPService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ANALYST = { id: 'analyst-001', role: ROLES.ANALYST, organizationNodeId: 'org-001' };
const ORG_ID = 'org-001';

function importText(svc, filename, rawText) {
  return svc.importText({
    organizationId: ORG_ID,
    sourceType: 'review',
    sourceId: 'src-001',
    filename,
    rawText,
    actorId: ANALYST.id,
  });
}

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = ANALYST;
});

afterEach(() => {
  authService._currentUser = null;
  cryptoService.clearSessionKey();
  closeDB();
  closeAll();
});

describe('NLP flow', () => {
  it('imports text and records metadata', async () => {
    const svc = new NLPService();
    const record = await importText(svc, 'review1.txt', 'Great product, very happy with the quality.');
    expect(record.filename).toBe('review1.txt');
    expect(record.sizeBytes).toBeGreaterThan(0);
  });

  it('batch run processes all imported texts and returns output payload', async () => {
    const svc = new NLPService();
    await importText(svc, 'r1.txt', 'Excellent quality and fast delivery.');
    await importText(svc, 'r2.txt', 'Poor packaging but great product inside.');

    const run = await svc.runBatch({ organizationId: ORG_ID, modelVersion: 'v1.0', actorId: ANALYST.id });
    expect(run.runType).toBe('batch');
    expect(run.inputIds.length).toBe(2);
    // Each text entry should have NLP output fields.
    const outputs = Object.values(run.outputPayload);
    expect(outputs.length).toBe(2);
    expect(outputs[0]).toHaveProperty('keywords');
    expect(outputs[0]).toHaveProperty('sentiment');
    expect(outputs[0]).toHaveProperty('topics');
  });

  it('incremental run only processes texts since last run', async () => {
    const svc = new NLPService();
    await importText(svc, 'old.txt', 'Old review about the store.');

    // Ensure old text importedAt is strictly before the batch run createdAt.
    await new Promise((r) => setTimeout(r, 10));

    // First batch run to establish baseline (createdAt > old text importedAt).
    const batchRun = await svc.runBatch({ organizationId: ORG_ID, modelVersion: 'v1.0', actorId: ANALYST.id });

    // Ensure new text importedAt is strictly after the batch run createdAt.
    await new Promise((r) => setTimeout(r, 10));
    await importText(svc, 'new.txt', 'Brand new feedback about today.');

    const incRun = await svc.runIncremental({ organizationId: ORG_ID, modelVersion: 'v1.0', actorId: ANALYST.id });
    expect(incRun.runType).toBe('incremental');
    // Only the new text (created after batchRun) should be included.
    expect(incRun.inputIds.length).toBe(1);
    // And the batch run came before — verified by its createdAt.
    expect(batchRun.inputIds.length).toBe(1);
  });

  it('run history is accessible and returns both runs', async () => {
    const svc = new NLPService();
    await importText(svc, 'text1.txt', 'Some review content here.');
    await svc.runBatch({ organizationId: ORG_ID, modelVersion: 'v1.0', actorId: ANALYST.id });
    await svc.runIncremental({ organizationId: ORG_ID, modelVersion: 'v1.0', actorId: ANALYST.id });

    const history = await svc.getRunHistory(ORG_ID);
    expect(history.length).toBeGreaterThanOrEqual(2);
    // History is newest-first.
    expect(history[0].createdAt).toBeGreaterThanOrEqual(history[1].createdAt);
  });

  it('empty text import is rejected', async () => {
    const svc = new NLPService();
    await expect(
      importText(svc, 'empty.txt', '   '),
    ).rejects.toThrow(/empty/i);
  });

  it('STORE_MANAGER role cannot import text', async () => {
    authService._currentUser = { id: 'mgr-001', role: ROLES.STORE_MANAGER, organizationNodeId: ORG_ID };
    const svc = new NLPService();
    await expect(
      importText(svc, 'blocked.txt', 'Some content.'),
    ).rejects.toThrow(/permission/i);
  });
});
