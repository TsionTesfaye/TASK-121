<script>
  /** @type {string} */
  export let title;
  /** @type {string} [description] */
  export let description = '';
</script>

<header class="page-header">
  <div class="page-header__text">
    <h1 class="page-header__title">{title}</h1>
    {#if description}
      <p class="page-header__desc">{description}</p>
    {/if}
  </div>
  {#if $$slots.actions}
    <div class="page-header__actions">
      <slot name="actions" />
    </div>
  {/if}
</header>

<style>
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.5rem 1.5rem 0;
    margin-bottom: 1.5rem;
  }

  .page-header__title {
    margin: 0 0 0.25rem;
    font-size: 1.375rem;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.3;
  }

  .page-header__desc {
    margin: 0;
    font-size: 0.875rem;
    color: #64748b;
  }

  .page-header__actions {
    display: flex;
    gap: 0.5rem;
    flex-shrink: 0;
    align-items: center;
  }
</style>
