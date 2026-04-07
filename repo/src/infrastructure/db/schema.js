/**
 * IndexedDB schema definition for RetailOps Console.
 *
 * Each entry in SCHEMA_STORES describes one object store and its indexes.
 * The upgrade handler in db.js iterates this definition to build the schema.
 */

export const DB_NAME = 'retailops_console';
export const DB_VERSION = 1;

/**
 * @typedef {{ keyPath: string; autoIncrement?: boolean; indexes: Array<{ name: string; keyPath: string | string[]; unique?: boolean }> }} StoreDefinition
 */

/** @type {Record<string, StoreDefinition>} */
export const SCHEMA_STORES = {
  users: {
    keyPath: 'id',
    indexes: [
      { name: 'by_username', keyPath: 'username', unique: true },
      { name: 'by_org', keyPath: 'organizationNodeId' },
      { name: 'by_role', keyPath: 'role' },
    ],
  },

  sessions: {
    keyPath: 'id',
    indexes: [
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_expiresAt', keyPath: 'expiresAt' },
    ],
  },

  organizations: {
    keyPath: 'id',
    indexes: [
      { name: 'by_parentId', keyPath: 'parentId' },
      { name: 'by_organizationId', keyPath: 'organizationId' },
      { name: 'by_type', keyPath: 'type' },
    ],
  },

  masterDataVersions: {
    keyPath: 'id',
    indexes: [
      { name: 'by_entityType_orgId', keyPath: ['entityType', 'organizationId'] },
      { name: 'by_entityId', keyPath: 'entityId' },
      { name: 'by_isActive', keyPath: 'isActive' },
      { name: 'by_orgId', keyPath: 'organizationId' },
    ],
  },

  styles: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_sku', keyPath: 'sku', unique: false },
      { name: 'by_storeId', keyPath: 'storeId' },
      { name: 'by_isActive', keyPath: 'isActive' },
    ],
  },

  colors: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_isActive', keyPath: 'isActive' },
    ],
  },

  sizes: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_isActive', keyPath: 'isActive' },
    ],
  },

  seasons: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_isActive', keyPath: 'isActive' },
    ],
  },

  brands: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_isActive', keyPath: 'isActive' },
    ],
  },

  suppliers: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_isActive', keyPath: 'isActive' },
    ],
  },

  warehouses: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_storeId', keyPath: 'storeId' },
    ],
  },

  customers: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_membershipTier', keyPath: 'membershipTier' },
    ],
  },

  orders: {
    keyPath: 'id',
    indexes: [
      { name: 'by_customerId', keyPath: 'customerId' },
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_storeId', keyPath: 'storeId' },
      { name: 'by_status', keyPath: 'status' },
    ],
  },

  orderEvents: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orderId', keyPath: 'orderId' },
      { name: 'by_type', keyPath: 'type' },
    ],
  },

  tickets: {
    keyPath: 'id',
    indexes: [
      { name: 'by_customerId', keyPath: 'customerId' },
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_storeId', keyPath: 'storeId' },
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_assignedTo', keyPath: 'assignedTo' },
      { name: 'by_isOverdue', keyPath: 'isOverdue' },
    ],
  },

  ticketEvents: {
    keyPath: 'id',
    indexes: [
      { name: 'by_ticketId', keyPath: 'ticketId' },
      { name: 'by_type', keyPath: 'type' },
    ],
  },

  notificationChannels: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_isEnabled', keyPath: 'isEnabled' },
    ],
  },

  notificationSubscriptions: {
    keyPath: 'id',
    indexes: [
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_channelId', keyPath: 'channelId' },
      { name: 'by_eventType', keyPath: 'eventType' },
    ],
  },

  templates: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_isCompact', keyPath: 'isCompact' },
    ],
  },

  messageQueue: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_recipientUserId', keyPath: 'recipientUserId' },
      { name: 'by_nextRetryAt', keyPath: 'nextRetryAt' },
    ],
  },

  notifications: {
    keyPath: 'id',
    indexes: [
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_read', keyPath: 'read' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },

  importedTexts: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_sourceType', keyPath: 'sourceType' },
      { name: 'by_sourceId', keyPath: 'sourceId' },
      { name: 'by_updatedAt', keyPath: 'updatedAt' },
    ],
  },

  validationProfiles: {
    keyPath: 'id',
    indexes: [
      { name: 'by_modelVersion', keyPath: 'modelVersion' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },

  nlpRuns: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_runType', keyPath: 'runType' },
      { name: 'by_modelVersion', keyPath: 'modelVersion' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },

  riskRules: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_targetEntityType', keyPath: 'targetEntityType' },
      { name: 'by_isActive', keyPath: 'isActive' },
    ],
  },

  riskCases: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_assignedReviewerId', keyPath: 'assignedReviewerId' },
      { name: 'by_sourceType', keyPath: 'sourceType' },
    ],
  },

  bidEvents: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_userId', keyPath: 'userId' },
      { name: 'by_itemId', keyPath: 'itemId' },
      { name: 'by_deviceFingerprint', keyPath: 'deviceFingerprint' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },

  linkedAccounts: {
    keyPath: 'id',
    indexes: [
      { name: 'by_orgId', keyPath: 'organizationId' },
      { name: 'by_primaryUserId', keyPath: 'primaryUserId' },
      { name: 'by_linkedUserId', keyPath: 'linkedUserId' },
    ],
  },

  auditLogs: {
    keyPath: 'id',
    indexes: [
      { name: 'by_actorId', keyPath: 'actorId' },
      { name: 'by_entityType', keyPath: 'entityType' },
      { name: 'by_entityId', keyPath: 'entityId' },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },

  appConfig: {
    keyPath: 'id',
    indexes: [{ name: 'by_orgId', keyPath: 'organizationId', unique: true }],
  },
};

/** Convenience array of all store names for iteration. */
export const ALL_STORE_NAMES = Object.keys(SCHEMA_STORES);

/**
 * Stores that must NOT be overwritten during a standard import restore.
 * These are protected system stores.
 */
export const PROTECTED_STORES = new Set(['sessions', 'auditLogs']);
