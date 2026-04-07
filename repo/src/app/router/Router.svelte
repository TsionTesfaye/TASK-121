<script>
  import { onMount, onDestroy } from 'svelte';
  import { routes, DEFAULT_ROUTE } from './routes.js';
  import { resolveAccess } from './accessControl.js';
  import { currentPath, navigate } from '../stores/ui.js';
  import { isAuthenticated, isGuest, currentRole } from '../stores/auth.js';

  let CurrentPage = null;

  function resolvePageComponent(path, authenticated, guest, role) {
    const { allowed, redirectTo } = resolveAccess(path, authenticated, guest, role);
    if (!allowed) {
      navigate(redirectTo);
      return routes[redirectTo] ?? routes[DEFAULT_ROUTE];
    }
    return routes[path] ?? routes[DEFAULT_ROUTE];
  }

  function onHashChange() {
    const path = window.location.hash.slice(1) || DEFAULT_ROUTE;
    currentPath.set(path);
  }

  onMount(() => {
    onHashChange();
    window.addEventListener('hashchange', onHashChange);
  });

  onDestroy(() => {
    window.removeEventListener('hashchange', onHashChange);
  });

  $: CurrentPage = resolvePageComponent($currentPath, $isAuthenticated, $isGuest, $currentRole);
</script>

{#if CurrentPage}
  <svelte:component this={CurrentPage} />
{:else}
  <div style="display:flex;align-items:center;justify-content:center;height:100vh;">
    <p>Loading…</p>
  </div>
{/if}
