<script>
  import { notificationService } from '../services/NotificationService.js';
  import { templateService } from '../services/TemplateService.js';
  import { eventDispatcherService } from '../services/EventDispatcherService.js';
  import { currentUser, currentRole } from '../app/stores/auth.js';
  import { orgTree, resolveOrgContext } from '../app/stores/org.js';
  import { showToast, tableColumnLayouts } from '../app/stores/ui.js';
  import { QUEUE_STATUSES, EVENT_TYPES, ROLES } from '../utils/constants.js';
  import Table from '../components/Table.svelte';

  const tabs = ['inbox', 'queue', 'templates', 'channels', 'subscriptions', 'simulate'];
  let activeTab = 'inbox';

  const QUEUE_COLUMNS = [
    { key: 'status', label: 'Status', sortable: true },
    { key: 'recipientUserId', label: 'Recipient' },
    { key: 'templateId', label: 'Template' },
    { key: 'retryCount', label: 'Retries' },
    { key: 'createdAt', label: 'Created', sortable: true },
    { key: 'failureReason', label: 'Failure Reason' },
  ];

  $: queueHiddenColumns = (() => {
    const saved = $tableColumnLayouts['queue'];
    if (!saved) return [];
    return QUEUE_COLUMNS.filter((c) => !saved.includes(c.key)).map((c) => c.key);
  })();

  $: userId = $currentUser?.id ?? '';

  // Inbox
  let notifications = [];
  let inboxLoading = false;
  let markReadLoading = new Set();

  // Queue
  let queueItems = [];
  let queueLoading = false;

  // Draft requeue modal
  let showRequeueModal = false;
  let requeueItem = null;
  let requeueVarsJson = '{}';
  let requeueError = '';
  let requeueLoading = false;

  // Templates
  let templates = [];
  let templatesLoading = false;
  let showTemplateForm = false;
  let tplName = '';
  let tplBody = '';
  let tplIsCompact = false;
  let tplError = '';
  let tplLoading = false;
  let deletingTemplateId = null;

  // Channels
  let channels = [];
  let channelsLoading = false;
  let showChannelForm = false;
  let channelName = '';
  let channelError = '';
  let channelLoading = false;

  // Subscriptions
  let subscriptions = [];
  let subscriptionsLoading = false;
  let subEventType = '';
  let subChannelId = '';
  let subError = '';
  let subLoading = false;
  let deletingSubId = null;

  // Simulate / dispatch
  const eventTypeOptions = Object.values(EVENT_TYPES);
  let simEventType = eventTypeOptions[0] ?? '';
  let simSourceId = '';
  let simTitle = '';
  let simBody = '';
  let simLoading = false;
  let simResult = '';

  $: actorId = $currentUser?.id ?? '';
  $: orgId = resolveOrgContext($currentUser, $orgTree).organizationId || ($currentUser?.organizationNodeId ?? '');
  $: canManage = $currentRole === ROLES.ADMINISTRATOR || $currentRole === ROLES.STORE_MANAGER;

  $: unreadCount = notifications.filter((n) => !n.read).length;

  $: if (actorId) loadInbox();

  async function loadInbox() {
    if (!actorId) return;
    inboxLoading = true;
    try {
      notifications = await notificationService.getInbox(actorId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      inboxLoading = false;
    }
  }

  async function loadQueue() {
    if (!orgId) return;
    queueLoading = true;
    try {
      queueItems = await notificationService.getQueueByOrg(orgId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      queueLoading = false;
    }
  }

  function openRequeueModal(item) {
    requeueItem = item;
    requeueVarsJson = JSON.stringify(item.payload ?? {}, null, 2);
    requeueError = '';
    showRequeueModal = true;
  }

  async function handleRequeue() {
    requeueError = '';
    let vars;
    try { vars = JSON.parse(requeueVarsJson); } catch { requeueError = 'Invalid JSON.'; return; }
    requeueLoading = true;
    try {
      await notificationService.requeueDraft(requeueItem.id, vars);
      showRequeueModal = false;
      showToast('success', 'Draft requeued for delivery.');
      await loadQueue();
    } catch (err) {
      requeueError = err.message;
    } finally {
      requeueLoading = false;
    }
  }

  async function loadTemplates() {
    if (!orgId) return;
    templatesLoading = true;
    try {
      templates = await templateService.getByOrg(orgId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      templatesLoading = false;
    }
  }

  async function loadChannels() {
    if (!orgId) return;
    channelsLoading = true;
    try {
      channels = await notificationService.getChannels(orgId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      channelsLoading = false;
    }
  }

  async function loadSubscriptions() {
    if (!actorId) return;
    subscriptionsLoading = true;
    try {
      subscriptions = await notificationService.getSubscriptions(actorId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      subscriptionsLoading = false;
    }
  }

  async function handleSubscribe() {
    subError = '';
    if (!subEventType?.trim()) {
      subError = 'Please select an event type.';
      return;
    }
    subLoading = true;
    try {
      const created = await notificationService.subscribe({
        userId: actorId,
        channelId: subChannelId || null,
        eventType: subEventType,
        organizationId: orgId,
        filters: {},
      });
      subscriptions = [...subscriptions, created];
      subEventType = '';
      subChannelId = '';
      showToast('success', 'Subscribed.');
    } catch (err) {
      subError = err.message;
    } finally {
      subLoading = false;
    }
  }

  async function handleDeleteSubscription(id) {
    deletingSubId = id;
    try {
      await notificationService.deleteSubscription(id, actorId);
      subscriptions = subscriptions.filter((s) => s.id !== id);
      showToast('success', 'Subscription removed.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      deletingSubId = null;
    }
  }

  async function handleSimulateDispatch() {
    simLoading = true;
    simResult = '';
    try {
      await eventDispatcherService.dispatch({
        organizationId: orgId,
        eventType: simEventType,
        sourceId: simSourceId || `sim-${Date.now()}`,
        actorId,
        title: simTitle,
        body: simBody,
        recipientUserIds: [actorId],
      });
      simResult = 'Event dispatched.';
      showToast('success', 'Event dispatched.');
    } catch (err) {
      simResult = err.message;
      showToast('error', err.message);
    } finally {
      simLoading = false;
    }
  }

  async function switchTab(tab) {
    activeTab = tab;
    if (tab === 'inbox') await loadInbox();
    if (tab === 'queue') await loadQueue();
    if (tab === 'templates') await loadTemplates();
    if (tab === 'channels') await loadChannels();
    if (tab === 'subscriptions') await loadSubscriptions();
  }

  async function markRead(notif) {
    markReadLoading = new Set([...markReadLoading, notif.id]);
    try {
      await notificationService.markRead(notif.id);
      notifications = notifications.map((n) => n.id === notif.id ? { ...n, read: true } : n);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      markReadLoading = new Set([...markReadLoading].filter((id) => id !== notif.id));
    }
  }

  function hasInvalidPlaceholders(body) {
    return /\{\{[^}]+\}\}/.test(body);
  }

  async function handleCreateTemplate() {
    tplError = '';
    if (hasInvalidPlaceholders(tplBody)) {
      tplError = 'Use single braces {varName}, not double {{varName}}.';
      return;
    }
    tplLoading = true;
    try {
      const created = await templateService.createTemplate({
        organizationId: orgId,
        name: tplName,
        body: tplBody,
        isCompact: tplIsCompact,
        actorId,
      });
      templates = [...templates, created];
      showTemplateForm = false;
      tplName = '';
      tplBody = '';
      tplIsCompact = false;
      showToast('success', 'Template created.');
    } catch (err) {
      tplError = err.message;
    } finally {
      tplLoading = false;
    }
  }

  async function handleDeleteTemplate(id) {
    deletingTemplateId = id;
    try {
      await templateService.deleteTemplate(id, actorId);
      templates = templates.filter((t) => t.id !== id);
      showToast('success', 'Template deleted.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      deletingTemplateId = null;
    }
  }

  async function handleCreateChannel() {
    channelError = '';
    channelLoading = true;
    try {
      await notificationService.upsertChannel({ organizationId: orgId, name: channelName });
      await loadChannels();
      showChannelForm = false;
      channelName = '';
      showToast('success', 'Channel created.');
    } catch (err) {
      channelError = err.message;
    } finally {
      channelLoading = false;
    }
  }

  function statusColor(status) {
    const map = {
      Draft: '#f1f5f9',
      Queued: '#dbeafe',
      Sent: '#dcfce7',
      Failed: '#fee2e2',
    };
    return map[status] ?? '#f1f5f9';
  }

  function formatDate(ms) {
    return ms ? new Date(ms).toLocaleString() : '—';
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>Notifications & Messages</h2>
  </header>

  <nav class="tab-bar">
    {#each tabs as tab}
      <button class:active={activeTab === tab} on:click={() => switchTab(tab)}>
        {tab.charAt(0).toUpperCase() + tab.slice(1)}
        {#if tab === 'inbox' && unreadCount > 0}
          <span class="badge-count">{unreadCount}</span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="panel">
    <!-- Inbox -->
    {#if activeTab === 'inbox'}
      {#if inboxLoading}
        <p class="loading-hint">Loading…</p>
      {:else if notifications.length === 0}
        <p class="empty-hint">No notifications.</p>
      {:else}
        <div class="notif-list">
          {#each notifications as n}
            <div class="notif-row" class:unread={!n.read}>
              <div class="notif-content">
                <span class="notif-title">{n.title}</span>
                <span class="notif-body">{n.body}</span>
                <span class="notif-time">{formatDate(n.createdAt)}</span>
              </div>
              {#if !n.read}
                <button class="btn-xs" on:click={() => markRead(n)} disabled={markReadLoading.has(n.id)}>
                  {markReadLoading.has(n.id) ? 'Marking…' : 'Mark read'}
                </button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

    <!-- Queue -->
    {:else if activeTab === 'queue'}
      {#if queueLoading}
        <p class="loading-hint">Loading…</p>
      {:else if queueItems.length === 0}
        <p class="empty-hint">No queue items.</p>
      {:else}
        <Table
          columns={QUEUE_COLUMNS}
          rows={queueItems}
          empty="No queue items."
          hiddenColumns={queueHiddenColumns}
          tableKey="queue"
          {userId}
        >
          <span slot="cell" let:row let:col>
            {#if col.key === 'status'}
              <span class="status-badge" style="background:{statusColor(row.status)}">{row.status}</span>
            {:else if col.key === 'recipientUserId'}
              <span class="mono">{row.recipientUserId?.slice(0, 8)}…</span>
            {:else if col.key === 'templateId'}
              <span class="mono">{row.templateId?.slice(0, 8)}…</span>
            {:else if col.key === 'retryCount'}
              {row.retryCount}/{3}
            {:else if col.key === 'createdAt'}
              {formatDate(row.createdAt)}
            {:else if col.key === 'failureReason'}
              <span class="failure">{row.failureReason ?? '—'}</span>
            {:else}
              {row[col.key] ?? '—'}
            {/if}
          </span>
          <span slot="actions" let:row>
            {#if canManage && row.status === 'Draft'}
              <button class="btn-xs" on:click={() => openRequeueModal(row)}>Requeue</button>
            {/if}
          </span>
        </Table>
      {/if}

    <!-- Templates -->
    {:else if activeTab === 'templates'}
      <div class="section-header">
        <h3>Message Templates</h3>
        {#if canManage}<button class="btn-primary" on:click={() => { showTemplateForm = true; tplError = ''; }}>+ New Template</button>{/if}
      </div>
      {#if templatesLoading}
        <p class="loading-hint">Loading…</p>
      {:else if templates.length === 0}
        <p class="empty-hint">No templates.</p>
      {:else}
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Placeholders</th>
              <th>Compact</th>
              <th>Body (preview)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each templates as t}
              <tr>
                <td>{t.name}</td>
                <td>{t.placeholders?.join(', ') || '—'}</td>
                <td>{t.isCompact ? 'Yes (160 chars)' : 'No'}</td>
                <td class="body-preview">{t.body.slice(0, 60)}{t.body.length > 60 ? '…' : ''}</td>
                <td>
                  <button class="btn-xs btn-danger-xs" on:click={() => handleDeleteTemplate(t.id)} disabled={deletingTemplateId === t.id}>
                    {deletingTemplateId === t.id ? 'Deleting…' : 'Delete'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

    <!-- Channels -->
    {:else if activeTab === 'channels'}
      <div class="section-header">
        <h3>Notification Channels</h3>
        {#if canManage}<button class="btn-primary" on:click={() => { showChannelForm = true; channelError = ''; }}>+ New Channel</button>{/if}
      </div>
      {#if channelsLoading}
        <p class="loading-hint">Loading…</p>
      {:else if channels.length === 0}
        <p class="empty-hint">No channels configured.</p>
      {:else}
        <table class="data-table">
          <thead>
            <tr><th>Name</th><th>Type</th><th>Enabled</th></tr>
          </thead>
          <tbody>
            {#each channels as ch}
              <tr>
                <td>{ch.name}</td>
                <td>{ch.type}</td>
                <td>{ch.isEnabled ? 'Yes' : 'No'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

    <!-- Subscriptions -->
    {:else if activeTab === 'subscriptions'}
      <div class="section-header">
        <h3>My Event Subscriptions</h3>
      </div>
      <div class="sub-form">
        <label>Event Type
          <select bind:value={subEventType}>
            <option value="">— select —</option>
            {#each eventTypeOptions as et}
              <option value={et}>{et}</option>
            {/each}
          </select>
        </label>
        <label>Channel ID (optional) <input type="text" bind:value={subChannelId} placeholder="leave blank for in-app" /></label>
        {#if subError}<div class="form-error">{subError}</div>{/if}
        <button class="btn-primary" on:click={handleSubscribe} disabled={subLoading || !subEventType?.trim()}>
          {subLoading ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>
      {#if subscriptionsLoading}
        <p class="loading-hint">Loading…</p>
      {:else if subscriptions.length === 0}
        <p class="empty-hint">No subscriptions.</p>
      {:else}
        <table class="data-table">
          <thead>
            <tr><th>Event Type</th><th>Channel</th><th>Enabled</th><th></th></tr>
          </thead>
          <tbody>
            {#each subscriptions as s}
              <tr>
                <td>{s.eventType}</td>
                <td class="mono">{s.channelId ?? '—'}</td>
                <td>{s.isEnabled !== false ? 'Yes' : 'No'}</td>
                <td>
                  <button class="btn-xs btn-danger-xs" on:click={() => handleDeleteSubscription(s.id)} disabled={deletingSubId === s.id}>
                    {deletingSubId === s.id ? 'Removing…' : 'Remove'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

    <!-- Simulate / Dispatch -->
    {:else if activeTab === 'simulate'}
      <div class="section-header">
        <h3>Dispatch Event</h3>
      </div>
      <div class="sub-form">
        <label>Event Type
          <select bind:value={simEventType}>
            {#each eventTypeOptions as et}
              <option value={et}>{et}</option>
            {/each}
          </select>
        </label>
        <label>Source ID <input type="text" bind:value={simSourceId} placeholder="e.g. order-abc123" /></label>
        <label>Title <input type="text" bind:value={simTitle} placeholder="Notification title" /></label>
        <label>Body <textarea bind:value={simBody} rows="3" placeholder="Notification body"></textarea></label>
        <button class="btn-primary" on:click={handleSimulateDispatch} disabled={simLoading || !simTitle.trim() || !simBody.trim()}>
          {simLoading ? 'Dispatching…' : 'Dispatch Event'}
        </button>
        {#if simResult}<p class="sim-result">{simResult}</p>{/if}
      </div>
    {/if}
  </div>
</div>

<!-- New template modal -->
{#if showTemplateForm}
  <div class="modal-overlay" role="presentation" on:click={() => showTemplateForm = false} on:keydown={(e) => { if (e.key === 'Escape') showTemplateForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>New Template</h3>
      {#if tplError}<div class="form-error">{tplError}</div>{/if}
      <label>Name <input type="text" bind:value={tplName} /></label>
      <label>Body (use {'{'}<span>varName</span>{'}'} for placeholders, e.g. {'{'}title{'}'})
        <textarea bind:value={tplBody} rows="4"></textarea>
      </label>
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={tplIsCompact} />
        Compact notice (max 160 chars when rendered)
      </label>
      <div class="modal-actions">
        <button on:click={() => showTemplateForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleCreateTemplate} disabled={tplLoading || !tplName.trim() || !tplBody.trim()}>
          {tplLoading ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- New channel modal -->
{#if showChannelForm}
  <div class="modal-overlay" role="presentation" on:click={() => showChannelForm = false} on:keydown={(e) => { if (e.key === 'Escape') showChannelForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>New Channel</h3>
      {#if channelError}<div class="form-error">{channelError}</div>{/if}
      <label>Channel Name <input type="text" bind:value={channelName} /></label>
      <p class="hint">Only in-app channels are supported in this offline system.</p>
      <div class="modal-actions">
        <button on:click={() => showChannelForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleCreateChannel} disabled={channelLoading || !channelName.trim()}>
          {channelLoading ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Requeue draft modal -->
{#if showRequeueModal}
  <div class="modal-overlay" role="presentation" on:click={() => showRequeueModal = false} on:keydown={(e) => { if (e.key === 'Escape') showRequeueModal = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>Requeue Draft</h3>
      <p class="hint">Edit template variables (JSON), then requeue for delivery.</p>
      {#if requeueError}<div class="form-error">{requeueError}</div>{/if}
      <label>Variables (JSON)
        <textarea bind:value={requeueVarsJson} rows="6" class="code-input"></textarea>
      </label>
      <div class="modal-actions">
        <button on:click={() => showRequeueModal = false}>Cancel</button>
        <button class="btn-primary" on:click={handleRequeue} disabled={requeueLoading}>
          {requeueLoading ? 'Requeuing…' : 'Requeue'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 1.5rem; }
  .page-header { margin-bottom: 1rem; }
  h2, h3 { margin: 0 0 0.5rem; }
  .tab-bar { display: flex; gap: 0.25rem; margin-bottom: 1rem; }
  button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  button.active { background: #2563eb; color: #fff; border-color: #2563eb; }
  .btn-primary { background: #2563eb; color: #fff; border: none; border-radius: 4px; }
  .badge-count { background: #dc2626; color: #fff; border-radius: 999px; padding: 0 0.35rem; font-size: 0.7rem; margin-left: 0.3rem; }
  .panel { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 1.5rem; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .notif-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .notif-row { display: flex; align-items: center; gap: 1rem; padding: 0.75rem; border-radius: 6px; border: 1px solid #e2e8f0; }
  .notif-row.unread { border-color: #bfdbfe; background: #eff6ff; }
  .notif-content { flex: 1; display: flex; flex-direction: column; gap: 0.1rem; }
  .notif-title { font-weight: 600; font-size: 0.875rem; }
  .notif-body { font-size: 0.8rem; color: #475569; }
  .notif-time { font-size: 0.75rem; color: #94a3b8; }
  .status-badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .data-table th { text-align: left; padding: 0.4rem 0.75rem; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 0.75rem; text-transform: uppercase; color: #64748b; }
  .data-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  .mono { font-family: monospace; font-size: 0.8rem; }
  .failure { font-size: 0.8rem; color: #dc2626; }
  .body-preview { font-size: 0.8rem; color: #475569; }
  .btn-xs { padding: 0.15rem 0.5rem; font-size: 0.75rem; border: 1px solid #ddd; border-radius: 3px; cursor: pointer; background: #fff; }
  .btn-danger-xs { border-color: #fca5a5; color: #dc2626; }
  .empty-hint, .loading-hint { color: #888; font-size: 0.875rem; font-style: italic; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: #fff; border-radius: 8px; padding: 2rem; width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 0.75rem; }
  .modal h3 { margin: 0 0 0.5rem; }
  .modal label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 500; }
  .modal input, .modal textarea { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; font-family: inherit; }
  .checkbox-label { flex-direction: row !important; align-items: center; gap: 0.5rem !important; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.5rem; }
  .modal button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .hint { font-size: 0.8rem; color: #64748b; }
  .form-error { background: #fee2e2; color: #991b1b; border-radius: 4px; padding: 0.5rem 0.75rem; font-size: 0.8rem; }
  .sub-form { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; max-width: 480px; }
  .sub-form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 500; }
  .sub-form input, .sub-form textarea, .sub-form select { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; font-family: inherit; }
  .sim-result { font-size: 0.875rem; color: #16a34a; font-style: italic; }
</style>
