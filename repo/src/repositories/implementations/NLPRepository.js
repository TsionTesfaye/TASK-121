import { BaseRepository } from '../base/BaseRepository.js';

export class ImportedTextRepository extends BaseRepository {
  constructor() {
    super('importedTexts');
  }

  /** @param {string} organizationId @returns {Promise<object[]>} */
  async findByOrg(organizationId) {
    return this.findByIndex('by_orgId', organizationId);
  }

  /** @param {string} sourceType @returns {Promise<object[]>} */
  async findBySourceType(sourceType) {
    return this.findByIndex('by_sourceType', sourceType);
  }

  /**
   * Returns texts for the given organization created or updated after the given timestamp.
   * @param {string} organizationId
   * @param {number} sinceMs
   * @returns {Promise<object[]>}
   */
  async findByOrgUpdatedSince(organizationId, sinceMs) {
    const all = await this.findByOrg(organizationId);
    return all.filter((t) => t.updatedAt >= sinceMs || t.importedAt >= sinceMs);
  }
}

export class ValidationProfileRepository extends BaseRepository {
  constructor() {
    super('validationProfiles');
  }

  /** @param {string} modelVersion @returns {Promise<object | null>} */
  async findByModelVersion(modelVersion) {
    return this.findOneByIndex('by_modelVersion', modelVersion);
  }

  /** @returns {Promise<object | null>} Returns the most recent profile. */
  async findLatest() {
    const all = await this.findAll();
    if (all.length === 0) return null;
    return all.sort((a, b) => b.createdAt - a.createdAt)[0];
  }
}

export class NLPRunRepository extends BaseRepository {
  constructor() {
    super('nlpRuns');
  }

  /** @param {string} organizationId @returns {Promise<object[]>} */
  async findByOrg(organizationId) {
    return this.findByIndex('by_orgId', organizationId);
  }

  /** @param {string} organizationId @returns {Promise<object | null>} */
  async findLatestByOrg(organizationId) {
    const runs = await this.findByOrg(organizationId);
    if (runs.length === 0) return null;
    return runs.sort((a, b) => b.createdAt - a.createdAt)[0];
  }
}
