<script>
  import { orderService } from '../services/OrderService.js';
  import { customerService } from '../services/CustomerService.js';
  import { currentUser } from '../app/stores/auth.js';
  import { orgTree, resolveOrgContext } from '../app/stores/org.js';
  import { showToast, tableColumnLayouts } from '../app/stores/ui.js';
  import { ORDER_STATUSES, ORDER_TRANSITIONS } from '../utils/constants.js';
  import Table from '../components/Table.svelte';

  const statuses = Object.values(ORDER_STATUSES);

  const ORDER_COLUMNS = [
    { key: 'id', label: 'Order ID', sortable: true },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'customerId', label: 'Customer', sortable: true },
    { key: 'createdAt', label: 'Created', sortable: true },
  ];

  let orders = [];
  let selectedOrder = null;
  let orderEvents = [];
  let filterStatus = '';

  $: orderHiddenColumns = (() => {
    const saved = $tableColumnLayouts['orders'];
    if (!saved) return [];
    return ORDER_COLUMNS.filter((c) => !saved.includes(c.key)).map((c) => c.key);
  })();

  $: userId = $currentUser?.id ?? '';

  // New order form
  let showNewForm = false;
  let newCustomerId = '';
  let newItemDesc = '';
  let formError = '';
  let formLoading = false;

  // Transition
  let transitionLoading = false;

  $: actorId = $currentUser?.id ?? '';
  $: orgCtx = resolveOrgContext($currentUser, $orgTree);
  $: organizationId = orgCtx.organizationId;
  $: storeId = orgCtx.storeId;

  $: filteredOrders = orders.filter((o) => !filterStatus || o.status === filterStatus);

  $: if (storeId) loadOrders();

  async function loadOrders() {
    if (!storeId) return;
    try {
      orders = await orderService.getByStore(storeId);
    } catch (err) {
      showToast('error', err.message);
    }
  }

  async function selectOrder(o) {
    try {
      const detail = await orderService.getOrderDetail(o.id);
      selectedOrder = detail.order;
      orderEvents = detail.events;
    } catch (err) {
      showToast('error', err.message);
    }
  }

  async function handleCreate() {
    formError = '';
    formLoading = true;
    try {
      const created = await orderService.createOrder({
        customerId: newCustomerId.trim(),
        organizationId,
        storeId,
        items: newItemDesc.trim() ? [{ description: newItemDesc.trim() }] : [],
        actorId,
      });
      orders = [...orders, created];
      showNewForm = false;
      newCustomerId = '';
      newItemDesc = '';
      showToast('success', 'Order created.');
    } catch (err) {
      formError = err.message;
    } finally {
      formLoading = false;
    }
  }

  async function handleTransition(newStatus) {
    if (!selectedOrder) return;
    transitionLoading = true;
    try {
      const updated = await orderService.transitionOrder(selectedOrder.id, newStatus, actorId);
      orders = orders.map((o) => (o.id === updated.id ? updated : o));
      selectedOrder = updated;
      // Refresh events
      const detail = await orderService.getOrderDetail(updated.id);
      orderEvents = detail.events;
      showToast('success', `Order moved to ${newStatus}.`);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      transitionLoading = false;
    }
  }

  function allowedTransitions(order) {
    return ORDER_TRANSITIONS.get(order.status) ?? [];
  }

  function statusColor(status) {
    const map = {
      draft: '#f1f5f9',
      placed: '#dbeafe',
      in_progress: '#fef3c7',
      ready: '#dcfce7',
      completed: '#bbf7d0',
      canceled: '#fee2e2',
    };
    return map[status] ?? '#f1f5f9';
  }

  function formatDate(ms) {
    return ms ? new Date(ms).toLocaleString() : '—';
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>Orders</h2>
    <div class="header-actions">
      <label class="filter-label">
        Status
        <select bind:value={filterStatus} class="filter-select">
          <option value="">All</option>
          {#each statuses as s}<option value={s}>{s}</option>{/each}
        </select>
      </label>
      <button class="btn-primary" on:click={() => { showNewForm = true; formError = ''; }}>+ New Order</button>
    </div>
  </header>

  <div class="layout">
    <!-- Order list -->
    <aside class="order-list">
      <Table
        columns={ORDER_COLUMNS}
        rows={filteredOrders}
        empty="No orders."
        hiddenColumns={orderHiddenColumns}
        tableKey="orders"
        {userId}
      >
        <span slot="cell" let:row let:col>
          {#if col.key === 'id'}
            <button class="order-link" class:selected={selectedOrder?.id === row.id} on:click={() => selectOrder(row)}>
              {row.id.slice(0, 8)}…
            </button>
          {:else if col.key === 'status'}
            <span class="status-badge" style="background:{statusColor(row.status)}">{row.status}</span>
          {:else if col.key === 'createdAt'}
            {formatDate(row.createdAt)}
          {:else}
            {row[col.key] ?? '—'}
          {/if}
        </span>
      </Table>
    </aside>

    <!-- Order detail -->
    <main class="order-detail">
      {#if !selectedOrder}
        <div class="empty-state">Select an order to view details.</div>
      {:else}
        <div class="detail-header">
          <div>
            <h3>Order <code>{selectedOrder.id.slice(0, 12)}…</code></h3>
            <span class="status-badge" style="background:{statusColor(selectedOrder.status)}">{selectedOrder.status}</span>
          </div>
        </div>

        <div class="info-grid">
          <div class="info-item"><span class="info-label">Customer</span><span>{selectedOrder.customerId}</span></div>
          <div class="info-item"><span class="info-label">Created</span><span>{formatDate(selectedOrder.createdAt)}</span></div>
        </div>

        {#if selectedOrder.restrictionFlags?.hasAllergies || selectedOrder.restrictionFlags?.hasMaterialRestrictions}
          <div class="restriction-alert">
            ⚠ Customer has restriction flags:
            {#if selectedOrder.restrictionFlags.hasAllergies}Allergies{/if}
            {#if selectedOrder.restrictionFlags.hasAllergies && selectedOrder.restrictionFlags.hasMaterialRestrictions}, {/if}
            {#if selectedOrder.restrictionFlags.hasMaterialRestrictions}Material Restrictions{/if}
          </div>
        {/if}

        <!-- Items -->
        {#if selectedOrder.items?.length > 0}
          <div class="items-section">
            <h4>Items</h4>
            <ul class="items-list">
              {#each selectedOrder.items as item}
                <li>{item.description ?? JSON.stringify(item)}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- Transitions -->
        {#if allowedTransitions(selectedOrder).length > 0}
          <div class="transitions">
            <h4>Advance Order</h4>
            <div class="transition-buttons">
              {#each allowedTransitions(selectedOrder) as next}
                <button
                  class="transition-btn"
                  class:btn-danger={next === 'canceled'}
                  class:btn-primary={next !== 'canceled'}
                  on:click={() => handleTransition(next)}
                  disabled={transitionLoading}
                >
                  → {next}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Event log -->
        <div class="events-section">
          <h4>Event Log</h4>
          {#if orderEvents.length === 0}
            <p class="empty-hint">No events.</p>
          {:else}
            <div class="event-list">
              {#each [...orderEvents].sort((a, b) => b.createdAt - a.createdAt) as ev}
                <div class="event-row">
                  <span class="event-type">{ev.type}</span>
                  <span class="event-meta">
                    {#if ev.metadata?.from}→ {ev.metadata.from} → {ev.metadata.to}{/if}
                  </span>
                  <span class="event-time">{formatDate(ev.createdAt)}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </main>
  </div>
</div>

<!-- New order modal -->
{#if showNewForm}
  <div class="modal-overlay" role="presentation" on:click={() => showNewForm = false} on:keydown={(e) => { if (e.key === 'Escape') showNewForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>New Order</h3>
      {#if formError}<div class="form-error">{formError}</div>{/if}
      <label>Customer ID
        <input type="text" bind:value={newCustomerId} placeholder="Customer ID" />
      </label>
      <label>Item Description (optional)
        <input type="text" bind:value={newItemDesc} placeholder="e.g. Blue shirt XL" />
      </label>
      <div class="modal-actions">
        <button on:click={() => showNewForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleCreate} disabled={formLoading || !newCustomerId.trim()}>
          {formLoading ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 1.5rem; height: 100%; display: flex; flex-direction: column; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  h2, h3, h4 { margin: 0 0 0.5rem; }
  .header-actions { display: flex; align-items: center; gap: 1rem; }
  .filter-label { font-size: 0.875rem; display: flex; align-items: center; gap: 0.4rem; }
  .filter-select { padding: 0.25rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; }
  .layout { display: grid; grid-template-columns: 260px 1fr; gap: 1rem; flex: 1; min-height: 0; }
  .order-list { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 0.75rem; overflow-y: auto; }
  .order-link { background: none; border: none; cursor: pointer; font-family: monospace; font-size: 0.8rem; color: #2563eb; padding: 0; text-decoration: underline; }
  .order-link.selected { font-weight: 700; }
  .status-badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .restriction-flag { color: #d97706; font-size: 0.9rem; }
  .order-detail { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 1.5rem; overflow-y: auto; }
  .empty-state { display: flex; align-items: center; justify-content: center; height: 200px; color: #888; }
  .detail-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1rem; }
  .info-item { display: flex; flex-direction: column; gap: 0.1rem; }
  .info-label { font-size: 0.7rem; color: #888; text-transform: uppercase; }
  .restriction-alert { background: #fef3c7; border: 1px solid #fde68a; color: #92400e; padding: 0.5rem 0.75rem; border-radius: 4px; font-size: 0.875rem; margin-bottom: 1rem; }
  .items-section, .transitions, .events-section { margin-top: 1rem; }
  .items-list { list-style: disc; padding-left: 1.5rem; font-size: 0.875rem; }
  .transition-buttons { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .transition-btn { padding: 0.4rem 0.75rem; border-radius: 4px; border: 1px solid #ddd; cursor: pointer; font-size: 0.875rem; }
  .event-list { display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.5rem; }
  .event-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.4rem 0.75rem; background: #f8fafc; border-radius: 4px; font-size: 0.8rem; }
  .event-type { font-weight: 500; min-width: 120px; }
  .event-meta { flex: 1; color: #64748b; }
  .event-time { color: #94a3b8; font-size: 0.75rem; }
  .empty-hint { color: #888; font-size: 0.875rem; font-style: italic; }
  .btn-primary { background: #2563eb; color: #fff; border: none; border-radius: 4px; padding: 0.4rem 0.75rem; cursor: pointer; font-size: 0.875rem; }
  .btn-danger { background: #dc2626; color: #fff; border: none; border-radius: 4px; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: #fff; border-radius: 8px; padding: 2rem; width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 0.75rem; }
  .modal h3 { margin: 0 0 0.5rem; }
  .modal label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 500; }
  .modal input { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .modal button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .form-error { background: #fee2e2; color: #991b1b; border-radius: 4px; padding: 0.5rem 0.75rem; font-size: 0.8rem; }
  code { font-family: monospace; font-size: 0.85em; }
  @media (max-width: 768px) {
    .layout { grid-template-columns: 1fr; }
    .info-grid { grid-template-columns: 1fr; }
    .page { padding: 0.75rem; }
    .modal { max-width: 95vw; }
  }
</style>
