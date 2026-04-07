import { BaseRepository } from '../base/BaseRepository.js';
import { getDB, requestToPromise } from '../../infrastructure/db/db.js';

export class MasterDataRepository extends BaseRepository {
  constructor() {
    super('masterDataVersions');
  }

  /**
   * Returns the single active version for an entity type in an org.
   * @param {string} entityType
   * @param {string} organizationId
   * @returns {Promise<object | null>}
   */
  async findActiveVersion(entityType, organizationId) {
    const all = await this.findAll();
    return (
      all.find(
        (v) => v.entityType === entityType && v.organizationId === organizationId && v.isActive,
      ) ?? null
    );
  }

  /**
   * Returns all versions for a specific entity, ordered by versionNumber descending.
   * @param {string} entityId
   * @returns {Promise<object[]>}
   */
  async findVersionHistory(entityId) {
    const versions = await this.findByIndex('by_entityId', entityId);
    return versions.sort((a, b) => b.versionNumber - a.versionNumber);
  }

  /**
   * Returns all active versions for an organization.
   * @param {string} organizationId
   * @returns {Promise<object[]>}
   */
  async findActiveVersionsByOrg(organizationId) {
    const all = await this.findByIndex('by_orgId', organizationId);
    return all.filter((v) => v.isActive);
  }

  /**
   * Atomically checks the optimistic concurrency guard, deactivates the
   * current active version, and creates the new one — all within a single
   * IndexedDB transaction.  This eliminates the TOCTOU race that would occur
   * if the concurrency check happened outside the transaction.
   *
   * @param {string | null} expectedActiveVersionId  The version the caller loaded.
   * @param {object} newVersionData  Must include entityType and organizationId.
   * @returns {Promise<object>}
   */
  async atomicVersionSwitch(expectedActiveVersionId, newVersionData) {
    const db = getDB();
    const tx = db.transaction('masterDataVersions', 'readwrite');
    const store = tx.objectStore('masterDataVersions');

    // Re-read the current active version INSIDE the transaction so the check
    // and the write are serialized by IDB's transaction locking.
    const all = await requestToPromise(store.getAll());
    const currentActive = all.find(
      (v) =>
        v.entityType === newVersionData.entityType &&
        v.organizationId === newVersionData.organizationId &&
        v.isActive,
    ) ?? null;

    const currentActiveId = currentActive?.id ?? null;
    if (currentActiveId !== (expectedActiveVersionId ?? null)) {
      tx.abort();
      throw new Error(
        'Concurrency conflict: the active version changed since you loaded this form. Please reload.',
      );
    }

    if (currentActive) {
      await requestToPromise(store.put({ ...currentActive, isActive: false }));
    }

    await requestToPromise(store.add(newVersionData));

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(newVersionData);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('atomicVersionSwitch transaction aborted'));
    });
  }
}
