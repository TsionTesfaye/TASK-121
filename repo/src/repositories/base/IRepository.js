/**
 * IRepository — interface contract for all domain repositories.
 *
 * Concrete implementations must override every method and throw if called
 * on the base class directly.  This enforces the contract in a JS environment
 * without TypeScript interfaces.
 *
 * All methods return Promises so implementations can be swapped between
 * IndexedDB (offline) and REST (future) adapters without changing service code.
 */

export class IRepository {
  /**
   * Creates a new record.
   * @param {object} data
   * @returns {Promise<object>}
   */
  async create(data) {
    throw new Error(`${this.constructor.name}.create() is not implemented.`);
  }

  /**
   * Returns a record by its primary key, or null if not found.
   * @param {string} id
   * @returns {Promise<object | null>}
   */
  async findById(id) {
    throw new Error(`${this.constructor.name}.findById() is not implemented.`);
  }

  /**
   * Returns all records in the store.
   * @returns {Promise<object[]>}
   */
  async findAll() {
    throw new Error(`${this.constructor.name}.findAll() is not implemented.`);
  }

  /**
   * Returns all records matching the given index key.
   * @param {string} indexName
   * @param {IDBValidKey} value
   * @returns {Promise<object[]>}
   */
  async findByIndex(indexName, value) {
    throw new Error(`${this.constructor.name}.findByIndex() is not implemented.`);
  }

  /**
   * Replaces an existing record entirely.
   * @param {string} id
   * @param {object} data
   * @returns {Promise<object>}
   */
  async update(id, data) {
    throw new Error(`${this.constructor.name}.update() is not implemented.`);
  }

  /**
   * Removes a record by its primary key.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async delete(id) {
    throw new Error(`${this.constructor.name}.delete() is not implemented.`);
  }

  /**
   * Removes all records from the store.
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error(`${this.constructor.name}.clear() is not implemented.`);
  }

  /**
   * Returns the count of records in the store.
   * @returns {Promise<number>}
   */
  async count() {
    throw new Error(`${this.constructor.name}.count() is not implemented.`);
  }
}
