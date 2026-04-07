import { BaseRepository } from '../base/BaseRepository.js';

export class OrgRepository extends BaseRepository {
  constructor() {
    super('organizations');
  }

  /** @param {string | null} parentId @returns {Promise<object[]>} */
  async findByParent(parentId) {
    return this.findByIndex('by_parentId', parentId);
  }

  /** @param {string} organizationId @returns {Promise<object[]>} */
  async findByOrganization(organizationId) {
    return this.findByIndex('by_organizationId', organizationId);
  }

  /** @param {string} type @returns {Promise<object[]>} */
  async findByType(type) {
    return this.findByIndex('by_type', type);
  }
}
