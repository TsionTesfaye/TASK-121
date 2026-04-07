<script>
  import { onDestroy } from 'svelte';
  import { ticketService } from '../services/TicketService.js';
  import { currentUser, currentRole } from '../app/stores/auth.js';
  import { orgTree, resolveOrgContext } from '../app/stores/org.js';
  import { showToast } from '../app/stores/ui.js';
  import {
    TICKET_STATUSES,
    TICKET_PRIORITIES,
    ROLES,
  } from '../utils/constants.js';

  const TRANSITIONS = new Map([
    [TICKET_STATUSES.OPEN,        [TICKET_STATUSES.IN_PROGRESS, TICKET_STATUSES.CLOSED]],
    [TICKET_STATUSES.IN_PROGRESS, [TICKET_STATUSES.RESOLVED,    TICKET_STATUSES.CLOSED]],
    [TICKET_STATUSES.RESOLVED,    [TICKET_STATUSES.CLOSED]],
    [TICKET_STATUSES.CLOSED,      []],
  ]);

  const priorities = Object.values(TICKET_PRIORITIES);
  const allStatuses = Object.values(TICKET_STATUSES);
  const categories = ['general', 'returns', 'billing', 'shipping', 'technical', 'other'];

  let tickets = [];
  let selectedTicket = null;
  let ticketEvents = [];
  let loading = false;
  let filterStatus = '';

  // Create form
  let showCreateModal = false;
  let newSubject = '';
  let newDescription = '';
  let newCategory = 'general';
  let newPriority = TICKET_PRIORITIES.MEDIUM;
  let newCustomerId = '';
  let createError = '';
  let createLoading = false;

  // Action states
  let assignLoading = false;
  let transitionTarget = '';
  let transitionLoading = false;
  let transitionComment = '';

  // SLA timer — ticks every minute to keep countdown reactive
  let now = Date.now();
  const timer = setInterval(() => { now = Date.now(); }, 60_000);
  onDestroy(() => clearInterval(timer));

  $: actorId = $currentUser?.id ?? '';
  $: orgCtx = resolveOrgContext($currentUser, $orgTree);
  $: organizationId = orgCtx.organizationId;
  $: orgId = orgCtx.storeId;
  $: canManage = $currentRole === ROLES.ADMINISTRATOR || $currentRole === ROLES.STORE_MANAGER;

  $: filteredTickets = tickets.filter((t) => !filterStatus || t.status === filterStatus);
  $: allowedTransitions = selectedTicket ? (TRANSITIONS.get(selectedTicket.status) ?? []) : [];

  $: if (orgId) loadTickets();

  async function loadTickets() {
    if (!orgId) return;
    loading = true;
    try {
      tickets = await ticketService.getByStore(orgId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      loading = false;
    }
  }

  async function selectTicket(t) {
    selectedTicket = t;
    ticketEvents = [];
    transitionTarget = '';
    transitionComment = '';
    try {
      const detail = await ticketService.getTicketDetail(t.id);
      selectedTicket = detail.ticket;
      ticketEvents = detail.events;
    } catch (err) {
      showToast('error', err.message);
    }
  }

  async function handleCreate() {
    createError = '';
    createLoading = true;
    try {
      const created = await ticketService.createTicket({
        customerId: newCustomerId.trim() || null,
        organizationId,
        storeId: orgId,
        subject: newSubject,
        description: newDescription,
        category: newCategory,
        priority: newPriority,
        actorId,
      });
      tickets = [...tickets, created];
      showCreateModal = false;
      newSubject = ''; newDescription = ''; newCustomerId = '';
      newCategory = 'general'; newPriority = TICKET_PRIORITIES.MEDIUM;
      showToast('success', 'Ticket created.');
    } catch (err) {
      createError = err.message;
    } finally {
      createLoading = false;
    }
  }

  async function handleAssign() {
    if (!selectedTicket) return;
    assignLoading = true;
    try {
      const updated = await ticketService.assignTicket(selectedTicket.id, actorId, actorId);
      tickets = tickets.map((t) => (t.id === updated.id ? updated : t));
      selectedTicket = updated;
      showToast('success', 'Ticket assigned to you.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      assignLoading = false;
    }
  }

  async function handleTransition() {
    if (!selectedTicket || !transitionTarget) return;
    transitionLoading = true;
    try {
      const updated = await ticketService.transitionTicket(
        selectedTicket.id,
        transitionTarget,
        actorId,
        transitionComment || undefined,
      );
      tickets = tickets.map((t) => (t.id === updated.id ? updated : t));
      selectedTicket = updated;
      transitionTarget = '';
      transitionComment = '';
      showToast('success', `Ticket moved to ${updated.status}.`);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      transitionLoading = false;
    }
  }

  function formatSLA(slaDueAt) {
    if (!slaDueAt) return '—';
    const remaining = slaDueAt - now;
    if (remaining <= 0) return 'OVERDUE';
    const hours = Math.floor(remaining / 3_600_000);
    const mins  = Math.floor((remaining % 3_600_000) / 60_000);
    return `${hours}h ${mins}m`;
  }

  function slaClass(t) {
    if (!t.slaDueAt) return '';
    const remaining = t.slaDueAt - now;
    if (t.isOverdue || remaining <= 0) return 'sla--overdue';
    if (remaining < 4 * 3_600_000) return 'sla--warning';
    return 'sla--ok';
  }

  function statusClass(status) {
    if (status === TICKET_STATUSES.OPEN)        return 'badge--open';
    if (status === TICKET_STATUSES.IN_PROGRESS) return 'badge--inprogress';
    if (status === TICKET_STATUSES.RESOLVED)    return 'badge--resolved';
    return 'badge--closed';
  }

  function formatDate(ms) {
    return ms ? new Date(ms).toLocaleString() : '—';
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>Ticket Management</h2>
    {#if canManage}
      <button class="btn-primary" on:click={() => { showCreateModal = true; createError = ''; }}>
        + New Ticket
      </button>
    {/if}
  </header>

  <div class="toolbar">
    <label class="filter-label">
      Status
      <select bind:value={filterStatus}>
        <option value="">All</option>
        {#each allStatuses as s}<option value={s}>{s}</option>{/each}
      </select>
    </label>
    <button class="btn-secondary" on:click={loadTickets} disabled={loading}>Refresh</button>
    <span class="ticket-count">{filteredTickets.length} ticket{filteredTickets.length !== 1 ? 's' : ''}</span>
  </div>

  <div class="layout">
    <!-- Ticket list -->
    <aside class="ticket-list">
      {#if loading}
        <p class="loading-hint">Loading…</p>
      {:else if filteredTickets.length === 0}
        <p class="empty-hint">No tickets.</p>
      {:else}
        {#each filteredTickets as t}
          <button
            class="ticket-row"
            class:selected={selectedTicket?.id === t.id}
            on:click={() => selectTicket(t)}
          >
            <div class="ticket-row-top">
              <span class="ticket-subject">{t.subject}</span>
              <span class="badge {statusClass(t.status)}">{t.status}</span>
            </div>
            <div class="ticket-row-meta">
              <span class="priority-tag priority--{t.priority}">{t.priority}</span>
              <span class="sla-tag {slaClass(t)}">SLA: {formatSLA(t.slaDueAt)}</span>
            </div>
          </button>
        {/each}
      {/if}
    </aside>

    <!-- Ticket detail -->
    <main class="ticket-detail">
      {#if !selectedTicket}
        <div class="empty-state">Select a ticket to view details and actions.</div>
      {:else}
        <div class="detail-header">
          <div>
            <h3>{selectedTicket.subject}</h3>
            <div class="detail-badges">
              <span class="badge {statusClass(selectedTicket.status)}">{selectedTicket.status}</span>
              <span class="priority-tag priority--{selectedTicket.priority}">{selectedTicket.priority}</span>
              {#if selectedTicket.isOverdue}
                <span class="badge badge--overdue">OVERDUE</span>
              {/if}
            </div>
          </div>
        </div>

        <div class="info-grid">
          <div class="info-item"><span class="info-label">Category</span>{selectedTicket.category}</div>
          <div class="info-item"><span class="info-label">Customer ID</span><code>{selectedTicket.customerId}</code></div>
          <div class="info-item"><span class="info-label">Created</span>{formatDate(selectedTicket.createdAt)}</div>
          <div class="info-item"><span class="info-label">SLA Due</span>
            <span class="{slaClass(selectedTicket)}">{formatSLA(selectedTicket.slaDueAt)}</span>
          </div>
          {#if selectedTicket.assignedTo}
            <div class="info-item"><span class="info-label">Assigned To</span><code>{selectedTicket.assignedTo}</code></div>
          {/if}
          {#if selectedTicket.resolvedAt}
            <div class="info-item"><span class="info-label">Resolved</span>{formatDate(selectedTicket.resolvedAt)}</div>
          {/if}
        </div>

        <div class="description-box">
          <p class="info-label">Description</p>
          <p class="description-text">{selectedTicket.description}</p>
        </div>

        <!-- Actions — store_manager / admin only -->
        {#if canManage && selectedTicket.status !== TICKET_STATUSES.CLOSED}
          <div class="action-panel">
            <h4>Actions</h4>

            {#if !selectedTicket.assignedTo}
              <button class="btn-primary" on:click={handleAssign} disabled={assignLoading}>
                {assignLoading ? 'Assigning…' : 'Assign to Me'}
              </button>
            {:else if selectedTicket.assignedTo !== actorId}
              <div class="info-item"><span class="info-label">Currently assigned to</span> <code>{selectedTicket.assignedTo}</code></div>
              <button class="btn-secondary" on:click={handleAssign} disabled={assignLoading}>
                {assignLoading ? 'Reassigning…' : 'Reassign to Me'}
              </button>
            {/if}

            {#if allowedTransitions.length > 0}
              <div class="transition-form">
                <label>
                  Move to Status
                  <select bind:value={transitionTarget}>
                    <option value="">— choose —</option>
                    {#each allowedTransitions as t}<option value={t}>{t}</option>{/each}
                  </select>
                </label>
                <label>
                  Comment (optional)
                  <input type="text" bind:value={transitionComment} placeholder="Reason or note…" />
                </label>
                <button
                  class="btn-primary"
                  on:click={handleTransition}
                  disabled={transitionLoading || !transitionTarget}
                >
                  {transitionLoading ? 'Updating…' : 'Apply Transition'}
                </button>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Event history -->
        {#if ticketEvents.length > 0}
          <div class="event-history">
            <h4>History</h4>
            <ol class="event-list">
              {#each ticketEvents as ev}
                <li class="event-item">
                  <span class="event-type">{ev.type}</span>
                  <span class="event-actor">by <code>{ev.actorId}</code></span>
                  <span class="event-time">{formatDate(ev.createdAt)}</span>
                  {#if ev.comment}<span class="event-comment">{ev.comment}</span>{/if}
                </li>
              {/each}
            </ol>
          </div>
        {/if}
      {/if}
    </main>
  </div>
</div>

<!-- Create ticket modal -->
{#if showCreateModal}
  <div
    class="modal-overlay"
    role="presentation"
    on:click={() => showCreateModal = false}
    on:keydown={(e) => { if (e.key === 'Escape') showCreateModal = false; }}
  >
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-ticket-title"
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <h3 id="create-ticket-title">New Support Ticket</h3>
      {#if createError}<div class="form-error">{createError}</div>{/if}

      <label>Subject <input type="text" bind:value={newSubject} placeholder="Brief summary of the issue" /></label>
      <label>
        Description
        <textarea bind:value={newDescription} rows="4" placeholder="Describe the issue in detail…"></textarea>
      </label>
      <div class="modal-row">
        <label>
          Category
          <select bind:value={newCategory}>
            {#each categories as c}<option value={c}>{c}</option>{/each}
          </select>
        </label>
        <label>
          Priority
          <select bind:value={newPriority}>
            {#each priorities as p}<option value={p}>{p}</option>{/each}
          </select>
        </label>
      </div>
      <label>Customer ID (optional) <input type="text" bind:value={newCustomerId} placeholder="cust-uuid or leave blank" /></label>

      <div class="modal-actions">
        <button on:click={() => showCreateModal = false}>Cancel</button>
        <button
          class="btn-primary"
          on:click={handleCreate}
          disabled={createLoading || !newSubject.trim() || !newDescription.trim()}
        >
          {createLoading ? 'Creating…' : 'Create Ticket'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 1.5rem; height: 100%; display: flex; flex-direction: column; gap: 0.75rem; }
  .page-header { display: flex; align-items: center; justify-content: space-between; }
  h2, h3, h4 { margin: 0 0 0.5rem; }
  .toolbar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
  .filter-label { display: flex; align-items: center; gap: 0.4rem; font-size: 0.875rem; font-weight: 500; }
  .filter-label select { padding: 0.25rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; }
  .ticket-count { font-size: 0.8rem; color: #64748b; margin-left: auto; }
  .layout { display: grid; grid-template-columns: 320px 1fr; gap: 1rem; flex: 1; min-height: 0; }
  .ticket-list { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 0.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.25rem; }
  .ticket-row { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.6rem 0.75rem; border-radius: 4px; border: 1px solid transparent; cursor: pointer; background: #fff; text-align: left; }
  .ticket-row:hover { background: #f1f5f9; }
  .ticket-row.selected { background: #eff6ff; border-color: #bfdbfe; }
  .ticket-row-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; }
  .ticket-subject { font-weight: 500; font-size: 0.875rem; flex: 1; }
  .ticket-row-meta { display: flex; gap: 0.5rem; align-items: center; }
  .badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; white-space: nowrap; }
  .badge--open        { background: #fef3c7; color: #b45309; }
  .badge--inprogress  { background: #dbeafe; color: #1d4ed8; }
  .badge--resolved    { background: #dcfce7; color: #166534; }
  .badge--closed      { background: #f1f5f9; color: #475569; }
  .badge--overdue     { background: #fee2e2; color: #dc2626; }
  .priority-tag { font-size: 0.7rem; font-weight: 600; padding: 0.1rem 0.4rem; border-radius: 3px; }
  .priority--low    { background: #f0fdf4; color: #166534; }
  .priority--medium { background: #fefce8; color: #854d0e; }
  .priority--high   { background: #fff1f2; color: #be123c; }
  .sla-tag { font-size: 0.7rem; font-weight: 500; }
  .sla--ok      { color: #166534; }
  .sla--warning { color: #b45309; }
  .sla--overdue { color: #dc2626; font-weight: 700; }
  .ticket-detail { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 1.5rem; overflow-y: auto; }
  .empty-state { display: flex; align-items: center; justify-content: center; height: 200px; color: #888; font-size: 0.875rem; }
  .detail-header { margin-bottom: 1rem; }
  .detail-badges { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.35rem; flex-wrap: wrap; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1rem; margin-bottom: 1rem; }
  .info-item { display: flex; flex-direction: column; gap: 0.1rem; font-size: 0.875rem; }
  .info-label { font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 0.03em; }
  code { font-family: monospace; font-size: 0.85em; }
  .description-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 0.75rem; margin-bottom: 1rem; }
  .description-text { margin: 0.25rem 0 0; font-size: 0.875rem; color: #374151; white-space: pre-wrap; }
  .action-panel { border-top: 1px solid #e2e8f0; padding-top: 1rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .transition-form { display: flex; flex-direction: column; gap: 0.5rem; }
  label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.875rem; font-weight: 500; }
  select, input[type=text], textarea { padding: 0.45rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; font-family: inherit; }
  textarea { resize: vertical; }
  .event-history { margin-top: 1.5rem; border-top: 1px solid #e2e8f0; padding-top: 1rem; }
  .event-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .event-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: #475569; padding: 0.3rem 0; border-bottom: 1px solid #f1f5f9; flex-wrap: wrap; }
  .event-type { font-weight: 600; color: #1e293b; }
  .event-actor { color: #64748b; }
  .event-time { color: #94a3b8; font-size: 0.75rem; margin-left: auto; }
  .event-comment { font-style: italic; color: #64748b; flex-basis: 100%; padding-left: 0.5rem; }
  .loading-hint, .empty-hint { color: #888; font-size: 0.875rem; font-style: italic; text-align: center; padding: 1rem; }
  .btn-primary { background: #2563eb; color: #fff; border: none; border-radius: 4px; padding: 0.4rem 0.75rem; cursor: pointer; font-size: 0.875rem; }
  .btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
  .btn-secondary { background: #fff; color: #2563eb; border: 1px solid #2563eb; border-radius: 4px; padding: 0.4rem 0.75rem; cursor: pointer; font-size: 0.875rem; }
  .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: #fff; border-radius: 8px; padding: 2rem; width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 0.75rem; max-height: 90vh; overflow-y: auto; }
  .modal h3 { margin: 0; }
  .modal-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.5rem; }
  .modal button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .form-error { background: #fee2e2; color: #991b1b; border-radius: 4px; padding: 0.5rem 0.75rem; font-size: 0.8rem; }
  @media (max-width: 768px) {
    .layout { grid-template-columns: 1fr; }
    .info-grid { grid-template-columns: 1fr; }
    .modal-row { grid-template-columns: 1fr; }
    .page { padding: 0.75rem; }
    .modal { max-width: 95vw; }
  }
</style>
