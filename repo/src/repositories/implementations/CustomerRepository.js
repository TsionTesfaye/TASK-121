import { BaseRepository } from '../base/BaseRepository.js';

export class CustomerRepository extends BaseRepository {
  constructor() {
    super('customers');
  }

  /** @param {string} organizationId @returns {Promise<object[]>} */
  async findByOrg(organizationId) {
    return this.findByIndex('by_orgId', organizationId);
  }

  /** @param {string} tier @returns {Promise<object[]>} */
  async findByMembershipTier(tier) {
    return this.findByIndex('by_membershipTier', tier);
  }
}
