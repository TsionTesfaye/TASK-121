import { BaseRepository } from '../base/BaseRepository.js';

export class RiskRuleRepository extends BaseRepository {
  constructor() {
    super('riskRules');
  }

  /** @param {string} organizationId @returns {Promise<object[]>} */
  async findByOrg(organizationId) {
    return this.findByIndex('by_orgId', organizationId);
  }

  /** @param {string} organizationId @returns {Promise<object[]>} */
  async findActiveByOrg(organizationId) {
    const all = await this.findByIndex('by_orgId', organizationId);
    return all.filter((r) => r.isActive);
  }

  /** @param {string} targetEntityType @returns {Promise<object[]>} */
  async findByEntityType(targetEntityType) {
    return this.findByIndex('by_targetEntityType', targetEntityType);
  }
}

export class RiskCaseRepository extends BaseRepository {
  constructor() {
    super('riskCases');
  }

  /** @param {string} organizationId @returns {Promise<object[]>} */
  async findByOrg(organizationId) {
    return this.findByIndex('by_orgId', organizationId);
  }

  /** @param {string} status @returns {Promise<object[]>} */
  async findByStatus(status) {
    return this.findByIndex('by_status', status);
  }

  /** @param {string} reviewerId @returns {Promise<object[]>} */
  async findByReviewer(reviewerId) {
    return this.findByIndex('by_assignedReviewerId', reviewerId);
  }

  /** @param {string} sourceType @returns {Promise<object[]>} */
  async findBySourceType(sourceType) {
    return this.findByIndex('by_sourceType', sourceType);
  }
}

export class BidEventRepository extends BaseRepository {
  constructor() {
    super('bidEvents');
  }

  /** @param {string} userId @returns {Promise<object[]>} */
  async findByUser(userId) {
    return this.findByIndex('by_userId', userId);
  }

  /** @param {string} deviceFingerprint @returns {Promise<object[]>} */
  async findByFingerprint(deviceFingerprint) {
    return this.findByIndex('by_deviceFingerprint', deviceFingerprint);
  }

  /**
   * Returns events within a time window for frequency analysis.
   * @param {string} itemId
   * @param {number} fromMs
   * @param {number} toMs
   * @returns {Promise<object[]>}
   */
  async findByItemInWindow(itemId, fromMs, toMs) {
    const all = await this.findByIndex('by_itemId', itemId);
    return all.filter((e) => e.createdAt >= fromMs && e.createdAt <= toMs);
  }
}

export class LinkedAccountRepository extends BaseRepository {
  constructor() {
    super('linkedAccounts');
  }

  /** @param {string} userId @returns {Promise<object[]>} */
  async findByPrimaryUser(userId) {
    return this.findByIndex('by_primaryUserId', userId);
  }

  /** @param {string} userId @returns {Promise<object[]>} */
  async findByLinkedUser(userId) {
    return this.findByIndex('by_linkedUserId', userId);
  }

  /**
   * Returns all accounts linked to the given userId (either as primary or linked).
   * @param {string} userId
   * @returns {Promise<object[]>}
   */
  async findAllLinksForUser(userId) {
    const [asPrimary, asLinked] = await Promise.all([
      this.findByPrimaryUser(userId),
      this.findByLinkedUser(userId),
    ]);
    return [...asPrimary, ...asLinked];
  }
}
