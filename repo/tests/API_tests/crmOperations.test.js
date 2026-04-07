/**
 * Integration tests — CRM operations: adjustPoints, adjustStoredValue, addRating.
 *
 * Covers:
 *   - adjustPoints increases/decreases balance
 *   - adjustPoints rejects non-integer delta
 *   - adjustPoints blocks negative total
 *   - adjustStoredValue credits and debits
 *   - adjustStoredValue blocks negative balance
 *   - addRating updates running average and count
 *   - addRating rejects out-of-range values
 *   - addRating dispatches GRADING_COMPLETED event
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { customerService } from '../../src/services/CustomerService.js';
import { eventDispatcherService } from '../../src/services/EventDispatcherService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES, EVENT_TYPES } from '../../src/utils/constants.js';

const ADMIN_PASS = 'CrmOps@12345';
let orgId;
let adminUser;
let customerId;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const { admin, org } = await bs.bootstrap({
    adminUsername: 'ops_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'OpsTestCo',
  });
  adminUser = admin;
  orgId = org.id;

  await authService.login('ops_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);

  const customer = await customerService.createCustomer({
    organizationId: orgId,
    name: 'Test Customer',
    membershipTier: 'Bronze',
    points: 100,
    storedValue: 50,
    actorId: adminUser.id,
        reasonNote: 'Test customer creation',
  });
  customerId = customer.id;
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  closeDB();
  closeAll();
  vi.restoreAllMocks();
});

// ── adjustPoints ──────────────────────────────────────────────────────────────

describe('CustomerService.adjustPoints', () => {
  it('increases points by positive delta', async () => {
    const updated = await customerService.adjustPoints(customerId, 25, adminUser.id, 'Test reason note text');
    expect(updated.points).toBe(125);
  });

  it('decreases points by negative delta', async () => {
    const updated = await customerService.adjustPoints(customerId, -30, adminUser.id, 'Test reason note text');
    expect(updated.points).toBe(70);
  });

  it('rejects non-integer delta', async () => {
    await expect(
      customerService.adjustPoints(customerId, 2.5, adminUser.id, 'Test reason note text'),
    ).rejects.toThrow(/integer/i);
  });

  it('rejects delta that would make points negative', async () => {
    await expect(
      customerService.adjustPoints(customerId, -200, adminUser.id, 'Test reason note text'),
    ).rejects.toThrow();
  });
});

// ── adjustStoredValue ─────────────────────────────────────────────────────────

describe('CustomerService.adjustStoredValue', () => {
  it('credits stored value', async () => {
    const updated = await customerService.adjustStoredValue(customerId, 25.50, adminUser.id, 'Test reason note text');
    // Verify by revealing
    const fields = await customerService.revealSensitiveFields(customerId);
    expect(parseFloat(fields.storedValue)).toBeCloseTo(75.50, 2);
  });

  it('debits stored value', async () => {
    const updated = await customerService.adjustStoredValue(customerId, -10, adminUser.id, 'Test reason note text');
    const fields = await customerService.revealSensitiveFields(customerId);
    expect(parseFloat(fields.storedValue)).toBeCloseTo(40, 2);
  });

  it('rejects debit that would create negative balance', async () => {
    await expect(
      customerService.adjustStoredValue(customerId, -999, adminUser.id, 'Test reason note text'),
    ).rejects.toThrow();
  });
});

// ── addRating ─────────────────────────────────────────────────────────────────

describe('CustomerService.addRating', () => {
  it('updates running average after first rating', async () => {
    const updated = await customerService.addRating(customerId, 4, adminUser.id, 'Test reason note text');
    expect(updated.ratingAverage).toBe(4);
    expect(updated.ratingCount).toBe(1);
  });

  it('correctly computes running average after multiple ratings', async () => {
    await customerService.addRating(customerId, 4, adminUser.id, 'Test reason note text');
    const updated = await customerService.addRating(customerId, 2, adminUser.id, 'Test reason note text');
    expect(updated.ratingAverage).toBe(3);
    expect(updated.ratingCount).toBe(2);
  });

  it('rejects rating below 1', async () => {
    await expect(
      customerService.addRating(customerId, 0, adminUser.id, 'Test reason note text'),
    ).rejects.toThrow();
  });

  it('rejects rating above 5', async () => {
    await expect(
      customerService.addRating(customerId, 6, adminUser.id, 'Test reason note text'),
    ).rejects.toThrow();
  });

  it('dispatches GRADING_COMPLETED event', async () => {
    const spy = vi.spyOn(eventDispatcherService, 'dispatch');
    await customerService.addRating(customerId, 5, adminUser.id, 'Test reason note text');

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: EVENT_TYPES.GRADING_COMPLETED,
        sourceId: customerId,
      }),
    );
  });
});
