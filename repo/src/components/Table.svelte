<script>
  import { createEventDispatcher } from 'svelte';
  import { saveColumnLayout } from '../app/stores/ui.js';

  /**
   * Generic data table component with column visibility toggle.
   *
   * Props:
   *   columns       - Array<{ key: string; label: string; sortable?: boolean; width?: string }>
   *   rows          - Array<object>  (each object must have a unique `id` field)
   *   loading       - boolean
   *   empty         - string (message shown when rows.length === 0 and !loading)
   *   hiddenColumns - string[]  (keys of columns to hide)
   *   tableKey      - string (identifier for layout persistence, e.g. 'orders')
   *   userId        - string (current user ID for scoped layout persistence)
   */

  /** @type {Array<{ key: string; label: string; sortable?: boolean; width?: string }>} */
  export let columns = [];

  /** @type {object[]} */
  export let rows = [];

  /** @type {boolean} */
  export let loading = false;

  /** @type {string} */
  export let empty = 'No records found.';

  /** @type {string[]} */
  export let hiddenColumns = [];

  /** @type {string} */
  export let tableKey = '';

  /** @type {string} */
  export let userId = '';

  const dispatch = createEventDispatcher();

  let sortKey = '';
  let sortDir = 'asc'; // 'asc' | 'desc'
  let showColumnMenu = false;

  function toggleSort(key) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  function toggleColumn(key) {
    if (hiddenColumns.includes(key)) {
      hiddenColumns = hiddenColumns.filter((k) => k !== key);
    } else {
      hiddenColumns = [...hiddenColumns, key];
    }
    const vis = columns.filter((c) => !hiddenColumns.includes(c.key)).map((c) => c.key);
    if (tableKey) {
      saveColumnLayout(tableKey, vis, userId);
    }
    dispatch('layoutchange', { tableKey, visibleColumns: vis });
  }

  $: visibleColumns = columns.filter((c) => !hiddenColumns.includes(c.key));

  $: sortedRows = sortKey
    ? [...rows].sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : rows;
</script>

<div class="table-wrap" role="region" aria-label="Data table">
  {#if tableKey}
    <div class="table-toolbar">
      <button class="column-toggle-btn" on:click={() => showColumnMenu = !showColumnMenu} aria-label="Toggle columns">
        Columns
      </button>
      {#if showColumnMenu}
        <div class="column-menu" role="menu" aria-label="Column visibility">
          {#each columns as col (col.key)}
            <label class="column-menu-item">
              <input
                type="checkbox"
                checked={!hiddenColumns.includes(col.key)}
                on:change={() => toggleColumn(col.key)}
              />
              {col.label}
            </label>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
  <table class="table">
    <thead>
      <tr>
        {#each visibleColumns as col (col.key)}
          <th
            class="th"
            style={col.width ? `width:${col.width}` : ''}
            aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
          >
            {#if col.sortable}
              <button class="sort-btn" on:click={() => toggleSort(col.key)}>
                {col.label}
                <span class="sort-icon" aria-hidden="true">
                  {sortKey === col.key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                </span>
              </button>
            {:else}
              {col.label}
            {/if}
          </th>
        {/each}
        <!-- Slot for action column header -->
        {#if $$slots.actions}
          <th class="th th--actions"><span class="sr-only">Actions</span></th>
        {/if}
      </tr>
    </thead>
    <tbody>
      {#if loading}
        <tr>
          <td colspan={visibleColumns.length + ($$slots.actions ? 1 : 0)} class="td td--center">
            <span class="spinner" aria-label="Loading"></span>
          </td>
        </tr>
      {:else if sortedRows.length === 0}
        <tr>
          <td colspan={visibleColumns.length + ($$slots.actions ? 1 : 0)} class="td td--empty">
            {empty}
          </td>
        </tr>
      {:else}
        {#each sortedRows as row (row.id)}
          <tr class="tr">
            {#each visibleColumns as col (col.key)}
              <td class="td">
                <slot name="cell" {row} {col}>
                  {row[col.key] ?? '—'}
                </slot>
              </td>
            {/each}
            {#if $$slots.actions}
              <td class="td td--actions">
                <slot name="actions" {row} />
              </td>
            {/if}
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

<style>
  .table-wrap {
    width: 100%;
    overflow-x: auto;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    position: relative;
  }

  .table-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 0.5rem 0.75rem;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    position: relative;
  }

  .column-toggle-btn {
    background: #fff;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    padding: 0.25rem 0.6rem;
    font-size: 0.75rem;
    cursor: pointer;
    color: #374151;
  }
  .column-toggle-btn:hover { background: #f3f4f6; }

  .column-menu {
    position: absolute;
    right: 0.75rem;
    top: 100%;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    padding: 0.5rem;
    z-index: 20;
    min-width: 160px;
  }

  .column-menu-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.4rem;
    font-size: 0.8rem;
    cursor: pointer;
    border-radius: 3px;
  }
  .column-menu-item:hover { background: #f1f5f9; }

  .table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  .th {
    padding: 0.625rem 0.75rem;
    text-align: left;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    white-space: nowrap;
  }

  .th--actions { width: 1%; }

  .sort-btn {
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
    padding: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .sort-btn:hover { color: #1e293b; }

  .sort-icon { opacity: 0.5; }

  .tr:hover { background: #f8fafc; }

  .td {
    padding: 0.625rem 0.75rem;
    border-bottom: 1px solid #f1f5f9;
    color: #1e293b;
    vertical-align: middle;
  }

  .tr:last-child .td { border-bottom: none; }

  .td--center { text-align: center; padding: 2rem; }
  .td--empty  { text-align: center; color: #94a3b8; padding: 2.5rem; }
  .td--actions { white-space: nowrap; text-align: right; }

  .spinner {
    display: inline-block;
    width: 24px;
    height: 24px;
    border: 2px solid #e2e8f0;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .sr-only {
    position: absolute; width: 1px; height: 1px;
    padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0,0,0,0); border: 0;
  }
</style>
