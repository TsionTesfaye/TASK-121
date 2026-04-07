import { BaseRepository } from '../base/BaseRepository.js';

export class TemplateRepository extends BaseRepository {
  constructor() {
    super('templates');
  }

  /** @param {string} organizationId @returns {Promise<object[]>} */
  async findByOrg(organizationId) {
    return this.findByIndex('by_orgId', organizationId);
  }

  /** @param {string} organizationId @returns {Promise<object[]>} */
  async findCompactByOrg(organizationId) {
    const all = await this.findByOrg(organizationId);
    return all.filter((t) => t.isCompact);
  }

  /**
   * Finds a template by name within an organization.
   * Used by EventDispatcherService to resolve system templates.
   * @param {string} name
   * @param {string} organizationId
   * @returns {Promise<object | undefined>}
   */
  async findByName(name, organizationId) {
    const all = await this.findByOrg(organizationId);
    return all.find((t) => t.name === name);
  }
}
