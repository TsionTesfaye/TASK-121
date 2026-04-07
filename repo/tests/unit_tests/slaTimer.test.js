/**
 * Unit tests — SLA timer countdown behavior.
 *
 * Covers:
 *   - formatSLA returns hours and minutes for future deadline
 *   - formatSLA returns 'OVERDUE' when deadline has passed
 *   - SLA countdown decreases as time progresses
 *   - SLA transitions from OK → WARNING → OVERDUE at correct thresholds
 *   - Default SLA is 48 hours
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { VALIDATION } from '../../src/utils/constants.js';

// Replicate the SLA formatting logic from TicketsPage.svelte
// so we can test the time-progression behavior in isolation.
function formatSLA(slaDueAt, now) {
  if (!slaDueAt) return '—';
  const remaining = slaDueAt - now;
  if (remaining <= 0) return 'OVERDUE';
  const hours = Math.floor(remaining / 3_600_000);
  const mins  = Math.floor((remaining % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

function slaClass(slaDueAt, isOverdue, now) {
  if (!slaDueAt) return '';
  const remaining = slaDueAt - now;
  if (isOverdue || remaining <= 0) return 'sla--overdue';
  if (remaining < 4 * 3_600_000) return 'sla--warning';
  return 'sla--ok';
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SLA timer — formatSLA', () => {
  it('returns hours and minutes for a future deadline', () => {
    const now = Date.now();
    const slaDueAt = now + 10 * 3_600_000 + 30 * 60_000; // 10h 30m from now
    expect(formatSLA(slaDueAt, now)).toBe('10h 30m');
  });

  it('returns OVERDUE when deadline has passed', () => {
    const now = Date.now();
    const slaDueAt = now - 5000; // 5 seconds ago
    expect(formatSLA(slaDueAt, now)).toBe('OVERDUE');
  });

  it('returns — when slaDueAt is null', () => {
    expect(formatSLA(null, Date.now())).toBe('—');
  });

  it('default SLA is 48 hours', () => {
    expect(VALIDATION.DEFAULT_TICKET_SLA_HOURS).toBe(48);
    const now = Date.now();
    const slaDueAt = now + VALIDATION.DEFAULT_TICKET_SLA_HOURS * 3_600_000;
    expect(formatSLA(slaDueAt, now)).toBe('48h 0m');
  });
});

describe('SLA timer — countdown decreases with time', () => {
  it('countdown shrinks as simulated time progresses', () => {
    vi.useFakeTimers();
    const baseNow = Date.now();
    const slaDueAt = baseNow + 48 * 3_600_000; // 48h out

    // T+0: full 48h remaining
    expect(formatSLA(slaDueAt, baseNow)).toBe('48h 0m');

    // T+1h: 47h remaining
    vi.advanceTimersByTime(3_600_000);
    const now1 = Date.now();
    expect(formatSLA(slaDueAt, now1)).toBe('47h 0m');

    // T+24h: 24h remaining
    vi.advanceTimersByTime(23 * 3_600_000);
    const now2 = Date.now();
    expect(formatSLA(slaDueAt, now2)).toBe('24h 0m');

    // T+47h: 1h remaining
    vi.advanceTimersByTime(23 * 3_600_000);
    const now3 = Date.now();
    expect(formatSLA(slaDueAt, now3)).toBe('1h 0m');

    // T+48h + 1s: OVERDUE
    vi.advanceTimersByTime(3_600_000 + 1000);
    const now4 = Date.now();
    expect(formatSLA(slaDueAt, now4)).toBe('OVERDUE');
  });

  it('countdown granularity includes minutes', () => {
    vi.useFakeTimers();
    const baseNow = Date.now();
    const slaDueAt = baseNow + 2 * 3_600_000 + 45 * 60_000; // 2h 45m

    expect(formatSLA(slaDueAt, baseNow)).toBe('2h 45m');

    vi.advanceTimersByTime(30 * 60_000); // advance 30 min
    expect(formatSLA(slaDueAt, Date.now())).toBe('2h 15m');

    vi.advanceTimersByTime(2 * 3_600_000); // advance 2h more → 15m left
    expect(formatSLA(slaDueAt, Date.now())).toBe('0h 15m');
  });
});

describe('SLA timer — slaClass thresholds', () => {
  it('returns sla--ok when > 4 hours remain', () => {
    const now = Date.now();
    const slaDueAt = now + 5 * 3_600_000;
    expect(slaClass(slaDueAt, false, now)).toBe('sla--ok');
  });

  it('returns sla--warning when < 4 hours remain', () => {
    const now = Date.now();
    const slaDueAt = now + 3 * 3_600_000;
    expect(slaClass(slaDueAt, false, now)).toBe('sla--warning');
  });

  it('returns sla--overdue when deadline has passed', () => {
    const now = Date.now();
    const slaDueAt = now - 1000;
    expect(slaClass(slaDueAt, false, now)).toBe('sla--overdue');
  });

  it('returns sla--overdue when isOverdue flag is set', () => {
    const now = Date.now();
    const slaDueAt = now + 10 * 3_600_000; // still future
    expect(slaClass(slaDueAt, true, now)).toBe('sla--overdue');
  });

  it('transitions ok → warning → overdue as time advances', () => {
    vi.useFakeTimers();
    const baseNow = Date.now();
    const slaDueAt = baseNow + 6 * 3_600_000; // 6h out

    // T+0: OK (6h remain)
    expect(slaClass(slaDueAt, false, baseNow)).toBe('sla--ok');

    // T+3h: WARNING (3h remain < 4h threshold)
    vi.advanceTimersByTime(3 * 3_600_000);
    expect(slaClass(slaDueAt, false, Date.now())).toBe('sla--warning');

    // T+6h+1s: OVERDUE
    vi.advanceTimersByTime(3 * 3_600_000 + 1000);
    expect(slaClass(slaDueAt, false, Date.now())).toBe('sla--overdue');
  });
});
