<script>
  import { nlpService } from '../services/NLPService.js';
  import { currentUser } from '../app/stores/auth.js';
  import { orgTree, resolveOrgContext } from '../app/stores/org.js';
  import { showToast } from '../app/stores/ui.js';
  import { NLP } from '../utils/constants.js';

  const tabs = ['runs', 'texts', 'clusters', 'profiles'];
  let activeTab = 'runs';

  // Run history
  let runs = [];
  let runsLoading = false;
  let selectedRun = null;
  let runDetailLoading = false;

  // Texts (derived from run input IDs — no direct service list method, we show from last run)
  let importedTexts = [];
  let textsLoading = false;

  // Topic clustering
  let clusters = {};
  let clustersLoading = false;

  // Validation profiles — loaded lazily when tab is opened
  let profiles = [];
  let profilesLoading = false;

  // Import text form
  let showImportForm = false;
  let importSourceType = '';
  let importFilename = '';
  let importRawText = '';
  let importError = '';
  let importLoading = false;

  // Run form
  let runModelVersion = 'v1.0';
  let runLoading = false;

  // Profile form (admin only)
  let showProfileForm = false;
  let profileModelVersion = '';
  let profileCorpus = '';
  let profilePrecision = '';
  let profileRecall = '';
  let profileF1 = '';
  let profileSampleCount = '';
  let profileError = '';
  let profileLoading = false;

  $: actorId = $currentUser?.id ?? '';
  $: orgId = resolveOrgContext($currentUser, $orgTree).organizationId || ($currentUser?.organizationNodeId ?? '');
  $: isAdmin = $currentUser?.role === 'administrator';
  $: isAnalyst = $currentUser?.role === 'analyst' || isAdmin;
  $: f1Threshold = nlpService.getF1Threshold();

  $: if (orgId) {
    loadRuns();
    nlpService.loadPersistedThreshold(orgId).then(() => {
      f1Threshold = nlpService.getF1Threshold();
    }).catch(() => {});
  }

  async function loadRuns() {
    if (!orgId) return;
    runsLoading = true;
    try {
      runs = await nlpService.getRunHistory(orgId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      runsLoading = false;
    }
  }

  async function switchTab(tab) {
    activeTab = tab;
    if (tab === 'runs') await loadRuns();
    if (tab === 'texts') await loadTexts();
    if (tab === 'clusters') await loadClusters();
    if (tab === 'profiles') await loadProfiles();
  }

  async function loadClusters() {
    clustersLoading = true;
    try {
      clusters = await nlpService.clusterTopics(orgId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      clustersLoading = false;
    }
  }

  async function loadProfiles() {
    profilesLoading = true;
    try {
      profiles = await nlpService.listProfiles();
    } catch (err) {
      showToast('error', err.message);
    } finally {
      profilesLoading = false;
    }
  }

  async function loadTexts() {
    textsLoading = true;
    try {
      importedTexts = await nlpService.getImportedTexts(orgId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      textsLoading = false;
    }
  }

  async function handleImportText() {
    importError = '';
    importLoading = true;
    try {
      await nlpService.importText({
        organizationId: orgId,
        sourceType: importSourceType,
        sourceId: 'manual_import',
        filename: importFilename,
        rawText: importRawText,
        actorId,
      });
      showImportForm = false;
      importSourceType = '';
      importFilename = '';
      importRawText = '';
      showToast('success', 'Text imported successfully.');
    } catch (err) {
      importError = err.message;
    } finally {
      importLoading = false;
    }
  }

  async function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    importFilename = file.name;
    importRawText = await file.text();
  }

  async function handleRunBatch() {
    runLoading = true;
    try {
      const run = await nlpService.runBatch({ organizationId: orgId, modelVersion: runModelVersion, actorId });
      runs = [run, ...runs];
      selectedRun = run;
      showToast('success', `Batch run complete — ${run.inputIds.length} text(s) analysed.`);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      runLoading = false;
    }
  }

  async function handleRunIncremental() {
    runLoading = true;
    try {
      const run = await nlpService.runIncremental({ organizationId: orgId, modelVersion: runModelVersion, actorId });
      runs = [run, ...runs];
      selectedRun = run;
      showToast('success', `Incremental run complete — ${run.inputIds.length} new text(s) analysed.`);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      runLoading = false;
    }
  }

  async function selectRun(run) {
    runDetailLoading = true;
    try {
      selectedRun = await nlpService.getRunDetail(run.id);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      runDetailLoading = false;
    }
  }

  async function handleCreateProfile() {
    profileError = '';
    profileLoading = true;
    try {
      const p = await nlpService.createValidationProfile({
        modelVersion: profileModelVersion,
        corpusName: profileCorpus,
        precision: parseFloat(profilePrecision),
        recall: parseFloat(profileRecall),
        f1: parseFloat(profileF1),
        labeledSampleCount: parseInt(profileSampleCount, 10),
        actorId,
      });
      profiles = [p, ...profiles];
      showProfileForm = false;
      profileModelVersion = '';
      profileCorpus = '';
      profilePrecision = '';
      profileRecall = '';
      profileF1 = '';
      profileSampleCount = '';
      showToast('success', 'Validation profile created.');
    } catch (err) {
      profileError = err.message;
    } finally {
      profileLoading = false;
    }
  }

  function formatDate(ms) {
    return ms ? new Date(ms).toLocaleString() : '—';
  }

  function outputEntries(run) {
    return Object.entries(run.outputPayload ?? {});
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>NLP Analysis</h2>
    <div class="actions">
      {#if isAnalyst}
        <button class="btn-secondary" on:click={() => { showImportForm = true; importError = ''; }}>Import Text</button>
        <div class="run-group">
          <input
            type="text"
            bind:value={runModelVersion}
            class="model-input"
            placeholder="Model version"
          />
          <button class="btn-primary" on:click={handleRunBatch} disabled={runLoading}>
            {runLoading ? 'Running…' : 'Run Batch'}
          </button>
          <button class="btn-secondary" on:click={handleRunIncremental} disabled={runLoading}>
            {runLoading ? 'Running…' : 'Analyze New Notes'}
          </button>
        </div>
        <span class="auto-ingest-hint">Incremental analysis auto-includes new CRM and ticket notes.</span>
      {/if}
    </div>
  </header>

  <nav class="tab-bar">
    {#each tabs as tab}
      <button class:active={activeTab === tab} on:click={() => switchTab(tab)}>
        {tab.charAt(0).toUpperCase() + tab.slice(1)}
      </button>
    {/each}
  </nav>

  <div class="panel">
    <!-- Runs tab -->
    {#if activeTab === 'runs'}
      <div class="runs-layout">
        <div class="run-list">
          {#if runsLoading}
            <p class="loading-hint">Loading…</p>
          {:else if runs.length === 0}
            <p class="empty-hint">No NLP runs yet.</p>
          {:else}
            {#each runs as run}
              <button
                class="run-row"
                class:selected={selectedRun?.id === run.id}
                on:click={() => selectRun(run)}
                disabled={runDetailLoading}
              >
                <span class="run-type">{run.runType}</span>
                <span class="run-model">{run.modelVersion}</span>
                {#if run.belowF1Threshold}
                  <span class="f1-alert" title="F1 below threshold {f1Threshold}">⚠ F1</span>
                {/if}
                <span class="run-date">{formatDate(run.createdAt)}</span>
              </button>
            {/each}
          {/if}
        </div>

        <div class="run-detail">
          {#if runDetailLoading}
            <div class="empty-state">Loading run details…</div>
          {:else if !selectedRun}
            <div class="empty-state">Select a run to view details.</div>
          {:else}
            <div class="detail-header">
              <h3>{selectedRun.runType} — {selectedRun.modelVersion}</h3>
              <span class="meta">{formatDate(selectedRun.createdAt)}</span>
            </div>

            {#if selectedRun.belowF1Threshold}
              <div class="f1-alert-banner">
                ⚠ F1 score ({selectedRun.benchmarkF1?.toFixed(2)}) is below the alert threshold ({f1Threshold}).
                Review the validation profile for model version {selectedRun.modelVersion}.
              </div>
            {/if}

            <div class="metrics-row">
              <div class="metric"><span class="metric-label">Texts analysed</span><span>{selectedRun.inputIds.length}</span></div>
              <div class="metric"><span class="metric-label">Precision</span><span>{selectedRun.benchmarkPrecision?.toFixed(2) ?? '—'}</span></div>
              <div class="metric"><span class="metric-label">Recall</span><span>{selectedRun.benchmarkRecall?.toFixed(2) ?? '—'}</span></div>
              <div class="metric"><span class="metric-label">F1</span><span class:low={selectedRun.belowF1Threshold}>{selectedRun.benchmarkF1?.toFixed(2) ?? '—'}</span></div>
            </div>

            {#if outputEntries(selectedRun).length > 0}
              <div class="output-section">
                <h4>Sample Output (first text)</h4>
                {#each [outputEntries(selectedRun)[0]] as [textId, result]}
                  <div class="output-card">
                    <div class="output-row"><span class="label">Text ID</span> <code>{textId.slice(0, 12)}…</code></div>
                    <div class="output-row"><span class="label">Keywords</span> {result.keywords.join(', ')}</div>
                    <div class="output-row"><span class="label">Topics</span> {result.topics.join(', ') || '—'}</div>
                    <div class="output-row"><span class="label">Sentiment</span> {result.sentiment.label} (score: {result.sentiment.score})</div>
                    <div class="output-row"><span class="label">Entities</span>
                      {#if result.entities?.length > 0}
                        {#each result.entities as entity}
                          <span class="entity-tag">{entity.text} <span class="entity-type">{entity.type}</span></span>
                        {/each}
                      {:else}
                        —
                      {/if}
                    </div>
                    <div class="output-row"><span class="label">Summary</span> {result.summary}</div>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>

    <!-- Texts tab -->
    {:else if activeTab === 'texts'}
      {#if textsLoading}
        <p class="loading-hint">Loading…</p>
      {:else if importedTexts.length === 0}
        <p class="empty-hint">No texts imported yet. CRM and ticket notes are auto-ingested when you run incremental analysis. You can also import texts manually.</p>
      {:else}
        <table class="data-table">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Source Type</th>
              <th>Characters</th>
              <th>Imported At</th>
            </tr>
          </thead>
          <tbody>
            {#each importedTexts as t}
              <tr>
                <td>{t.filename}</td>
                <td>{t.sourceType}</td>
                <td>{t.rawText?.length ?? 0}</td>
                <td>{formatDate(t.importedAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

    <!-- Clusters tab -->
    {:else if activeTab === 'clusters'}
      <div class="section-header">
        <h3>Topic Clusters</h3>
        <button class="btn-primary" on:click={loadClusters} disabled={clustersLoading}>
          {clustersLoading ? 'Clustering…' : 'Run Topic Clustering'}
        </button>
      </div>

      {#if Object.keys(clusters).length === 0}
        <p class="empty-hint">No clusters yet. Run a batch analysis first, then cluster.</p>
      {:else}
        {#each Object.entries(clusters) as [topic, textIds]}
          <div class="cluster-group">
            <h4 class="cluster-topic">{topic}</h4>
            <p class="cluster-count">{textIds.length} text(s)</p>
            <ul class="cluster-ids">
              {#each textIds as id}
                <li class="mono">{id.slice(0, 12)}…</li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}

    <!-- F1 Threshold config -->
      {#if isAdmin}
        <div class="config-section">
          <h4>F1 Alert Threshold</h4>
          <p class="hint">Runs with F1 below this threshold are flagged. Default: 0.70</p>
          <div class="threshold-control">
            <input type="number" min="0" max="1" step="0.05" bind:value={f1Threshold} />
            <button class="btn-secondary" on:click={async () => {
              try {
                await nlpService.setF1Threshold(f1Threshold, orgId);
                showToast('success', `Threshold set to ${f1Threshold}.`);
              } catch (err) { showToast('error', err.message); }
            }}>
              Save Threshold
            </button>
          </div>
        </div>
      {/if}

    <!-- Profiles tab -->
    {:else if activeTab === 'profiles'}
      <div class="section-header">
        <h3>Validation Profiles</h3>
        {#if isAdmin}
          <button class="btn-primary" on:click={() => { showProfileForm = true; profileError = ''; }}>+ New Profile</button>
        {/if}
      </div>
      {#if profiles.length === 0}
        <p class="empty-hint">No validation profiles. An administrator must create one for quality metrics to be shown in run results.</p>
      {:else}
        <table class="data-table">
          <thead>
            <tr><th>Model</th><th>Corpus</th><th>Precision</th><th>Recall</th><th>F1</th><th>Samples</th><th>Created</th></tr>
          </thead>
          <tbody>
            {#each profiles as p}
              <tr>
                <td>{p.modelVersion}</td>
                <td>{p.corpusName}</td>
                <td>{p.precision.toFixed(2)}</td>
                <td>{p.recall.toFixed(2)}</td>
                <td class:low={p.f1 < f1Threshold}>{p.f1.toFixed(2)}</td>
                <td>{p.labeledSampleCount}</td>
                <td>{formatDate(p.createdAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/if}
  </div>
</div>

<!-- Import text modal -->
{#if showImportForm}
  <div class="modal-overlay" role="presentation" on:click={() => showImportForm = false} on:keydown={(e) => { if (e.key === 'Escape') showImportForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>Import Text</h3>
      {#if importError}<div class="form-error">{importError}</div>{/if}
      <label>Upload file (optional — overrides text area)
        <input type="file" accept=".txt,.csv,.json,.md" on:change={handleFileUpload} />
        <span class="file-hint">Uploading a file will replace the text area content.</span>
      </label>
      <label>Source Type <input type="text" bind:value={importSourceType} placeholder="e.g. customer_note, review" /></label>
      <label>Filename <input type="text" bind:value={importFilename} placeholder="e.g. notes_2024.txt" /></label>
      <label>Text Content
        <textarea bind:value={importRawText} rows="6" placeholder="Paste or type text content here…"></textarea>
      </label>
      <div class="modal-actions">
        <button on:click={() => showImportForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleImportText}
          disabled={importLoading || !importSourceType.trim() || !importFilename.trim() || !importRawText.trim()}>
          {importLoading ? 'Importing…' : 'Import'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- New profile modal (admin only) -->
{#if showProfileForm}
  <div class="modal-overlay" role="presentation" on:click={() => showProfileForm = false} on:keydown={(e) => { if (e.key === 'Escape') showProfileForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>New Validation Profile</h3>
      {#if profileError}<div class="form-error">{profileError}</div>{/if}
      <label>Model Version <input type="text" bind:value={profileModelVersion} /></label>
      <label>Corpus Name <input type="text" bind:value={profileCorpus} /></label>
      <div class="metric-inputs">
        <label>Precision (0–1) <input type="number" min="0" max="1" step="0.01" bind:value={profilePrecision} /></label>
        <label>Recall (0–1) <input type="number" min="0" max="1" step="0.01" bind:value={profileRecall} /></label>
        <label>F1 (0–1) <input type="number" min="0" max="1" step="0.01" bind:value={profileF1} /></label>
      </div>
      <label>Labeled Sample Count <input type="number" min="1" step="1" bind:value={profileSampleCount} /></label>
      <div class="modal-actions">
        <button on:click={() => showProfileForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleCreateProfile} disabled={profileLoading}>
          {profileLoading ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 1.5rem; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; }
  h2, h3, h4 { margin: 0 0 0.5rem; }
  .actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .run-group { display: flex; align-items: center; gap: 0.4rem; }
  .model-input { padding: 0.35rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; width: 120px; }
  .tab-bar { display: flex; gap: 0.25rem; margin-bottom: 1rem; }
  button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  button.active { background: #2563eb; color: #fff; border-color: #2563eb; }
  .btn-primary { background: #2563eb; color: #fff; border: none; }
  .btn-secondary { background: #fff; color: #2563eb; border-color: #2563eb; }
  .panel { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 1.5rem; }
  .runs-layout { display: grid; grid-template-columns: 240px 1fr; gap: 1rem; min-height: 400px; }
  .run-list { display: flex; flex-direction: column; gap: 0.25rem; border-right: 1px solid #e2e8f0; padding-right: 1rem; overflow-y: auto; }
  .run-row { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.5rem 0.75rem; border-radius: 4px; border: 1px solid transparent; cursor: pointer; background: #fff; text-align: left; font-size: 0.8rem; }
  .run-row:hover { background: #f1f5f9; }
  .run-row.selected { background: #eff6ff; border-color: #bfdbfe; }
  .run-type { font-weight: 600; text-transform: capitalize; }
  .run-model { color: #475569; }
  .run-date { color: #94a3b8; font-size: 0.75rem; }
  .f1-alert { color: #d97706; font-size: 0.75rem; }
  .run-detail { padding-left: 1rem; }
  .empty-state { display: flex; align-items: center; justify-content: center; height: 200px; color: #888; }
  .detail-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; }
  .meta { font-size: 0.8rem; color: #888; }
  .f1-alert-banner { background: #fef9c3; border: 1px solid #fde68a; color: #854d0e; padding: 0.5rem 0.75rem; border-radius: 4px; font-size: 0.875rem; margin-bottom: 1rem; }
  .metrics-row { display: flex; gap: 1.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
  .metric { display: flex; flex-direction: column; gap: 0.1rem; }
  .metric-label { font-size: 0.7rem; color: #888; text-transform: uppercase; }
  .low { color: #d97706; font-weight: 600; }
  .output-section { margin-top: 1rem; }
  .output-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; font-size: 0.875rem; display: flex; flex-direction: column; gap: 0.35rem; }
  .output-row { display: flex; gap: 0.5rem; }
  .label { font-weight: 600; min-width: 80px; color: #475569; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .data-table th { text-align: left; padding: 0.4rem 0.75rem; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 0.75rem; text-transform: uppercase; color: #64748b; }
  .data-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f1f5f9; }
  .empty-hint, .loading-hint { color: #888; font-size: 0.875rem; font-style: italic; }
  .metric-inputs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: #fff; border-radius: 8px; padding: 2rem; width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 0.75rem; }
  .modal h3 { margin: 0 0 0.5rem; }
  .modal label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 500; }
  .modal input, .modal textarea { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; font-family: inherit; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.5rem; }
  .modal button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .form-error { background: #fee2e2; color: #991b1b; border-radius: 4px; padding: 0.5rem 0.75rem; font-size: 0.8rem; }
  code { font-family: monospace; font-size: 0.85em; }
  .file-hint { font-size: 0.75rem; color: #888; font-weight: normal; }
  .auto-ingest-hint { font-size: 0.75rem; color: #64748b; font-style: italic; }
  .entity-tag { display: inline-flex; align-items: center; gap: 0.2rem; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 0.1rem 0.35rem; font-size: 0.78rem; margin: 0.1rem 0.15rem 0.1rem 0; }
  .entity-type { background: #dbeafe; color: #1e40af; border-radius: 3px; padding: 0.05rem 0.25rem; font-size: 0.7rem; font-weight: 600; }
  .cluster-group { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.5rem; }
  .cluster-topic { margin: 0 0 0.25rem; font-size: 0.9rem; text-transform: capitalize; }
  .cluster-count { margin: 0; font-size: 0.8rem; color: #64748b; }
  .cluster-ids { margin: 0.25rem 0 0; padding-left: 1.2rem; font-size: 0.75rem; color: #475569; }
  .config-section { margin-top: 1.5rem; border-top: 1px solid #e2e8f0; padding-top: 1rem; }
  .threshold-control { display: flex; gap: 0.5rem; align-items: center; }
  .threshold-control input { width: 80px; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; }
  @media (max-width: 768px) {
    .runs-layout { grid-template-columns: 1fr; }
    .metric-inputs { grid-template-columns: 1fr; }
    .page { padding: 0.75rem; }
    .data-table { display: block; overflow-x: auto; }
  }
</style>
