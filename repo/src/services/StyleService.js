import { StyleRepository } from '../repositories/implementations/StyleRepository.js';
import { BaseRepository } from '../repositories/base/BaseRepository.js';
import { OrgRepository } from '../repositories/implementations/OrgRepository.js';
import { MasterDataRepository } from '../repositories/implementations/MasterDataRepository.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { generateId } from '../utils/idGenerator.js';
import { validateReasonNote } from '../utils/validation.js';
import { ROLES, ORG_NODE_TYPES } from '../utils/constants.js';
import { orgService } from './OrgService.js';

/**
 * StyleService — style SKU management with deactivated-reference enforcement.
 *
 * A style references color, size, season, brand, and supplier.
 * New styles may not reference deactivated master data records.
 *
 * RBAC:
 *   - create/update/deactivate → ADMINISTRATOR or STORE_MANAGER
 *   - reads                    → any authenticated user
 */
export class StyleService {
  constructor() {
    this._styleRepo = new StyleRepository();
    this._orgRepo = new OrgRepository();
    this._colorRepo = new BaseRepository('colors');
    this._sizeRepo = new BaseRepository('sizes');
    this._seasonRepo = new BaseRepository('seasons');
    this._brandRepo = new BaseRepository('brands');
    this._supplierRepo = new BaseRepository('suppliers');
  }

  /**
   * Creates a new style SKU after validating all referenced entities are active.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {{ organizationId: string; sku: string; colorId: string; sizeId: string; seasonId: string; brandId: string; supplierId: string; storeId: string; warehouseId?: string; actorId: string }} params
   * @returns {Promise<object>}
   */
  async createStyle({ organizationId, sku, colorId, sizeId, seasonId, brandId, supplierId, storeId, warehouseId, actorId, reasonNote = '' }) {
    const actor = this._requireRole(ROLES.STORE_MANAGER);
    await this._assertOrgScope(actor, organizationId);

    if (!sku?.trim()) throw new Error('SKU is required.');
    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    await this._validateReferences({ colorId, sizeId, seasonId, brandId, supplierId }, organizationId);

    // Validate warehouse if provided: must exist and belong to the same org tree.
    if (warehouseId) {
      await this._validateWarehouse(actor, warehouseId);
    }

    const style = {
      id: generateId(),
      organizationId,
      sku,
      colorId,
      sizeId,
      seasonId,
      brandId,
      supplierId,
      storeId,
      warehouseId: warehouseId ?? null,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this._styleRepo.create(style);

    // Version record — single-active invariant.
    await this._createVersion(style.id, organizationId, { sku, colorId, sizeId, seasonId, brandId, supplierId }, reasonNote, actorId);

    await auditService.log({ actorId, action: 'create_style', entityType: 'style', entityId: style.id, metadata: { reasonNote } });
    return style;
  }

  /**
   * Updates a style SKU after validating all referenced entities.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} styleId
   * @param {object} data
   * @param {string} actorId
   * @returns {Promise<object>}
   */
  async updateStyle(styleId, data, actorId, reasonNote = '') {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    const existing = await this._styleRepo.findById(styleId);
    if (!existing) throw new Error('Style not found.');
    await this._assertOrgScope(actor, existing.organizationId);

    await this._validateReferences({
      colorId: data.colorId ?? existing.colorId,
      sizeId: data.sizeId ?? existing.sizeId,
      seasonId: data.seasonId ?? existing.seasonId,
      brandId: data.brandId ?? existing.brandId,
      supplierId: data.supplierId ?? existing.supplierId,
    }, existing.organizationId);

    // Validate warehouse if being updated.
    const effectiveWarehouseId = data.warehouseId !== undefined ? data.warehouseId : existing.warehouseId;
    if (effectiveWarehouseId) {
      await this._validateWarehouse(actor, effectiveWarehouseId);
    }

    const updated = { ...existing, ...data, updatedAt: Date.now() };
    await this._styleRepo.update(styleId, updated);

    // Version record for the update.
    await this._createVersion(styleId, existing.organizationId, {
      sku: updated.sku, colorId: updated.colorId, sizeId: updated.sizeId,
      seasonId: updated.seasonId, brandId: updated.brandId, supplierId: updated.supplierId,
    }, reasonNote, actorId);

    await auditService.log({ actorId, action: 'update_style', entityType: 'style', entityId: styleId, metadata: { reasonNote } });
    return updated;
  }

  /**
   * Deactivates a style.
   * Requires: ADMINISTRATOR or STORE_MANAGER role.
   *
   * @param {string} styleId
   * @param {string} actorId
   * @returns {Promise<void>}
   */
  async deactivateStyle(styleId, actorId, reasonNote = '') {
    const actor = this._requireRole(ROLES.STORE_MANAGER);

    const noteCheck = validateReasonNote(reasonNote);
    if (!noteCheck.valid) throw new Error(noteCheck.error);

    const style = await this._styleRepo.findById(styleId);
    if (!style) throw new Error('Style not found.');
    await this._assertOrgScope(actor, style.organizationId);

    await this._styleRepo.update(styleId, { ...style, isActive: false, updatedAt: Date.now() });

    await this._createVersion(styleId, style.organizationId, { sku: style.sku, isActive: false }, reasonNote, actorId);

    await auditService.log({ actorId, action: 'deactivate_style', entityType: 'style', entityId: styleId, metadata: { reasonNote } });
  }

  /**
   * Returns all styles for an organization.
   * Requires: any authenticated user.
   *
   * @param {string} organizationId
   * @returns {Promise<object[]>}
   */
  async getByOrg(organizationId) {
    const actor = this._requireAuth();
    await this._assertOrgScope(actor, organizationId);
    return this._styleRepo.findByOrg(organizationId);
  }

  /**
   * Returns all styles scoped to a store.
   * Requires: any authenticated user within the store's organization.
   *
   * @param {string} storeId
   * @returns {Promise<object[]>}
   */
  async getByStore(storeId) {
    const actor = this._requireAuth();
    await this._assertOrgScope(actor, storeId);
    return this._styleRepo.findByStore(storeId);
  }

  /**
   * Returns all version history for a style, newest first.
   * @param {string} styleId
   * @returns {Promise<object[]>}
   */
  async getStyleVersionHistory(styleId) {
    const actor = this._requireAuth();
    const style = await this._styleRepo.findById(styleId);
    if (!style) throw new Error('Style not found.');
    await this._assertOrgScope(actor, style.organizationId);
    const mdRepo = new MasterDataRepository();
    return mdRepo.findVersionHistory(styleId);
  }

  /**
   * Returns the currently active version for a style, or null.
   * @param {string} styleId
   * @returns {Promise<object | null>}
   */
  async getActiveStyleVersion(styleId) {
    const actor = this._requireAuth();
    const style = await this._styleRepo.findById(styleId);
    if (!style) throw new Error('Style not found.');
    await this._assertOrgScope(actor, style.organizationId);
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(styleId);
    return history.find((v) => v.isActive) ?? null;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * Creates a version record using the RECORD HISTORY model:
   * one active version per entityId (not per entityType).
   * Deactivates all prior active versions for this entity before creating the new one.
   */
  async _createVersion(entityId, organizationId, payload, reasonNote, actorId) {
    const mdRepo = new MasterDataRepository();
    const history = await mdRepo.findVersionHistory(entityId);
    for (const v of history) {
      if (v.isActive) await mdRepo.update(v.id, { ...v, isActive: false });
    }
    const nextVersion = history.length > 0 ? history[0].versionNumber + 1 : 1;
    await mdRepo.create({
      id: generateId(), organizationId, entityType: 'style', entityId,
      versionNumber: nextVersion, payload, reasonNote, isActive: true,
      createdBy: actorId, createdAt: Date.now(),
    });
  }

  /**
   * Validates that a warehouse ID exists as an org node and is within the actor's scope.
   * @param {object} actor
   * @param {string} warehouseId
   */
  async _validateWarehouse(actor, warehouseId) {
    const node = await this._orgRepo.findById(warehouseId);
    if (!node) throw new Error(`Warehouse '${warehouseId}' not found.`);
    if (node.type !== ORG_NODE_TYPES.WAREHOUSE) {
      throw new Error(`Node '${warehouseId}' is of type '${node.type}', not 'warehouse'.`);
    }
    await this._assertOrgScope(actor, warehouseId);
  }

  async _validateReferences({ colorId, sizeId, seasonId, brandId, supplierId }, organizationId) {
    const checks = [
      { repo: this._colorRepo, id: colorId, label: 'color' },
      { repo: this._sizeRepo, id: sizeId, label: 'size' },
      { repo: this._seasonRepo, id: seasonId, label: 'season' },
      { repo: this._brandRepo, id: brandId, label: 'brand' },
      { repo: this._supplierRepo, id: supplierId, label: 'supplier' },
    ];

    for (const { repo, id, label } of checks) {
      if (!id) throw new Error(`${label} ID is required.`);
      const record = await repo.findById(id);
      if (!record) throw new Error(`${label} '${id}' not found.`);
      if (!record.isActive) {
        throw new Error(
          `Cannot reference deactivated ${label} '${id}'. ` +
            'Deactivated master data records cannot be used in new styles.',
        );
      }
      // Cross-org isolation: referenced entity must belong to the same organization.
      if (organizationId && record.organizationId && record.organizationId !== organizationId) {
        throw new Error(`${label} '${id}' belongs to a different organization.`);
      }
    }
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

export const styleService = new StyleService();
