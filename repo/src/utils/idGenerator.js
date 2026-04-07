/**
 * Generates a cryptographically random UUID v4.
 * Uses globalThis.crypto.randomUUID() which is available in
 * both browser environments and Node 18+.
 *
 * @returns {string} UUID v4 string
 */
export function generateId() {
  return globalThis.crypto.randomUUID();
}

/**
 * Generates a sortable prefixed ID: `{prefix}_{timestamp}_{random6}`.
 * Useful for human-readable IDs in audit logs and queue items.
 *
 * @param {string} prefix
 * @returns {string}
 */
export function generatePrefixedId(prefix) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

/**
 * Generates a numeric idempotency key string for notification deduplication.
 * Combines a stable source key with the current timestamp bucket (minute).
 *
 * @param {string} sourceKey  e.g. `ticket_${ticketId}_overdue`
 * @returns {string}
 */
export function generateIdempotencyKey(sourceKey) {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  return `${sourceKey}__${minuteBucket}`;
}
