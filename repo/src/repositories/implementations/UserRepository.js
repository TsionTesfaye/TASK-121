import { BaseRepository } from '../base/BaseRepository.js';

export class UserRepository extends BaseRepository {
  constructor() {
    super('users');
  }

  /** @param {string} username @returns {Promise<object | null>} */
  async findByUsername(username) {
    return this.findOneByIndex('by_username', username);
  }

  /** @param {string} orgNodeId @returns {Promise<object[]>} */
  async findByOrgNode(orgNodeId) {
    return this.findByIndex('by_org', orgNodeId);
  }

  /** @param {string} role @returns {Promise<object[]>} */
  async findByRole(role) {
    return this.findByIndex('by_role', role);
  }
}
