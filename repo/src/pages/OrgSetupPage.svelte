<script>
  import { orgService } from '../services/OrgService.js';
  import { authService } from '../services/AuthService.js';
  import { currentUser } from '../app/stores/auth.js';
  import { orgTree, resolveOrgContext } from '../app/stores/org.js';
  import { showToast } from '../app/stores/ui.js';
  import { ORG_NODE_TYPES, VALID_PARENT_CHILD } from '../utils/constants.js';

  const nodeTypes = Object.values(ORG_NODE_TYPES);

  let activeTab = 'tree';
  let nodes = [];
  let treeLoading = false;
  let selectedNode = null;

  // Create form
  let showCreateForm = false;
  let createParentId = '';
  let createType = ORG_NODE_TYPES.COMPANY;
  let createName = '';
  let createOrgId = '';
  let createError = '';
  let createLoading = false;

  // Edit form
  let showEditForm = false;
  let editName = '';
  let editType = '';
  let editParentId = '';
  let editError = '';
  let editLoading = false;

  // Delete
  let deleteLoading = false;

  // Passphrase setup
  let showPassphraseSetup = false;
  let passphraseValue = '';
  let passphraseConfirm = '';
  let passphraseError = '';
  let passphraseLoading = false;
  let currentEncryptionModel = 'password';

  $: actorId = $currentUser?.id ?? '';
  $: userOrgId = resolveOrgContext($currentUser, $orgTree).organizationId || ($currentUser?.organizationNodeId ?? '');

  // Build tree structure from flat array for display
  $: nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  $: rootNodes = nodes.filter((n) => !n.parentId);

  $: isAdmin = $currentUser?.role === 'administrator';

  $: if (actorId) {
    loadTree();
    authService.getEncryptionModel().then((m) => { currentEncryptionModel = m; }).catch(() => {});
  }

  async function handleSetupPassphrase() {
    passphraseError = '';
    if (passphraseValue.length < 12) { passphraseError = 'Passphrase must be at least 12 characters.'; return; }
    if (passphraseValue !== passphraseConfirm) { passphraseError = 'Passphrases do not match.'; return; }
    passphraseLoading = true;
    try {
      await authService.setupOrgPassphrase(passphraseValue);
      currentEncryptionModel = 'passphrase';
      showPassphraseSetup = false;
      passphraseValue = '';
      passphraseConfirm = '';
      showToast('success', 'Org passphrase set. Protected data now uses passphrase-based encryption.');
    } catch (err) {
      passphraseError = err.message;
    } finally {
      passphraseLoading = false;
    }
  }

  async function loadTree() {
    treeLoading = true;
    try {
      // Load with a broad org query — admin sees all via orgId param
      const all = await orgService.getTree(userOrgId || 'all');
      nodes = all;
      orgTree.set(all);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      treeLoading = false;
    }
  }

  function getChildren(parentId) {
    return nodes.filter((n) => n.parentId === parentId);
  }

  function allowedChildType(parentType) {
    return VALID_PARENT_CHILD.get(parentType) ?? null;
  }

  async function handleCreate() {
    createError = '';
    createLoading = true;
    try {
      const node = await orgService.createNode({
        parentId: createParentId || null,
        type: createType,
        name: createName,
        organizationId: createOrgId || userOrgId,
        actorId,
      });
      nodes = [...nodes, node];
      orgTree.set(nodes);
      showCreateForm = false;
      createName = '';
      createParentId = '';
      createOrgId = '';
      showToast('success', 'Node created.');
    } catch (err) {
      createError = err.message;
    } finally {
      createLoading = false;
    }
  }

  function openEdit(node) {
    selectedNode = node;
    editName = node.name;
    editType = node.type;
    editParentId = node.parentId ?? '';
    editError = '';
    showEditForm = true;
  }

  // Filter valid parent options for a node being edited (exclude self + descendants)
  function getValidParents(editingNode) {
    if (!editingNode) return [];
    const subtreeIds = new Set();
    const collectDescendants = (id) => {
      subtreeIds.add(id);
      for (const n of nodes) {
        if (n.parentId === id && !subtreeIds.has(n.id)) collectDescendants(n.id);
      }
    };
    collectDescendants(editingNode.id);
    return nodes.filter((n) => !subtreeIds.has(n.id) && n.organizationId === editingNode.organizationId);
  }

  async function handleEdit() {
    editError = '';
    editLoading = true;
    try {
      const data = { name: editName };
      if (editType !== selectedNode.type) data.type = editType;
      if ((editParentId || null) !== (selectedNode.parentId || null)) data.parentId = editParentId || null;
      const updated = await orgService.updateNode(selectedNode.id, data, actorId);
      nodes = nodes.map((n) => (n.id === updated.id ? updated : n));
      orgTree.set(nodes);
      showEditForm = false;
      showToast('success', 'Node updated.');
    } catch (err) {
      editError = err.message;
    } finally {
      editLoading = false;
    }
  }

  async function handleDelete(node) {
    if (!confirm(`Delete "${node.name}"? This cannot be undone.`)) return;
    deleteLoading = true;
    try {
      await orgService.deleteNode(node.id, actorId);
      nodes = nodes.filter((n) => n.id !== node.id);
      orgTree.set(nodes);
      if (selectedNode?.id === node.id) selectedNode = null;
      showToast('success', 'Node deleted.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      deleteLoading = false;
    }
  }

  function typeIcon(type) {
    const icons = { company: '🏢', factory: '🏭', store: '🏪', warehouse: '🏬' };
    return icons[type] ?? '📦';
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>Organization Setup</h2>
    <div class="header-actions">
      <div class="tab-bar">
        <button class:active={activeTab === 'tree'} on:click={() => activeTab = 'tree'}>Tree View</button>
        <button class:active={activeTab === 'table'} on:click={() => activeTab = 'table'}>Table View</button>
      </div>
      <button class="btn-primary" on:click={() => { showCreateForm = true; createError = ''; }}>+ Add Node</button>
    </div>
  </header>

  {#if activeTab === 'tree'}
    <section class="panel">
      <div class="tree-count">{nodes.length} node{nodes.length !== 1 ? 's' : ''} loaded</div>
      {#if treeLoading}
        <p class="loading-hint">Loading…</p>
      {:else if rootNodes.length === 0}
        <p class="empty-hint">No organization nodes yet. Add a Company node to get started.</p>
      {:else}
        <div class="tree">
          {#each rootNodes as root}
            {#each [root] as n}
              <div class="tree-node">
                <div class="node-row">
                  <span class="node-icon">{typeIcon(n.type)}</span>
                  <span class="node-name">{n.name}</span>
                  <span class="node-type">{n.type}</span>
                  <div class="node-actions">
                    <button class="btn-xs" on:click={() => openEdit(n)}>Edit</button>
                    <button class="btn-xs btn-danger-xs" on:click={() => handleDelete(n)} disabled={deleteLoading}>Delete</button>
                  </div>
                </div>
                {#each getChildren(n.id) as child1}
                  <div class="tree-node tree-node--l1">
                    <div class="node-row">
                      <span class="node-icon">{typeIcon(child1.type)}</span>
                      <span class="node-name">{child1.name}</span>
                      <span class="node-type">{child1.type}</span>
                      <div class="node-actions">
                        <button class="btn-xs" on:click={() => openEdit(child1)}>Edit</button>
                        <button class="btn-xs btn-danger-xs" on:click={() => handleDelete(child1)} disabled={deleteLoading}>Delete</button>
                      </div>
                    </div>
                    {#each getChildren(child1.id) as child2}
                      <div class="tree-node tree-node--l2">
                        <div class="node-row">
                          <span class="node-icon">{typeIcon(child2.type)}</span>
                          <span class="node-name">{child2.name}</span>
                          <span class="node-type">{child2.type}</span>
                          <div class="node-actions">
                            <button class="btn-xs" on:click={() => openEdit(child2)}>Edit</button>
                            <button class="btn-xs btn-danger-xs" on:click={() => handleDelete(child2)} disabled={deleteLoading}>Delete</button>
                          </div>
                        </div>
                        {#each getChildren(child2.id) as child3}
                          <div class="tree-node tree-node--l3">
                            <div class="node-row">
                              <span class="node-icon">{typeIcon(child3.type)}</span>
                              <span class="node-name">{child3.name}</span>
                              <span class="node-type">{child3.type}</span>
                              <div class="node-actions">
                                <button class="btn-xs" on:click={() => openEdit(child3)}>Edit</button>
                                <button class="btn-xs btn-danger-xs" on:click={() => handleDelete(child3)} disabled={deleteLoading}>Delete</button>
                              </div>
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            {/each}
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    <section class="panel">
      {#if nodes.length === 0}
        <p class="empty-hint">No nodes yet.</p>
      {:else}
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Parent</th>
              <th>Org ID</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each nodes as n}
              <tr>
                <td>{n.name}</td>
                <td>{n.type}</td>
                <td>{n.parentId ? (nodeMap[n.parentId]?.name ?? n.parentId.slice(0, 8)) : '—'}</td>
                <td class="mono">{n.organizationId?.slice(0, 8)}…</td>
                <td>
                  <div class="row-actions">
                    <button class="btn-xs" on:click={() => openEdit(n)}>Edit</button>
                    <button class="btn-xs btn-danger-xs" on:click={() => handleDelete(n)} disabled={deleteLoading}>Delete</button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}

  {#if isAdmin}
    <section class="panel passphrase-section">
      <h3>Protected Data Encryption</h3>
      <p class="hint">Encryption model: <strong>Org passphrase</strong>. The org passphrase is wrapped per-user with their login password, so login and unlock automatically restore access to encrypted data.</p>
      <button class="btn-secondary" on:click={() => { showPassphraseSetup = true; passphraseError = ''; passphraseValue = ''; passphraseConfirm = ''; }}>Change Passphrase</button>
    </section>
  {/if}
</div>

<!-- Passphrase setup modal -->
{#if showPassphraseSetup}
  <div class="modal-overlay" role="presentation" on:click={() => showPassphraseSetup = false} on:keydown={(e) => { if (e.key === 'Escape') showPassphraseSetup = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>{currentEncryptionModel === 'passphrase' ? 'Change' : 'Set'} Org Passphrase</h3>
      <p class="hint">This passphrase will be used to encrypt/decrypt sensitive customer data. All authorized users in this organization will need it to access protected fields.</p>
      {#if passphraseError}<div class="form-error">{passphraseError}</div>{/if}
      <label>Passphrase (min 12 chars)
        <input type="password" bind:value={passphraseValue} placeholder="Enter org passphrase" autocomplete="off" />
      </label>
      <label>Confirm Passphrase
        <input type="password" bind:value={passphraseConfirm} placeholder="Confirm passphrase" autocomplete="off" />
      </label>
      <div class="modal-actions">
        <button on:click={() => showPassphraseSetup = false}>Cancel</button>
        <button class="btn-primary" on:click={handleSetupPassphrase} disabled={passphraseLoading || passphraseValue.length < 12}>
          {passphraseLoading ? 'Setting…' : 'Set Passphrase'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Create node modal -->
{#if showCreateForm}
  <div class="modal-overlay" role="presentation" on:click={() => showCreateForm = false} on:keydown={(e) => { if (e.key === 'Escape') showCreateForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>Add Organization Node</h3>
      {#if createError}<div class="form-error">{createError}</div>{/if}
      <label>Name <input type="text" bind:value={createName} /></label>
      <label>Type
        <select bind:value={createType}>
          {#each nodeTypes as t}<option value={t}>{t}</option>{/each}
        </select>
      </label>
      <label>Parent Node
        <select bind:value={createParentId}>
          <option value="">— None (root company) —</option>
          {#each nodes as p}
            <option value={p.id}>{p.name} ({p.type})</option>
          {/each}
        </select>
      </label>
      <label>Organization ID
        <input type="text" bind:value={createOrgId} placeholder="Defaults to your org" />
      </label>
      <div class="modal-actions">
        <button on:click={() => showCreateForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleCreate} disabled={createLoading || !createName.trim()}>
          {createLoading ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Edit node modal -->
{#if showEditForm}
  <div class="modal-overlay" role="presentation" on:click={() => showEditForm = false} on:keydown={(e) => { if (e.key === 'Escape') showEditForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>Edit Node</h3>
      {#if editError}<div class="form-error">{editError}</div>{/if}
      <label>Name <input type="text" bind:value={editName} /></label>
      <label>Type
        <select bind:value={editType}>
          {#each nodeTypes as t}<option value={t}>{t}</option>{/each}
        </select>
      </label>
      <label>Parent
        <select bind:value={editParentId} class="edit-parent-select">
          <option value="">— None (root) —</option>
          {#each getValidParents(selectedNode) as p}
            <option value={p.id}>{p.name} ({p.type})</option>
          {/each}
        </select>
      </label>
      <div class="modal-actions">
        <button on:click={() => showEditForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleEdit} disabled={editLoading || !editName.trim()}>
          {editLoading ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 1.5rem; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h2, h3 { margin: 0; }
  .header-actions { display: flex; align-items: center; gap: 0.75rem; }
  .tab-bar { display: flex; gap: 0.25rem; }
  .panel { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 1.5rem; }
  .tree-count { font-size: 0.8rem; color: #888; margin-bottom: 1rem; }
  .tree { display: flex; flex-direction: column; gap: 0.25rem; }
  .tree-node { display: flex; flex-direction: column; gap: 0.25rem; }
  .tree-node--l1 { margin-left: 1.5rem; }
  .tree-node--l2 { margin-left: 3rem; }
  .tree-node--l3 { margin-left: 4.5rem; }
  .node-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.75rem; border-radius: 4px; background: #f8fafc; border: 1px solid #e2e8f0; }
  .node-icon { font-size: 1rem; }
  .node-name { font-weight: 500; flex: 1; font-size: 0.875rem; }
  .node-type { font-size: 0.75rem; color: #888; text-transform: capitalize; padding: 0.1rem 0.4rem; background: #e2e8f0; border-radius: 4px; }
  .node-actions { display: flex; gap: 0.3rem; }
  .row-actions { display: flex; gap: 0.3rem; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .data-table th { text-align: left; padding: 0.4rem 0.75rem; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 0.75rem; text-transform: uppercase; color: #64748b; }
  .data-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f1f5f9; }
  .mono { font-family: monospace; font-size: 0.8rem; }
  .empty-hint, .loading-hint { color: #888; font-style: italic; font-size: 0.875rem; }
  .btn-primary { background: #2563eb; color: #fff; border: none; border-radius: 4px; padding: 0.4rem 0.75rem; cursor: pointer; font-size: 0.875rem; }
  button.active { background: #2563eb; color: #fff; border-color: #2563eb; }
  button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .btn-xs { padding: 0.15rem 0.5rem; font-size: 0.75rem; border: 1px solid #ddd; border-radius: 3px; cursor: pointer; background: #fff; }
  .btn-danger-xs { border-color: #fca5a5; color: #dc2626; }
  .btn-danger-xs:hover { background: #fee2e2; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: #fff; border-radius: 8px; padding: 2rem; width: 100%; max-width: 440px; display: flex; flex-direction: column; gap: 0.75rem; }
  .modal h3 { margin: 0 0 0.5rem; }
  .modal label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 500; }
  .modal input, .modal select { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.5rem; }
  .modal button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .form-error { background: #fee2e2; color: #991b1b; border-radius: 4px; padding: 0.5rem 0.75rem; font-size: 0.8rem; }
  .passphrase-section { margin-top: 1.5rem; }
  .passphrase-section h3 { margin: 0 0 0.5rem; }
  .hint { font-size: 0.875rem; color: #64748b; margin-bottom: 0.75rem; }
  .btn-secondary { background: #fff; color: #2563eb; border: 1px solid #2563eb; border-radius: 4px; padding: 0.4rem 0.75rem; cursor: pointer; font-size: 0.875rem; }
  .edit-parent-select { max-width: 100%; }
</style>
