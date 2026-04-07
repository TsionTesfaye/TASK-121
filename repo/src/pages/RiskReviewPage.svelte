<script>
  import { riskReviewService } from '../services/RiskReviewService.js';
  import { currentUser, currentRole } from '../app/stores/auth.js';
  import { orgTree, resolveOrgContext } from '../app/stores/org.js';
  import { showToast } from '../app/stores/ui.js';
  import { RISK_CASE_STATUSES, OUTCOME_CODES, ROLES } from '../utils/constants.js';
  import { generateFingerprint } from '../utils/fingerprint.js';

  const outcomeCodes = Object.values(OUTCOME_CODES);
  const tabs = ['inbox', 'rules'];

  let activeTab = 'inbox';

  // Inbox tab
  let cases = [];
  let loading = false;
  let filterStatus = '';

  let selectedCase = null;
  let outcomeCode = '';
  let resolutionComment = '';
  let actionLoading = false;

  // Rules tab
  let rules = [];
  let rulesLoading = false;
  let showRuleForm = false;
  let ruleFormName = '';
  let ruleFormType = 'field_contains';
  let ruleFormEntityType = '*';
  let ruleFormField = '';
  let ruleFormValue = '';
  let ruleFormThreshold = '';
  let ruleFormError = '';
  let ruleFormLoading = false;

  // Sensitive words
  let sensitiveWordsText = '';
  let sensitiveWordsLoading = false;

  // Evaluate entity
  let evalEntityType = '';
  let evalEntityId = '';
  let evalPayloadJson = '{}';
  let evalResult = null;
  let evalLoading = false;
  let evalError = '';

  // Image validation
  let imageFile = null;
  let imageResult = null;
  let imageLoading = false;
  let imageError = '';

  // Bidding heuristic
  let heuristicItemId = '';
  let heuristicResult = null;
  let heuristicLoading = false;
  let heuristicError = '';
  let caseFromHeuristicLoading = false;

  // Bid event ingestion
  let bidItemId = '';
  let bidUserId = '';
  let bidAmount = '';
  let bidLoading = false;
  let bidError = '';

  // Linked account ingestion
  let linkPrimary = '';
  let linkLinked = '';
  let linkType = '';
  let linkDetails = '';
  let linkLoading = false;
  let linkError = '';

  $: actorId = $currentUser?.id ?? '';
  $: orgId = resolveOrgContext($currentUser, $orgTree).organizationId || ($currentUser?.organizationNodeId ?? '');
  $: isAdmin = $currentRole === ROLES.ADMINISTRATOR;
  $: isManager = $currentRole === ROLES.STORE_MANAGER || isAdmin;
  $: isReviewer = $currentRole === ROLES.REVIEWER || isAdmin;

  $: filteredCases = cases.filter((c) =>
    !filterStatus || c.status === filterStatus
  );

  $: canSubmit = outcomeCode && resolutionComment.trim().length > 0;

  $: if (orgId) {
    loadInbox();
    // Load persisted dictionary for this org on mount/org-switch.
    riskReviewService.loadPersistedDictionary(orgId).catch(() => {});
  }

  async function switchTab(tab) {
    activeTab = tab;
    if (tab === 'rules') await loadRules();
  }

  async function loadInbox() {
    if (!orgId) return;
    loading = true;
    try {
      cases = await riskReviewService.getInbox(orgId);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      loading = false;
    }
  }

  async function loadRules() {
    rulesLoading = true;
    try {
      rules = await riskReviewService.listRules(orgId);
      sensitiveWordsText = riskReviewService.getSensitiveWords().join(', ');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      rulesLoading = false;
    }
  }

  function selectCase(c) {
    selectedCase = c;
    outcomeCode = c.outcomeCode ?? '';
    resolutionComment = c.resolutionComment ?? '';
  }

  async function handleAssign() {
    if (!selectedCase) return;
    actionLoading = true;
    try {
      const updated = await riskReviewService.assignCase(selectedCase.id, actorId, actorId);
      cases = cases.map((c) => (c.id === updated.id ? updated : c));
      selectedCase = updated;
      showToast('success', 'Case assigned to you.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      actionLoading = false;
    }
  }

  async function handleResolve() {
    if (!selectedCase || !canSubmit) return;
    actionLoading = true;
    try {
      const updated = await riskReviewService.resolveCase({
        caseId: selectedCase.id,
        outcomeCode,
        resolutionComment,
        reviewerId: actorId,
      });
      cases = cases.filter((c) => c.id !== updated.id); // Remove from inbox (terminal)
      selectedCase = null;
      outcomeCode = '';
      resolutionComment = '';
      showToast('success', 'Case resolved.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      actionLoading = false;
    }
  }

  async function handleDismiss() {
    if (!selectedCase || !resolutionComment.trim()) return;
    actionLoading = true;
    try {
      const updated = await riskReviewService.dismissCase(
        selectedCase.id,
        resolutionComment,
        actorId,
      );
      cases = cases.filter((c) => c.id !== updated.id);
      selectedCase = null;
      outcomeCode = '';
      resolutionComment = '';
      showToast('success', 'Case dismissed as false positive.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      actionLoading = false;
    }
  }

  async function handleCreateRule() {
    ruleFormError = '';
    ruleFormLoading = true;
    try {
      const parameters = ruleFormType === 'field_contains'
        ? { field: ruleFormField.trim(), value: ruleFormValue.trim() }
        : { field: ruleFormField.trim(), threshold: parseFloat(ruleFormThreshold) };
      await riskReviewService.createRule({
        organizationId: orgId,
        name: ruleFormName,
        ruleType: ruleFormType,
        targetEntityType: ruleFormEntityType,
        parameters,
        actorId,
      });
      await loadRules();
      showRuleForm = false;
      ruleFormName = '';
      ruleFormField = '';
      ruleFormValue = '';
      ruleFormThreshold = '';
      showToast('success', 'Rule created.');
    } catch (err) {
      ruleFormError = err.message;
    } finally {
      ruleFormLoading = false;
    }
  }

  async function handleDeleteRule(ruleId) {
    try {
      await riskReviewService.deleteRule(ruleId, actorId);
      rules = rules.filter((r) => r.id !== ruleId);
      showToast('success', 'Rule deleted.');
    } catch (err) {
      showToast('error', err.message);
    }
  }

  async function handleUpdateSensitiveWords() {
    sensitiveWordsLoading = true;
    try {
      const words = sensitiveWordsText.split(',').map((w) => w.trim()).filter(Boolean);
      await riskReviewService.updateSensitiveWords(words, actorId);
      showToast('success', 'Sensitive word dictionary updated.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      sensitiveWordsLoading = false;
    }
  }

  async function handleValidateImage() {
    imageError = '';
    imageResult = null;
    if (!imageFile) { imageError = 'Select a file first.'; return; }
    imageLoading = true;
    try {
      imageResult = await riskReviewService.validateImage(imageFile);
    } catch (err) {
      imageError = err.message;
    } finally {
      imageLoading = false;
    }
  }

  async function handleEvaluateHeuristic() {
    heuristicError = '';
    heuristicResult = null;
    if (!heuristicItemId.trim()) { heuristicError = 'Item ID is required.'; return; }
    heuristicLoading = true;
    try {
      heuristicResult = await riskReviewService.evaluateBiddingHeuristics({
        organizationId: orgId,
        itemId: heuristicItemId.trim(),
      });
    } catch (err) {
      heuristicError = err.message;
    } finally {
      heuristicLoading = false;
    }
  }

  async function handleCreateCaseFromHeuristic() {
    if (!heuristicResult?.flagged) return;
    caseFromHeuristicLoading = true;
    try {
      const newCase = await riskReviewService.createCaseFromHeuristic({
        organizationId: orgId,
        itemId: heuristicItemId.trim(),
        heuristicResult,
        actorId,
      });
      if (newCase) {
        await loadInbox();
        showToast('success', 'Risk case created and added to inbox.');
      } else {
        showToast('info', 'No case created (item not flagged).');
      }
    } catch (err) {
      showToast('error', err.message);
    } finally {
      caseFromHeuristicLoading = false;
    }
  }

  async function handleIngestBid() {
    bidError = '';
    bidLoading = true;
    try {
      await riskReviewService.ingestBidEvent({
        organizationId: orgId,
        userId: bidUserId.trim(),
        itemId: bidItemId.trim(),
        bidAmount: parseFloat(bidAmount),
        deviceFingerprint: generateFingerprint(),
        actorId,
      });
      showToast('success', 'Bid event recorded. Run heuristic to evaluate.');
      bidItemId = ''; bidUserId = ''; bidAmount = '';
    } catch (err) {
      bidError = err.message;
    } finally {
      bidLoading = false;
    }
  }

  async function handleIngestLink() {
    linkError = '';
    linkLoading = true;
    try {
      await riskReviewService.ingestLinkedAccount({
        organizationId: orgId,
        primaryUserId: linkPrimary.trim(),
        linkedUserId: linkLinked.trim(),
        evidenceType: linkType.trim() || 'manual_link',
        evidenceDetails: linkDetails.trim() || 'Linked via UI',
        actorId,
      });
      showToast('success', 'Linked account recorded. Run heuristic to evaluate.');
      linkPrimary = ''; linkLinked = ''; linkType = ''; linkDetails = '';
    } catch (err) {
      linkError = err.message;
    } finally {
      linkLoading = false;
    }
  }

  async function handleEvaluate() {
    evalError = '';
    evalResult = null;
    let payload;
    try {
      payload = JSON.parse(evalPayloadJson);
    } catch {
      evalError = 'Payload must be valid JSON.';
      return;
    }
    evalLoading = true;
    try {
      const newCases = await riskReviewService.evaluateRules({
        organizationId: orgId,
        entityType: evalEntityType.trim(),
        entityId: evalEntityId.trim(),
        payload,
        actorId,
      });
      evalResult = newCases.length;
      if (newCases.length > 0) {
        await loadInbox(); // Refresh inbox so new cases appear
        showToast('success', `${newCases.length} case(s) created.`);
      } else {
        showToast('info', 'No rules matched — 0 cases created.');
      }
    } catch (err) {
      evalError = err.message;
    } finally {
      evalLoading = false;
    }
  }

  function statusBadgeClass(status) {
    if (status === RISK_CASE_STATUSES.OPEN) return 'badge--open';
    if (status === RISK_CASE_STATUSES.IN_REVIEW) return 'badge--in-review';
    if (status === RISK_CASE_STATUSES.RESOLVED) return 'badge--resolved';
    return 'badge--dismissed';
  }

  function formatDate(ms) {
    return ms ? new Date(ms).toLocaleString() : '—';
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>Risk Review</h2>
    <div class="tab-bar">
      {#each tabs as tab}
        <button
          class="tab-btn"
          class:tab-btn--active={activeTab === tab}
          on:click={() => switchTab(tab)}
        >
          {tab === 'inbox' ? 'Inbox' : 'Rules'}
        </button>
      {/each}
    </div>
  </header>

  {#if activeTab === 'inbox'}
    <div class="inbox-toolbar">
      <label class="filter-label">
        Status
        <select bind:value={filterStatus}>
          <option value="">All active</option>
          <option value={RISK_CASE_STATUSES.OPEN}>Open</option>
          <option value={RISK_CASE_STATUSES.IN_REVIEW}>In Review</option>
        </select>
      </label>
      <button class="btn-secondary" on:click={loadInbox} disabled={loading}>Refresh</button>
    </div>

    <div class="layout">
      <!-- Case list -->
      <aside class="case-list">
        {#if loading}
          <p class="loading-hint">Loading…</p>
        {:else if filteredCases.length === 0}
          <p class="empty-hint">No active cases.</p>
        {:else}
          {#each filteredCases as c}
            <button
              class="case-row"
              class:selected={selectedCase?.id === c.id}
              on:click={() => selectCase(c)}
            >
              <div class="case-row-header">
                <span class="case-source">{c.sourceType}</span>
                <span class="badge {statusBadgeClass(c.status)}">{c.status}</span>
              </div>
              <span class="case-id">{c.id.slice(0, 12)}…</span>
              <span class="case-date">{formatDate(c.createdAt)}</span>
            </button>
          {/each}
        {/if}
      </aside>

      <!-- Case detail -->
      <main class="case-detail">
        {#if !selectedCase}
          <div class="empty-state">Select a case to review.</div>
        {:else}
          <div class="detail-header">
            <div>
              <h3>Case <code>{selectedCase.id.slice(0, 12)}…</code></h3>
              <span class="badge {statusBadgeClass(selectedCase.status)}">{selectedCase.status}</span>
            </div>
            {#if selectedCase.status === RISK_CASE_STATUSES.OPEN}
              <button class="btn-primary" on:click={handleAssign} disabled={actionLoading}>
                Assign to Me
              </button>
            {/if}
          </div>

          <div class="info-grid">
            <div class="info-item"><span class="info-label">Source Type</span>{selectedCase.sourceType}</div>
            <div class="info-item"><span class="info-label">Source ID</span><code>{selectedCase.sourceId}</code></div>
            <div class="info-item"><span class="info-label">Created</span>{formatDate(selectedCase.createdAt)}</div>
            {#if selectedCase.assignedReviewerId}
              <div class="info-item"><span class="info-label">Assigned to</span><code>{selectedCase.assignedReviewerId.slice(0, 8)}…</code></div>
            {/if}
          </div>

          <!-- Rule matches -->
          {#if selectedCase.ruleMatches?.length > 0}
            <div class="rule-matches">
              <h4>Rule Matches</h4>
              {#each selectedCase.ruleMatches as match}
                <div class="match-row">
                  <span class="match-name">{match.ruleName}</span>
                  {#if match.ruleType}<span class="match-type">{match.ruleType}</span>{/if}
                  {#if match.matches}<span class="match-detail">Matched: {match.matches.join(', ')}</span>{/if}
                  {#if match.reason}<span class="match-detail">{match.reason}</span>{/if}
                  {#if match.evidence?.linkedAccountCount}
                    <span class="match-detail linked-evidence">
                      Linked accounts: {match.evidence.linkedAccountCount} link(s) —
                      users: {match.evidence.linkedUserIds?.join(', ')}
                      {#if match.evidence.evidenceTypes?.length}
                        (evidence types: {match.evidence.evidenceTypes.join(', ')})
                      {/if}
                    </span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          <!-- Resolution form — only for in_review cases -->
          {#if selectedCase.status === RISK_CASE_STATUSES.IN_REVIEW}
            <div class="resolution-form">
              <h4>Resolution</h4>
              <label>
                Outcome Code
                <select bind:value={outcomeCode}>
                  <option value="">Select…</option>
                  {#each outcomeCodes as code}
                    <option value={code}>{code}</option>
                  {/each}
                </select>
              </label>
              <label>
                Comment (required)
                <textarea bind:value={resolutionComment} rows="4" placeholder="Describe your finding…"></textarea>
              </label>
              <div class="form-actions">
                <button
                  class="btn-danger"
                  on:click={handleDismiss}
                  disabled={actionLoading || !resolutionComment.trim()}
                >
                  {actionLoading ? '…' : 'Dismiss (False Positive)'}
                </button>
                <button
                  class="btn-primary"
                  on:click={handleResolve}
                  disabled={actionLoading || !canSubmit}
                >
                  {actionLoading ? '…' : 'Resolve'}
                </button>
              </div>
            </div>
          {/if}
        {/if}
      </main>
    </div>

  <!-- Rules tab -->
  {:else if activeTab === 'rules'}
    <div class="rules-panel">
      <div class="section-header">
        <h3>Risk Detection Rules</h3>
        {#if isManager}
          <button class="btn-primary" on:click={() => { showRuleForm = true; ruleFormError = ''; }}>+ New Rule</button>
        {/if}
      </div>

      {#if rulesLoading}
        <p class="loading-hint">Loading…</p>
      {:else if rules.length === 0}
        <p class="empty-hint">No rules defined. Add a rule to start automatically flagging risky entities.</p>
      {:else}
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Target</th>
              <th>Parameters</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each rules as rule}
              <tr>
                <td>{rule.name}</td>
                <td><span class="type-badge">{rule.ruleType}</span></td>
                <td>{rule.targetEntityType}</td>
                <td class="mono">{JSON.stringify(rule.parameters)}</td>
                {#if isManager}
                  <td>
                    <button class="btn-xs btn-danger-xs" on:click={() => handleDeleteRule(rule.id)}>Delete</button>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <!-- Sensitive words — STORE_MANAGER / ADMIN only -->
      {#if isManager}
      <div class="config-section">
        <h4>Sensitive Word Dictionary</h4>
        <p class="hint">Comma-separated list of words that trigger automatic review when found in any entity payload.</p>
        <textarea class="words-textarea" bind:value={sensitiveWordsText} rows="3" placeholder="e.g. fraud, banned, suspicious"></textarea>
        <button class="btn-secondary" on:click={handleUpdateSensitiveWords}>Update Dictionary</button>
      </div>

      <!-- Evaluate entity -->
      <div class="config-section">
        <h4>Evaluate Entity</h4>
        <p class="hint">Manually run rules against an entity to generate risk cases.</p>
        {#if evalError}<div class="form-error">{evalError}</div>{/if}
        {#if evalResult !== null}
          <div class="eval-result">{evalResult} case(s) generated.</div>
        {/if}
        <div class="eval-grid">
          <label>Entity Type <input type="text" bind:value={evalEntityType} placeholder="order, customer, *" /></label>
          <label>Entity ID <input type="text" bind:value={evalEntityId} placeholder="entity-uuid" /></label>
        </div>
        <label>Payload (JSON)
          <textarea bind:value={evalPayloadJson} rows="4" class="code-input" placeholder="e.g. field: value (JSON)"></textarea>
        </label>
        <button class="btn-primary" on:click={handleEvaluate}
          disabled={evalLoading || !evalEntityType.trim() || !evalEntityId.trim()}>
          {evalLoading ? 'Evaluating…' : 'Evaluate'}
        </button>
      </div>

      <!-- Image validation -->
      <div class="config-section">
        <h4>Image Validation</h4>
        <p class="hint">Validate a product or listing image against content policy rules.</p>
        {#if imageError}<div class="form-error">{imageError}</div>{/if}
        {#if imageResult !== null}
          <div class="eval-result {imageResult.valid ? 'result--valid' : 'result--invalid'}">
            {imageResult.valid ? 'Image passed validation.' : `Validation failed: ${imageResult.error}`}
          </div>
        {/if}
        <label>
          Image File
          <input type="file" accept="image/*" on:change={(e) => { imageFile = e.target.files[0] ?? null; imageResult = null; }} />
        </label>
        <button class="btn-primary" on:click={handleValidateImage} disabled={imageLoading || !imageFile}>
          {imageLoading ? 'Validating…' : 'Validate Image'}
        </button>
      </div>

      <!-- Bidding heuristic -->
      <div class="config-section">
        <h4>Bidding Heuristic Analysis</h4>
        <p class="hint">Detect shill bidding or abnormal bid patterns for a specific item.</p>
        {#if heuristicError}<div class="form-error">{heuristicError}</div>{/if}
        {#if heuristicResult !== null}
          <div class="eval-result {heuristicResult.flagged ? 'result--invalid' : 'result--valid'}">
            {heuristicResult.flagged
              ? `Flagged: ${heuristicResult.reason}`
              : 'No suspicious bidding patterns detected.'}
          </div>
          {#if heuristicResult.flagged}
            <button
              class="btn-danger"
              on:click={handleCreateCaseFromHeuristic}
              disabled={caseFromHeuristicLoading}
            >
              {caseFromHeuristicLoading ? 'Creating case…' : 'Create Risk Case → Inbox'}
            </button>
          {/if}
        {/if}
        <label>
          Item ID
          <input type="text" bind:value={heuristicItemId} placeholder="item-uuid" />
        </label>
        <button class="btn-primary" on:click={handleEvaluateHeuristic} disabled={heuristicLoading || !heuristicItemId.trim()}>
          {heuristicLoading ? 'Analyzing…' : 'Run Heuristic'}
        </button>
      </div>

      <!-- Bid event ingestion -->
      <div class="config-section">
        <h4>Ingest Bid Event</h4>
        <p class="hint">Record a bid event for heuristic analysis.</p>
        {#if bidError}<div class="form-error">{bidError}</div>{/if}
        <div class="eval-grid">
          <label>Item ID <input type="text" bind:value={bidItemId} placeholder="bid-item-id" /></label>
          <label>User ID <input type="text" bind:value={bidUserId} placeholder="bidder-id" /></label>
        </div>
        <label>Bid Amount ($) <input type="number" min="0.01" step="0.01" bind:value={bidAmount} placeholder="e.g. 100.00" /></label>
        <button class="btn-primary" on:click={handleIngestBid}
          disabled={bidLoading || !bidItemId.trim() || !bidUserId.trim() || !bidAmount}>
          {bidLoading ? 'Recording…' : 'Add Bid Event'}
        </button>
      </div>

      <!-- Linked account ingestion -->
      <div class="config-section">
        <h4>Ingest Linked Account</h4>
        <p class="hint">Record a linked account relationship for shill-bidding detection.</p>
        {#if linkError}<div class="form-error">{linkError}</div>{/if}
        <div class="eval-grid">
          <label>Primary User ID <input type="text" bind:value={linkPrimary} placeholder="user-A" /></label>
          <label>Linked User ID <input type="text" bind:value={linkLinked} placeholder="user-B" /></label>
        </div>
        <div class="eval-grid">
          <label>Link Type (optional) <input type="text" bind:value={linkType} placeholder="e.g. same_address" /></label>
          <label>Evidence Details (optional) <input type="text" bind:value={linkDetails} placeholder="e.g. Shared payment method" /></label>
        </div>
        <button class="btn-primary" on:click={handleIngestLink}
          disabled={linkLoading || !linkPrimary.trim() || !linkLinked.trim()}>
          {linkLoading ? 'Recording…' : 'Add Linked Account'}
        </button>
      </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Create rule modal -->
{#if showRuleForm}
  <div class="modal-overlay" role="presentation" on:click={() => showRuleForm = false} on:keydown={(e) => { if (e.key === 'Escape') showRuleForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>New Risk Rule</h3>
      {#if ruleFormError}<div class="form-error">{ruleFormError}</div>{/if}
      <label>Rule Name <input type="text" bind:value={ruleFormName} placeholder="e.g. High stored value alert" /></label>
      <label>Rule Type
        <select bind:value={ruleFormType}>
          <option value="field_contains">Field contains text</option>
          <option value="field_exceeds">Field exceeds threshold</option>
        </select>
      </label>
      <label>Target Entity Type
        <input type="text" bind:value={ruleFormEntityType} placeholder="order, customer, * (all)" />
      </label>
      <label>Field Name <input type="text" bind:value={ruleFormField} placeholder="e.g. notes, storedValue" /></label>
      {#if ruleFormType === 'field_contains'}
        <label>Match Value <input type="text" bind:value={ruleFormValue} placeholder="e.g. refund, urgent" /></label>
      {:else}
        <label>Threshold <input type="number" bind:value={ruleFormThreshold} placeholder="e.g. 1000" step="0.01" /></label>
      {/if}
      <div class="modal-actions">
        <button on:click={() => showRuleForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleCreateRule}
          disabled={ruleFormLoading || !ruleFormName.trim() || !ruleFormField.trim()}>
          {ruleFormLoading ? 'Creating…' : 'Create Rule'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 1.5rem; height: 100%; display: flex; flex-direction: column; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  h2, h3, h4 { margin: 0 0 0.5rem; }
  .tab-bar { display: flex; gap: 0.25rem; }
  .tab-btn { padding: 0.4rem 1rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .tab-btn--active { background: #2563eb; color: #fff; border-color: #2563eb; }
  .inbox-toolbar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
  .filter-label { display: flex; align-items: center; gap: 0.4rem; font-size: 0.875rem; }
  .filter-label select { padding: 0.25rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; }
  .layout { display: grid; grid-template-columns: 300px 1fr; gap: 1rem; flex: 1; min-height: 0; }
  .case-list { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 0.75rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.25rem; }
  .case-row { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.6rem 0.75rem; border-radius: 4px; border: 1px solid transparent; cursor: pointer; background: #fff; text-align: left; }
  .case-row:hover { background: #f1f5f9; }
  .case-row.selected { background: #eff6ff; border-color: #bfdbfe; }
  .case-row-header { display: flex; justify-content: space-between; align-items: center; }
  .case-source { font-weight: 500; font-size: 0.875rem; }
  .case-id { font-family: monospace; font-size: 0.75rem; color: #888; }
  .case-date { font-size: 0.75rem; color: #94a3b8; }
  .badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; white-space: nowrap; }
  .badge--open { background: #fef3c7; color: #b45309; }
  .badge--in-review { background: #dbeafe; color: #1d4ed8; }
  .badge--resolved { background: #dcfce7; color: #166534; }
  .badge--dismissed { background: #f1f5f9; color: #64748b; }
  .case-detail { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 1.5rem; overflow-y: auto; }
  .empty-state { display: flex; align-items: center; justify-content: center; height: 200px; color: #888; }
  .detail-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1rem; }
  .info-item { display: flex; flex-direction: column; gap: 0.1rem; font-size: 0.875rem; }
  .info-label { font-size: 0.7rem; color: #888; text-transform: uppercase; }
  .rule-matches { background: #fef9c3; border: 1px solid #fde68a; border-radius: 6px; padding: 0.75rem; margin-bottom: 1rem; }
  .match-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; font-size: 0.875rem; }
  .match-name { font-weight: 500; }
  .match-type { font-size: 0.75rem; color: #888; padding: 0.1rem 0.35rem; background: #fff; border-radius: 3px; }
  .match-detail { font-size: 0.8rem; color: #92400e; }
  .linked-evidence { color: #7c3aed; font-weight: 500; }
  .resolution-form { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  label { display: block; font-size: 0.875rem; font-weight: 500; }
  select, textarea { display: block; width: 100%; margin-top: 0.25rem; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; font-family: inherit; }
  .form-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .btn-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  .btn-primary:disabled { background: #93c5fd; border-color: #93c5fd; cursor: not-allowed; }
  .btn-secondary { background: #fff; color: #2563eb; border-color: #2563eb; }
  .btn-danger { background: #dc2626; color: #fff; border-color: #dc2626; }
  .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
  .loading-hint, .empty-hint { color: #888; font-size: 0.875rem; font-style: italic; }
  code { font-family: monospace; font-size: 0.85em; }
  /* Rules tab */
  .rules-panel { flex: 1; overflow-y: auto; }
  .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .data-table th { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 2px solid #e2e8f0; font-size: 0.75rem; text-transform: uppercase; color: #64748b; }
  .data-table td { padding: 0.5rem; border-bottom: 1px solid #f1f5f9; }
  .mono { font-family: monospace; font-size: 0.8rem; color: #475569; }
  .btn-xs { padding: 0.2rem 0.5rem; font-size: 0.75rem; border-radius: 3px; }
  .btn-danger-xs { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }
  .btn-danger-xs:hover { background: #dc2626; color: #fff; border-color: #dc2626; }
  .config-section { margin-top: 2rem; border-top: 1px solid #e2e8f0; padding-top: 1.5rem; }
  .config-section h4 { margin: 0 0 0.25rem; font-size: 0.875rem; }
  .words-textarea { width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; font-family: inherit; resize: vertical; }
  .eval-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.5rem; }
  .eval-grid label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 500; }
  .eval-grid input { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; }
  .code-input { font-family: monospace; font-size: 0.8rem; }
  .eval-result { background: #dcfce7; color: #166534; padding: 0.4rem 0.75rem; border-radius: 4px; font-size: 0.875rem; margin-bottom: 0.75rem; }
  .result--valid { background: #dcfce7; color: #166534; }
  .result--invalid { background: #fee2e2; color: #991b1b; }
  .type-badge { background: #dbeafe; color: #1e40af; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .hint { font-size: 0.8rem; color: #64748b; margin-bottom: 0.75rem; }
  .form-error { background: #fee2e2; color: #b91c1c; padding: 0.4rem 0.75rem; border-radius: 4px; font-size: 0.875rem; margin-bottom: 0.75rem; }
  /* Modal */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: #fff; border-radius: 8px; padding: 1.5rem; width: 480px; max-width: 95vw; display: flex; flex-direction: column; gap: 0.75rem; }
  .modal h3 { margin: 0 0 0.25rem; }
  .modal label input, .modal label select { display: block; width: 100%; margin-top: 0.25rem; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; box-sizing: border-box; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.5rem; }
  @media (max-width: 768px) {
    .layout { grid-template-columns: 1fr; }
    .info-grid { grid-template-columns: 1fr; }
    .eval-grid { grid-template-columns: 1fr; }
    .page { padding: 0.75rem; }
    .data-table { display: block; overflow-x: auto; }
  }
</style>
