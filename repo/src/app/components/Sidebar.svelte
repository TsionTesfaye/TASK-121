<script>
  import { createEventDispatcher } from 'svelte';
  import {
    isAuthenticated,
    isGuest,
    isLocked,
    currentRole,
    currentUser,
  } from '../stores/auth.js';
  import { currentPath } from '../stores/ui.js';
  import { selectedStore, storeNodes, persistSelectedStore } from '../stores/org.js';
  import { ROLE_ROUTES } from '../router/routes.js';

  const dispatch = createEventDispatcher();

  function handleStoreChange(e) {
    const storeId = e.target.value;
    const store = $storeNodes.find((s) => s.id === storeId) ?? null;
    persistSelectedStore(store, $currentUser?.id);
  }

  const NAV_LABELS = {
    '/crm': 'CRM',
    '/orders': 'Orders',
    '/tickets': 'Tickets',
    '/master-data': 'Master Data',
    '/messages': 'Messages',
    '/nlp': 'NLP Analysis',
    '/risk-review': 'Risk Review',
    '/org-setup': 'Org Setup',
    '/admin': 'Admin',
  };

  $: allowedRoutes = (() => {
    const role = $currentRole ?? ($isGuest ? 'guest' : null);
    if (!role) return [];
    return [...(ROLE_ROUTES[role] ?? [])].filter((r) => NAV_LABELS[r]);
  })();
</script>

{#if ($isAuthenticated || $isGuest) && !$isLocked}
  <nav class="sidebar" aria-label="Main navigation">
    <div class="logo">RetailOps</div>

    {#each allowedRoutes as route}
      <a
        href="#{route}"
        class:active={$currentPath === route}
        aria-current={$currentPath === route ? 'page' : undefined}
      >
        {NAV_LABELS[route]}
      </a>
    {/each}

    <div class="sidebar-spacer"></div>

    {#if $storeNodes.length > 0}
      <div class="sidebar-store-selector">
        <label class="store-label">Store
          <select class="store-select" value={$selectedStore?.id ?? ''} on:change={handleStoreChange}>
            <option value="">— Default —</option>
            {#each $storeNodes as s}
              <option value={s.id}>{s.name}</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}

    {#if $currentUser}
      <div class="sidebar-user">
        <span class="sidebar-username">{$currentUser.username ?? 'Guest'}</span>
        <span class="sidebar-role">{$currentRole}</span>
      </div>
    {/if}

    <button class="sidebar-lock" on:click={() => dispatch('lock')}>Lock</button>
    <button class="sidebar-logout" on:click={() => dispatch('logout')}>Log out</button>
  </nav>
{/if}

<style>
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
  .logo { font-weight: 700; font-size: 1.125rem; padding: 0.5rem 0; margin-bottom: 0.75rem; color: #fff; }
  .sidebar a { display: block; padding: 0.5rem 0.75rem; border-radius: 4px; color: #cbd5e1; text-decoration: none; font-size: 0.875rem; }
  .sidebar a:hover { background: #334155; color: #fff; }
  .sidebar a.active { background: #2563eb; color: #fff; }
  .sidebar-spacer { flex: 1; }
  .sidebar-store-selector { padding: 0.5rem 0.75rem; border-top: 1px solid #334155; margin-top: 0.25rem; }
  .store-label { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; display: flex; flex-direction: column; gap: 0.2rem; }
  .store-select { width: 100%; padding: 0.3rem; background: #334155; color: #e2e8f0; border: 1px solid #475569; border-radius: 4px; font-size: 0.75rem; }
  .sidebar-user { padding: 0.5rem 0.75rem; border-top: 1px solid #334155; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.1rem; }
  .sidebar-username { font-size: 0.8rem; color: #fff; font-weight: 500; }
  .sidebar-role { font-size: 0.7rem; color: #94a3b8; text-transform: capitalize; }
  .sidebar-lock, .sidebar-logout {
    width: 100%; padding: 0.4rem 0.75rem; border-radius: 4px; font-size: 0.8rem;
    border: 1px solid #475569; background: transparent; color: #94a3b8; text-align: left; margin-top: 0.25rem; cursor: pointer;
  }
  .sidebar-lock:hover, .sidebar-logout:hover { background: #334155; color: #fff; }
</style>
