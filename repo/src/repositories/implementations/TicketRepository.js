import { BaseRepository } from '../base/BaseRepository.js';

export class TicketRepository extends BaseRepository {
  constructor() {
    super('tickets');
  }

  /** @param {string} customerId @returns {Promise<object[]>} */
  async findByCustomer(customerId) {
    return this.findByIndex('by_customerId', customerId);
  }

  /** @param {string} storeId @returns {Promise<object[]>} */
  async findByStore(storeId) {
    return this.findByIndex('by_storeId', storeId);
  }

  /** @param {string} status @returns {Promise<object[]>} */
  async findByStatus(status) {
    return this.findByIndex('by_status', status);
  }

  /** @param {string} userId @returns {Promise<object[]>} */
  async findByAssignee(userId) {
    return this.findByIndex('by_assignedTo', userId);
  }

  /** @returns {Promise<object[]>} */
  async findOverdue() {
    const all = await this.findAll();
    return all.filter((t) => t.isOverdue === true);
  }

  /**
   * Returns all open or in-progress tickets past their SLA due time.
   * @param {number} nowMs
   * @returns {Promise<object[]>}
   */
  async findDueForOverdueCheck(nowMs) {
    const all = await this.findAll();
    return all.filter(
      (t) =>
        (t.status === 'open' || t.status === 'in_progress') &&
        !t.isOverdue &&
        t.slaDueAt <= nowMs,
    );
  }
}

export class TicketEventRepository extends BaseRepository {
  constructor() {
    super('ticketEvents');
  }

  /** @param {string} ticketId @returns {Promise<object[]>} */
  async findByTicket(ticketId) {
    return this.findByIndex('by_ticketId', ticketId);
  }
}
