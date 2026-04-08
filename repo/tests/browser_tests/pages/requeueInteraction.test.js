/**
 * Draft Requeue — interaction-driven test.
 *
 * Simulates:
 *   1. Admin creates a template with a required placeholder
 *   2. Enqueues a notification with missing placeholder → creates Draft
 *   3. Navigates to queue tab
 *   4. Clicks "Requeue" button on Draft item
 *   5. Modal opens — user edits JSON with correct variable
 *   6. Submits → success toast + item transitions to Queued
 *
 * All assertions go through rendered UI, NOT direct service calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../../src/infrastructure/db/db.js';
import { authService } from '../../../src/services/AuthService.js';
import { cryptoService } from '../../../src/services/CryptoService.js';
import { notificationService } from '../../../src/services/NotificationService.js';
import { templateService } from '../../../src/services/TemplateService.js';
import { BootstrapService } from '../../../src/services/BootstrapService.js';
import { currentUser } from '../../../src/app/stores/auth.js';
import { orgTree } from '../../../src/app/stores/org.js';
import { toast } from '../../../src/app/stores/ui.js';
import { get } from 'svelte/store';
import {
  setBroadcastService,
  closeAll,
} from '../../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../../src/infrastructure/broadcast/MockBroadcastService.js';
import { OrgRepository } from '../../../src/repositories/implementations/OrgRepository.js';
import MessagesPage from '../../../src/pages/MessagesPage.svelte';

const ADMIN_PASS = 'Requeue@1234';
let adminUser, orgId, templateId;

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  const result = await bs.bootstrap({
    adminUsername: 'rq_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'RequeueCo',
  });
  adminUser = result.admin;
  orgId = result.org.id;

  await authService.login('rq_admin', ADMIN_PASS);
  await authService.unlockProtectedData(ADMIN_PASS);
  currentUser.set(authService._currentUser);


  // Create a template that requires {greeting} placeholder
  const tpl = await templateService.createTemplate({
    organizationId: orgId,
    name: 'Welcome Template',
    body: 'Hello {greeting}, welcome!',
    isCompact: false,
    actorId: adminUser.id,
  });
  templateId = tpl.id;

  // Create a channel for the enqueue
  await notificationService.upsertChannel({ organizationId: orgId, name: 'in-app' });

  // Enqueue with missing {greeting} → creates Draft
  await notificationService.enqueue({
    organizationId: orgId,
    recipientUserId: adminUser.id,
    templateId,
    channelId: 'in-app',
    vars: {},  // missing {greeting}
    eventSourceKey: 'test-draft-1',
  });
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  currentUser.set(null);

  toast.set(null);
  closeDB();
  closeAll();
});

describe('Draft Requeue — full interaction flow', () => {
  it('user clicks Requeue, edits JSON, submits, sees success feedback', async () => {
    render(MessagesPage);

    // Step 1: Navigate to queue tab
    const queueTab = screen.getByRole('button', { name: /queue/i });
    await fireEvent.click(queueTab);

    // Step 2: Wait for Draft item to appear
    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeTruthy();
    }, { timeout: 5000 });

    // Step 3: Click "Requeue" button
    const requeueBtn = screen.getByRole('button', { name: /^requeue$/i });
    expect(requeueBtn).toBeTruthy();
    await fireEvent.click(requeueBtn);

    // Step 4: Modal opens — verify it's visible
    await waitFor(() => {
      expect(screen.getByText('Requeue Draft')).toBeTruthy();
      expect(screen.getByText(/edit template variables/i)).toBeTruthy();
    }, { timeout: 2000 });

    // Step 5: Edit JSON in textarea — add the missing {greeting} variable
    const textarea = screen.getByRole('textbox');
    await fireEvent.input(textarea, {
      target: { value: JSON.stringify({ greeting: 'World' }) },
    });

    // Step 6: Click the modal's Requeue button to submit
    const submitBtns = screen.getAllByRole('button', { name: /^requeue$/i });
    const modalSubmit = submitBtns.find((b) => b.closest('[role="dialog"]'));
    expect(modalSubmit).toBeTruthy();
    await fireEvent.click(modalSubmit);

    // Step 7: Verify success — modal closes and toast shows
    await waitFor(() => {
      // Modal should be gone
      expect(screen.queryByText('Requeue Draft')).toBeNull();
    }, { timeout: 5000 });

    // Verify the toast was shown
    const toastVal = get(toast);
    expect(toastVal).toBeTruthy();
    expect(toastVal.type).toBe('success');
    expect(toastVal.message).toMatch(/requeued/i);

    // Step 8: Verify queue updated — item status changed to Queued
    await waitFor(() => {
      expect(screen.getByText('Queued')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^requeue$/i })).toBeNull();
    }, { timeout: 5000 });
  });

  it('shows error when user submits invalid JSON', async () => {
    render(MessagesPage);

    // Navigate to queue tab
    await fireEvent.click(screen.getByRole('button', { name: /queue/i }));
    await waitFor(() => screen.getByText('Draft'), { timeout: 5000 });

    // Open modal
    await fireEvent.click(screen.getByRole('button', { name: /^requeue$/i }));
    await waitFor(() => screen.getByText('Requeue Draft'), { timeout: 2000 });

    // Enter invalid JSON
    const textarea = screen.getByRole('textbox');
    await fireEvent.input(textarea, { target: { value: '{not valid json' } });

    // Submit
    const submitBtns = screen.getAllByRole('button', { name: /^requeue$/i });
    const modalSubmit = submitBtns.find((b) => b.closest('[role="dialog"]'));
    await fireEvent.click(modalSubmit);

    // Verify error shown
    await waitFor(() => {
      expect(screen.getByText(/invalid json/i)).toBeTruthy();
    }, { timeout: 2000 });

    // Modal should still be open
    expect(screen.getByText('Requeue Draft')).toBeTruthy();
  });

  it('requeue calls service layer (not bypassed)', async () => {
    const spy = vi.spyOn(notificationService, 'requeueDraft');

    render(MessagesPage);
    await fireEvent.click(screen.getByRole('button', { name: /queue/i }));
    await waitFor(() => screen.getByText('Draft'), { timeout: 5000 });

    await fireEvent.click(screen.getByRole('button', { name: /^requeue$/i }));
    await waitFor(() => screen.getByText('Requeue Draft'), { timeout: 2000 });

    const textarea = screen.getByRole('textbox');
    await fireEvent.input(textarea, {
      target: { value: JSON.stringify({ greeting: 'Test' }) },
    });

    const submitBtns = screen.getAllByRole('button', { name: /^requeue$/i });
    const modalSubmit = submitBtns.find((b) => b.closest('[role="dialog"]'));
    await fireEvent.click(modalSubmit);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1]).toEqual({ greeting: 'Test' });
    }, { timeout: 5000 });

    spy.mockRestore();
  });

  it('cancel button closes modal without requeuing', async () => {
    render(MessagesPage);
    await fireEvent.click(screen.getByRole('button', { name: /queue/i }));
    await waitFor(() => screen.getByText('Draft'), { timeout: 5000 });

    await fireEvent.click(screen.getByRole('button', { name: /^requeue$/i }));
    await waitFor(() => screen.getByText('Requeue Draft'), { timeout: 2000 });

    // Click Cancel
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText('Requeue Draft')).toBeNull();
    }, { timeout: 2000 });

    // Draft should still be in the list
    expect(screen.getByText('Draft')).toBeTruthy();
  });
});
