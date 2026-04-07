/**
 * Integration tests — NotificationService channel type enforcement.
 *
 * Covers:
 *   - Creating channel with 'email' type is rejected
 *   - Creating channel with 'sms' type is rejected
 *   - Creating channel with 'push' type is rejected
 *   - Creating channel with 'in_app' type is accepted
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { notificationService } from '../../src/services/NotificationService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import { ROLES } from '../../src/utils/constants.js';

const ADMIN = { id: 'admin-001', role: ROLES.ADMINISTRATOR, organizationNodeId: 'org-001' };
const ORG_ID = 'org-001';

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());
  authService._currentUser = ADMIN;
});

afterEach(() => {
  authService._currentUser = null;
  closeDB();
  closeAll();
});

describe('Channel type enforcement', () => {
  it('rejects channel type "email"', async () => {
    await expect(
      notificationService.upsertChannel({ organizationId: ORG_ID, name: 'Email Channel', type: 'email' }),
    ).rejects.toThrow(/invalid channel type/i);
  });

  it('rejects channel type "sms"', async () => {
    await expect(
      notificationService.upsertChannel({ organizationId: ORG_ID, name: 'SMS Channel', type: 'sms' }),
    ).rejects.toThrow(/invalid channel type/i);
  });

  it('rejects channel type "push"', async () => {
    await expect(
      notificationService.upsertChannel({ organizationId: ORG_ID, name: 'Push Channel', type: 'push' }),
    ).rejects.toThrow(/invalid channel type/i);
  });

  it('accepts channel type "in_app"', async () => {
    const channel = await notificationService.upsertChannel({
      organizationId: ORG_ID,
      name: 'In-App Channel',
      type: 'in_app',
    });
    expect(channel.type).toBe('in_app');
    expect(channel.organizationId).toBe(ORG_ID);
  });

  it('defaults to "in_app" when type is omitted', async () => {
    const channel = await notificationService.upsertChannel({
      organizationId: ORG_ID,
      name: 'Default Channel',
    });
    expect(channel.type).toBe('in_app');
  });
});
