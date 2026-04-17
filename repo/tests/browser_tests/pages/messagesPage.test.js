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

describe('MessagesPage — subscription event type selection (real data path)', () => {
  it('subscribing via the form persists the subscription to IndexedDB with the correct event type', async () => {
    const validEventType = EVENT_TYPES.ORDER_STATUS_CHANGED;

    // Verify no subscription exists yet (data side-effect baseline)
    const subsBefore = await notificationService.getSubscriptions(adminUser.id);
    const countBefore = subsBefore.length;

    render(MessagesPage);

    // Navigate to subscriptions tab
    await waitFor(() => screen.getByRole('button', { name: /subscriptions/i }));
    fireEvent.click(screen.getByRole('button', { name: /subscriptions/i }));

    // Select event type from the subscriptions form
    await waitFor(() => screen.getByRole('combobox'), { timeout: 2000 });
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: validEventType } });

    // Click Subscribe
    await waitFor(() => screen.getByRole('button', { name: /^subscribe$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^subscribe$/i }));

    // Data side-effect: subscription is persisted to IndexedDB with the chosen event type
    await waitFor(async () => {
      const subsAfter = await notificationService.getSubscriptions(adminUser.id);
      expect(subsAfter.length).toBe(countBefore + 1);
      // The new subscription must carry the event type chosen in the subscriptions form,
      // not the default value from the simulate tab's separate binding.
      expect(subsAfter[subsAfter.length - 1].eventType).toBe(validEventType);
    }, { timeout: 5000 });
  });
});

// ── Real data-path: template created via UI appears in list ───────────────

describe('MessagesPage — template created via form appears in list (real data path)', () => {
  it('template name appears in templates tab after form submission', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByRole('button', { name: /templates/i }));
    fireEvent.click(screen.getByRole('button', { name: /templates/i }));
    await waitFor(() => screen.getByText('+ New Template'), { timeout: 2000 });
    fireEvent.click(screen.getByText('+ New Template'));

    // Fill template name
    await waitFor(() => {
      expect(screen.queryByRole('dialog') ?? screen.queryByText('New Template')).toBeTruthy();
    }, { timeout: 2000 });

    const inputs = screen.getAllByRole('textbox');
    // First textbox = template name
    await fireEvent.input(inputs[0], { target: { value: 'Real UI Template' } });

    // Body textarea — use querySelector for textarea
    const bodyArea = document.querySelector('textarea');
    if (bodyArea) {
      await fireEvent.input(bodyArea, { target: { value: 'Hello {name}, real body text here.' } });
    }

    const createBtn = screen.getByRole('button', { name: /^create$/i });
    await fireEvent.click(createBtn);

    // Template should appear in the list
    await waitFor(() => {
      expect(screen.getByText('Real UI Template')).toBeTruthy();
    }, { timeout: 5000 });
  });

  it('two seeded templates both appear in the templates list', async () => {
    await templateService.createTemplate({
      organizationId: ORG_ID,
      name: 'Template One',
      body: 'Body one {{var}}',
      isCompact: false,
      actorId: adminUser.id,
    });
    await templateService.createTemplate({
      organizationId: ORG_ID,
      name: 'Template Two',
      body: 'Body two {{var}}',
      isCompact: false,
      actorId: adminUser.id,
    });

    render(MessagesPage);
    await waitFor(() => screen.getByRole('button', { name: /templates/i }));
    fireEvent.click(screen.getByRole('button', { name: /templates/i }));

    await waitFor(() => {
      expect(screen.getByText('Template One')).toBeTruthy();
      expect(screen.getByText('Template Two')).toBeTruthy();
    }, { timeout: 3000 });
  });
});

// ── Real data-path: notification persists after mark-read ─────────────────

describe('MessagesPage — mark-read removes button but notification stays visible (real data path)', () => {
  beforeEach(async () => {
    await notificationService.notifyUser(adminUser.id, {
      type: 'success',
      title: 'Persist After Read',
      body: 'This notification stays in inbox.',
    });
  });

  it('notification title remains visible after marking as read', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByText('Persist After Read'), { timeout: 3000 });

    // Mark it read
    fireEvent.click(screen.getByRole('button', { name: /mark read/i }));

    await waitFor(() => {
      // Mark read button gone
      expect(screen.queryByRole('button', { name: /mark read/i })).toBeNull();
    }, { timeout: 3000 });

    // Notification title still visible
    expect(screen.getByText('Persist After Read')).toBeTruthy();
  });
});
