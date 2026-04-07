/**
 * BaseRepository — IndexedDB implementation of IRepository.
 *
 * Subclasses pass their store name to the constructor and inherit all CRUD
 * helpers.  They may override or extend methods for domain-specific queries.
 *
 * All writes go through the getDB() singleton so the connection is always
 * shared (one IDBDatabase per tab).
 */

import { IRepository } from './IRepository.js';
import { getDB, requestToPromise } from '../../infrastructure/db/db.js';

export class BaseRepository extends IRepository {
  /**
   * @param {string} storeName  Name of the IndexedDB object store.
   */
  constructor(storeName) {
    super();
    this._storeName = storeName;
  }

  // ── Read helpers ─────────────────────────────────────────────────────────────

  /** @returns {IDBObjectStore} */
  _readStore(tx) {
    return tx.objectStore(this._storeName);
  }

  /** @returns {IDBObjectStore} */
  _writeStore(tx) {
    return tx.objectStore(this._storeName);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  /**
   * Inserts a new record.  Throws if a record with the same key already exists.
   * @param {object} data  Must contain the store's keyPath field.
   * @returns {Promise<object>}
   */
  async create(data) {
    const db = getDB();
    const tx = db.transaction(this._storeName, 'readwrite');
    const store = tx.objectStore(this._storeName);
    await requestToPromise(store.add(data));
    return data;
  }

  /**
   * @param {string} id
   * @returns {Promise<object | null>}
   */
  async findById(id) {
    const db = getDB();
    const tx = db.transaction(this._storeName, 'readonly');
    const store = tx.objectStore(this._storeName);
    const result = await requestToPromise(store.get(id));
    return result ?? null;
  }

  /**
   * @returns {Promise<object[]>}
   */
  async findAll() {
    const db = getDB();
    const tx = db.transaction(this._storeName, 'readonly');
    const store = tx.objectStore(this._storeName);
    return requestToPromise(store.getAll());
  }

  /**
   * @param {string} indexName
   * @param {IDBValidKey} value
   * @returns {Promise<object[]>}
   */
  async findByIndex(indexName, value) {
    const db = getDB();
    const tx = db.transaction(this._storeName, 'readonly');
    const store = tx.objectStore(this._storeName);
    const index = store.index(indexName);
    return requestToPromise(index.getAll(value));
  }

  /**
   * Retrieves the first record matching an index key.
   *
   * @param {string} indexName
   * @param {IDBValidKey} value
   * @returns {Promise<object | null>}
   */
  async findOneByIndex(indexName, value) {
    const db = getDB();
    const tx = db.transaction(this._storeName, 'readonly');
    const store = tx.objectStore(this._storeName);
    const index = store.index(indexName);
    const result = await requestToPromise(index.get(value));
    return result ?? null;
  }

  /**
   * Retrieves all records matching a compound index key array.
   *
   * @param {string} indexName
   * @param {IDBValidKey[]} keyArray
   * @returns {Promise<object[]>}
   */
  async findByCompoundIndex(indexName, keyArray) {
    const db = getDB();
    const tx = db.transaction(this._storeName, 'readonly');
    const store = tx.objectStore(this._storeName);
    const index = store.index(indexName);
    return requestToPromise(index.getAll(keyArray));
  }

  /**
   * Replaces an existing record.  Throws if the record does not exist.
   * @param {string} id
   * @param {object} data
   * @returns {Promise<object>}
   */
  async update(id, data) {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Record '${id}' not found in '${this._storeName}'.`);

    const db = getDB();
    const tx = db.transaction(this._storeName, 'readwrite');
    const store = tx.objectStore(this._storeName);
    await requestToPromise(store.put(data));
    return data;
  }

  /**
   * @param {string} id
   * @returns {Promise<void>}
   */
  async delete(id) {
    const db = getDB();
    const tx = db.transaction(this._storeName, 'readwrite');
    const store = tx.objectStore(this._storeName);
    await requestToPromise(store.delete(id));
  }

  /**
   * @returns {Promise<void>}
   */
  async clear() {
    const db = getDB();
    const tx = db.transaction(this._storeName, 'readwrite');
    const store = tx.objectStore(this._storeName);
    await requestToPromise(store.clear());
  }

  /**
   * @returns {Promise<number>}
   */
  async count() {
    const db = getDB();
    const tx = db.transaction(this._storeName, 'readonly');
    const store = tx.objectStore(this._storeName);
    return requestToPromise(store.count());
  }

  /**
   * Performs a bulk insert within a single transaction.
   * Aborts if any insert fails.
   *
   * @param {object[]} items
   * @returns {Promise<object[]>}
   */
  async createMany(items) {
    if (items.length === 0) return [];

    const db = getDB();
    const tx = db.transaction(this._storeName, 'readwrite');
    const store = tx.objectStore(this._storeName);

    const promises = items.map((item) => requestToPromise(store.add(item)));
    await Promise.all(promises);
    return items;
  }

  /**
   * Upserts a record (insert or overwrite).
   * @param {object} data
   * @returns {Promise<object>}
   */
  async upsert(data) {
    const db = getDB();
    const tx = db.transaction(this._storeName, 'readwrite');
    const store = tx.objectStore(this._storeName);
    await requestToPromise(store.put(data));
    return data;
  }
}
