/**
 * Unit tests — IndexedDB initialization and repository CRUD.
 *
 * Uses fake-indexeddb (shimmed globally in tests/setup.js) so these tests
 * run identically in Node 18 and in the browser.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initDB, getDB, closeDB, isDBInitialized } from '../../src/infrastructure/db/db.js';
import { ALL_STORE_NAMES, DB_VERSION, SCHEMA_STORES } from '../../src/infrastructure/db/schema.js';
import { BaseRepository } from '../../src/repositories/base/BaseRepository.js';

// Each test gets a fresh IDBFactory instance to ensure full isolation.
let idbFactory;

beforeEach(async () => {
  idbFactory = new IDBFactory();
  await initDB(idbFactory);
});

afterEach(() => {
  closeDB();
});

// ── Database initialization ───────────────────────────────────────────────────

describe('initDB', () => {
  it('initializes without error and marks the DB as ready', () => {
    expect(isDBInitialized()).toBe(true);
  });

  it('creates all expected object stores', () => {
    const db = getDB();
    for (const storeName of ALL_STORE_NAMES) {
      expect(db.objectStoreNames.contains(storeName)).toBe(true);
    }
  });

  it('creates the expected number of stores', () => {
    const db = getDB();
    expect(db.objectStoreNames.length).toBe(ALL_STORE_NAMES.length);
  });

  it('opens the database at the correct schema version', () => {
    const db = getDB();
    expect(db.version).toBe(DB_VERSION);
  });

  it('throws when accessing DB before initialization', () => {
    closeDB();
    expect(() => getDB()).toThrow('Database not initialized');
  });

  it('creates correct indexes for the users store', () => {
    const db = getDB();
    const tx = db.transaction('users', 'readonly');
    const store = tx.objectStore('users');

    for (const idx of SCHEMA_STORES.users.indexes) {
      expect(store.indexNames.contains(idx.name)).toBe(true);
    }
  });
});

// ── BaseRepository CRUD ───────────────────────────────────────────────────────

describe('BaseRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new BaseRepository('users');
  });

  it('creates and retrieves a record by ID', async () => {
    const user = {
      id: 'user-001',
      username: 'alice',
      role: 'administrator',
      isActive: true,
    };

    const created = await repo.create(user);
    expect(created).toEqual(user);

    const found = await repo.findById('user-001');
    expect(found).toEqual(user);
  });

  it('returns null for a non-existent record', async () => {
    const result = await repo.findById('does-not-exist');
    expect(result).toBeNull();
  });

  it('findAll returns all records', async () => {
    await repo.create({ id: 'u1', username: 'a', role: 'administrator', isActive: true });
    await repo.create({ id: 'u2', username: 'b', role: 'store_manager', isActive: true });

    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });

  it('updates a record', async () => {
    const user = { id: 'u3', username: 'charlie', role: 'analyst', isActive: true };
    await repo.create(user);

    const updated = { ...user, role: 'reviewer' };
    await repo.update('u3', updated);

    const found = await repo.findById('u3');
    expect(found.role).toBe('reviewer');
  });

  it('throws when updating a non-existent record', async () => {
    await expect(
      repo.update('ghost', { id: 'ghost', username: 'ghost', role: 'analyst', isActive: true }),
    ).rejects.toThrow("Record 'ghost' not found");
  });

  it('deletes a record', async () => {
    await repo.create({ id: 'u4', username: 'dave', role: 'analyst', isActive: true });
    await repo.delete('u4');

    const found = await repo.findById('u4');
    expect(found).toBeNull();
  });

  it('counts records correctly', async () => {
    await repo.create({ id: 'u5', username: 'eve', role: 'reviewer', isActive: true });
    const count = await repo.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('clears all records', async () => {
    await repo.create({ id: 'u6', username: 'frank', role: 'analyst', isActive: true });
    await repo.clear();

    const all = await repo.findAll();
    expect(all).toHaveLength(0);
  });

  it('findByIndex returns matching records', async () => {
    await repo.create({ id: 'u7', username: 'grace', role: 'store_manager', isActive: true, organizationNodeId: 'org-1' });
    await repo.create({ id: 'u8', username: 'hank', role: 'analyst', isActive: true, organizationNodeId: 'org-2' });

    const results = await repo.findByIndex('by_role', 'store_manager');
    expect(results.some((r) => r.id === 'u7')).toBe(true);
    expect(results.every((r) => r.role === 'store_manager')).toBe(true);
  });

  it('upserts an existing record', async () => {
    const user = { id: 'u9', username: 'iris', role: 'analyst', isActive: true };
    await repo.create(user);
    await repo.upsert({ ...user, role: 'reviewer' });

    const found = await repo.findById('u9');
    expect(found.role).toBe('reviewer');
  });

  it('createMany inserts all records', async () => {
    const users = [
      { id: 'm1', username: 'j1', role: 'analyst', isActive: true },
      { id: 'm2', username: 'j2', role: 'analyst', isActive: true },
      { id: 'm3', username: 'j3', role: 'analyst', isActive: true },
    ];
    await repo.createMany(users);

    const all = await repo.findAll();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });
});
