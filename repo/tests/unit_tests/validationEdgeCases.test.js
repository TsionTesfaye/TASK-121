/**
 * Unit tests — validation edge cases and boundary conditions.
 *
 * Covers compact template post-substitution length, placeholder validation,
 * stored value, points, allergy field, rating, reason note, and image checks.
 */

import { describe, it, expect } from 'vitest';
import {
  validatePassword,
  validateReasonNote,
  validateAllergyField,
  validateStoredValue,
  validatePoints,
  validateRating,
  validateCompactNoticeLength,
  extractPlaceholders,
  validatePlaceholders,
  renderTemplate,
  isValidOutcomeCode,
  isValidMembershipTier,
  isValidRole,
  isValidTicketPriority,
} from '../../src/utils/validation.js';
import { VALIDATION } from '../../src/utils/constants.js';

// ── Password ──────────────────────────────────────────────────────────────────

describe('validatePassword', () => {
  it('accepts exactly 12 chars with digit and symbol', () => {
    expect(validatePassword('Secure12345!').valid).toBe(true);
  });

  it('rejects 11 chars', () => {
    const { valid, errors } = validatePassword('Short12345!');
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('12'))).toBe(true);
  });

  it('rejects no digit', () => {
    const { valid, errors } = validatePassword('NoDigitsHere!');
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('number'))).toBe(true);
  });

  it('rejects no symbol', () => {
    const { valid, errors } = validatePassword('NoSymbolHere12');
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('symbol'))).toBe(true);
  });

  it('rejects empty string', () => {
    expect(validatePassword('').valid).toBe(false);
  });

  it('accepts long password with all requirements', () => {
    expect(validatePassword('MyVeryLongPassw0rd!WithLotsOfChars').valid).toBe(true);
  });
});

// ── Reason note ───────────────────────────────────────────────────────────────

describe('validateReasonNote', () => {
  it('accepts exactly 10 non-whitespace chars', () => {
    expect(validateReasonNote('Valid note!').valid).toBe(true);
  });

  it('rejects fewer than 10 non-whitespace chars', () => {
    expect(validateReasonNote('short').valid).toBe(false);
  });

  it('rejects whitespace-only strings', () => {
    expect(validateReasonNote('          ').valid).toBe(false);
  });

  it('accepts note with whitespace that has ≥10 non-whitespace', () => {
    expect(validateReasonNote('This is a valid reason note.').valid).toBe(true);
  });
});

// ── Allergy field ─────────────────────────────────────────────────────────────

describe('validateAllergyField', () => {
  it('accepts empty string', () => {
    expect(validateAllergyField('').valid).toBe(true);
  });

  it('accepts up to 500 chars', () => {
    const text = 'a'.repeat(500);
    expect(validateAllergyField(text).valid).toBe(true);
  });

  it('rejects 501 chars', () => {
    const text = 'a'.repeat(501);
    expect(validateAllergyField(text).valid).toBe(false);
  });
});

// ── Stored value ──────────────────────────────────────────────────────────────

describe('validateStoredValue', () => {
  it('accepts 0', () => {
    expect(validateStoredValue(0).valid).toBe(true);
  });

  it('accepts positive with 2 decimal places', () => {
    expect(validateStoredValue(99.99).valid).toBe(true);
  });

  it('rejects negative', () => {
    expect(validateStoredValue(-0.01).valid).toBe(false);
  });

  it('rejects more than 2 decimal places', () => {
    expect(validateStoredValue(10.001).valid).toBe(false);
  });

  it('accepts whole numbers', () => {
    expect(validateStoredValue(100).valid).toBe(true);
  });
});

// ── Points ────────────────────────────────────────────────────────────────────

describe('validatePoints', () => {
  it('accepts 0', () => {
    expect(validatePoints(0).valid).toBe(true);
  });

  it('accepts positive integer', () => {
    expect(validatePoints(1000).valid).toBe(true);
  });

  it('rejects negative', () => {
    expect(validatePoints(-1).valid).toBe(false);
  });

  it('rejects float', () => {
    expect(validatePoints(10.5).valid).toBe(false);
  });
});

// ── Rating ────────────────────────────────────────────────────────────────────

describe('validateRating', () => {
  it('accepts 1', () => { expect(validateRating(1).valid).toBe(true); });
  it('accepts 5', () => { expect(validateRating(5).valid).toBe(true); });
  it('accepts 3', () => { expect(validateRating(3).valid).toBe(true); });
  it('rejects 0', () => { expect(validateRating(0).valid).toBe(false); });
  it('rejects 6', () => { expect(validateRating(6).valid).toBe(false); });
  it('rejects float', () => { expect(validateRating(3.5).valid).toBe(false); });
});

// ── Compact notice length ─────────────────────────────────────────────────────

describe('validateCompactNoticeLength', () => {
  it('accepts exactly 160 chars', () => {
    expect(validateCompactNoticeLength('a'.repeat(160)).valid).toBe(true);
  });

  it('rejects 161 chars', () => {
    const result = validateCompactNoticeLength('a'.repeat(161));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('160');
  });

  it('accepts empty string', () => {
    expect(validateCompactNoticeLength('').valid).toBe(true);
  });
});

// ── Placeholder extraction & validation ───────────────────────────────────────

describe('extractPlaceholders', () => {
  it('extracts single placeholder', () => {
    const phs = extractPlaceholders('Hello {name}!');
    expect(phs).toContain('name');
  });

  it('extracts multiple placeholders', () => {
    const phs = extractPlaceholders('{greeting} {name}, your order {orderId} is ready.');
    expect(phs).toContain('greeting');
    expect(phs).toContain('name');
    expect(phs).toContain('orderId');
  });

  it('returns empty array for no placeholders', () => {
    expect(extractPlaceholders('No placeholders here.')).toEqual([]);
  });

  it('deduplicates repeated placeholders', () => {
    const phs = extractPlaceholders('{name} and {name}');
    expect(phs.filter((p) => p === 'name').length).toBe(1);
  });
});

describe('validatePlaceholders', () => {
  it('passes when all placeholders have values', () => {
    const result = validatePlaceholders(['name', 'orderId'], { name: 'Alice', orderId: '123' });
    expect(result.valid).toBe(true);
  });

  it('fails when a placeholder is missing', () => {
    const result = validatePlaceholders(['name', 'orderId'], { name: 'Alice' });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('orderId');
  });

  it('passes when vars include extra keys', () => {
    const result = validatePlaceholders(['name'], { name: 'Alice', extra: 'ignored' });
    expect(result.valid).toBe(true);
  });
});

describe('renderTemplate', () => {
  it('replaces all placeholders', () => {
    const result = renderTemplate('Hello {name}, order {id} is ready.', { name: 'Alice', id: '999' });
    expect(result).toBe('Hello Alice, order 999 is ready.');
  });

  it('throws when placeholder is missing from vars', () => {
    expect(() => renderTemplate('{name} {missing}', { name: 'Alice' }))
      .toThrow();
  });
});

// ── Critical edge case: compact template exceeds 160 after substitution ───────

describe('Compact template post-substitution length check', () => {
  it('a short template can exceed 160 chars after substitution with long values', () => {
    const template = 'Hi {name}!';
    const rendered = renderTemplate(template, { name: 'A'.repeat(200) });
    // The rendered result is longer than 160 chars
    expect(rendered.length).toBeGreaterThan(160);
    // validateCompactNoticeLength must catch this
    const check = validateCompactNoticeLength(rendered);
    expect(check.valid).toBe(false);
  });
});

// ── Enum validators ───────────────────────────────────────────────────────────

describe('isValidOutcomeCode', () => {
  it('accepts valid codes', () => {
    expect(isValidOutcomeCode('no_issue')).toBe(true);
    expect(isValidOutcomeCode('false_positive')).toBe(true);
    expect(isValidOutcomeCode('warning_issued')).toBe(true);
  });

  it('rejects unknown codes', () => {
    expect(isValidOutcomeCode('unknown_code')).toBe(false);
    expect(isValidOutcomeCode('')).toBe(false);
  });
});

describe('isValidMembershipTier', () => {
  it('accepts valid tiers', () => {
    expect(isValidMembershipTier('Bronze')).toBe(true);
    expect(isValidMembershipTier('Silver')).toBe(true);
    expect(isValidMembershipTier('Gold')).toBe(true);
  });

  it('rejects unknown tiers', () => {
    expect(isValidMembershipTier('Platinum')).toBe(false);
    expect(isValidMembershipTier('bronze')).toBe(false); // case-sensitive
  });
});

describe('isValidTicketPriority', () => {
  it('accepts low, medium, high', () => {
    expect(isValidTicketPriority('low')).toBe(true);
    expect(isValidTicketPriority('medium')).toBe(true);
    expect(isValidTicketPriority('high')).toBe(true);
  });

  it('rejects unknown priorities', () => {
    expect(isValidTicketPriority('critical')).toBe(false);
    expect(isValidTicketPriority('')).toBe(false);
  });
});
