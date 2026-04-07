<script>
  /** @type {string} */
  export let message = 'No items yet.';
  /** @type {string} [action] Label for the CTA button. */
  export let action = '';
</script>

<div class="empty-state" role="status">
  <div class="empty-state__icon" aria-hidden="true">○</div>
  <p class="empty-state__message">{message}</p>
  {#if action}
    <slot name="action" />
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 2rem;
    gap: 0.75rem;
    color: #94a3b8;
  }

  .empty-state__icon {
    font-size: 2rem;
    line-height: 1;
  }

  .empty-state__message {
    margin: 0;
    font-size: 0.9375rem;
    text-align: center;
  }
</style>
