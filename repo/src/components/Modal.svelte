<script>
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  /** @type {boolean} */
  export let open = false;
  /** @type {string} */
  export let title = '';
  /** @type {'sm'|'md'|'lg'} */
  export let size = 'md';

  let dialogEl;

  function close() {
    dispatch('close');
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && open) close();
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) close();
  }

  $: if (open && dialogEl) {
    // Move focus into the dialog so screen readers announce it.
    dialogEl.focus();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
  <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title" on:click={handleBackdropClick}>
    <div
      class="dialog dialog--{size}"
      bind:this={dialogEl}
      tabindex="-1"
    >
      <div class="dialog__header">
        <h2 class="dialog__title" id="modal-title">{title}</h2>
        <button class="dialog__close" on:click={close} aria-label="Close dialog">×</button>
      </div>

      <div class="dialog__body">
        <slot />
      </div>

      {#if $$slots.footer}
        <div class="dialog__footer">
          <slot name="footer" />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 500;
    padding: 1rem;
  }

  .dialog {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.25);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 2rem);
    width: 100%;
    outline: none;
  }

  .dialog--sm { max-width: 400px; }
  .dialog--md { max-width: 560px; }
  .dialog--lg { max-width: 720px; }

  .dialog__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
  }

  .dialog__title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #0f172a;
  }

  .dialog__close {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.25rem;
    color: #94a3b8;
    padding: 0 4px;
    line-height: 1;
    border-radius: 4px;
    transition: color 0.1s, background 0.1s;
  }

  .dialog__close:hover { color: #0f172a; background: #f1f5f9; }

  .dialog__body {
    padding: 1.25rem;
    overflow-y: auto;
    flex: 1;
  }

  .dialog__footer {
    padding: 1rem 1.25rem;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-shrink: 0;
  }
</style>
