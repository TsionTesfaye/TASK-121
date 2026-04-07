<script>
  import { authService } from '../services/AuthService.js';
  import { cryptoService } from '../services/CryptoService.js';
  import { riskReviewService } from '../services/RiskReviewService.js';
  import { nlpService } from '../services/NLPService.js';
  import { syncAuthStores, clearAuthStores } from '../app/stores/auth.js';
  import { selectedStore, orgTree } from '../app/stores/org.js';
  import { navigate, showToast, isLoading, tableColumnLayouts } from '../app/stores/ui.js';

  let username = '';
  let password = '';
  let error = '';

  /**
   * Clears ALL session state before a new login.
   * Prevents cross-user data leakage when switching accounts
   * without going through the normal logout flow.
   */
  async function cleanupBeforeLogin() {
    if (authService.isAuthenticated() || authService.isGuest()) {
      await authService.logout();
    }
    cryptoService.clearSessionKey();
    riskReviewService.clearDictionary();
    nlpService._f1ThresholdOverride = null;
    selectedStore.set(null);
    orgTree.set([]);
    tableColumnLayouts.set({});
    clearAuthStores();
  }

  async function handleLogin() {
    error = '';
    isLoading.set(true);
    try {
      await cleanupBeforeLogin();
      await authService.login(username, password);
      syncAuthStores(authService);
      navigate('/crm');
    } catch (err) {
      error = err.message;
    } finally {
      isLoading.set(false);
    }
  }

  async function handleGuestLogin() {
    await cleanupBeforeLogin();
    await authService.createGuestSession((reason) => {
      showToast('info', reason);
      navigate('/login');
    });
    syncAuthStores(authService);
    navigate('/crm');
  }
</script>

<div class="login-page">
  <div class="login-card">
    <h1>RetailOps Console</h1>
    <p class="subtitle">Offline Insight & Compliance</p>

    {#if error}
      <div class="error-banner">{error}</div>
    {/if}

    <form on:submit|preventDefault={handleLogin}>
      <label>
        Username
        <input type="text" bind:value={username} autocomplete="username" required />
      </label>
      <label>
        Password
        <input type="password" bind:value={password} autocomplete="current-password" required />
      </label>
      <button type="submit">Sign In</button>
    </form>

    <button class="guest-btn" on:click={handleGuestLogin}>
      Continue as Guest (30-min read-only)
    </button>
  </div>
</div>

<style>
  .login-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: #f5f5f5;
  }
  .login-card {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    padding: 2.5rem;
    width: 100%;
    max-width: 400px;
  }
  h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
  .subtitle { color: #666; margin: 0 0 1.5rem; font-size: 0.875rem; }
  .error-banner { background: #fee; border: 1px solid #fcc; color: #c00; border-radius: 4px; padding: 0.75rem; margin-bottom: 1rem; font-size: 0.875rem; }
  label { display: block; margin-bottom: 1rem; font-size: 0.875rem; font-weight: 500; }
  input { display: block; width: 100%; margin-top: 0.25rem; padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem; }
  button[type="submit"] { width: 100%; padding: 0.75rem; background: #2563eb; color: #fff; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; margin-top: 0.5rem; }
  button[type="submit"]:hover { background: #1d4ed8; }
  .guest-btn { display: block; width: 100%; margin-top: 0.75rem; padding: 0.5rem; background: none; border: 1px solid #ddd; border-radius: 4px; color: #666; cursor: pointer; font-size: 0.875rem; }
  .guest-btn:hover { background: #f5f5f5; }
</style>
