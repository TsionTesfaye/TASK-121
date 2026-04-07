<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';

  const dispatch = createEventDispatcher();

  /** @type {boolean} */
  export let open = false;
  /** @type {string} */
  export let title = '';
  /** @type {'sm'|'md'|'lg'} */
  export let size = 'md';

  function close() {
    dispatch('close');
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && open) close();
  }

  onMount(() => { window.addEventListener('keydown', handleKeydown); });
  onDestroy(() => { window.removeEventListener('keydown', handleKeydown); });
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
  <div class="overlay" on:click|self={close} aria-hidden="true"></div>
  <aside
    class="drawer drawer--{size}"
    role="complementary"
    aria-label={title}
    tabindex="-1"
  >
    <div class="drawer__header">
      <h2 class="drawer__title">{title}</h2>
      <button class="drawer__close" on:click={close} aria-label="Close panel">×</button>
    </div>

    <div class="drawer__body">
      <slot />
    </div>

    {#if $$slots.footer}
      <div class="drawer__footer">
        <slot name="footer" />
      </div>
    {/if}
  </aside>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(15,23,42,0.4);
    z-index: 400;
  }

  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    height: 100%;
    background: #fff;
    box-shadow: -4px 0 24px rgba(0,0,0,0.12);
    z-index: 401;
    display: flex;
    flex-direction: column;
    outline: none;
  }

  .drawer--sm { width: 320px; }
  .drawer--md { width: 480px; }
  .drawer--lg { width: 640px; }

  .drawer__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
  }

  .drawer__title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #0f172a;
  }

  .drawer__close {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.25rem;
    color: #94a3b8;
    padding: 0 4px;
    border-radius: 4px;
    line-height: 1;
    transition: color 0.1s, background 0.1s;
  }

  .drawer__close:hover { color: #0f172a; background: #f1f5f9; }

  .drawer__body {
    padding: 1.25rem;
    overflow-y: auto;
    flex: 1;
  }

  .drawer__footer {
    padding: 1rem 1.25rem;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-shrink: 0;
  }
</style>
