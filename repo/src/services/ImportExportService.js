import { ImportExportRepository } from '../repositories/implementations/ImportExportRepository.js';
import { MasterDataRepository } from '../repositories/implementations/MasterDataRepository.js';
import { cryptoService } from './CryptoService.js';
import { auditService } from './AuditService.js';
import { authService } from './AuthService.js';
import { generateId } from '../utils/idGenerator.js';
import { DB_VERSION, SCHEMA_STORES, PROTECTED_STORES } from '../infrastructure/db/schema.js';
import { ROLES, MASTER_DATA_ENTITY_TYPES } from '../utils/constants.js';

/** Stores whose records should get version records on import. */
const VERSIONED_STORES = new Set([
  'colors', 'sizes', 'seasons', 'brands', 'suppliers', 'styles',
  'masterDataVersions',
]);

/**
 * ImportExportService — encrypted backup/restore with schema validation.
 *
 * Protected stores (sessions, auditLogs) are excluded from export and
 * never overwritten during import.
 *
 * RBAC: ADMINISTRATOR only.
 */
export class ImportExportService {
  constructor() {
    this._repo = new ImportExportRepository();
  }

  /**
   * Exports all non-protected stores as an encrypted JSON backup file.
   * Uses a separate backup passphrase (not the login password).
   * Requires: ADMINISTRATOR role.
   *
   * @param {{ actorId: string; backupPassphrase: string }} params
   * @returns {Promise<Blob>}  A downloadable .json Blob.
   */
  async exportBackup({ actorId, backupPassphrase }) {
    this._requireRole(ROLES.ADMINISTRATOR);

    if (!backupPassphrase?.trim()) throw new Error('Backup passphrase is required.');

    const snapshot = await this._repo.exportAll();

    const envelope = {
      schemaVersion: DB_VERSION,
      exportedAt: Date.now(),
      exportedBy: actorId,
      data: snapshot,
    };

    const { key, saltHex } = await cryptoService.deriveBackupKey(backupPassphrase);
    const { ciphertext, iv } = await cryptoService.encryptBackup(JSON.stringify(envelope), key);

    const backupFile = JSON.stringify({
      version: DB_VERSION,
      saltHex,
      iv,
      ciphertext,
    });

    await auditService.log({
      actorId,
      action: 'export_backup',
      entityType: 'system',
      entityId: 'backup',
      metadata: { schemaVersion: DB_VERSION },
    });

    return new Blob([backupFile], { type: 'application/json' });
  }

  /**
   * Reads and decrypts an import file, validates its schema, and returns
   * the preview diff without applying changes.
   * Requires: ADMINISTRATOR role.
   *
   * @param {{ file: File; backupPassphrase: string }} params
   * @returns {Promise<{ diff: object[]; snapshot: object; schemaVersion: number }>}
   */
  async previewImport({ file, backupPassphrase }) {
    this._requireRole(ROLES.ADMINISTRATOR);

    if (!backupPassphrase?.trim()) throw new Error('Backup passphrase is required.');
    if (!file) throw new Error('Import file is required.');

    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Import file is not valid JSON.');
    }

    const { schemaVersion, snapshot } = await this._decryptAndValidate(parsed, backupPassphrase);

    const rawDiff = await this._repo.previewDiff(snapshot);

    // Aggregate per-record rows into summary rows { store, action, count }
    const countMap = new Map();
    for (const { store, action } of rawDiff) {
      const key = `${store}::${action}`;
      countMap.set(key, { store, action, count: (countMap.get(key)?.count ?? 0) + 1 });
    }
    const diff = [...countMap.values()];

    return { diff, snapshot, schemaVersion };
  }

  /**
   * Applies a previously previewed import snapshot, replacing live store data.
   * Protected stores (sessions, auditLogs) are never replaced.
   * Requires: ADMINISTRATOR role.
   *
   * @param {{ snapshot: object; actorId: string }} params
   * @returns {Promise<void>}
   */
  async applyImport({ snapshot, schemaVersion, actorId }) {
    this._requireRole(ROLES.ADMINISTRATOR);

    if (!snapshot || typeof snapshot !== 'object') throw new Error('Snapshot must be a non-null object.');
    if (typeof schemaVersion !== 'number') throw new Error('Schema version is required for import validation.');
    this.validateSchemaVersion(schemaVersion);

    // Validate snapshot structure: every store must exist in schema and records must have required fields.
    this._validateSnapshotStructure(snapshot);

    await this._repo.importAll(snapshot);

    // Post-import: ensure version records exist for imported entities.
    await this._reconcileImportedVersions(snapshot, actorId);

    await auditService.log({
      actorId,
      action: 'import_backup',
      entityType: 'system',
      entityId: 'backup',
      metadata: { storeCount: Object.keys(snapshot).length },
    });

    // Force logout after import — stale in-memory auth/crypto state must not survive
    // because the imported dataset may contain different users/permissions.
    await authService.logout();
  }

  /**
   * Validates schema version compatibility.
   * Throws if the backup schema version does not match the current DB version.
   *
   * @param {number} backupSchemaVersion
   */
  /**
   * Ensures imported versioned entities have at least one version record.
   * Creates a system-generated version for any entity missing version history.
   * Enforces single-active-version invariant.
   */
  async _reconcileImportedVersions(snapshot, actorId) {
    const mdRepo = new MasterDataRepository();
    const STORE_TO_ENTITY = {
      colors: 'color', sizes: 'size', seasons: 'season',
      brands: 'brand', suppliers: 'supplier', styles: 'style',
    };

    for (const [storeName, records] of Object.entries(snapshot)) {
      const entityType = STORE_TO_ENTITY[storeName];
      if (!entityType || !Array.isArray(records)) continue;

      for (const record of records) {
        if (!record.id) continue;
        const history = await mdRepo.findVersionHistory(record.id);
        if (history.length === 0) {
          // No version history — create a system-generated initial version.
          await mdRepo.create({
            id: generateId(),
            organizationId: record.organizationId ?? null,
            entityType,
            entityId: record.id,
            versionNumber: 1,
            payload: { name: record.name ?? record.sku ?? record.id, isActive: record.isActive ?? true },
            reasonNote: 'System import',
            isActive: true,
            systemGenerated: true,
            createdBy: actorId,
            createdAt: Date.now(),
          });
        } else {
          // Enforce single-active invariant — deactivate extras.
          const activeVersions = history.filter((v) => v.isActive);
          if (activeVersions.length > 1) {
            // Keep only the newest active, deactivate the rest.
            const sorted = activeVersions.sort((a, b) => b.versionNumber - a.versionNumber);
            for (let i = 1; i < sorted.length; i++) {
              await mdRepo.update(sorted[i].id, { ...sorted[i], isActive: false });
            }
          }
        }
      }
    }
  }

  validateSchemaVersion(backupSchemaVersion) {
    if (backupSchemaVersion !== DB_VERSION) {
      throw new Error(
        `Schema version mismatch: backup is v${backupSchemaVersion}, app expects v${DB_VERSION}. ` +
          'Migration is required before applying this backup.',
      );
    }
  }

  /**
   * Validates the structure of a snapshot before applying it.
   * - Every store in the snapshot must exist in the schema (and not be protected).
   * - Every record must be an object with an `id` field (the keyPath).
   * @param {Record<string, object[]>} snapshot
   */
  _validateSnapshotStructure(snapshot) {
    const validStoreNames = new Set(
      Object.keys(SCHEMA_STORES).filter((s) => !PROTECTED_STORES.has(s)),
    );

    // Per-store required fields beyond `id`.
    const REQUIRED_FIELDS = {
      users: ['username', 'role'],
      customers: ['organizationId', 'name'],
      orders: ['organizationId', 'customerId', 'status'],
      tickets: ['organizationId', 'storeId', 'subject', 'status'],
      templates: ['organizationId', 'name', 'body'],
      styles: ['organizationId', 'sku'],
      organizations: ['type', 'name'],
    };

    for (const [storeName, records] of Object.entries(snapshot)) {
      if (!validStoreNames.has(storeName)) {
        throw new Error(`Import validation failed: unknown or protected store '${storeName}'.`);
      }
      if (!Array.isArray(records)) {
        throw new Error(`Import validation failed: store '${storeName}' must contain an array of records.`);
      }
      const requiredFields = REQUIRED_FIELDS[storeName] ?? [];
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
          throw new Error(`Import validation failed: record ${i} in store '${storeName}' is not a valid object.`);
        }
        if (!rec.id) {
          throw new Error(`Import validation failed: record ${i} in store '${storeName}' is missing required 'id' field.`);
        }
        for (const field of requiredFields) {
          if (rec[field] === undefined || rec[field] === null) {
            throw new Error(`Import validation failed: record ${i} in store '${storeName}' is missing required field '${field}'.`);
          }
        }
      }
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  async _decryptAndValidate(parsed, backupPassphrase) {
    if (!parsed.saltHex || !parsed.iv || !parsed.ciphertext) {
      throw new Error('Invalid backup file format: missing required encryption fields (saltHex, iv, ciphertext).');
    }

    const key = await cryptoService.resolveBackupKey(backupPassphrase, parsed.saltHex);
    let json;
    try {
      json = await cryptoService.decryptBackup(parsed.ciphertext, parsed.iv, key);
    } catch {
      throw new Error('Failed to decrypt backup. Check that the passphrase is correct.');
    }

    let envelope;
    try {
      envelope = JSON.parse(json);
    } catch {
      throw new Error('Decrypted backup content is not valid JSON.');
    }

    if (!envelope.data || typeof envelope.schemaVersion !== 'number') {
      throw new Error('Invalid backup envelope: missing data or schemaVersion.');
    }

    this.validateSchemaVersion(envelope.schemaVersion);

    return { schemaVersion: envelope.schemaVersion, snapshot: envelope.data };
  }

  _requireRole(...allowedRoles) {
    const user = authService.getCurrentUser();
    if (!user) throw new Error('Authentication required.');
    authService.requireUnlocked();
    if (user.role === ROLES.ADMINISTRATOR) return user;
    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      throw new Error(`Permission denied. Required role(s): ${allowedRoles.join(', ')}`);
    }
    return user;
  }
}

export const importExportService = new ImportExportService();
