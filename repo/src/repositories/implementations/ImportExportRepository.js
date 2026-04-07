/**
 * ImportExportRepository handles bulk read/write operations for backup/restore.
 *
 * Unlike domain repositories it operates across multiple stores, so it
 * does NOT extend BaseRepository — it holds a reference to the DB directly.
 */

import { getDB, requestToPromise } from '../../infrastructure/db/db.js';
import { ALL_STORE_NAMES, PROTECTED_STORES } from '../../infrastructure/db/schema.js';

export class ImportExportRepository {
  /**
   * Exports all non-protected stores as a plain JS object.
   * @returns {Promise<Record<string, object[]>>}
   */
  async exportAll() {
    const db = getDB();
    const storeNames = ALL_STORE_NAMES.filter((s) => !PROTECTED_STORES.has(s));
    const tx = db.transaction(storeNames, 'readonly');
    const result = {};

    for (const name of storeNames) {
      const store = tx.objectStore(name);
      result[name] = await requestToPromise(store.getAll());
    }

    return result;
  }

  /**
   * Replaces all non-protected stores with the provided data snapshot.
   * Runs in a single transaction covering all affected stores.
   *
   * @param {Record<string, object[]>} snapshot
   * @returns {Promise<void>}
   */
  async importAll(snapshot) {
    const db = getDB();
    const storeNames = Object.keys(snapshot).filter((s) => !PROTECTED_STORES.has(s));
    if (storeNames.length === 0) return;
    const tx = db.transaction(storeNames, 'readwrite');

    for (const name of storeNames) {
      const store = tx.objectStore(name);
      await requestToPromise(store.clear());
      for (const record of snapshot[name] ?? []) {
        await requestToPromise(store.add(record));
      }
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Import transaction aborted'));
    });
  }

  /**
   * Returns a preview diff between the current database state and the incoming snapshot.
   * Diff entries have the shape: { store, action: 'add'|'update'|'delete', record }
   *
   * @param {Record<string, object[]>} snapshot
   * @returns {Promise<object[]>}
   */
  async previewDiff(snapshot) {
    const db = getDB();
    const storeNames = Object.keys(snapshot).filter((s) => !PROTECTED_STORES.has(s));
    const diff = [];

    for (const name of storeNames) {
      const tx = db.transaction(name, 'readonly');
      const store = tx.objectStore(name);
      const existing = await requestToPromise(store.getAll());
      const existingMap = new Map(existing.map((r) => [r.id, r]));
      const incomingMap = new Map((snapshot[name] ?? []).map((r) => [r.id, r]));

      for (const [id, record] of incomingMap) {
        if (!existingMap.has(id)) {
          diff.push({ store: name, action: 'add', record });
        } else if (JSON.stringify(existingMap.get(id)) !== JSON.stringify(record)) {
          diff.push({ store: name, action: 'update', record });
        }
      }

      for (const [id, record] of existingMap) {
        if (!incomingMap.has(id)) {
          diff.push({ store: name, action: 'delete', record });
        }
      }
    }

    return diff;
  }
}
