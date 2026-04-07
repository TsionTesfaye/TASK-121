<script>
  import { masterDataService } from '../services/MasterDataService.js';
  import { lookupDataService } from '../services/LookupDataService.js';
  import { styleService } from '../services/StyleService.js';
  import { currentUser, currentRole } from '../app/stores/auth.js';
  import { orgTree, resolveOrgContext } from '../app/stores/org.js';
  import { showToast } from '../app/stores/ui.js';
  import { MASTER_DATA_ENTITY_TYPES, ROLES } from '../utils/constants.js';

  const entityTypes = Object.values(MASTER_DATA_ENTITY_TYPES);

  let activeEntityType = entityTypes[0];
  let activeVersions = {};   // entityType → version record
  let versionsLoading = false;
  let historyCache = {};     // entityId → version[]
  let historyLoading = false;
  let showHistoryFor = null; // entityId currently showing history

  // New version modal
  let showModal = false;
  let newEntityId = '';
  let newPayloadJson = '{}';
  let newReasonNote = '';
  let expectedActiveVersionId = null;
  let modalError = '';
  let modalLoading = false;

  // Top-level tabs
  const mainTabs = ['versions', 'lookup-data'];
  let mainTab = 'versions';

  // Lookup data tab
  const lookupStores = ['colors', 'sizes', 'seasons', 'brands', 'suppliers', 'styles'];
  let activeLookupStore = 'colors';
  let lookupEntries = {};  // store → entries[]
  let lookupLoading = false;
  let showLookupForm = false;
  let lookupFormName = '';
  let lookupFormReason = '';
  let lookupFormError = '';
  let lookupFormLoading = false;

  // Deactivation modal
  let showDeactivateModal = false;
  let deactivateEntryId = null;
  let deactivateReason = '';
  let deactivateError = '';
  let deactivateLoading = false;

  // Style deactivation modal
  let showStyleDeactivateModal = false;
  let styleDeactivateId = null;
  let styleDeactivateReason = '';
  let styleDeactivateError = '';
  let styleDeactivateLoading = false;

  // Styles
  let styles = [];
  let stylesLoading = false;
  let showStyleForm = false;
  let styleFormSku = '';
  let styleFormColorId = '';
  let styleFormSizeId = '';
  let styleFormSeasonId = '';
  let styleFormBrandId = '';
  let styleFormSupplierId = '';
  let styleFormError = '';
  let styleFormLoading = false;
  let styleFormReason = '';
  let styleFormOptions = { colors: [], sizes: [], seasons: [], brands: [], suppliers: [] };

  $: actorId = $currentUser?.id ?? '';
  $: orgCtx = resolveOrgContext($currentUser, $orgTree);
  $: orgId = orgCtx.organizationId || ($currentUser?.organizationNodeId ?? '');
  $: canManage = $currentRole === ROLES.ADMINISTRATOR || $currentRole === ROLES.STORE_MANAGER;

  $: activeVersion = activeVersions[activeEntityType] ?? null;

  $: if (actorId) loadActiveVersions();

  $: if (mainTab === 'lookup-data' && orgId && activeLookupStore) {
    if (activeLookupStore === 'styles') {
      loadStyles();
    } else {
      loadLookupEntries(activeLookupStore);
    }
  }

  async function loadActiveVersions() {
    versionsLoading = true;
    try {
      const all = await masterDataService.getAllActiveVersions(orgId);
      const map = {};
      for (const v of all) {
        map[v.entityType] = v;
      }
      activeVersions = map;
    } catch (err) {
      showToast('error', err.message);
    } finally {
      versionsLoading = false;
    }
  }

  async function loadHistory(entityId) {
    if (showHistoryFor === entityId) {
      showHistoryFor = null;
      return;
    }
    historyLoading = true;
    try {
      historyCache[entityId] = await masterDataService.getVersionHistory(entityId);
      showHistoryFor = entityId;
    } catch (err) {
      showToast('error', err.message);
    } finally {
      historyLoading = false;
    }
  }

  function openNewVersionModal() {
    const current = activeVersions[activeEntityType];
    newEntityId = current?.entityId ?? activeEntityType;
    newPayloadJson = current ? JSON.stringify(current.payload, null, 2) : '{}';
    newReasonNote = '';
    expectedActiveVersionId = current?.id ?? null;
    modalError = '';
    showModal = true;
  }

  async function handlePublish() {
    modalError = '';
    let payload;
    try {
      payload = JSON.parse(newPayloadJson);
    } catch {
      modalError = 'Payload must be valid JSON.';
      return;
    }
    modalLoading = true;
    try {
      const newVersion = await masterDataService.publishVersion({
        entityType: activeEntityType,
        entityId: newEntityId.trim() || activeEntityType,
        organizationId: orgId,
        payload,
        reasonNote: newReasonNote,
        createdBy: actorId,
        expectedActiveVersionId,
      });
      activeVersions = { ...activeVersions, [activeEntityType]: newVersion };
      showModal = false;
      showToast('success', `Version ${newVersion.versionNumber} published.`);
    } catch (err) {
      modalError = err.message;
    } finally {
      modalLoading = false;
    }
  }

  async function loadLookupEntries(store) {
    lookupLoading = true;
    try {
      const entries = await lookupDataService.listEntries(store, orgId);
      lookupEntries = { ...lookupEntries, [store]: entries };
    } catch (err) {
      showToast('error', err.message);
    } finally {
      lookupLoading = false;
    }
  }

  async function loadStyles() {
    stylesLoading = true;
    try {
      styles = await styleService.getByOrg(orgId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      stylesLoading = false;
    }
  }

  async function handleCreateLookupEntry() {
    lookupFormError = '';
    lookupFormLoading = true;
    try {
      await lookupDataService.createEntry({
        store: activeLookupStore,
        organizationId: orgId,
        name: lookupFormName,
        actorId,
        reasonNote: lookupFormReason,
      });
      await loadLookupEntries(activeLookupStore);
      showLookupForm = false;
      lookupFormName = '';
      lookupFormReason = '';
      showToast('success', `${activeLookupStore.slice(0, -1)} created.`);
    } catch (err) {
      lookupFormError = err.message;
    } finally {
      lookupFormLoading = false;
    }
  }

  function openDeactivateModal(entryId) {
    deactivateEntryId = entryId;
    deactivateReason = '';
    deactivateError = '';
    showDeactivateModal = true;
  }

  async function handleDeactivateLookup() {
    deactivateError = '';
    deactivateLoading = true;
    try {
      await lookupDataService.deactivateEntry({ store: activeLookupStore, entryId: deactivateEntryId, actorId, reasonNote: deactivateReason });
      await loadLookupEntries(activeLookupStore);
      showDeactivateModal = false;
      showToast('success', 'Entry deactivated.');
    } catch (err) {
      deactivateError = err.message;
    } finally {
      deactivateLoading = false;
    }
  }

  async function openStyleForm() {
    styleFormError = '';
    styleFormSku = '';
    styleFormColorId = '';
    styleFormSizeId = '';
    styleFormSeasonId = '';
    styleFormBrandId = '';
    styleFormSupplierId = '';
    // Load active entries for all lookup stores
    const [colors, sizes, seasons, brands, suppliers] = await Promise.all([
      lookupDataService.listEntries('colors', orgId),
      lookupDataService.listEntries('sizes', orgId),
      lookupDataService.listEntries('seasons', orgId),
      lookupDataService.listEntries('brands', orgId),
      lookupDataService.listEntries('suppliers', orgId),
    ]);
    styleFormOptions = {
      colors: colors.filter((e) => e.isActive),
      sizes: sizes.filter((e) => e.isActive),
      seasons: seasons.filter((e) => e.isActive),
      brands: brands.filter((e) => e.isActive),
      suppliers: suppliers.filter((e) => e.isActive),
    };
    styleFormReason = '';
    showStyleForm = true;
  }

  async function handleCreateStyle() {
    styleFormError = '';
    styleFormLoading = true;
    try {
      await styleService.createStyle({
        organizationId: orgId,
        sku: styleFormSku,
        colorId: styleFormColorId || null,
        sizeId: styleFormSizeId || null,
        seasonId: styleFormSeasonId || null,
        brandId: styleFormBrandId || null,
        supplierId: styleFormSupplierId || null,
        storeId: orgCtx.storeId || ($currentUser?.organizationNodeId ?? ''),
        actorId,
        reasonNote: styleFormReason,
      });
      await loadStyles();
      showStyleForm = false;
      styleFormReason = '';
      showToast('success', 'Style created.');
    } catch (err) {
      styleFormError = err.message;
    } finally {
      styleFormLoading = false;
    }
  }

  function openStyleDeactivate(styleId) {
    styleDeactivateId = styleId;
    styleDeactivateReason = '';
    styleDeactivateError = '';
    showStyleDeactivateModal = true;
  }

  async function handleStyleDeactivate() {
    styleDeactivateError = '';
    styleDeactivateLoading = true;
    try {
      await styleService.deactivateStyle(styleDeactivateId, actorId, styleDeactivateReason);
      await loadStyles();
      showStyleDeactivateModal = false;
      showToast('success', 'Style deactivated.');
    } catch (err) {
      styleDeactivateError = err.message;
    } finally {
      styleDeactivateLoading = false;
    }
  }

  function formatDate(ms) {
    return ms ? new Date(ms).toLocaleString() : '—';
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>Master Data</h2>
    {#if mainTab === 'versions'}
      {#if canManage}<button class="btn-primary" on:click={openNewVersionModal}>+ Publish New Version</button>{/if}
    {/if}
  </header>

  <nav class="main-tabs">
    {#each mainTabs as tab}
      <button class:active={mainTab === tab} on:click={() => mainTab = tab}>
        {tab === 'versions' ? 'Versioned Catalog' : 'Reference Data'}
      </button>
    {/each}
  </nav>

  {#if mainTab === 'versions'}
    <nav class="entity-tabs">
      {#each entityTypes as type}
        <button class:active={activeEntityType === type} on:click={() => activeEntityType = type}>
          {type.charAt(0).toUpperCase() + type.slice(1)}
        </button>
      {/each}
    </nav>

    <section class="panel">
      <h3>Active Version — {activeEntityType}</h3>

      {#if versionsLoading}
        <p class="loading-hint">Loading…</p>
      {:else if !activeVersion}
        <p class="empty-hint">No active version for {activeEntityType}. Publish one to get started.</p>
      {:else}
        <div class="version-card">
          <div class="version-meta">
            <span class="version-badge">v{activeVersion.versionNumber}</span>
            <span class="active-badge">Active</span>
            <span class="meta-text">Published by {activeVersion.createdBy} on {formatDate(activeVersion.createdAt)}</span>
          </div>
          <div class="reason-note">
            <span class="label">Reason:</span> {activeVersion.reasonNote}
          </div>
          <div class="payload-preview">
            <span class="label">Payload:</span>
            <pre class="payload-json">{JSON.stringify(activeVersion.payload, null, 2)}</pre>
          </div>
          <button class="btn-link" on:click={() => loadHistory(activeVersion.entityId)} disabled={historyLoading}>
            {historyLoading ? 'Loading…' : showHistoryFor === activeVersion.entityId ? 'Hide history' : 'View history'}
          </button>
        </div>

        {#if showHistoryFor === activeVersion.entityId && historyCache[activeVersion.entityId]}
          <div class="history-section">
            <h4>Version History</h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Published</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {#each historyCache[activeVersion.entityId] as v}
                  <tr>
                    <td>v{v.versionNumber}</td>
                    <td>
                      {#if v.isActive}
                        <span class="active-badge">Active</span>
                      {:else}
                        <span class="inactive-badge">Superseded</span>
                      {/if}
                    </td>
                    <td>{v.reasonNote}</td>
                    <td>{formatDate(v.createdAt)}</td>
                    <td>{v.createdBy}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      {/if}
    </section>
  {:else if mainTab === 'lookup-data'}
    <nav class="entity-tabs">
      {#each lookupStores as store}
        <button class:active={activeLookupStore === store} on:click={() => activeLookupStore = store}>
          {store.charAt(0).toUpperCase() + store.slice(1)}
        </button>
      {/each}
    </nav>

    {#if activeLookupStore !== 'styles'}
      <section class="panel">
        <div class="section-header">
          <h3>{activeLookupStore.charAt(0).toUpperCase() + activeLookupStore.slice(1)}</h3>
          {#if canManage}
            <button class="btn-primary" on:click={() => { showLookupForm = true; lookupFormError = ''; lookupFormName = ''; lookupFormReason = ''; }}>
              + Add {activeLookupStore.slice(0, -1)}
            </button>
          {/if}
        </div>
        {#if lookupLoading}
          <p class="loading-hint">Loading…</p>
        {:else if !lookupEntries[activeLookupStore] || lookupEntries[activeLookupStore].length === 0}
          <p class="empty-hint">No {activeLookupStore} defined yet.</p>
        {:else}
          <table class="data-table">
            <thead>
              <tr><th>Name</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {#each lookupEntries[activeLookupStore] as entry}
                <tr class:inactive-row={!entry.isActive}>
                  <td>{entry.name}</td>
                  <td>
                    {#if entry.isActive}
                      <span class="active-badge">Active</span>
                    {:else}
                      <span class="inactive-badge">Inactive</span>
                    {/if}
                  </td>
                  <td>
                    {#if entry.isActive}
                      <button class="btn-xs btn-danger-xs" on:click={() => openDeactivateModal(entry.id)}>Deactivate</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>
    {:else}
      <!-- Styles section -->
      <section class="panel">
        <div class="section-header">
          <h3>Style SKUs</h3>
          {#if canManage}<button class="btn-primary" on:click={openStyleForm}>+ New Style</button>{/if}
        </div>
        {#if stylesLoading}
          <p class="loading-hint">Loading…</p>
        {:else if styles.length === 0}
          <p class="empty-hint">No styles defined. Create reference data (colors, sizes, etc.) first, then add styles.</p>
        {:else}
          <table class="data-table">
            <thead>
              <tr><th>SKU</th><th>Color</th><th>Size</th><th>Season</th><th>Brand</th><th>Supplier</th><th>Status</th>{#if canManage}<th></th>{/if}</tr>
            </thead>
            <tbody>
              {#each styles as s}
                <tr>
                  <td class="mono">{s.sku}</td>
                  <td>{s.colorId ?? '—'}</td>
                  <td>{s.sizeId ?? '—'}</td>
                  <td>{s.seasonId ?? '—'}</td>
                  <td>{s.brandId ?? '—'}</td>
                  <td>{s.supplierId ?? '—'}</td>
                  <td>{s.isActive ? 'Active' : 'Inactive'}</td>
                  {#if canManage}
                    <td>{#if s.isActive}<button class="btn-xs btn-danger-xs" on:click={() => openStyleDeactivate(s.id)}>Deactivate</button>{/if}</td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<!-- Create lookup entry modal -->
{#if showLookupForm}
  <div class="modal-overlay" role="presentation" on:click={() => showLookupForm = false} on:keydown={(e) => { if (e.key === 'Escape') showLookupForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>Add {activeLookupStore.charAt(0).toUpperCase() + activeLookupStore.slice(1, -1)}</h3>
      {#if lookupFormError}<div class="form-error">{lookupFormError}</div>{/if}
      <label>Name <input type="text" bind:value={lookupFormName} placeholder="Enter name" /></label>
      <label>Reason (min 10 chars) <input type="text" bind:value={lookupFormReason} placeholder="Why is this entry needed?" /></label>
      <div class="modal-actions">
        <button on:click={() => showLookupForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleCreateLookupEntry}
          disabled={lookupFormLoading || !lookupFormName.trim() || lookupFormReason.trim().length < 10}>
          {lookupFormLoading ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Create style modal -->
{#if showStyleForm}
  <div class="modal-overlay" role="presentation" on:click={() => showStyleForm = false} on:keydown={(e) => { if (e.key === 'Escape') showStyleForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>New Style SKU</h3>
      {#if styleFormError}<div class="form-error">{styleFormError}</div>{/if}
      <label>SKU <input type="text" bind:value={styleFormSku} placeholder="e.g. SKU-001-BLK-S" /></label>
      <label>Color
        <select bind:value={styleFormColorId}>
          <option value="">— None —</option>
          {#each styleFormOptions.colors as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label>Size
        <select bind:value={styleFormSizeId}>
          <option value="">— None —</option>
          {#each styleFormOptions.sizes as s}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </label>
      <label>Season
        <select bind:value={styleFormSeasonId}>
          <option value="">— None —</option>
          {#each styleFormOptions.seasons as s}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </label>
      <label>Brand
        <select bind:value={styleFormBrandId}>
          <option value="">— None —</option>
          {#each styleFormOptions.brands as b}<option value={b.id}>{b.name}</option>{/each}
        </select>
      </label>
      <label>Supplier
        <select bind:value={styleFormSupplierId}>
          <option value="">— None —</option>
          {#each styleFormOptions.suppliers as s}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </label>
      <label>Reason (min 10 chars) <input type="text" bind:value={styleFormReason} placeholder="Why is this style being created?" /></label>
      <div class="modal-actions">
        <button on:click={() => showStyleForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleCreateStyle}
          disabled={styleFormLoading || !styleFormSku.trim() || styleFormReason.trim().length < 10}>
          {styleFormLoading ? 'Creating…' : 'Create Style'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Publish modal -->
{#if showModal}
  <div class="modal-overlay" role="presentation" on:click={() => showModal = false} on:keydown={(e) => { if (e.key === 'Escape') showModal = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>Publish New Version — {activeEntityType}</h3>
      {#if modalError}<div class="form-error">{modalError}</div>{/if}
      <label>Entity ID
        <input type="text" bind:value={newEntityId} />
      </label>
      <label>Payload (JSON)
        <textarea bind:value={newPayloadJson} rows="6" class="code-input"></textarea>
      </label>
      <label>Reason Note (min 10 characters)
        <input type="text" bind:value={newReasonNote} placeholder="Why are you publishing this version?" />
        <span class="char-count" class:error={newReasonNote.length > 0 && newReasonNote.trim().length < 10}>
          {newReasonNote.trim().length}/10 min
        </span>
      </label>
      {#if expectedActiveVersionId}
        <p class="concurrency-note">Will supersede version currently active (concurrency-checked).</p>
      {/if}
      <div class="modal-actions">
        <button on:click={() => showModal = false}>Cancel</button>
        <button
          class="btn-primary"
          on:click={handlePublish}
          disabled={modalLoading || newReasonNote.trim().length < 10}
        >
          {modalLoading ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Deactivate lookup entry modal -->
{#if showDeactivateModal}
  <div class="modal-overlay" role="presentation" on:click={() => showDeactivateModal = false} on:keydown={(e) => { if (e.key === 'Escape') showDeactivateModal = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>Deactivate Entry</h3>
      {#if deactivateError}<div class="form-error">{deactivateError}</div>{/if}
      <label>Reason (min 10 chars) <input type="text" bind:value={deactivateReason} placeholder="Why is this entry being deactivated?" /></label>
      <div class="modal-actions">
        <button on:click={() => showDeactivateModal = false}>Cancel</button>
        <button class="btn-primary" on:click={handleDeactivateLookup}
          disabled={deactivateLoading || deactivateReason.trim().length < 10}>
          {deactivateLoading ? 'Deactivating…' : 'Deactivate'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Deactivate style modal -->
{#if showStyleDeactivateModal}
  <div class="modal-overlay" role="presentation" on:click={() => showStyleDeactivateModal = false} on:keydown={(e) => { if (e.key === 'Escape') showStyleDeactivateModal = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>Deactivate Style</h3>
      {#if styleDeactivateError}<div class="form-error">{styleDeactivateError}</div>{/if}
      <label>Reason (min 10 chars) <input type="text" bind:value={styleDeactivateReason} placeholder="Why is this style being deactivated?" /></label>
      <div class="modal-actions">
        <button on:click={() => showStyleDeactivateModal = false}>Cancel</button>
        <button class="btn-primary" on:click={handleStyleDeactivate}
          disabled={styleDeactivateLoading || styleDeactivateReason.trim().length < 10}>
          {styleDeactivateLoading ? 'Deactivating…' : 'Deactivate'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 1.5rem; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  h2, h3, h4 { margin: 0 0 0.5rem; }
  .entity-tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-bottom: 1rem; }
  button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  button.active { background: #2563eb; color: #fff; border-color: #2563eb; }
  .btn-primary { background: #2563eb; color: #fff; border: none; border-radius: 4px; padding: 0.4rem 0.75rem; cursor: pointer; }
  .btn-link { background: none; border: none; color: #2563eb; font-size: 0.8rem; cursor: pointer; padding: 0; text-decoration: underline; margin-top: 0.75rem; }
  .panel { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 1.5rem; }
  .empty-hint, .loading-hint { color: #888; font-style: italic; font-size: 0.875rem; }
  .version-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 1rem; }
  .version-meta { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
  .version-badge { background: #1e40af; color: #fff; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .active-badge { background: #dcfce7; color: #166534; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .inactive-badge { background: #f1f5f9; color: #64748b; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; }
  .meta-text { font-size: 0.8rem; color: #64748b; }
  .reason-note, .payload-preview { font-size: 0.875rem; margin-top: 0.5rem; }
  .label { font-weight: 600; margin-right: 0.25rem; }
  .payload-json { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 0.5rem; font-size: 0.8rem; max-height: 150px; overflow-y: auto; margin-top: 0.25rem; white-space: pre-wrap; }
  .history-section { margin-top: 1.5rem; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .data-table th { text-align: left; padding: 0.4rem 0.75rem; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 0.75rem; text-transform: uppercase; color: #64748b; }
  .data-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f1f5f9; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: #fff; border-radius: 8px; padding: 2rem; width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 0.75rem; }
  .modal h3 { margin: 0 0 0.5rem; }
  .modal label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 500; }
  .modal input, .modal textarea, .modal select { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; font-family: inherit; }
  .code-input { font-family: monospace; font-size: 0.8rem; }
  .char-count { font-size: 0.75rem; color: #888; font-weight: normal; }
  .char-count.error { color: #dc2626; }
  .concurrency-note { font-size: 0.8rem; color: #64748b; font-style: italic; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.5rem; }
  .modal button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .form-error { background: #fee2e2; color: #991b1b; border-radius: 4px; padding: 0.5rem 0.75rem; font-size: 0.8rem; }
  .main-tabs { display: flex; gap: 0.25rem; margin-bottom: 1rem; }
  .main-tabs button { padding: 0.5rem 1rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .main-tabs button.active { background: #2563eb; color: #fff; border-color: #2563eb; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .loading-hint { color: #888; font-style: italic; font-size: 0.875rem; }
  .inactive-row { opacity: 0.5; }
  .btn-xs { padding: 0.15rem 0.5rem; font-size: 0.75rem; border-radius: 3px; cursor: pointer; border: 1px solid #ddd; background: #fff; }
  .btn-danger-xs { border-color: #fca5a5; color: #dc2626; }
  .mono { font-family: monospace; font-size: 0.8rem; }
</style>
