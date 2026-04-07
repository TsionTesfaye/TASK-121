// ── Organization hierarchy ────────────────────────────────────────────────────
export const ORG_NODE_TYPES = /** @type {const} */ ({
  COMPANY: 'company',
  FACTORY: 'factory',
  STORE: 'store',
  WAREHOUSE: 'warehouse',
});

/** Valid parent → child type combinations. */
export const VALID_PARENT_CHILD = new Map([
  [ORG_NODE_TYPES.COMPANY, ORG_NODE_TYPES.FACTORY],
  [ORG_NODE_TYPES.FACTORY, ORG_NODE_TYPES.STORE],
  [ORG_NODE_TYPES.STORE, ORG_NODE_TYPES.WAREHOUSE],
]);

// ── Roles ─────────────────────────────────────────────────────────────────────
export const ROLES = /** @type {const} */ ({
  ADMINISTRATOR: 'administrator',
  STORE_MANAGER: 'store_manager',
  ANALYST: 'analyst',
  REVIEWER: 'reviewer',
  GUEST: 'guest',
});

// ── Master data entity types ──────────────────────────────────────────────────
export const MASTER_DATA_ENTITY_TYPES = /** @type {const} */ ({
  COLOR: 'color',
  SIZE: 'size',
  SEASON: 'season',
  BRAND: 'brand',
  SUPPLIER: 'supplier',
  STYLE: 'style',
});

// ── Membership tiers ──────────────────────────────────────────────────────────
export const MEMBERSHIP_TIERS = /** @type {const} */ ({
  BRONZE: 'Bronze',
  SILVER: 'Silver',
  GOLD: 'Gold',
});

// ── Order statuses ────────────────────────────────────────────────────────────
export const ORDER_STATUSES = /** @type {const} */ ({
  DRAFT: 'draft',
  PLACED: 'placed',
  IN_PROGRESS: 'in_progress',
  READY: 'ready',
  COMPLETED: 'completed',
  CANCELED: 'canceled',
});

/** Valid forward transitions for orders. */
export const ORDER_TRANSITIONS = new Map([
  [ORDER_STATUSES.DRAFT, [ORDER_STATUSES.PLACED, ORDER_STATUSES.CANCELED]],
  [ORDER_STATUSES.PLACED, [ORDER_STATUSES.IN_PROGRESS, ORDER_STATUSES.CANCELED]],
  [ORDER_STATUSES.IN_PROGRESS, [ORDER_STATUSES.READY, ORDER_STATUSES.CANCELED]],
  [ORDER_STATUSES.READY, [ORDER_STATUSES.COMPLETED, ORDER_STATUSES.CANCELED]],
  [ORDER_STATUSES.COMPLETED, []],
  [ORDER_STATUSES.CANCELED, []],
]);

// ── Ticket statuses ───────────────────────────────────────────────────────────
export const TICKET_STATUSES = /** @type {const} */ ({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
});

export const TICKET_PRIORITIES = /** @type {const} */ ({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});

export const TICKET_EVENT_TYPES = /** @type {const} */ ({
  CREATED: 'created',
  ASSIGNED: 'assigned',
  REPLIED: 'replied',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
  OVERDUE: 'overdue',
});

// ── Event dispatcher ──────────────────────────────────────────────────────────
export const EVENT_TYPES = /** @type {const} */ ({
  ORDER_STATUS_CHANGED: 'order_status',
  TICKET_ASSIGNED: 'ticket_assigned',
  TICKET_STATUS_CHANGED: 'ticket_status',
  RISK_CASE_FLAGGED: 'risk_case_flagged',
  MASTER_DATA_PUBLISHED: 'master_data_published',
  DEADLINE_APPROACHING: 'deadline_approaching',
  GRADING_COMPLETED: 'grading_completed',
  ANNOUNCEMENT: 'announcement',
});

// ── System template definitions ───────────────────────────────────────────────
// Every EVENT_TYPE maps to a system template name and default body.
// BootstrapService seeds one template per event type during first-run.
// EventDispatcherService resolves templateId from this map — no body-only bypass.
export const SYSTEM_TEMPLATES = /** @type {const} */ ({
  [EVENT_TYPES.ORDER_STATUS_CHANGED]: {
    name: '__system__order_status',
    body: '{title} — {body}',
  },
  [EVENT_TYPES.TICKET_ASSIGNED]: {
    name: '__system__ticket_assigned',
    body: '{title} — {body}',
  },
  [EVENT_TYPES.TICKET_STATUS_CHANGED]: {
    name: '__system__ticket_status',
    body: '{title} — {body}',
  },
  [EVENT_TYPES.RISK_CASE_FLAGGED]: {
    name: '__system__risk_case_flagged',
    body: '{title} — {body}',
  },
  [EVENT_TYPES.MASTER_DATA_PUBLISHED]: {
    name: '__system__master_data_published',
    body: '{title} — {body}',
  },
  [EVENT_TYPES.DEADLINE_APPROACHING]: {
    name: '__system__deadline_approaching',
    body: '{title} — {body}',
  },
  [EVENT_TYPES.GRADING_COMPLETED]: {
    name: '__system__grading_completed',
    body: '{title} — {body}',
  },
  [EVENT_TYPES.ANNOUNCEMENT]: {
    name: '__system__announcement',
    body: '{title} — {body}',
  },
});

// ── Message queue ─────────────────────────────────────────────────────────────
export const QUEUE_STATUSES = /** @type {const} */ ({
  DRAFT: 'Draft',
  QUEUED: 'Queued',
  SENT: 'Sent',
  FAILED: 'Failed',
});

/** Retry delay schedule in minutes. */
export const RETRY_SCHEDULE_MINUTES = [1, 5, 15];
export const MAX_RETRIES = 3;

// ── Risk cases ────────────────────────────────────────────────────────────────
export const RISK_CASE_STATUSES = /** @type {const} */ ({
  OPEN: 'open',
  IN_REVIEW: 'in_review',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
});

export const OUTCOME_CODES = /** @type {const} */ ({
  NO_ISSUE: 'no_issue',
  WARNING_ISSUED: 'warning_issued',
  CONTENT_REMOVED: 'content_removed',
  ACCOUNT_LINK_CONFIRMED: 'account_link_confirmed',
  SUSPICIOUS_ACTIVITY_CONFIRMED: 'suspicious_activity_confirmed',
  FALSE_POSITIVE: 'false_positive',
});

// ── Validation limits ─────────────────────────────────────────────────────────
export const VALIDATION = /** @type {const} */ ({
  PASSWORD_MIN_LENGTH: 12,
  REASON_NOTE_MIN_LENGTH: 10,
  ALLERGY_MAX_CHARS: 500,
  COMPACT_NOTICE_MAX_CHARS: 160,
  MAX_IMAGE_BYTES: 5 * 1024 * 1024, // 5 MB
  RATING_MIN: 1,
  RATING_MAX: 5,
  STORED_VALUE_DECIMALS: 2,
  GUEST_TRIAL_MINUTES: 30,
  AUTO_LOCK_MINUTES: 10,
  DEFAULT_TICKET_SLA_HOURS: 48,
});

// ── Crypto ────────────────────────────────────────────────────────────────────
// In test environments, reduce PBKDF2 iterations to avoid ~100s overhead from
// 300+ derivation calls across the suite. Production uses 310,000 iterations.
const _pbkdf2Iterations = (typeof process !== 'undefined' && process.env?.VITEST) ? 1_000 : 310_000;

export const CRYPTO = /** @type {const} */ ({
  PBKDF2_ITERATIONS: _pbkdf2Iterations,
  PBKDF2_HASH: 'SHA-256',
  AES_ALGORITHM: 'AES-GCM',
  AES_KEY_LENGTH: 256,
  IV_LENGTH_BYTES: 12, // 96-bit IV for AES-GCM
  SALT_LENGTH_BYTES: 32,
  ALGORITHM_VERSION: 'v1',
});

// ── NLP ───────────────────────────────────────────────────────────────────────
export const NLP = /** @type {const} */ ({
  F1_ALERT_THRESHOLD: 0.7,
  RUN_TYPES: {
    BATCH: 'batch',
    INCREMENTAL: 'incremental',
  },
});

// ── Allowed image MIME types ──────────────────────────────────────────────────
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg'];
export const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
export const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]);
