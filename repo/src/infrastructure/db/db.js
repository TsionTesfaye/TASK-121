/**
 * Centralized IndexedDB access module.
 *
 * - initDB(overrideFactory?)  opens / creates the database
 * - getDB()                   returns the cached IDBDatabase instance
 * - closeDB()                 closes and clears the cached instance (used in tests)
 *
 * The optional `overrideFactory` parameter accepts a custom `IDBFactory`
 * (e.g. `fake-indexeddb` in tests) so the module is fully testable in Node 18.
 */

import { DB_NAME, DB_VERSION, SCHEMA_STORES } from './schema.js';

/** @type {IDBDatabase | null} */
let _db = null;

/**
 * Opens the IndexedDB database and runs any pending schema upgrades.
 *
 * @param {IDBFactory | null} [overrideFactory]  Pass `indexedDB` from fake-indexeddb in tests.
 * @returns {Promise<IDBDatabase>}
 */
export async function initDB(overrideFactory = null) {
  // If already initialized and no explicit factory override, reuse the existing connection.
  if (_db && !overrideFactory) return _db;

  const idbFactory = overrideFactory ?? globalThis.indexedDB;

  if (!idbFactory) {
    throw new Error(
      'IndexedDB is not available. ' +
        'In Node 18 tests, pass a fake-indexeddb IDBFactory to initDB().',
    );
  }

  return new Promise((resolve, reject) => {
    const request = idbFactory.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error(`Failed to open database: ${request.error?.message}`));

    request.onsuccess = () => {
      _db = /** @type {IDBDatabase} */ (request.result);

      _db.onerror = (event) => {
        console.error('[IndexedDB] Unhandled error:', event?.target?.error?.message || 'Unknown error');
      };

      resolve(_db);
    };

    request.onupgradeneeded = (event) => {
      const db = /** @type {IDBDatabase} */ (event.target.result);
      _applySchema(db, event.oldVersion);
    };

    request.onblocked = () => {
      console.warn('[IndexedDB] Upgrade blocked by another open tab.');
    };
  });
}

/**
 * Returns the cached IDBDatabase instance.
 * Throws if initDB() has not been called first.
 *
 * @returns {IDBDatabase}
 */
export function getDB() {
  if (!_db) {
    throw new Error('Database not initialized. Call initDB() before accessing the database.');
  }
  return _db;
}

/**
 * Closes and clears the cached database instance.
 * Primarily used between test runs to avoid state leakage.
 */
export function closeDB() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Returns whether the database has been initialized.
 * @returns {boolean}
 */
export function isDBInitialized() {
  return _db !== null;
}

// ── Schema upgrade ─────────────────────────────────────────────────────────────

/**
 * Applies the full schema by iterating SCHEMA_STORES.
 * Safe to call on both fresh installs (oldVersion=0) and upgrades.
 *
 * @param {IDBDatabase} db
 * @param {number} _oldVersion
 */
function _applySchema(db, _oldVersion) {
  for (const [storeName, definition] of Object.entries(SCHEMA_STORES)) {
    if (!db.objectStoreNames.contains(storeName)) {
      const store = db.createObjectStore(storeName, {
        keyPath: definition.keyPath,
        autoIncrement: definition.autoIncrement ?? false,
      });

      for (const idx of definition.indexes ?? []) {
        store.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
      }
    }
  }
}

// ── Transaction helpers ────────────────────────────────────────────────────────

/**
 * Wraps an IndexedDB request in a Promise.
 *
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Opens a read-write transaction for the given stores and runs the callback.
 * Rolls back automatically if the callback throws.
 *
 * @template T
 * @param {string[]} storeNames
 * @param {(tx: IDBTransaction) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function withTransaction(storeNames, callback) {
  const db = getDB();
  const tx = db.transaction(storeNames, 'readwrite');

  return new Promise((resolve, reject) => {
    let result;

    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error('Transaction aborted.'));
    tx.oncomplete = () => resolve(result);

    Promise.resolve()
      .then(() => callback(tx))
      .then((r) => {
        result = r;
      })
      .catch((err) => {
        tx.abort();
        reject(err);
      });
  });
}

/**
 * Opens a read-only transaction for the given stores and runs the callback.
 *
 * @template T
 * @param {string[]} storeNames
 * @param {(tx: IDBTransaction) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function withReadTransaction(storeNames, callback) {
  const db = getDB();
  const tx = db.transaction(storeNames, 'readonly');

  return new Promise((resolve, reject) => {
    let result;

    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error('Read transaction aborted.'));
    tx.oncomplete = () => resolve(result);

    Promise.resolve()
      .then(() => callback(tx))
      .then((r) => {
        result = r;
      })
      .catch((err) => {
        reject(err);
      });
  });
}
