import { BaseRepository } from '../base/BaseRepository.js';

export class AuditRepository extends BaseRepository {
  constructor() {
    super('auditLogs');
  }

  /** @param {string} actorId @returns {Promise<object[]>} */
  async findByActor(actorId) {
    return this.findByIndex('by_actorId', actorId);
  }

  /** @param {string} entityType @returns {Promise<object[]>} */
  async findByEntityType(entityType) {
    return this.findByIndex('by_entityType', entityType);
  }

  /** @param {string} entityId @returns {Promise<object[]>} */
  async findByEntity(entityId) {
    return this.findByIndex('by_entityId', entityId);
  }

  /**
   * Returns logs created after the given timestamp, ordered ascending.
   * @param {number} sinceMs
   * @returns {Promise<object[]>}
   */
  async findSince(sinceMs) {
    const all = await this.findAll();
    return all
      .filter((log) => log.createdAt >= sinceMs)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}
