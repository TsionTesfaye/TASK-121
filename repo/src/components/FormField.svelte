<script>
  /** @type {string} */
  export let label;
  /** @type {string} */
  export let id;
  /** @type {string} [error] */
  export let error = '';
  /** @type {string} [hint] */
  export let hint = '';
  /** @type {boolean} */
  export let required = false;
</script>

<div class="field" class:field--error={!!error}>
  <label for={id} class="field__label">
    {label}{#if required}<span class="required" aria-hidden="true">*</span>{/if}
  </label>

  <slot />

  {#if error}
    <p class="field__error" role="alert" id="{id}-error">{error}</p>
  {:else if hint}
    <p class="field__hint" id="{id}-hint">{hint}</p>
  {/if}
</div>

<style>
  .field { display: flex; flex-direction: column; gap: 4px; }

  .field__label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
  }

  .required { color: #ef4444; margin-left: 2px; }

  .field__error { font-size: 0.75rem; color: #dc2626; margin: 0; }
  .field__hint  { font-size: 0.75rem; color: #6b7280; margin: 0; }

  .field--error :global(input),
  .field--error :global(select),
  .field--error :global(textarea) {
    border-color: #ef4444;
  }
</style>
