/**
 * AuditService — append-only event logging.
 *
 * All domain services call AuditService to record immutable audit events.
 * Logs are stored in IndexedDB and never overwritten by standard imports.
 */

import { AuditRepository } from '../repositories/implementations/AuditRepository.js';
import { generateId } from '../utils/idGenerator.js';

export class AuditService {
  constructor() {
    this._repo = new AuditRepository();
  }

  /**
   * Appends a single audit event.
   *
   * @param {{ actorId: string; action: string; entityType: string; entityId: string; metadata?: object }} params
   * @returns {Promise<object>}
   */
  async log({ actorId, action, entityType, entityId, metadata = {} }) {
    const entry = {
      id: generateId(),
      actorId,
      action,
      entityType,
      entityId,
      metadata,
      createdAt: Date.now(),
    };
    return this._repo.create(entry);
  }

  /**
   * Retrieves all audit entries for a specific entity.
   * @param {string} entityId
   * @returns {Promise<object[]>}
   */
  async getEntityHistory(entityId) {
    return this._repo.findByEntity(entityId);
  }

  /**
   * Retrieves all audit entries by actor.
   * @param {string} actorId
   * @returns {Promise<object[]>}
   */
  async getActorHistory(actorId) {
    return this._repo.findByActor(actorId);
  }

  /**
   * Retrieves all audit entries since a given timestamp.
   * @param {number} sinceMs
   * @returns {Promise<object[]>}
   */
  async getSince(sinceMs) {
    return this._repo.findSince(sinceMs);
  }
}

export const auditService = new AuditService();
