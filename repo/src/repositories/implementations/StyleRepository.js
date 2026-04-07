import { BaseRepository } from '../base/BaseRepository.js';

export class StyleRepository extends BaseRepository {
  constructor() {
    super('styles');
  }

  /** @param {string} organizationId @returns {Promise<object[]>} */
  async findByOrg(organizationId) {
    return this.findByIndex('by_orgId', organizationId);
  }

  /** @param {string} storeId @returns {Promise<object[]>} */
  async findByStore(storeId) {
    return this.findByIndex('by_storeId', storeId);
  }

  /**
   * Finds all active styles that reference a specific entity ID
   * (used for deactivation reference check).
   *
   * @param {'colorId'|'sizeId'|'seasonId'|'brandId'|'supplierId'} field
   * @param {string} entityId
   * @returns {Promise<object[]>}
   */
  async findActiveStylesReferencingEntity(field, entityId) {
    const all = await this.findAll();
    return all.filter((s) => s.isActive && s[field] === entityId);
  }
}
