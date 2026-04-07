/**
 * LookupDataService — CRUD for master data reference tables.
 *
 * Manages the individual entity stores: colors, sizes, seasons, brands, suppliers.
 * These are the building blocks that styles reference.
 *
 * RBAC:
 *   - createEntry, deactivateEntry, reactivateEntry → ADMINISTRATOR or STORE_MANAGER
 *   - listEntries → any authenticated user
 */

import { BaseRepository } from '../repositories/base/BaseRepository.js';
import { MasterDataRepository } from '../repositories/implementations/MasterDataRepository.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { generateId } from '../utils/idGenerator.js';
import { validateReasonNote } from '../utils/validation.js';
import { ROLES } from '../utils/constants.js';
import { orgService } from './OrgService.js';

const SUPPORTED_STORES = ['colors', 'sizes', 'seasons', 'brands', 'suppliers'];

const STYLE_FIELD_MAP = {
  colors: 'colorId',
  sizes: 'sizeId',
  seasons: 'seasonId',
  brands: 'brandId',
  suppliers: 'supplierId',
};

/** Maps plural store names to singular entity types used in version records. */
const ENTITY_TYPE_MAP = {
  colors: 'color',
  sizes: 'size',
  seasons: 'season',
  brands: 'brand',
  suppliers: 'supplier',
};

export class LookupDataService {
  _repo(store) {
    if (!SUPPORTED_STORES.includes(store)) throw new Error(`Unknown lookup store: ${store}`);
    return new BaseRepository(store);
  }

  /**
   * Creates a new lookup entry (color, size, season, brand, or supplier).
   * A version record is created alongside the entity for audit traceability.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ store: string; organizationId: string; name: string; actorId: string; reasonNote?: string }} params
   */
  async createEntry({ store, organizationId, name, actorId, reasonNote = '' }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    if (!name?.trim()) throw new Error(`${store} name is required.`);
    await this._assertOrgScope(actor, organizationId);

    // Reason note required for all mutations.
    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    const record = {
      id: generateId(),
      organizationId,
      name: name.trim(),
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const saved = await this._repo(store).create(record);

    // Create a version record — single-active invariant enforced.
    await this._createVersion({
      organizationId, entityType: ENTITY_TYPE_MAP[store] ?? store, entityId: record.id,
      payload: { name: record.name, isActive: true }, reasonNote, actorId,
    });

    await auditService.log({ actorId, action: 'create_lookup_entry', entityType: store, entityId: record.id, metadata: { name, reasonNote } });
    return saved;
  }

  /**
   * Lists all lookup entries for an organization.
   * Requires: any authenticated user.
   */
  async listEntries(store, organizationId) {
    const actor = this._requireAuth();
    await this._assertOrgScope(actor, organizationId);
    const all = await this._repo(store).findByIndex('by_orgId', organizationId);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Deactivates a lookup entry if no active styles reference it.
   * Creates a version record for the state change.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ store: string; entryId: string; actorId: string; reasonNote?: string }} params
   */
  async deactivateEntry({ store, entryId, actorId, reasonNote = '' }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    const record = await this._repo(store).findById(entryId);
    if (!record) throw new Error(`${store} entry '${entryId}' not found.`);
    await this._assertOrgScope(actor, record.organizationId);

    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    // Check for active style references.
    const styleRepo = new BaseRepository('styles');
    const allStyles = await styleRepo.findByIndex('by_orgId', record.organizationId);
    const fieldName = STYLE_FIELD_MAP[store];
    const activeRefs = allStyles.filter((s) => s.isActive && s[fieldName] === entryId);
    if (activeRefs.length > 0) {
      throw new Error(`Cannot deactivate — ${activeRefs.length} active style(s) reference this entry.`);
    }

    const updated = { ...record, isActive: false, updatedAt: Date.now() };
    await this._repo(store).update(entryId, updated);

    await this._createVersion({
      organizationId: record.organizationId, entityType: ENTITY_TYPE_MAP[store] ?? store, entityId: entryId,
      payload: { name: record.name, isActive: false }, reasonNote, actorId,
    });

    await auditService.log({ actorId, action: 'deactivate_lookup_entry', entityType: store, entityId: entryId, metadata: { reasonNote } });
  }

  /**
   * Reactivates a lookup entry.
   * Creates a version record for the state change.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ store: string; entryId: string; actorId: string; reasonNote?: string }} params
   */
  async reactivateEntry({ store, entryId, actorId, reasonNote = '' }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    const record = await this._repo(store).findById(entryId);
    if (!record) throw new Error(`${store} entry '${entryId}' not found.`);
    await this._assertOrgScope(actor, record.organizationId);

    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    const updated = { ...record, isActive: true, updatedAt: Date.now() };
    await this._repo(store).update(entryId, updated);

    await this._createVersion({
      organizationId: record.organizationId, entityType: ENTITY_TYPE_MAP[store] ?? store, entityId: entryId,
      payload: { name: record.name, isActive: true }, reasonNote, actorId,
    });

    await auditService.log({ actorId, action: 'reactivate_lookup_entry', entityType: store, entityId: entryId, metadata: { reasonNote } });
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * Creates a version record using the RECORD HISTORY model:
   * one active version per entityId (not per entityType).
   * Deactivates all prior active versions for this entity before creating the new one.
   */
  async _createVersion({ organizationId, entityType, entityId, payload, reasonNote, actorId }) {
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entityId);

    // Deactivate all currently active versions for this entity (single-active invariant).
    for (const v of history) {
      if (v.isActive) {
        await mdRepo.update(v.id, { ...v, isActive: false });
      }
    }

    const nextVersion = history.length > 0 ? history[0].versionNumber + 1 : 1;
    await mdRepo.create({
      id: generateId(),
      organizationId,
      entityType,
      entityId,
      versionNumber: nextVersion,
      payload,
      reasonNote,
      isActive: true,
      createdBy: actorId,
      createdAt: Date.now(),
    });
  }

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
}

export const lookupDataService = new LookupDataService();
