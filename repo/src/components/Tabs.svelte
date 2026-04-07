<script>
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  /**
   * @type {Array<{ key: string; label: string; disabled?: boolean }>}
   */
  export let tabs = [];

  /** @type {string} Currently active tab key. */
  export let active = '';

  function select(key) {
    const tab = tabs.find((t) => t.key === key);
    if (tab?.disabled) return;
    if (active !== key) {
      active = key;
      dispatch('change', { key });
    }
  }

  function handleKeydown(e, key) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(key);
    }
  }
</script>

<div class="tabs" role="tablist" aria-label="Navigation tabs">
  {#each tabs as tab (tab.key)}
    <button
      class="tab"
      class:tab--active={active === tab.key}
      role="tab"
      aria-selected={active === tab.key}
      aria-disabled={tab.disabled ?? false}
      disabled={tab.disabled}
      tabindex={active === tab.key ? 0 : -1}
      on:click={() => select(tab.key)}
      on:keydown={(e) => handleKeydown(e, tab.key)}
    >
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    border-bottom: 1px solid #e2e8f0;
    gap: 0;
  }

  .tab {
    padding: 0.625rem 1rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    color: #64748b;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }

  .tab:hover:not(:disabled) { color: #1e293b; }

  .tab--active {
    color: #2563eb;
    border-bottom-color: #2563eb;
  }

  .tab:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
