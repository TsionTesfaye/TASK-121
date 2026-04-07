import { BaseRepository } from '../base/BaseRepository.js';

/**
 * Repository for the appConfig store.
 * Stores singleton configuration records, one per organization.
 */
export class AppConfigRepository extends BaseRepository {
  constructor() {
    super('appConfig');
  }

  /**
   * Returns the config record for an organization, or null if none exists.
   * @param {string} organizationId
   * @returns {Promise<object | null>}
   */
  async findByOrg(organizationId) {
    return this.findOneByIndex('by_orgId', organizationId);
  }
}
