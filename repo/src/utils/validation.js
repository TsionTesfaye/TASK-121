import {
  VALIDATION,
  ALLOWED_IMAGE_MIME,
  PNG_MAGIC,
  JPEG_MAGIC,
  OUTCOME_CODES,
  MEMBERSHIP_TIERS,
  TICKET_PRIORITIES,
  ROLES,
} from './constants.js';

// ── Password ──────────────────────────────────────────────────────────────────

/**
 * Validates a plaintext password against business rules.
 * Rules: min 12 chars, at least one digit, at least one symbol.
 *
 * @param {string} password
 * @returns {{ valid: boolean; errors: string[] }}
 */
export function validatePassword(password) {
  const errors = [];
  if (typeof password !== 'string' || password.length < VALIDATION.PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters.`);
  }
  if (!/\d/.test(password)) errors.push('Password must contain at least one number.');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Password must contain at least one symbol.');
  return { valid: errors.length === 0, errors };
}

// ── Reason note ───────────────────────────────────────────────────────────────

/**
 * Validates a master-data change reason note.
 * Must be at least 10 non-whitespace-only characters.
 *
 * @param {string} note
 * @returns {{ valid: boolean; error: string | null }}
 */
export function validateReasonNote(note) {
  if (typeof note !== 'string') return { valid: false, error: 'Reason note must be a string.' };
  const trimmed = note.trim();
  if (trimmed.length < VALIDATION.REASON_NOTE_MIN_LENGTH) {
    return {
      valid: false,
      error: `Reason note must be at least ${VALIDATION.REASON_NOTE_MIN_LENGTH} non-whitespace characters.`,
    };
  }
  return { valid: true, error: null };
}

// ── Allergy / restriction fields ──────────────────────────────────────────────

/**
 * Validates the plaintext value of an allergy or material restriction field.
 * Must be validated BEFORE encryption.
 *
 * @param {string} value
 * @returns {{ valid: boolean; error: string | null }}
 */
export function validateAllergyField(value) {
  if (typeof value !== 'string') return { valid: false, error: 'Must be a string.' };
  if (value.length > VALIDATION.ALLERGY_MAX_CHARS) {
    return {
      valid: false,
      error: `Field must not exceed ${VALIDATION.ALLERGY_MAX_CHARS} characters.`,
    };
  }
  return { valid: true, error: null };
}

// ── Stored value ──────────────────────────────────────────────────────────────

/**
 * Validates a stored value in USD to 2 decimal places.
 * Rejects negative values.
 *
 * @param {number} value
 * @returns {{ valid: boolean; error: string | null }}
 */
export function validateStoredValue(value) {
  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
    return { valid: false, error: 'Stored value must be a finite number.' };
  }
  if (value < 0) return { valid: false, error: 'Stored value cannot be negative.' };
  const rounded = Math.round(value * 100) / 100;
  if (rounded !== value) {
    return { valid: false, error: 'Stored value must have at most 2 decimal places.' };
  }
  return { valid: true, error: null };
}

// ── Points ────────────────────────────────────────────────────────────────────

/**
 * @param {number} points
 * @returns {{ valid: boolean; error: string | null }}
 */
export function validatePoints(points) {
  if (!Number.isInteger(points) || points < 0) {
    return { valid: false, error: 'Points must be a non-negative integer.' };
  }
  return { valid: true, error: null };
}

// ── Rating ────────────────────────────────────────────────────────────────────

/**
 * @param {number} rating
 * @returns {{ valid: boolean; error: string | null }}
 */
export function validateRating(rating) {
  if (!Number.isInteger(rating) || rating < VALIDATION.RATING_MIN || rating > VALIDATION.RATING_MAX) {
    return {
      valid: false,
      error: `Rating must be an integer between ${VALIDATION.RATING_MIN} and ${VALIDATION.RATING_MAX}.`,
    };
  }
  return { valid: true, error: null };
}

// ── Compact notice ────────────────────────────────────────────────────────────

/**
 * Validates the rendered (post-substitution) body of a compact notice.
 *
 * @param {string} renderedBody
 * @returns {{ valid: boolean; error: string | null }}
 */
export function validateCompactNoticeLength(renderedBody) {
  if (typeof renderedBody !== 'string') return { valid: false, error: 'Body must be a string.' };
  if (renderedBody.length > VALIDATION.COMPACT_NOTICE_MAX_CHARS) {
    return {
      valid: false,
      error: `Compact notice must not exceed ${VALIDATION.COMPACT_NOTICE_MAX_CHARS} characters after substitution (got ${renderedBody.length}).`,
    };
  }
  return { valid: true, error: null };
}

// ── Template placeholders ─────────────────────────────────────────────────────

const PLACEHOLDER_REGEX = /\{(\w+)\}/g;

/**
 * Extracts all placeholder names from a template body.
 *
 * @param {string} body
 * @returns {string[]}
 */
export function extractPlaceholders(body) {
  return [...new Set([...body.matchAll(PLACEHOLDER_REGEX)].map((m) => m[1]))];
}

/**
 * Validates that all declared placeholders have values in the substitution map.
 *
 * @param {string[]} placeholders  - placeholder names declared on the template
 * @param {Record<string, string>} vars - substitution values
 * @returns {{ valid: boolean; missing: string[] }}
 */
export function validatePlaceholders(placeholders, vars) {
  const missing = placeholders.filter((p) => !(p in vars) || vars[p] == null);
  return { valid: missing.length === 0, missing };
}

/**
 * Performs variable substitution on a template body.
 * Throws if any placeholder remains unresolved.
 *
 * @param {string} body
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function renderTemplate(body, vars) {
  return body.replace(PLACEHOLDER_REGEX, (_match, key) => {
    if (!(key in vars)) throw new Error(`Unresolved placeholder: {${key}}`);
    return String(vars[key]);
  });
}

// ── Image file ────────────────────────────────────────────────────────────────

/**
 * Validates an image file by MIME type, magic bytes, and size.
 *
 * @param {{ name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }} file
 * @returns {Promise<{ valid: boolean; error: string | null }>}
 */
export async function validateImageFile(file) {
  if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
    return { valid: false, error: 'Only PNG and JPEG images are allowed.' };
  }
  if (file.size > VALIDATION.MAX_IMAGE_BYTES) {
    return { valid: false, error: 'Image must not exceed 5 MB.' };
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer.slice(0, 4));

  const isPng = PNG_MAGIC.every((b, i) => bytes[i] === b);
  const isJpeg = JPEG_MAGIC.every((b, i) => bytes[i] === b);

  if (!isPng && !isJpeg) {
    return { valid: false, error: 'File signature does not match PNG or JPEG.' };
  }
  return { valid: true, error: null };
}

// ── Outcome codes ─────────────────────────────────────────────────────────────

const VALID_OUTCOME_CODES = new Set(Object.values(OUTCOME_CODES));

/**
 * @param {string} code
 * @returns {boolean}
 */
export function isValidOutcomeCode(code) {
  return VALID_OUTCOME_CODES.has(code);
}

// ── Membership tier ───────────────────────────────────────────────────────────

const VALID_TIERS = new Set(Object.values(MEMBERSHIP_TIERS));

/**
 * @param {string} tier
 * @returns {boolean}
 */
export function isValidMembershipTier(tier) {
  return VALID_TIERS.has(tier);
}

// ── Role ──────────────────────────────────────────────────────────────────────

const VALID_ROLES = new Set(Object.values(ROLES));

/**
 * @param {string} role
 * @returns {boolean}
 */
export function isValidRole(role) {
  return VALID_ROLES.has(role);
}

// ── Ticket priority ───────────────────────────────────────────────────────────

const VALID_PRIORITIES = new Set(Object.values(TICKET_PRIORITIES));

/**
 * @param {string} priority
 * @returns {boolean}
 */
export function isValidTicketPriority(priority) {
  return VALID_PRIORITIES.has(priority);
}
