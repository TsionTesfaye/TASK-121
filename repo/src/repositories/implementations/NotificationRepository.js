import { BaseRepository } from '../base/BaseRepository.js';

export class NotificationChannelRepository extends BaseRepository {
  constructor() {
    super('notificationChannels');
  }

  /** @param {string} organizationId @returns {Promise<object[]>} */
  async findByOrg(organizationId) {
    return this.findByIndex('by_orgId', organizationId);
  }
}

export class NotificationSubscriptionRepository extends BaseRepository {
  constructor() {
    super('notificationSubscriptions');
  }

  /** @param {string} userId @returns {Promise<object[]>} */
  async findByUser(userId) {
    return this.findByIndex('by_userId', userId);
  }

  /** @param {string} eventType @returns {Promise<object[]>} */
  async findByEventType(eventType) {
    return this.findByIndex('by_eventType', eventType);
  }
}

export class MessageQueueRepository extends BaseRepository {
  constructor() {
    super('messageQueue');
  }

  /** @param {string} status @returns {Promise<object[]>} */
  async findByStatus(status) {
    return this.findByIndex('by_status', status);
  }

  /**
   * Returns items due for retry.
   * @param {number} nowMs
   * @returns {Promise<object[]>}
   */
  async findDueForRetry(nowMs) {
    const all = await this.findByStatus('Queued');
    return all.filter((item) => item.nextRetryAt != null && item.nextRetryAt <= nowMs);
  }
}

export class NotificationRepository extends BaseRepository {
  constructor() {
    super('notifications');
  }

  /** @param {string} userId @returns {Promise<object[]>} */
  async findByUser(userId) {
    return this.findByIndex('by_userId', userId);
  }

  /** @param {string} userId @returns {Promise<object[]>} */
  async findUnreadByUser(userId) {
    const all = await this.findByUser(userId);
    return all.filter((n) => !n.read);
  }
}
