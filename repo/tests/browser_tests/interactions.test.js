/**
 * Browser tests — UI interactions: modal open/submit, file upload, lock/unlock.
 *
 * Covers:
 *   - Modal opens on button click
 *   - Modal submit button disabled with empty inputs
 *   - Modal submit button enabled with valid inputs
 *   - Modal closes on Cancel click
 *   - File upload input renders and accepts text files
 *   - Import button disabled until all fields filled
 *   - Lock button renders for authenticated user
 *   - Lock button dispatches lock event
 *   - Log out button renders for authenticated user
 *   - Log out button dispatches logout event
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, closeDB } from '../../src/infrastructure/db/db.js';
import { authService } from '../../src/services/AuthService.js';
import { cryptoService } from '../../src/services/CryptoService.js';
import { BootstrapService } from '../../src/services/BootstrapService.js';
import {
  currentUser,
  isAuthenticated,
  isLocked,
  isGuest,
  clearAuthStores,
} from '../../src/app/stores/auth.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';

import MessagesPage from '../../src/pages/MessagesPage.svelte';
import NLPPage from '../../src/pages/NLPPage.svelte';
import OrgSetupPage from '../../src/pages/OrgSetupPage.svelte';
import Sidebar from '../../src/app/components/Sidebar.svelte';

const ADMIN_PASS = 'Interact@1234';

beforeEach(async () => {
  setBroadcastService(new MockBroadcastService());
  await initDB(new IDBFactory());

  const bs = new BootstrapService();
  await bs.bootstrap({
    adminUsername: 'interact_admin',
    adminPassword: ADMIN_PASS,
    orgName: 'InteractCo',
  });

  await authService.login('interact_admin', ADMIN_PASS);
    await authService.unlockProtectedData(ADMIN_PASS);
  currentUser.set(authService._currentUser);
  isAuthenticated.set(true);
  isLocked.set(false);
  isGuest.set(false);
});

afterEach(() => {
  cryptoService.clearSessionKey();
  authService._currentUser = null;
  clearAuthStores();
  closeDB();
  closeAll();
});

// ── Modal open / submit ───────────────────────────────────────────────────────

describe('Interactions — modal open/close', () => {
  it('clicking "+ New Template" opens the template modal', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByRole('button', { name: /templates/i }));
    fireEvent.click(screen.getByRole('button', { name: /templates/i }));
    await waitFor(() => screen.getByText('+ New Template'), { timeout: 2000 });

    fireEvent.click(screen.getByText('+ New Template'));

    await waitFor(() => {
      expect(screen.getByText('New Template')).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('Create button disabled in empty template modal', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByRole('button', { name: /templates/i }));
    fireEvent.click(screen.getByRole('button', { name: /templates/i }));
    await waitFor(() => screen.getByText('+ New Template'), { timeout: 2000 });
    fireEvent.click(screen.getByText('+ New Template'));

    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /^create$/i });
      expect(btns.some((b) => b.disabled)).toBe(true);
    }, { timeout: 2000 });
  });

  it('Create button enables when name and body are filled', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByRole('button', { name: /templates/i }));
    fireEvent.click(screen.getByRole('button', { name: /templates/i }));
    await waitFor(() => screen.getByText('+ New Template'), { timeout: 2000 });
    fireEvent.click(screen.getByText('+ New Template'));
    await waitFor(() => screen.getByText('New Template'), { timeout: 2000 });

    // Name input is first textbox, body textarea is second
    const inputs = screen.getAllByRole('textbox');
    await fireEvent.input(inputs[0], { target: { value: 'My Template' } });
    await fireEvent.input(inputs[1], { target: { value: 'Hello {name}, your order is ready.' } });

    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /^create$/i });
      expect(btns.some((b) => !b.disabled)).toBe(true);
    }, { timeout: 1000 });
  });

  it('Cancel button closes the template modal', async () => {
    render(MessagesPage);
    await waitFor(() => screen.getByRole('button', { name: /templates/i }));
    fireEvent.click(screen.getByRole('button', { name: /templates/i }));
    await waitFor(() => screen.getByText('+ New Template'), { timeout: 2000 });
    fireEvent.click(screen.getByText('+ New Template'));
    await waitFor(() => screen.getByText('New Template'), { timeout: 2000 });

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByText('New Template')).toBeNull();
    }, { timeout: 1000 });
  });

  it('clicking "+ Add Node" opens "Add Organization Node" modal', async () => {
    render(OrgSetupPage);
    await waitFor(() => screen.getByText('+ Add Node'), { timeout: 3000 });
    fireEvent.click(screen.getByText('+ Add Node'));

    await waitFor(() => {
      expect(screen.getByText('Add Organization Node')).toBeTruthy();
    }, { timeout: 2000 });
  });
});

// ── File upload ───────────────────────────────────────────────────────────────

describe('Interactions — file upload', () => {
  it('Import Text modal contains a file upload input', async () => {
    render(NLPPage);
    await waitFor(() => screen.getByText('Import Text'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Import Text'));

    await waitFor(() => {
      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('file input has an accept attribute for text file types', async () => {
    render(NLPPage);
    await waitFor(() => screen.getByText('Import Text'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Import Text'));

    await waitFor(() => {
      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toBeTruthy();
      expect(fileInput?.getAttribute('accept')).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('Import button disabled when source type, filename, and text are empty', async () => {
    render(NLPPage);
    await waitFor(() => screen.getByText('Import Text'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Import Text'));

    await waitFor(() => {
      const importBtn = screen.getByRole('button', { name: /^import$/i });
      expect(importBtn).toBeDisabled();
    }, { timeout: 2000 });
  });

  it('Import button enables after filling source type, filename, and text', async () => {
    render(NLPPage);
    await waitFor(() => screen.getByText('Import Text'), { timeout: 3000 });
    fireEvent.click(screen.getByText('Import Text'));
    await waitFor(() => screen.getByRole('button', { name: /^import$/i }), { timeout: 2000 });

    // Modal has three required text inputs: source type, filename, and a textarea
    const sourceTypeInput = screen.getByPlaceholderText(/customer_note/i);
    const filenameInput = screen.getByPlaceholderText(/notes_2024/i);
    const textarea = screen.getByPlaceholderText(/paste or type/i);

    await fireEvent.input(sourceTypeInput, { target: { value: 'customer_note' } });
    await fireEvent.input(filenameInput, { target: { value: 'sample.txt' } });
    await fireEvent.input(textarea, { target: { value: 'Sample text content for NLP analysis.' } });

    await waitFor(() => {
      const importBtn = screen.getByRole('button', { name: /^import$/i });
      expect(importBtn).not.toBeDisabled();
    }, { timeout: 1000 });
  });
});

// ── Lock / unlock flow ────────────────────────────────────────────────────────

describe('Interactions — lock/unlock flow', () => {
  it('Sidebar renders Lock button for authenticated user', () => {
    render(Sidebar);
    expect(screen.getByRole('button', { name: /^lock$/i })).toBeTruthy();
  });

  it('Lock button dispatches lock event', async () => {
    let lockFired = false;
    const { component } = render(Sidebar);
    component.$on('lock', () => { lockFired = true; });

    const lockBtn = screen.getByRole('button', { name: /^lock$/i });
    await fireEvent.click(lockBtn);

    expect(lockFired).toBe(true);
  });

  it('Sidebar renders Log out button for authenticated user', () => {
    render(Sidebar);
    expect(screen.getByRole('button', { name: /^log out$/i })).toBeTruthy();
  });

  it('Log out button dispatches logout event', async () => {
    let logoutFired = false;
    const { component } = render(Sidebar);
    component.$on('logout', () => { logoutFired = true; });

    const logoutBtn = screen.getByRole('button', { name: /^log out$/i });
    await fireEvent.click(logoutBtn);

    expect(logoutFired).toBe(true);
  });

  it('Sidebar hides nav when session is locked', () => {
    isLocked.set(true);
    render(Sidebar);
    expect(screen.queryByText('CRM')).toBeNull();
    expect(screen.queryByRole('button', { name: /^lock$/i })).toBeNull();
  });

  it('Sidebar shows nav when session is unlocked', () => {
    isLocked.set(false);
    render(Sidebar);
    expect(screen.getByText('CRM')).toBeTruthy();
  });
});
