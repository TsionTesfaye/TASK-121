<script>
  import { customerService } from '../services/CustomerService.js';
  import { ticketService } from '../services/TicketService.js';
  import { authService } from '../services/AuthService.js';
  import { cryptoService } from '../services/CryptoService.js';
  import { currentUser, currentRole, isLocked } from '../app/stores/auth.js';
  import { orgTree, resolveOrgContext } from '../app/stores/org.js';
  import { showToast, tableColumnLayouts } from '../app/stores/ui.js';
  import { MEMBERSHIP_TIERS, ROLES, VALIDATION } from '../utils/constants.js';
  import Table from '../components/Table.svelte';

  const tiers = Object.values(MEMBERSHIP_TIERS);

  const TICKET_COLUMNS = [
    { key: 'subject', label: 'Subject', sortable: true },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'priority', label: 'Priority', sortable: true },
    { key: 'createdAt', label: 'Created', sortable: true },
  ];

  $: ticketHiddenColumns = (() => {
    const saved = $tableColumnLayouts['tickets'];
    if (!saved) return [];
    return TICKET_COLUMNS.filter((c) => !saved.includes(c.key)).map((c) => c.key);
  })();

  $: userId = $currentUser?.id ?? '';

  let customers = [];
  let selectedCustomer = null;
  let tickets = [];
  let sensitiveFields = null;
  let revealLoading = false;

  // Search / filter
  let searchQuery = '';
  let filterTier = '';

  // New customer form
  let showNewForm = false;
  let newName = '';
  let newTier = MEMBERSHIP_TIERS.BRONZE;
  let newStoredValue = 0;
  let newAllergies = '';
  let newMaterialRestrictions = '';
  let newReason = '';
  let formError = '';
  let formLoading = false;

  // Edit form
  let showEditForm = false;
  let editName = '';
  let editTier = '';
  let editReason = '';
  let editError = '';
  let editLoading = false;

  // Version history
  let versionHistory = [];
  let activeVersion = null;
  let versionLoading = false;
  let showPublishModal = false;
  let publishReason = '';
  let publishLoading = false;
  let publishError = '';

  // CRM operations modals
  let showPointsModal = false;
  let pointsDelta = 0;
  let pointsReason = '';
  let pointsLoading = false;
  let pointsError = '';

  let showStoredValueModal = false;
  let svDelta = 0;
  let svReason = '';
  let svLoading = false;
  let svError = '';

  let showRatingModal = false;
  let ratingValue = 5;
  let ratingReason = '';
  let ratingLoading = false;
  let ratingError = '';

  // Org passphrase unlock
  let showPassphrasePrompt = false;
  let passphraseInput = '';
  let passphraseError = '';
  let passphraseLoading = false;
  let encryptionModel = 'password';

  $: actorId = $currentUser?.id ?? '';
  $: orgId = resolveOrgContext($currentUser, $orgTree).organizationId || ($currentUser?.organizationNodeId ?? '');
  $: protectedDataLocked = encryptionModel === 'passphrase' && !cryptoService.isUnlocked();

  // Clear decrypted sensitive fields when session is locked or user logs out.
  $: if ($isLocked || !$currentUser) sensitiveFields = null;

  $: filteredCustomers = customers.filter((c) => {
    const matchesSearch = !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTier = !filterTier || c.membershipTier === filterTier;
    return matchesSearch && matchesTier;
  });

  $: if (orgId) {
    loadCustomers();
    authService.getEncryptionModel().then((m) => { encryptionModel = m; }).catch(() => {});
  }

  async function handlePassphraseUnlock() {
    passphraseError = '';
    passphraseLoading = true;
    try {
      const ok = await authService.unlockProtectedData(passphraseInput);
      if (ok) {
        showPassphrasePrompt = false;
        passphraseInput = '';
        showToast('success', 'Protected data unlocked.');
      } else {
        passphraseError = 'Incorrect passphrase.';
      }
    } catch (err) {
      passphraseError = err.message;
    } finally {
      passphraseLoading = false;
    }
  }

  async function loadCustomers() {
    if (!orgId) return;
    try {
      customers = await customerService.getByOrg(orgId);
    } catch (err) {
      showToast('error', err.message);
    }
  }

  async function selectCustomer(c) {
    selectedCustomer = c;
    sensitiveFields = null;
    tickets = [];
    versionHistory = [];
    activeVersion = null;
    try {
      tickets = await ticketService.getByCustomer(c.id, orgId);
    } catch (err) {
      showToast('error', err.message);
    }
    await loadVersionHistory(c.id);
  }

  async function loadVersionHistory(customerId) {
    versionLoading = true;
    try {
      versionHistory = await customerService.getCustomerVersionHistory(customerId);
      activeVersion = await customerService.getActiveCustomerVersion(customerId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      versionLoading = false;
    }
  }

  function openPublishModal() {
    publishReason = '';
    publishError = '';
    showPublishModal = true;
  }

  async function handlePublish() {
    publishError = '';
    publishLoading = true;
    try {
      await customerService.publishCustomerVersion({
        customerId: selectedCustomer.id,
        organizationId: orgId,
        reasonNote: publishReason,
        actorId,
      });
      showPublishModal = false;
      showToast('success', 'Version published.');
      await loadVersionHistory(selectedCustomer.id);
    } catch (err) {
      publishError = err.message;
    } finally {
      publishLoading = false;
    }
  }

  async function revealSensitive() {
    if (!selectedCustomer) return;
    revealLoading = true;
    try {
      sensitiveFields = await customerService.revealSensitiveFields(selectedCustomer.id);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      revealLoading = false;
    }
  }

  function hideSensitive() {
    sensitiveFields = null;
  }

  async function handleCreate() {
    formError = '';
    formLoading = true;
    try {
      const created = await customerService.createCustomer({
        organizationId: orgId,
        name: newName,
        membershipTier: newTier,
        storedValue: parseFloat(newStoredValue) || 0,
        allergies: newAllergies,
        materialRestrictions: newMaterialRestrictions,
        actorId,
        reasonNote: newReason,
      });
      customers = [...customers, created];
      showNewForm = false;
      newName = '';
      newTier = MEMBERSHIP_TIERS.BRONZE;
      newStoredValue = 0;
      newAllergies = '';
      newMaterialRestrictions = '';
      newReason = '';
      showToast('success', 'Customer created.');
    } catch (err) {
      formError = err.message;
    } finally {
      formLoading = false;
    }
  }

  function openEditForm() {
    editName = selectedCustomer.name;
    editTier = selectedCustomer.membershipTier;
    editReason = '';
    editError = '';
    showEditForm = true;
  }

  async function handleEdit() {
    editError = '';
    editLoading = true;
    try {
      const updated = await customerService.updateCustomer(
        selectedCustomer.id,
        { name: editName, membershipTier: editTier },
        actorId,
        editReason,
      );
      customers = customers.map((c) => (c.id === updated.id ? updated : c));
      selectedCustomer = updated;
      showEditForm = false;
      showToast('success', 'Customer updated.');
    } catch (err) {
      editError = err.message;
    } finally {
      editLoading = false;
    }
  }

  $: canManage = $currentRole === ROLES.ADMINISTRATOR || $currentRole === ROLES.STORE_MANAGER;

  async function handleAdjustPoints() {
    pointsError = '';
    const delta = parseInt(pointsDelta, 10);
    if (!Number.isInteger(delta) || delta === 0) { pointsError = 'Enter a non-zero integer.'; return; }
    pointsLoading = true;
    try {
      const updated = await customerService.adjustPoints(selectedCustomer.id, delta, actorId, pointsReason);
      customers = customers.map((c) => (c.id === updated.id ? updated : c));
      selectedCustomer = updated;
      showPointsModal = false;
      pointsDelta = 0;
      showToast('success', `Points adjusted by ${delta > 0 ? '+' : ''}${delta}.`);
    } catch (err) {
      pointsError = err.message;
    } finally {
      pointsLoading = false;
    }
  }

  async function handleAdjustStoredValue() {
    svError = '';
    const delta = parseFloat(svDelta);
    if (isNaN(delta) || delta === 0) { svError = 'Enter a non-zero amount.'; return; }
    svLoading = true;
    try {
      const updated = await customerService.adjustStoredValue(selectedCustomer.id, delta, actorId, svReason);
      customers = customers.map((c) => (c.id === updated.id ? updated : c));
      selectedCustomer = updated;
      sensitiveFields = null; // reset reveal — value changed
      showStoredValueModal = false;
      svDelta = 0;
      showToast('success', `Stored value adjusted by ${delta > 0 ? '+' : ''}${delta.toFixed(2)}.`);
    } catch (err) {
      svError = err.message;
    } finally {
      svLoading = false;
    }
  }

  async function handleAddRating() {
    ratingError = '';
    const r = parseInt(ratingValue, 10);
    if (r < VALIDATION.RATING_MIN || r > VALIDATION.RATING_MAX) { ratingError = `Rating must be ${VALIDATION.RATING_MIN}–${VALIDATION.RATING_MAX}.`; return; }
    ratingLoading = true;
    try {
      const updated = await customerService.addRating(selectedCustomer.id, r, actorId, ratingReason);
      customers = customers.map((c) => (c.id === updated.id ? updated : c));
      selectedCustomer = updated;
      showRatingModal = false;
      ratingValue = 5;
      showToast('success', `Rating of ${r} added.`);
    } catch (err) {
      ratingError = err.message;
    } finally {
      ratingLoading = false;
    }
  }

  function tierBadgeClass(tier) {
    if (tier === 'Gold') return 'badge--gold';
    if (tier === 'Silver') return 'badge--silver';
    return 'badge--bronze';
  }

  function formatDate(ms) {
    return ms ? new Date(ms).toLocaleDateString() : '—';
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>Customer CRM</h2>
    {#if canManage}
      <button class="btn-primary" on:click={() => { showNewForm = true; formError = ''; }}>+ New Customer</button>
    {:else}
      <span class="readonly-badge">Read Only</span>
    {/if}
  </header>

  <div class="layout">
    <!-- Customer list -->
    <aside class="customer-list">
      <div class="list-filters">
        <input
          class="search-input"
          type="search"
          placeholder="Search by name…"
          bind:value={searchQuery}
        />
        <select bind:value={filterTier} class="tier-filter">
          <option value="">All tiers</option>
          {#each tiers as t}
            <option value={t}>{t}</option>
          {/each}
        </select>
      </div>

      {#if filteredCustomers.length === 0}
        <p class="empty-hint">No customers found.</p>
      {:else}
        {#each filteredCustomers as c}
          <button
            class="customer-row"
            class:selected={selectedCustomer?.id === c.id}
            on:click={() => selectCustomer(c)}
          >
            <span class="customer-name">{c.name}</span>
            <span class="badge {tierBadgeClass(c.membershipTier)}">{c.membershipTier}</span>
          </button>
        {/each}
      {/if}
    </aside>

    <!-- Customer detail -->
    <main class="customer-detail">
      {#if !selectedCustomer}
        <div class="empty-state">Select a customer to view their profile.</div>
      {:else}
        <div class="detail-header">
          <div>
            <h3>{selectedCustomer.name}</h3>
            <span class="badge {tierBadgeClass(selectedCustomer.membershipTier)}">{selectedCustomer.membershipTier}</span>
          </div>
          {#if canManage}<button class="btn-secondary" on:click={openEditForm}>Edit</button>{/if}
        </div>

        <div class="stats-row">
          <div class="stat">
            <span class="stat-label">Points</span>
            <span class="stat-value">{selectedCustomer.points}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Rating</span>
            <span class="stat-value">{selectedCustomer.ratingAverage.toFixed(1)} ({selectedCustomer.ratingCount})</span>
          </div>
          <div class="stat">
            <span class="stat-label">Since</span>
            <span class="stat-value">{formatDate(selectedCustomer.createdAt)}</span>
          </div>
        </div>

        <!-- CRM operations — store_manager / admin only -->
        {#if canManage}
          <div class="ops-row">
            <button class="btn-secondary" on:click={() => { showPointsModal = true; pointsError = ''; pointsDelta = 0; pointsReason = ''; }}>Adjust Points</button>
            <button class="btn-secondary" on:click={() => { showStoredValueModal = true; svError = ''; svDelta = 0; svReason = ''; }}>Adjust Stored Value</button>
            <button class="btn-secondary" on:click={() => { showRatingModal = true; ratingError = ''; ratingValue = 5; ratingReason = ''; }}>Add Rating</button>
          </div>
        {/if}

        <!-- Sensitive fields -->
        <section class="sensitive-section">
          <div class="sensitive-header">
            <h4>Sensitive Data</h4>
            {#if sensitiveFields}
              <button class="btn-link" on:click={hideSensitive}>Hide</button>
            {:else if canManage && protectedDataLocked}
              <button class="btn-link" on:click={() => { showPassphrasePrompt = true; passphraseError = ''; passphraseInput = ''; }}>Unlock with Passphrase</button>
            {:else if canManage}
              <button class="btn-link" on:click={revealSensitive} disabled={revealLoading}>
                {revealLoading ? 'Revealing…' : 'Reveal'}
              </button>
            {/if}
          </div>
          <div class="sensitive-row">
            <span class="field-label">Stored Value</span>
            <span class="masked-field">{sensitiveFields ? `$${sensitiveFields.storedValue}` : '••••••••'}</span>
          </div>
          <div class="sensitive-row">
            <span class="field-label">Allergies</span>
            <span class="masked-field">
              {#if sensitiveFields}
                {sensitiveFields.allergies ?? '—'}
              {:else if selectedCustomer.allergiesCiphertext}
                ••••••••
              {:else}
                —
              {/if}
            </span>
          </div>
          <div class="sensitive-row">
            <span class="field-label">Material Restrictions</span>
            <span class="masked-field">
              {#if sensitiveFields}
                {sensitiveFields.materialRestrictions ?? '—'}
              {:else if selectedCustomer.materialRestrictionsCiphertext}
                ••••••••
              {:else}
                —
              {/if}
            </span>
          </div>
          {#if selectedCustomer.allergiesCiphertext || selectedCustomer.materialRestrictionsCiphertext}
            <div class="restriction-alert">Restriction flags present on this customer.</div>
          {/if}
        </section>

        <!-- Tickets -->
        <section class="tickets-section">
          <h4>Support Tickets</h4>
          <Table
            columns={TICKET_COLUMNS}
            rows={tickets}
            empty="No tickets."
            hiddenColumns={ticketHiddenColumns}
            tableKey="tickets"
            {userId}
          >
            <span slot="cell" let:row let:col>
              {#if col.key === 'status'}
                <span class="badge badge--status">{row.status}</span>
              {:else if col.key === 'createdAt'}
                {formatDate(row.createdAt)}
              {:else}
                {row[col.key] ?? '—'}
              {/if}
            </span>
          </Table>
        </section>

        <!-- Version history -->
        <section class="version-section">
          <div class="version-header">
            <h4>Customer Version History</h4>
            {#if canManage}<button class="btn-primary" on:click={openPublishModal}>Publish Version</button>{/if}
          </div>
          {#if activeVersion}
            <div class="active-version-badge">
              Active: v{activeVersion.versionNumber} — published {formatDate(activeVersion.createdAt)}
            </div>
          {/if}
          {#if versionLoading}
            <p class="empty-hint">Loading…</p>
          {:else if versionHistory.length === 0}
            <p class="empty-hint">No versions published yet.</p>
          {:else}
            <table class="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {#each versionHistory as v}
                  <tr>
                    <td>v{v.versionNumber}</td>
                    <td><span class="badge {v.isActive ? 'badge--active-ver' : 'badge--inactive-ver'}">{v.isActive ? 'Active' : 'Archived'}</span></td>
                    <td class="version-reason">{v.reasonNote}</td>
                    <td>{formatDate(v.createdAt)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </section>
      {/if}
    </main>
  </div>
</div>

<!-- New customer modal -->
{#if showNewForm}
  <div class="modal-overlay" role="presentation" on:click={() => showNewForm = false} on:keydown={(e) => { if (e.key === 'Escape') showNewForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="new-customer-modal-title" on:click|stopPropagation on:keydown|stopPropagation>
      <h3 id="new-customer-modal-title">New Customer</h3>
      {#if formError}<div class="form-error">{formError}</div>{/if}
      <label>Name <input type="text" bind:value={newName} /></label>
      <label>Membership Tier
        <select bind:value={newTier}>
          {#each tiers as t}<option value={t}>{t}</option>{/each}
        </select>
      </label>
      <label>Initial Stored Value ($)
        <input type="number" min="0" step="0.01" bind:value={newStoredValue} />
      </label>
      <label>Allergies (optional)
        <textarea bind:value={newAllergies} rows="2" maxlength="500"></textarea>
      </label>
      <label>Material Restrictions (optional)
        <textarea bind:value={newMaterialRestrictions} rows="2" maxlength="500"></textarea>
      </label>
      <label>Reason (min 10 chars) <input type="text" bind:value={newReason} placeholder="Why is this customer being created?" /></label>
      <div class="modal-actions">
        <button on:click={() => showNewForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleCreate} disabled={formLoading || !newName.trim() || newReason.trim().length < 10}>
          {formLoading ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Edit customer modal -->
{#if showEditForm}
  <div class="modal-overlay" role="presentation" on:click={() => showEditForm = false} on:keydown={(e) => { if (e.key === 'Escape') showEditForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title" on:click|stopPropagation on:keydown|stopPropagation>
      <h3 id="edit-modal-title">Edit Customer</h3>
      {#if editError}<div class="form-error">{editError}</div>{/if}
      <label>Name <input type="text" bind:value={editName} /></label>
      <label>Membership Tier
        <select bind:value={editTier}>
          {#each tiers as t}<option value={t}>{t}</option>{/each}
        </select>
      </label>
      <label>Reason (min 10 chars) <input type="text" bind:value={editReason} placeholder="Why are you editing?" /></label>
      <div class="modal-actions">
        <button on:click={() => showEditForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleEdit} disabled={editLoading || !editName.trim() || editReason.trim().length < 10}>
          {editLoading ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Publish version modal -->
{#if showPublishModal}
  <div class="modal-overlay" role="presentation" on:click={() => showPublishModal = false} on:keydown={(e) => { if (e.key === 'Escape') showPublishModal = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="publish-modal-title" on:click|stopPropagation on:keydown|stopPropagation>
      <h3 id="publish-modal-title">Publish Customer Version</h3>
      {#if publishError}<div class="form-error">{publishError}</div>{/if}
      <label>
        Reason Note (minimum 10 characters)
        <textarea
          bind:value={publishReason}
          rows="3"
          placeholder="Describe why this version is being published…"
        ></textarea>
      </label>
      <div class="modal-actions">
        <button on:click={() => showPublishModal = false}>Cancel</button>
        <button
          class="btn-primary"
          on:click={handlePublish}
          disabled={publishLoading || publishReason.trim().length < 10}
        >
          {publishLoading ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Adjust points modal -->
{#if showPointsModal}
  <div class="modal-overlay" role="presentation" on:click={() => showPointsModal = false} on:keydown={(e) => { if (e.key === 'Escape') showPointsModal = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="points-modal-title" on:click|stopPropagation on:keydown|stopPropagation>
      <h3 id="points-modal-title">Adjust Points</h3>
      <p class="modal-hint">Current: <strong>{selectedCustomer?.points ?? 0}</strong> points. Enter a positive or negative integer.</p>
      {#if pointsError}<div class="form-error">{pointsError}</div>{/if}
      <label>Delta <input type="number" step="1" bind:value={pointsDelta} /></label>
      <label>Reason (min 10 chars) <input type="text" bind:value={pointsReason} placeholder="Why adjust points?" /></label>
      <div class="modal-actions">
        <button on:click={() => showPointsModal = false}>Cancel</button>
        <button class="btn-primary" on:click={handleAdjustPoints} disabled={pointsLoading || pointsDelta === 0 || pointsReason.trim().length < 10}>
          {pointsLoading ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Adjust stored value modal -->
{#if showStoredValueModal}
  <div class="modal-overlay" role="presentation" on:click={() => showStoredValueModal = false} on:keydown={(e) => { if (e.key === 'Escape') showStoredValueModal = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="sv-modal-title" on:click|stopPropagation on:keydown|stopPropagation>
      <h3 id="sv-modal-title">Adjust Stored Value</h3>
      <p class="modal-hint">Enter a positive (credit) or negative (debit) amount. Negative balances are blocked.</p>
      {#if svError}<div class="form-error">{svError}</div>{/if}
      <label>Amount ($) <input type="number" step="0.01" bind:value={svDelta} /></label>
      <label>Reason (min 10 chars) <input type="text" bind:value={svReason} placeholder="Why adjust value?" /></label>
      <div class="modal-actions">
        <button on:click={() => showStoredValueModal = false}>Cancel</button>
        <button class="btn-primary" on:click={handleAdjustStoredValue} disabled={svLoading || svDelta === 0 || svReason.trim().length < 10}>
          {svLoading ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Add rating modal -->
{#if showRatingModal}
  <div class="modal-overlay" role="presentation" on:click={() => showRatingModal = false} on:keydown={(e) => { if (e.key === 'Escape') showRatingModal = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="rating-modal-title" on:click|stopPropagation on:keydown|stopPropagation>
      <h3 id="rating-modal-title">Add Rating</h3>
      <p class="modal-hint">Current average: <strong>{selectedCustomer?.ratingAverage?.toFixed(1) ?? '—'}</strong> ({selectedCustomer?.ratingCount ?? 0} ratings)</p>
      {#if ratingError}<div class="form-error">{ratingError}</div>{/if}
      <label>Rating (1–5)
        <select bind:value={ratingValue}>
          {#each [1, 2, 3, 4, 5] as r}<option value={r}>{r}</option>{/each}
        </select>
      </label>
      <label>Reason (min 10 chars) <input type="text" bind:value={ratingReason} placeholder="Why add this rating?" /></label>
      <div class="modal-actions">
        <button on:click={() => showRatingModal = false}>Cancel</button>
        <button class="btn-primary" on:click={handleAddRating} disabled={ratingLoading || ratingReason.trim().length < 10}>
          {ratingLoading ? 'Submitting…' : 'Submit Rating'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Org passphrase unlock modal -->
{#if showPassphrasePrompt}
  <div class="modal-overlay" role="presentation" on:click={() => showPassphrasePrompt = false} on:keydown={(e) => { if (e.key === 'Escape') showPassphrasePrompt = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="passphrase-modal-title" on:click|stopPropagation on:keydown|stopPropagation>
      <h3 id="passphrase-modal-title">Unlock Protected Data</h3>
      <p class="modal-hint">Enter the organization passphrase to access sensitive customer data.</p>
      {#if passphraseError}<div class="form-error">{passphraseError}</div>{/if}
      <label>Org Passphrase
        <input type="password" bind:value={passphraseInput} autocomplete="off" placeholder="Enter org passphrase" />
      </label>
      <div class="modal-actions">
        <button on:click={() => showPassphrasePrompt = false}>Cancel</button>
        <button class="btn-primary" on:click={handlePassphraseUnlock} disabled={passphraseLoading || !passphraseInput}>
          {passphraseLoading ? 'Unlocking…' : 'Unlock'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 1.5rem; height: 100%; display: flex; flex-direction: column; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  h2, h3, h4 { margin: 0 0 0.5rem; }
  .layout { display: grid; grid-template-columns: 280px 1fr; gap: 1rem; flex: 1; min-height: 0; }
  .customer-list { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 0.75rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.25rem; }
  .list-filters { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0.5rem; }
  .search-input, .tier-filter { width: 100%; padding: 0.35rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem; }
  .customer-row { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; border-radius: 4px; border: 1px solid transparent; cursor: pointer; background: #fff; font-size: 0.875rem; text-align: left; }
  .customer-row:hover { background: #f1f5f9; }
  .customer-row.selected { background: #eff6ff; border-color: #bfdbfe; }
  .customer-name { font-weight: 500; }
  .badge { padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.7rem; font-weight: 600; white-space: nowrap; }
  .badge--gold { background: #fef9c3; color: #854d0e; }
  .badge--silver { background: #f1f5f9; color: #475569; }
  .badge--bronze { background: #fde8d4; color: #92400e; }
  .badge--status { background: #dbeafe; color: #1d4ed8; }
  .customer-detail { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 1.5rem; overflow-y: auto; }
  .empty-state { display: flex; align-items: center; justify-content: center; height: 200px; color: #888; }
  .detail-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; }
  .stats-row { display: flex; gap: 1.5rem; margin-bottom: 1rem; }
  .stat { display: flex; flex-direction: column; gap: 0.1rem; }
  .stat-label { font-size: 0.7rem; color: #888; text-transform: uppercase; }
  .stat-value { font-size: 1rem; font-weight: 600; }
  .ops-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .readonly-badge { background: #f1f5f9; color: #64748b; padding: 0.3rem 0.75rem; border-radius: 4px; font-size: 0.8rem; font-weight: 500; }
  .modal-hint { font-size: 0.8rem; color: #64748b; margin: 0; }
  .sensitive-section { border: 1px solid #fde68a; background: #fffbeb; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
  .sensitive-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .sensitive-row { display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0; border-bottom: 1px solid #fef3c7; font-size: 0.875rem; }
  .field-label { color: #666; }
  .masked-field { font-family: monospace; }
  .restriction-alert { margin-top: 0.5rem; font-size: 0.8rem; color: #b45309; font-weight: 500; }
  .tickets-section { margin-top: 1rem; }
  .version-section { margin-top: 1.5rem; border-top: 1px solid #e2e8f0; padding-top: 1rem; }
  .version-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
  .active-version-badge { display: inline-block; background: #dcfce7; color: #166534; font-size: 0.8rem; font-weight: 500; padding: 0.2rem 0.6rem; border-radius: 4px; margin-bottom: 0.5rem; }
  .badge--active-ver { background: #dcfce7; color: #166534; }
  .badge--inactive-ver { background: #f1f5f9; color: #64748b; }
  .version-reason { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8rem; color: #64748b; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; margin-top: 0.5rem; }
  .data-table th { text-align: left; padding: 0.4rem 0.75rem; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 0.75rem; text-transform: uppercase; color: #64748b; }
  .data-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f1f5f9; }
  .empty-hint { color: #888; font-size: 0.875rem; font-style: italic; }
  .btn-primary { background: #2563eb; color: #fff; border: none; border-radius: 4px; padding: 0.4rem 0.75rem; cursor: pointer; font-size: 0.875rem; }
  .btn-secondary { background: #fff; color: #2563eb; border: 1px solid #2563eb; border-radius: 4px; padding: 0.4rem 0.75rem; cursor: pointer; font-size: 0.875rem; }
  .btn-link { background: none; border: none; color: #2563eb; font-size: 0.8rem; cursor: pointer; padding: 0; text-decoration: underline; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: #fff; border-radius: 8px; padding: 2rem; width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 0.75rem; }
  .modal h3 { margin: 0 0 0.5rem; }
  .modal label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 500; }
  .modal input, .modal select, .modal textarea { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; font-family: inherit; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.5rem; }
  .modal button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .form-error { background: #fee2e2; color: #991b1b; border-radius: 4px; padding: 0.5rem 0.75rem; font-size: 0.8rem; }
  @media (max-width: 768px) {
    .layout { grid-template-columns: 1fr; }
    .page { padding: 0.75rem; }
    .data-table { display: block; overflow-x: auto; }
    .modal { max-width: 95vw; }
  }
</style>
