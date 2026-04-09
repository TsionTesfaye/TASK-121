/**
 * Log sanitization — verifies that runtime logging in App.svelte and db.js
 * never dumps raw objects (Error, Event, etc.) to the console.
 *
 * Strategy: read the source files and assert that every console.error /
 * console.warn call uses only string messages or whitelisted primitive
 * field access (e.g. err?.message), never a bare variable reference.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Returns all console.error / console.warn / console.log call expressions
 * from the given source text.  Matches single-line calls only (sufficient
 * for the patterns used in this codebase).
 */
function extractConsoleCalls(source) {
  const pattern = /console\.(error|warn|log)\(([^)]+)\)/g;
  const matches = [];
  let m;
  while ((m = pattern.exec(source)) !== null) {
    matches.push({ method: m[1], args: m[2], full: m[0] });
  }
  return matches;
}

/**
 * Returns true when an argument token looks like a raw object reference
 * (a bare identifier with no property access, no string literal, no
 * template literal, and no primitive method call).
 *
 * Allowed patterns:
 *   - string literals ('...', "...", `...`)
 *   - property access (err.message, err?.message, event?.target?.error?.message)
 *   - logical-or fallback (x || 'fallback')
 *
 * Disallowed:
 *   - bare identifier as the LAST argument: console.error('prefix', err)
 */
function hasRawObjectArg(argsString) {
  // Split on commas that are not inside quotes or parens
  const tokens = argsString.split(/,(?=(?:[^'"`]*['"`][^'"`]*['"`])*[^'"`]*$)/);
  for (const token of tokens) {
    const trimmed = token.trim();
    // Skip string literals
    if (/^['"`]/.test(trimmed)) continue;
    // Skip property access chains (err.message, err?.message, etc.)
    if (/[.?]/.test(trimmed)) continue;
    // A bare identifier (like `err`, `event`, `e`) with no property access
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
      return true;
    }
  }
  return false;
}

describe('Log sanitization — App.svelte', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../../src/App.svelte'),
    'utf-8',
  );

  it('contains no console calls that log raw objects', () => {
    const calls = extractConsoleCalls(source);
    const violations = calls.filter((c) => hasRawObjectArg(c.args));
    expect(violations, `Raw object logging found: ${violations.map((v) => v.full).join('; ')}`).toHaveLength(0);
  });
});

describe('Log sanitization — db.js', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../../src/infrastructure/db/db.js'),
    'utf-8',
  );

  it('contains no console calls that log raw objects', () => {
    const calls = extractConsoleCalls(source);
    const violations = calls.filter((c) => hasRawObjectArg(c.args));
    expect(violations, `Raw object logging found: ${violations.map((v) => v.full).join('; ')}`).toHaveLength(0);
  });
});

describe('hasRawObjectArg helper', () => {
  it('detects bare identifier: err', () => {
    expect(hasRawObjectArg("'[App] error:', err")).toBe(true);
  });

  it('accepts property access: err?.message', () => {
    expect(hasRawObjectArg("'[App] error:', err?.message || 'Unknown error'")).toBe(false);
  });

  it('accepts string-only args', () => {
    expect(hasRawObjectArg("'[DB] Upgrade blocked by another open tab.'")).toBe(false);
  });

  it('detects bare event', () => {
    expect(hasRawObjectArg("'[IndexedDB] Unhandled error:', event")).toBe(true);
  });

  it('accepts chained property access', () => {
    expect(hasRawObjectArg("'[IndexedDB] error:', event?.target?.error?.message || 'Unknown error'")).toBe(false);
  });
});
