<script>
  import { onMount } from 'svelte';
  import Router from './app/router/Router.svelte';
  import Sidebar from './app/components/Sidebar.svelte';
  import { isAuthenticated, isGuest, isLocked, currentRole, currentUser, syncAuthStores, clearAuthStores } from './app/stores/auth.js';
  import { toast, isLoading, restoreColumnLayouts, clearUserLayoutPreferences, navigate, showToast, tableColumnLayouts } from './app/stores/ui.js';
  import { restoreSelectedStore, persistSelectedStore, clearOrgPreferences, selectedStore, orgTree } from './app/stores/org.js';
  import { authService } from './services/AuthService.js';
  import { bootstrapService } from './services/BootstrapService.js';
  import { seedService } from './services/SeedService.js';
  import { schedulerService } from './services/SchedulerService.js';
  import { notificationService } from './services/NotificationService.js';
  import { ticketService } from './services/TicketService.js';
  import { riskReviewService } from './services/RiskReviewService.js';
  import { nlpService } from './services/NLPService.js';
  import { OrgRepository } from './repositories/implementations/OrgRepository.js';
  import { initDB } from './infrastructure/db/db.js';
  import { subscribe as subscribeBroadcast, CHANNEL_NAMES, EVENT_TYPES as BC_EVENTS } from './infrastructure/broadcast/broadcastManager.js';

  async function seedOrgTree(orgNodeId) {
    try {
      const repo = new OrgRepository();
      const node = await repo.findById(orgNodeId);
      if (node) orgTree.set([node]);
    } catch { /* ignore */ }
  }

  let dbReady = false;
  let dbError = null;

  // Lock screen state
  let unlockPassword = '';
  let unlockError = '';
  let unlockLoading = false;

  // Track the last user ID for whom we restored preferences.
  let _prefsRestoredFor = null;

  // Restore user-scoped preferences and seed org context when user changes.
  $: if ($currentUser?.id && $currentUser.id !== _prefsRestoredFor) {
    _prefsRestoredFor = $currentUser.id;
    restoreColumnLayouts($currentUser.id);
    const restored = restoreSelectedStore($currentUser.id);
    selectedStore.set(restored ?? null);
    // Seed the orgTree with the user's own node so resolveOrgContext works
    // even before the full tree is loaded (non-admin users may never load it).
    if ($currentUser.organizationNodeId && $orgTree.length === 0) {
      seedOrgTree($currentUser.organizationNodeId);
    }
  }

  // Auto-persist selectedStore changes to LocalStorage (user-scoped).
  $: if ($currentUser?.id && $selectedStore) {
    persistSelectedStore($selectedStore, $currentUser.id);
  }

  onMount(async () => {
    // Phase 1: DB init + bootstrap check — failures here are fatal (app can't run).
    try {
      await initDB();
      dbReady = true;

      // First-run: auto-seed demo accounts so testers can skip the bootstrap UI.
      const bootstrapped = await bootstrapService.isBootstrapped();
      if (!bootstrapped) {
        try {
          await seedService.seedDemoAccounts();
        } catch (seedErr) {
          console.warn('[App] Auto-seed failed, falling back to manual bootstrap:', seedErr?.message);
          navigate('/bootstrap');
          return;
        }
      }
      // Always land on login if no session is active.
      navigate('/login');
    } catch (err) {
      dbError = err.message;
      console.error('[App] Startup error:', err.message);
      return;
    }

    // Phase 2: Background scheduler — failures here are non-fatal; app still works.
    try {
      schedulerService.registerTask('queue_check', () => notificationService.processDueItems(), 30_000);
      schedulerService.registerTask('overdue_check', () => ticketService.evaluateOverdue(), 5 * 60_000);
      await schedulerService.start();
    } catch (err) {
      console.warn('[App] Scheduler startup error (non-fatal):', err?.message || 'Unknown error');
    }

    // Phase 3: Subscribe to broadcast state changes so auto-lock and cross-tab
    // events propagate to Svelte stores immediately.
    subscribeBroadcast(CHANNEL_NAMES.STATE, (event) => {
      if (event.type === BC_EVENTS.SESSION_LOCKED) {
        syncAuthStores(authService);
      } else if (event.type === BC_EVENTS.SESSION_LOGGED_OUT) {
        clearAuthStores();
      } else if (event.type === BC_EVENTS.SESSION_UNLOCKED) {
        syncAuthStores(authService);
      }
    });
  });

  // Handle inactivity — reset timer on any user interaction.
  function onActivity() {
    if ($isAuthenticated) {
      authService.resetInactivityTimer();
    }
  }

  // Unlock the session from the lock screen.
  async function handleUnlock() {
    unlockError = '';
    unlockLoading = true;
    try {
      const ok = await authService.unlockSession(unlockPassword);
      if (ok) {
        unlockPassword = '';
        syncAuthStores(authService);
      } else {
        unlockError = 'Incorrect password. Try again.';
      }
    } catch (err) {
      // Too many failed attempts → forced logout.
      unlockError = err.message;
      clearAuthStores();
      navigate('/login');
    } finally {
      unlockLoading = false;
    }
  }

  // Logout.
  async function handleLogout() {
    const uid = $currentUser?.id;
    await authService.logout();
    riskReviewService.clearDictionary();
    nlpService._f1ThresholdOverride = null;
    // Clear user-scoped LocalStorage preferences on logout to prevent
    // cross-user state leakage when another user logs in on the same device.
    if (uid) {
      clearUserLayoutPreferences(uid);
      clearOrgPreferences(uid);
    }
    selectedStore.set(null);
    orgTree.set([]);
    tableColumnLayouts.set({});
    clearAuthStores();
    _prefsRestoredFor = null;
    navigate('/login');
  }
</script>

<svelte:window on:click={onActivity} on:keydown={onActivity} />

{#if dbError}
  <div class="db-error">
    <h2>Database Error</h2>
    <p>{dbError}</p>
    <button on:click={() => window.location.reload()}>Reload</button>
  </div>
{:else if !dbReady}
  <div class="startup-screen">
    <p>Initializing…</p>
  </div>
{:else}
  <div class="app-shell">
    <!-- Global loading overlay -->
    {#if $isLoading}
      <div class="loading-overlay">
        <div class="spinner"></div>
      </div>
    {/if}

    <!-- Toast notifications -->
    {#if $toast}
      <div class="toast toast--{$toast.type}">
        {$toast.message}
      </div>
    {/if}

    <!-- Lock screen — overlays everything when session is locked -->
    {#if $isLocked}
      <div class="lock-screen" role="dialog" aria-modal="true" aria-label="Session locked">
        <div class="lock-card">
          <div class="lock-icon" aria-hidden="true">🔒</div>
          <h2>Session Locked</h2>
          <p>Enter your password to unlock.</p>
          {#if unlockError}
            <div class="lock-error">{unlockError}</div>
          {/if}
          <form on:submit|preventDefault={handleUnlock}>
            <input
              type="password"
              placeholder="Password"
              bind:value={unlockPassword}
              autocomplete="current-password"
              disabled={unlockLoading}
            />
            <button type="submit" disabled={unlockLoading || !unlockPassword}>
              {unlockLoading ? 'Unlocking…' : 'Unlock'}
            </button>
          </form>
          <button class="lock-logout" on:click={handleLogout}>
            Log out instead
          </button>
        </div>
      </div>
    {/if}

    <!-- Sidebar navigation — visible when authenticated or guest -->
    <Sidebar
      on:lock={() => { authService.lockSession(); syncAuthStores(authService); }}
      on:logout={handleLogout}
    />

    <main class="content" class:content--no-nav={!($isAuthenticated || $isGuest)}>
      <Router />
    </main>
  </div>
{/if}

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #1a1a1a; }
  :global(button) { cursor: pointer; }

  .db-error, .startup-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    gap: 1rem;
  }

  .app-shell {
    display: flex;
    min-height: 100vh;
    position: relative;
  }

  /* ── Sidebar ── */
  .sidebar {
    width: 200px;
    background: #1e293b;
    color: #e2e8f0;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex-shrink: 0;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
  }

  .logo {
    font-weight: 700;
    font-size: 1.125rem;
    padding: 0.5rem 0;
    margin-bottom: 0.75rem;
    color: #fff;
  }

  .sidebar-spacer { flex: 1; }

  .sidebar-user {
    padding: 0.5rem 0.75rem;
    border-top: 1px solid #334155;
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .sidebar-username { font-size: 0.8rem; color: #fff; font-weight: 500; }
  .sidebar-role { font-size: 0.7rem; color: #94a3b8; text-transform: capitalize; }

  .sidebar-lock, .sidebar-logout {
    width: 100%;
    padding: 0.4rem 0.75rem;
    border-radius: 4px;
    font-size: 0.8rem;
    border: 1px solid #475569;
    background: transparent;
    color: #94a3b8;
    text-align: left;
    margin-top: 0.25rem;
  }
  .sidebar-lock:hover, .sidebar-logout:hover { background: #334155; color: #fff; }

  /* ── Main content ── */
  .content {
    flex: 1;
    overflow: auto;
    min-height: 100vh;
  }
  .content--no-nav { width: 100%; }

  /* ── Lock screen ── */
  .lock-screen {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.92);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }
  .lock-card {
    background: #fff;
    border-radius: 12px;
    padding: 2.5rem;
    width: 100%;
    max-width: 380px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  }
  .lock-icon { font-size: 2.5rem; margin-bottom: 0.75rem; }
  .lock-card h2 { font-size: 1.375rem; margin-bottom: 0.5rem; }
  .lock-card p { color: #64748b; font-size: 0.875rem; margin-bottom: 1.25rem; }
  .lock-error {
    background: #fee2e2;
    color: #991b1b;
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
    margin-bottom: 0.75rem;
  }
  .lock-card form { display: flex; flex-direction: column; gap: 0.75rem; }
  .lock-card input {
    padding: 0.625rem 0.875rem;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 1rem;
    width: 100%;
  }
  .lock-card button[type="submit"] {
    padding: 0.625rem;
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 0.9rem;
  }
  .lock-card button[type="submit"]:disabled { opacity: 0.5; }
  .lock-logout {
    margin-top: 0.75rem;
    background: none;
    border: none;
    color: #64748b;
    font-size: 0.8rem;
    text-decoration: underline;
  }

  /* ── Loading overlay ── */
  .loading-overlay {
    position: fixed;
    inset: 0;
    background: rgba(255,255,255,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #ddd;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Toast ── */
  .toast {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    padding: 0.75rem 1.25rem;
    border-radius: 6px;
    z-index: 999;
    font-size: 0.875rem;
    max-width: 360px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  }
  .toast--success { background: #dcfce7; color: #166534; }
  .toast--error { background: #fee2e2; color: #991b1b; }
  .toast--info { background: #dbeafe; color: #1e40af; }
  .toast--warning { background: #fef9c3; color: #854d0e; }
</style>
