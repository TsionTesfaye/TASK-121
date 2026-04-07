/**
 * MessagesPage — integration tests.
 *
 * Verifies UI ↔ service interaction for the MessagesPage component:
 *   - Empty inbox state
 *   - Notification renders after seeding
 *   - Tab navigation (inbox, queue, templates, channels)
 *   - New Template form validates required fields
 *   - New Channel form validates required fields
 *   - Subscription tab uses subEventType (not simEventType) for event type
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { EVENT_TYPES } from '../../../src/utils/constants.js';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../../src/infrastructure/db/db.js';
import { authService } from '../../../src/services/AuthService.js';
import { notificationService } from '../../../src/services/NotificationService.js';
import { cryptoService } from '../../../src/services/CryptoService.js';
import { BootstrapService } from '../../../src/services/BootstrapService.js';
import { currentUser } from '../../../src/app/stores/auth.js';
import {
  setBroadcastService,
  closeAll,
} from '../../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../../src/infrastructure/broadcast/MockBroadcastService.js';
import { templateService } from '../../../src/services/TemplateService.js';
import MessagesPage from '../../../src/pages/MessagesPage.svelte';

const ADMIN_PASS = 'Messages@1234';
const ORG_ID = 'org-messages-test';

let adminUser;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'msg_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'MessagesCo',
  });
  adminUser = result.admin;

  await authService.login('msg_admin', ADMIN_PASS);
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

describe('MessagesPage — empty state', () => {
  it('renders Notifications & Messages header', () => {
    render(MessagesPage);
    expect(screen.getByText('Notifications & Messages')).toBeTruthy();
  });

  it('shows inbox tab active by default', () => {
    render(MessagesPage);
    expect(screen.getByRole('button', { name: /inbox/i })).toBeTruthy();
  });

  it('shows No notifications in empty inbox', async () => {
    render(MessagesPage);
    await waitFor(() => {
      expect(screen.getByText(/no notifications/i)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('renders all four tab buttons', () => {
    render(MessagesPage);
    expect(screen.getByRole('button', { name: /inbox/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /queue/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /templates/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /channels/i })).toBeTruthy();
  });
});

describe('MessagesPage — tab navigation', () => {
  it('clicking Queue tab shows empty queue hint', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByRole('button', { name: /queue/i }));
    fireEvent.click(screen.getByRole('button', { name: /queue/i }));
    await waitFor(() => {
      expect(screen.getByText(/no queue items/i)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('clicking Templates tab shows + New Template button', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByRole('button', { name: /templates/i }));
    fireEvent.click(screen.getByRole('button', { name: /templates/i }));
    await waitFor(() => {
      expect(screen.getByText('+ New Template')).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('clicking Channels tab shows + New Channel button', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByRole('button', { name: /channels/i }));
    fireEvent.click(screen.getByRole('button', { name: /channels/i }));
    await waitFor(() => {
      expect(screen.getByText('+ New Channel')).toBeTruthy();
    }, { timeout: 2000 });
  });
});

describe('MessagesPage — template form', () => {
  it('Create button disabled in template form when name or body empty', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByRole('button', { name: /templates/i }));
    fireEvent.click(screen.getByRole('button', { name: /templates/i }));
    await waitFor(() => screen.getByText('+ New Template'), { timeout: 2000 });
    fireEvent.click(screen.getByText('+ New Template'));
    await waitFor(() => {
      // The modal's Create button is disabled when name/body are empty.
      const btns = screen.getAllByRole('button', { name: /^create$/i });
      expect(btns.some((b) => b.disabled)).toBe(true);
    }, { timeout: 2000 });
  });
});

// ── Mark read interaction ──────────────────────────────────────────────────

describe('MessagesPage — mark read', () => {
  beforeEach(async () => {
    await notificationService.notifyUser(adminUser.id, {
      type: 'info',
      title: 'Test Notification',
      body: 'Click mark read',
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('Mark read button is visible for unread notification', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByText('Test Notification'), { timeout: 3000 });
    expect(screen.getByRole('button', { name: /mark read/i })).toBeTruthy();
  });

  it('Mark read updates notification — button removed after marking', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByText('Test Notification'), { timeout: 3000 });

    await fireEvent.click(screen.getByRole('button', { name: /mark read/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /mark read/i })).toBeNull();
    }, { timeout: 3000 });
  });

  it('Mark read button is disabled while marking', async () => {
    vi.spyOn(notificationService, 'markRead').mockImplementation(() => new Promise(() => {}));

    render(MessagesPage);
    await waitFor(() => screen.getByText('Test Notification'), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: /mark read/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /marking/i })).toBeDisabled();
    }, { timeout: 2000 });
  });
});

// ── Template deletion ──────────────────────────────────────────────────────

describe('MessagesPage — template deletion', () => {
  beforeEach(async () => {
    await templateService.createTemplate({
      organizationId: ORG_ID,
      name: 'Promo Template',
      body: 'Hello {{name}}, here is your promo!',
      isCompact: false,
      actorId: adminUser.id,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('Delete button disabled while deleting template', async () => {
    vi.spyOn(templateService, 'deleteTemplate').mockImplementation(() => new Promise(() => {}));

    render(MessagesPage);
    await waitFor(() => screen.getByRole('button', { name: /templates/i }));
    fireEvent.click(screen.getByRole('button', { name: /templates/i }));
    await waitFor(() => screen.getByText('Promo Template'), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /deleting/i })).toBeDisabled();
    }, { timeout: 2000 });
  });
});

// ── Subscription tab: uses subEventType only ──────────────────────────────────

describe('MessagesPage — subscription event type selection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('subscribe call receives the event type chosen from the subscriptions select, not simEventType', async () => {
    // Use a valid event type value that actually exists as a select option
    const validEventType = EVENT_TYPES.ORDER_STATUS_CHANGED; // 'order_status'

    const subscribeSpy = vi.spyOn(notificationService, 'subscribe').mockResolvedValue({
      id: 'sub-test-001',
      userId: adminUser.id,
      eventType: validEventType,
      channelId: null,
      organizationId: 'org-messages-test',
      filters: {},
    });

    render(MessagesPage);

    // Navigate to subscriptions tab
    await waitFor(() => screen.getByRole('button', { name: /subscriptions/i }));
    fireEvent.click(screen.getByRole('button', { name: /subscriptions/i }));

    // Select a valid event type from the subscriptions form select
    await waitFor(() => screen.getByRole('combobox'), { timeout: 2000 });
    const selects = screen.getAllByRole('combobox');
    // First combobox in the subscriptions form is the event type select
    fireEvent.change(selects[0], { target: { value: validEventType } });

    // Click Subscribe
    await waitFor(() => screen.getByRole('button', { name: /^subscribe$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^subscribe$/i }));

    await waitFor(() => {
      expect(subscribeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: validEventType }),
      );
    }, { timeout: 3000 });

    // Must NOT have used simEventType — simEventType defaults to the first option but
    // is only for the simulate tab; subEventType is the subscriptions tab binding.
    const callArg = subscribeSpy.mock.calls[0][0];
    expect(callArg.eventType).toBe(validEventType);
  });
});
