<script>
  import { onMount } from 'svelte';
  import { bootstrapService } from '../services/BootstrapService.js';
  import { authService } from '../services/AuthService.js';
  import { syncAuthStores } from '../app/stores/auth.js';
  import { navigate, showToast, isLoading } from '../app/stores/ui.js';

  let adminUsername = '';
  let adminPassword = '';
  let orgName = '';
  let error = '';
  let ready = false;

  onMount(async () => {
    try {
      const bootstrapped = await bootstrapService.isBootstrapped();
      if (bootstrapped) {
        navigate('/login');
        return;
      }
    } catch { /* DB not ready yet — allow form */ }
    ready = true;
  });

  async function handleBootstrap() {
    error = '';
    isLoading.set(true);
    try {
      await bootstrapService.bootstrap({ adminUsername, adminPassword, orgName });
      showToast('success', 'System initialized. Please sign in with your new administrator account.');
      navigate('/login');
    } catch (err) {
      error = err.message;
    } finally {
      isLoading.set(false);
    }
  }
</script>

{#if ready}
<div class="bootstrap-page">
  <div class="bootstrap-card">
    <div class="card-header">
      <h1>RetailOps Console</h1>
      <p class="subtitle">First-time setup — create your administrator account</p>
    </div>

    {#if error}
      <div class="error-banner" role="alert">{error}</div>
    {/if}

    <form on:submit|preventDefault={handleBootstrap} novalidate>
      <div class="form-section">
        <h2 class="section-title">Organization</h2>
        <div class="field">
          <label for="orgName">Company name</label>
          <input
            id="orgName"
            type="text"
            bind:value={orgName}
            placeholder="e.g. Acme Retail Group"
            autocomplete="organization"
            required
          />
        </div>
      </div>

      <div class="form-section">
        <h2 class="section-title">Administrator account</h2>
        <div class="field">
          <label for="adminUsername">Username</label>
          <input
            id="adminUsername"
            type="text"
            bind:value={adminUsername}
            placeholder="admin"
            autocomplete="username"
            required
          />
        </div>
        <div class="field">
          <label for="adminPassword">Password</label>
          <input
            id="adminPassword"
            type="password"
            bind:value={adminPassword}
            autocomplete="new-password"
            required
          />
          <p class="hint">Min. 12 characters, at least one number and one symbol.</p>
        </div>
      </div>

      <button type="submit" class="submit-btn">Initialize System</button>
    </form>

    <p class="footer-note">
      This screen is only shown once. After initialization, it will not be accessible again
      without resetting the database.
    </p>
  </div>
</div>
{/if}

<style>
  .bootstrap-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: #f1f5f9;
    padding: 2rem;
  }

  .bootstrap-card {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 4px 16px rgba(0,0,0,0.08);
    padding: 2.5rem;
    width: 100%;
    max-width: 480px;
  }

  .card-header { margin-bottom: 2rem; }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    font-weight: 700;
    color: #0f172a;
  }

  .subtitle {
    margin: 0;
    font-size: 0.875rem;
    color: #64748b;
  }

  .error-banner {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    margin-bottom: 1.5rem;
    font-size: 0.875rem;
  }

  .form-section {
    margin-bottom: 1.5rem;
  }

  .section-title {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #64748b;
    margin: 0 0 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #e2e8f0;
  }

  .field {
    margin-bottom: 1rem;
  }

  label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
    margin-bottom: 0.375rem;
  }

  input {
    display: block;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.9375rem;
    color: #111827;
    background: #fff;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  input:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37,99,235,0.12);
  }

  .hint {
    margin: 0.375rem 0 0;
    font-size: 0.75rem;
    color: #6b7280;
  }

  .submit-btn {
    width: 100%;
    padding: 0.625rem 1rem;
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    margin-top: 0.5rem;
    transition: background 0.15s;
  }

  .submit-btn:hover { background: #1d4ed8; }
  .submit-btn:active { background: #1e40af; }

  .footer-note {
    margin: 1.5rem 0 0;
    font-size: 0.75rem;
    color: #94a3b8;
    text-align: center;
    line-height: 1.5;
  }
</style>
