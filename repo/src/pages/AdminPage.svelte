<script>
  import { authService } from '../services/AuthService.js';
  import { importExportService } from '../services/ImportExportService.js';
  import { currentUser, clearAuthStores } from '../app/stores/auth.js';
  import { showToast, navigate } from '../app/stores/ui.js';
  import { ROLES } from '../utils/constants.js';
  import { DB_VERSION } from '../infrastructure/db/schema.js';

  const tabs = ['users', 'links', 'backup'];
  let activeTab = 'users';

  // Users
  let users = [];
  let usersLoading = false;

  // Account linking
  let linkUserA = '';
  let linkUserB = '';
  let linkReason = '';
  let linkError = '';
  let linkLoading = false;
  let links = [];
  let linksLoading = false;
  let deactivatingId = null;
  let showCreateUserForm = false;
  let newUsername = '';
  let newPassword = '';
  let newRole = ROLES.STORE_MANAGER;
  let newOrgNodeId = '';
  let userFormError = '';
  let userFormLoading = false;

  // Backup export
  let exportPassphrase = '';
  let exportLoading = false;

  // Backup import
  let importFile = null;
  let importPassphrase = '';
  let importPreview = null;
  let importSchemaVersion = null;
  let importLoading = false;
  let applyLoading = false;

  const roles = Object.values(ROLES).filter((r) => r !== ROLES.GUEST);

  $: actorId = $currentUser?.id ?? '';

  $: if (actorId) loadUsers();

  async function loadUsers() {
    usersLoading = true;
    try {
      users = await authService.listUsers();
    } catch (err) {
      showToast('error', err.message);
    } finally {
      usersLoading = false;
    }
  }

  async function handleCreateUser() {
    userFormError = '';
    userFormLoading = true;
    try {
      await authService.createUser({
        username: newUsername,
        password: newPassword,
        role: newRole,
        organizationNodeId: newOrgNodeId || null,
      });
      await loadUsers();
      showCreateUserForm = false;
      newUsername = '';
      newPassword = '';
      newRole = ROLES.STORE_MANAGER;
      newOrgNodeId = '';
      showToast('success', 'User created.');
    } catch (err) {
      userFormError = err.message;
    } finally {
      userFormLoading = false;
    }
  }

  async function handleDeactivate(userId) {
    if (!confirm('Deactivate this user? They will no longer be able to log in.')) return;
    deactivatingId = userId;
    try {
      await authService.deactivateAccount(userId);
      await loadUsers();
      showToast('success', 'Account deactivated.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      deactivatingId = null;
    }
  }

  async function handleExport() {
    if (!exportPassphrase.trim()) {
      showToast('error', 'Backup passphrase is required.');
      return;
    }
    exportLoading = true;
    try {
      const blob = await importExportService.exportBackup({ actorId, backupPassphrase: exportPassphrase });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `retailops-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      exportPassphrase = '';
      showToast('success', 'Backup exported.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      exportLoading = false;
    }
  }

  function handleFileChange(e) {
    importFile = e.target.files[0] ?? null;
    importPreview = null;
    importSchemaVersion = null;
  }

  async function handlePreviewImport() {
    if (!importFile || !importPassphrase.trim()) {
      showToast('error', 'File and passphrase are required.');
      return;
    }
    importLoading = true;
    try {
      const result = await importExportService.previewImport({
        file: importFile,
        backupPassphrase: importPassphrase,
      });
      importPreview = result.diff;
      importSchemaVersion = result.schemaVersion;
    } catch (err) {
      showToast('error', err.message);
    } finally {
      importLoading = false;
    }
  }

  async function handleApplyImport() {
    if (!importPreview || importSchemaVersion === null) return;
    if (!confirm('Apply this backup? This will overwrite current data. Audit logs are preserved.')) return;
    applyLoading = true;
    try {
      // We need the snapshot — preview stores it; re-run or store snapshot
      const result = await importExportService.previewImport({
        file: importFile,
        backupPassphrase: importPassphrase,
      });
      await importExportService.applyImport({
        snapshot: result.snapshot,
        schemaVersion: result.schemaVersion,
        actorId,
      });
      importPreview = null;
      importSchemaVersion = null;
      importFile = null;
      importPassphrase = '';
      showToast('success', 'Backup restored. Please log in again.');
      clearAuthStores();
      navigate('/login');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      applyLoading = false;
    }
  }

  async function loadLinks() {
    linksLoading = true;
    try {
      // Get all links — query from first user found, then deduplicate
      const allUsers = await authService.listUsers();
      const seen = new Set();
      const allLinks = [];
      for (const u of allUsers) {
        const userLinks = await authService.getLinkedAccounts(u.id);
        for (const l of userLinks) {
          if (!seen.has(l.id)) { seen.add(l.id); allLinks.push(l); }
        }
      }
      links = allLinks;
    } catch (err) {
      showToast('error', err.message);
    } finally {
      linksLoading = false;
    }
  }

  async function handleLink() {
    linkError = '';
    linkLoading = true;
    try {
      await authService.linkUserAccounts({
        userIdA: linkUserA, userIdB: linkUserB, reason: linkReason,
      });
      linkUserA = ''; linkUserB = ''; linkReason = '';
      showToast('success', 'Accounts linked.');
      await loadLinks();
    } catch (err) {
      linkError = err.message;
    } finally {
      linkLoading = false;
    }
  }

  async function handleUnlink(linkId) {
    try {
      await authService.unlinkAccounts(linkId);
      links = links.filter((l) => l.id !== linkId);
      showToast('success', 'Link removed.');
    } catch (err) {
      showToast('error', err.message);
    }
  }

  function switchTab(tab) {
    activeTab = tab;
    if (tab === 'links') loadLinks();
  }

  function formatDate(ms) {
    return ms ? new Date(ms).toLocaleDateString() : '—';
  }

  function roleLabel(role) {
    return role.replace('_', ' ');
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>Administration</h2>
    <span class="schema-badge">Schema v{DB_VERSION}</span>
  </header>

  <nav class="tab-bar">
    {#each tabs as tab}
      <button class:active={activeTab === tab} on:click={() => switchTab(tab)}>
        {tab.charAt(0).toUpperCase() + tab.slice(1)}
      </button>
    {/each}
  </nav>

  <div class="panel">
    <!-- Users tab -->
    {#if activeTab === 'users'}
      <div class="section-header">
        <h3>User Accounts</h3>
        <button class="btn-primary" on:click={() => { showCreateUserForm = true; userFormError = ''; }}>+ New User</button>
      </div>

      {#if usersLoading}
        <p class="loading-hint">Loading…</p>
      {:else if users.length === 0}
        <p class="empty-hint">No users found.</p>
      {:else}
        <table class="data-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Org Node</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each users.filter((u) => !u.isGuest) as u}
              <tr class:inactive={!u.isActive}>
                <td>{u.username}</td>
                <td><span class="role-badge">{roleLabel(u.role)}</span></td>
                <td class="mono">{u.organizationNodeId ? u.organizationNodeId.slice(0, 8) + '…' : '—'}</td>
                <td>
                  {#if u.isActive}
                    <span class="active-badge">Active</span>
                  {:else}
                    <span class="inactive-text">Deactivated</span>
                  {/if}
                </td>
                <td>{formatDate(u.createdAt)}</td>
                <td>
                  {#if u.isActive && u.id !== actorId}
                    <button class="btn-xs btn-danger-xs" on:click={() => handleDeactivate(u.id)} disabled={deactivatingId === u.id}>
                      {deactivatingId === u.id ? 'Deactivating…' : 'Deactivate'}
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

    <!-- Links tab -->
    {:else if activeTab === 'links'}
      <div class="section-header">
        <h3>Account Links</h3>
      </div>

      <div class="link-form">
        {#if linkError}<div class="form-error">{linkError}</div>{/if}
        <div class="link-inputs">
          <label>User A
            <select bind:value={linkUserA}>
              <option value="">— Select —</option>
              {#each users as u}<option value={u.id}>{u.username} ({u.role})</option>{/each}
            </select>
          </label>
          <label>User B
            <select bind:value={linkUserB}>
              <option value="">— Select —</option>
              {#each users as u}<option value={u.id}>{u.username} ({u.role})</option>{/each}
            </select>
          </label>
        </div>
        <label>Reason (min 10 chars) <input type="text" bind:value={linkReason} placeholder="Why are these accounts linked?" /></label>
        <button class="btn-primary" on:click={handleLink}
          disabled={linkLoading || !linkUserA || !linkUserB || linkReason.trim().length < 10}>
          {linkLoading ? 'Linking…' : 'Link Accounts'}
        </button>
      </div>

      {#if linksLoading}
        <p class="loading-hint">Loading…</p>
      {:else if links.length === 0}
        <p class="empty-hint">No account links.</p>
      {:else}
        <table class="data-table">
          <thead><tr><th>User A</th><th>User B</th><th>Reason</th><th>Date</th><th></th></tr></thead>
          <tbody>
            {#each links as l}
              <tr>
                <td class="mono">{l.primaryUserId.slice(0, 8)}…</td>
                <td class="mono">{l.linkedUserId.slice(0, 8)}…</td>
                <td>{l.evidenceDetails}</td>
                <td>{formatDate(l.createdAt)}</td>
                <td><button class="btn-xs btn-danger-xs" on:click={() => handleUnlink(l.id)}>Unlink</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

    <!-- Backup tab -->
    {:else if activeTab === 'backup'}
      <div class="backup-layout">
        <!-- Export -->
        <div class="backup-card">
          <h3>Export Backup</h3>
          <p class="hint">Creates an AES-GCM encrypted JSON backup of all data (excluding session and audit logs).</p>
          <label>Backup Passphrase
            <input type="password" bind:value={exportPassphrase} placeholder="Enter a strong passphrase" autocomplete="off" />
          </label>
          <button class="btn-primary" on:click={handleExport} disabled={exportLoading || !exportPassphrase.trim()}>
            {exportLoading ? 'Exporting…' : 'Export & Download'}
          </button>
        </div>

        <!-- Import -->
        <div class="backup-card">
          <h3>Import Backup</h3>
          <p class="hint">Decrypt and preview a backup before applying. Audit logs are never overwritten.</p>
          <label>Backup File
            <input type="file" accept=".json" on:change={handleFileChange} />
          </label>
          <label>Backup Passphrase
            <input type="password" bind:value={importPassphrase} placeholder="Passphrase used during export" autocomplete="off" />
          </label>
          <button class="btn-secondary" on:click={handlePreviewImport}
            disabled={importLoading || !importFile || !importPassphrase.trim()}>
            {importLoading ? 'Decrypting…' : 'Preview Import'}
          </button>

          {#if importPreview}
            <div class="preview-section">
              <h4>Import Preview</h4>
              {#if importPreview.length === 0}
                <p class="empty-hint">No differences found — database is already up to date.</p>
              {:else}
                <table class="data-table">
                  <thead>
                    <tr><th>Store</th><th>Action</th><th>Count</th></tr>
                  </thead>
                  <tbody>
                    {#each importPreview as row}
                      <tr>
                        <td>{row.store}</td>
                        <td><span class="action-badge action-{row.action}">{row.action}</span></td>
                        <td>{row.count}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
              <div class="import-actions">
                <button class="btn-primary" on:click={handleApplyImport} disabled={applyLoading}>
                  {applyLoading ? 'Applying…' : 'Apply Backup'}
                </button>
                <button on:click={() => { importPreview = null; importSchemaVersion = null; }}>Cancel</button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- Create user modal -->
{#if showCreateUserForm}
  <div class="modal-overlay" role="presentation" on:click={() => showCreateUserForm = false} on:keydown={(e) => { if (e.key === 'Escape') showCreateUserForm = false; }}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation on:keydown|stopPropagation>
      <h3>New User</h3>
      {#if userFormError}<div class="form-error">{userFormError}</div>{/if}
      <label>Username <input type="text" bind:value={newUsername} autocomplete="off" /></label>
      <label>Password (min 12 chars, 1 digit, 1 symbol)
        <input type="password" bind:value={newPassword} autocomplete="new-password" />
      </label>
      <label>Role
        <select bind:value={newRole}>
          {#each roles as r}<option value={r}>{roleLabel(r)}</option>{/each}
        </select>
      </label>
      <label>Organization Node ID (optional)
        <input type="text" bind:value={newOrgNodeId} placeholder="Leave blank for admin" />
      </label>
      <div class="modal-actions">
        <button on:click={() => showCreateUserForm = false}>Cancel</button>
        <button class="btn-primary" on:click={handleCreateUser}
          disabled={userFormLoading || !newUsername.trim() || !newPassword.trim()}>
          {userFormLoading ? 'Creating…' : 'Create User'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 1.5rem; }
  .page-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
  h2, h3, h4 { margin: 0 0 0.5rem; }
  .schema-badge { font-size: 0.75rem; color: #64748b; background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 4px; }
  .tab-bar { display: flex; gap: 0.25rem; margin-bottom: 1rem; }
  button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  button.active { background: #2563eb; color: #fff; border-color: #2563eb; }
  .btn-primary { background: #2563eb; color: #fff; border: none; }
  .btn-secondary { background: #fff; color: #2563eb; border-color: #2563eb; }
  .panel { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 1.5rem; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .data-table th { text-align: left; padding: 0.4rem 0.75rem; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 0.75rem; text-transform: uppercase; color: #64748b; }
  .data-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f1f5f9; }
  .inactive td { color: #94a3b8; }
  .role-badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; background: #dbeafe; color: #1e40af; text-transform: capitalize; }
  .active-badge { font-size: 0.75rem; color: #166534; background: #dcfce7; padding: 0.15rem 0.4rem; border-radius: 4px; }
  .inactive-text { font-size: 0.75rem; color: #94a3b8; }
  .mono { font-family: monospace; font-size: 0.8rem; }
  .btn-xs { padding: 0.15rem 0.5rem; font-size: 0.75rem; border-radius: 3px; cursor: pointer; }
  .btn-danger-xs { border-color: #fca5a5; color: #dc2626; background: #fff; }
  .backup-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
  .backup-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .backup-card h3 { margin: 0; }
  .hint { font-size: 0.8rem; color: #64748b; }
  .backup-card label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 500; }
  .backup-card input { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; }
  .preview-section { border-top: 1px solid #e2e8f0; padding-top: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .import-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .action-badge { padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem; font-weight: 600; }
  .action-add { background: #dcfce7; color: #166534; }
  .action-update { background: #dbeafe; color: #1e40af; }
  .action-delete { background: #fee2e2; color: #991b1b; }
  .loading-hint, .empty-hint { color: #888; font-size: 0.875rem; font-style: italic; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: #fff; border-radius: 8px; padding: 2rem; width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: 0.75rem; }
  .modal h3 { margin: 0 0 0.5rem; }
  .modal label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 500; }
  .modal input, .modal select { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.5rem; }
  .modal button { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #fff; font-size: 0.875rem; }
  .form-error { background: #fee2e2; color: #991b1b; border-radius: 4px; padding: 0.5rem 0.75rem; font-size: 0.8rem; }
  .link-form { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
  .link-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .link-form label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.875rem; font-weight: 500; }
  .link-form select, .link-form input { padding: 0.45rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; }
</style>
