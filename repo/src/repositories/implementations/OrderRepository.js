import { BaseRepository } from '../base/BaseRepository.js';

export class OrderRepository extends BaseRepository {
  constructor() {
    super('orders');
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
}

export class OrderEventRepository extends BaseRepository {
  constructor() {
    super('orderEvents');
  }

  /** @param {string} orderId @returns {Promise<object[]>} */
  async findByOrder(orderId) {
    return this.findByIndex('by_orderId', orderId);
  }
}
