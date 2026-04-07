/**
 * Unit tests — BroadcastService abstraction and MockBroadcastService.
 *
 * These tests verify the publish/subscribe contract through the broadcastManager
 * facade using MockBroadcastService as the active backend.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';
import {
  setBroadcastService,
  getBroadcastService,
  broadcast,
  subscribe,
  closeAll,
  CHANNEL_NAMES,
  EVENT_TYPES,
} from '../../src/infrastructure/broadcast/broadcastManager.js';

beforeEach(() => {
  setBroadcastService(new MockBroadcastService());
});

afterEach(() => {
  closeAll();
});

// ── setBroadcastService / getBroadcastService ─────────────────────────────────

describe('getBroadcastService', () => {
  it('returns the service set by setBroadcastService', () => {
    const svc = new MockBroadcastService();
    setBroadcastService(svc);
    expect(getBroadcastService()).toBe(svc);
  });
});

// ── publish / subscribe ───────────────────────────────────────────────────────

describe('broadcast / subscribe', () => {
  it('delivers a published message to a subscriber on the same channel', () => {
    const received = [];
    subscribe(CHANNEL_NAMES.STATE, (msg) => received.push(msg));

    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_LOCKED, { userId: 'u1' });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(EVENT_TYPES.SESSION_LOCKED);
    expect(received[0].payload).toEqual({ userId: 'u1' });
    expect(typeof received[0].timestamp).toBe('number');
  });

  it('does not deliver to subscribers on a different channel', () => {
    const received = [];
    subscribe(CHANNEL_NAMES.QUEUE, (msg) => received.push(msg));

    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_LOCKED);

    expect(received).toHaveLength(0);
  });

  it('delivers to multiple subscribers on the same channel', () => {
    const r1 = [];
    const r2 = [];
    subscribe(CHANNEL_NAMES.STATE, (msg) => r1.push(msg));
    subscribe(CHANNEL_NAMES.STATE, (msg) => r2.push(msg));

    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.VERSION_PUBLISHED, { version: 3 });

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r1[0].payload).toEqual({ version: 3 });
  });

  it('delivers multiple broadcasts in order', () => {
    const types = [];
    subscribe(CHANNEL_NAMES.STATE, (msg) => types.push(msg.type));

    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_LOCKED);
    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_UNLOCKED);
    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_LOGGED_OUT);

    expect(types).toEqual([
      EVENT_TYPES.SESSION_LOCKED,
      EVENT_TYPES.SESSION_UNLOCKED,
      EVENT_TYPES.SESSION_LOGGED_OUT,
    ]);
  });
});

// ── Cleanup function ──────────────────────────────────────────────────────────

describe('unsubscribe (cleanup function)', () => {
  it('stops delivery after the cleanup function is called', () => {
    const received = [];
    const unsubscribe = subscribe(CHANNEL_NAMES.STATE, (msg) => received.push(msg));

    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_LOCKED);
    unsubscribe();
    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_UNLOCKED);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(EVENT_TYPES.SESSION_LOCKED);
  });

  it('does not affect other subscribers when one unsubscribes', () => {
    const r1 = [];
    const r2 = [];
    const unsub1 = subscribe(CHANNEL_NAMES.STATE, (msg) => r1.push(msg));
    subscribe(CHANNEL_NAMES.STATE, (msg) => r2.push(msg));

    unsub1();
    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_LOCKED);

    expect(r1).toHaveLength(0);
    expect(r2).toHaveLength(1);
  });
});

// ── closeAll ──────────────────────────────────────────────────────────────────

describe('closeAll', () => {
  it('silences all subsequent broadcasts after closeAll', () => {
    const received = [];
    subscribe(CHANNEL_NAMES.STATE, (msg) => received.push(msg));

    closeAll();
    broadcast(CHANNEL_NAMES.STATE, EVENT_TYPES.SESSION_LOCKED);

    expect(received).toHaveLength(0);
  });
});
