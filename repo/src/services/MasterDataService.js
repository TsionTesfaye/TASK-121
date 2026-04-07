import { MasterDataRepository } from '../repositories/implementations/MasterDataRepository.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { eventDispatcherService } from './EventDispatcherService.js';
import { generateId } from '../utils/idGenerator.js';
import { validateReasonNote } from '../utils/validation.js';
import { ROLES, MASTER_DATA_ENTITY_TYPES, EVENT_TYPES } from '../utils/constants.js';
import { orgService } from './OrgService.js';

/**
 * MasterDataService — versioned master data lifecycle management.
 *
 * Uses the DATASET PUBLISH versioning model:
 * one active version per (entityType, organizationId) at a time.
 * This is distinct from the RECORD HISTORY model used by LookupDataService
 * and StyleService (one active version per entityId).
 *
 * Publish operations use optimistic concurrency: if the active version
 * changed since the editor loaded, the publish is rejected.
 *
 * RBAC:
 *   - publishVersion → ADMINISTRATOR or STORE_MANAGER
 *   - all reads       → any authenticated user
 */
export class MasterDataService {
  constructor() {
    this._repo = new MasterDataRepository();
  }

  /**
   * Creates and immediately publishes a new version of a master data entity.
   * Atomically deactivates the previous active version.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ entityType: string; entityId: string; organizationId: string; payload: object; reasonNote: string; createdBy: string; expectedActiveVersionId: string | null }} params
   * @returns {Promise<object>}
   */
  async publishVersion({ entityType, entityId, organizationId, payload, reasonNote, createdBy, expectedActiveVersionId }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);
    this._assertValidEntityType(entityType);

    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    if (!payload || typeof payload !== 'object') throw new Error('Payload must be a non-null object.');

    const history = await this._repo.findVersionHistory(entityId);
    const nextVersion = history.length > 0 ? history[0].versionNumber + 1 : 1;

    const newVersion = {
      id: generateId(),
      organizationId,
      entityType,
      entityId,
      versionNumber: nextVersion,
      payload,
      reasonNote,
      isActive: true,
      createdBy,
      createdAt: Date.now(),
    };

    // The concurrency check (expectedActiveVersionId vs current active) happens
    // atomically inside the transaction in the repository layer.
    await this._repo.atomicVersionSwitch(expectedActiveVersionId, newVersion);

    await auditService.log({
      actorId: createdBy,
      action: 'publish_version',
      entityType,
      entityId,
      metadata: { versionNumber: nextVersion, previousActiveId: expectedActiveVersionId ?? null, organizationId },
    });

    // Dispatch publish event (non-fatal).
    await eventDispatcherService.dispatch({
      organizationId,
      eventType: EVENT_TYPES.MASTER_DATA_PUBLISHED,
      sourceId: newVersion.id,
      actorId: createdBy,
      vars: { entityType, entityId, versionNumber: String(nextVersion) },
      title: `Master data published: ${entityType}`,
      body: `Version ${nextVersion} of ${entityType} has been published.`,
    }).catch(() => {});

    return newVersion;
  }

  /**
   * Returns the currently active version for an entity type in an org.
   * Requires: any authenticated user.
   *
   * @param {string} entityType
   * @param {string} organizationId
   * @returns {Promise<object | null>}
   */
  async getActiveVersion(entityType, organizationId) {
    const actor = this._requireAuth();
    await this._assertOrgScope(actor, organizationId);
    this._assertValidEntityType(entityType);
    return this._repo.findActiveVersion(entityType, organizationId);
  }

  /**
   * Returns all historical versions for an entity, newest first.
   * Results are filtered to the actor's org scope — cross-org versions are excluded.
   * Requires: any authenticated user.
   *
   * @param {string} entityId
   * @param {string} [organizationId]  When provided, only versions from this org are returned.
   * @returns {Promise<object[]>}
   */
  async getVersionHistory(entityId, organizationId) {
    const actor = this._requireAuth();
    const versions = await this._repo.findVersionHistory(entityId);
    if (actor.role === ROLES.ADMINISTRATOR && !organizationId) return versions;
    // Filter versions to the actor's org scope.
    const targetOrg = organizationId ?? actor.organizationNodeId;
    if (targetOrg) {
      await this._assertOrgScope(actor, targetOrg);
      return versions.filter((v) => v.organizationId === targetOrg);
    }
    return versions;
  }

  /**
   * Returns all active versions for an organization.
   * Requires: any authenticated user.
   *
   * @param {string} organizationId
   * @returns {Promise<object[]>}
   */
  async getAllActiveVersions(organizationId) {
    const actor = this._requireAuth();
    await this._assertOrgScope(actor, organizationId);
    return this._repo.findActiveVersionsByOrg(organizationId);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  _requireRole(...allowedRoles) {
    const user = authService.getCurrentUser();
    if (!user) throw new Error('Authentication required.');
    authService.requireUnlocked();
    if (user.role === ROLES.ADMINISTRATOR) return user;
    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      throw new Error(`Permission denied. Required role(s): ${allowedRoles.join(', ')}`);
    }
    return user;
  }

  _requireAuth() {
    const user = authService.getCurrentUser();
    if (!user) throw new Error('Authentication required.');
    return user;
  }

  async _assertOrgScope(actor, targetOrgId) {
    if (actor.role === ROLES.ADMINISTRATOR) return;
    if (!actor.organizationNodeId) throw new Error('Actor has no organization assigned.');
    const inScope = await orgService.isInScope(actor, targetOrgId);
    if (!inScope) throw new Error('Scope violation: you can only access data within your assigned organization.');
  }

  _assertValidEntityType(entityType) {
    const valid = Object.values(MASTER_DATA_ENTITY_TYPES);
    if (!valid.includes(entityType)) {
      throw new Error(`Unknown entity type: '${entityType}'. Valid: ${valid.join(', ')}`);
    }
  }
}

export const masterDataService = new MasterDataService();
