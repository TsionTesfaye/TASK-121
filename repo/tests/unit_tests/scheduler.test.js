/**
 * Unit tests — SchedulerService.
 *
 * Tests cover:
 *   - registerTask stores a task
 *   - start() triggers leader election and reconciliation
 *   - registered tasks execute at their interval
 *   - stop() cancels all timers and releases leadership
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchedulerService } from '../../src/services/SchedulerService.js';
import { setBroadcastService, closeAll } from '../../src/infrastructure/broadcast/broadcastManager.js';
import { MockBroadcastService } from '../../src/infrastructure/broadcast/MockBroadcastService.js';

let scheduler;

beforeEach(() => {
  vi.useFakeTimers();
  // Clear any stale leader state from previous tests.
  localStorage.clear();
  setBroadcastService(new MockBroadcastService());
  scheduler = new SchedulerService();
});

afterEach(() => {
  scheduler.stop();
  closeAll();
  vi.useRealTimers();
});

// ── registerTask ──────────────────────────────────────────────────────────────

describe('registerTask', () => {
  it('stores the task by name', () => {
    const fn = vi.fn();
    scheduler.registerTask('my_task', fn, 5_000);
    expect(scheduler._tasks.has('my_task')).toBe(true);
  });

  it('stores intervalMs alongside the task function', () => {
    const fn = vi.fn();
    scheduler.registerTask('timed_task', fn, 10_000);
    expect(scheduler._tasks.get('timed_task').intervalMs).toBe(10_000);
  });

  it('overwrites a previously registered task with the same name', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    scheduler.registerTask('same_name', fn1, 1_000);
    scheduler.registerTask('same_name', fn2, 2_000);
    expect(scheduler._tasks.get('same_name').fn).toBe(fn2);
  });
});

// ── start() — leader election ─────────────────────────────────────────────────

describe('start — leader election', () => {
  it('claims leadership when no other leader exists', async () => {
    await scheduler.start();
    expect(scheduler._isLeader).toBe(true);
  });

  it('writes leader state to localStorage', async () => {
    await scheduler.start();
    const raw = localStorage.getItem('retailops:queue_leader');
    expect(raw).not.toBeNull();
    const state = JSON.parse(raw);
    expect(state.tabId).toBe(scheduler._tabId);
  });
});

// ── start() — reconciliation ──────────────────────────────────────────────────

describe('start — missed-work reconciliation', () => {
  it('calls each registered task once immediately on start', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    scheduler.registerTask('reconcile_task', fn, 60_000);

    await scheduler.start();

    expect(fn).toHaveBeenCalledOnce();
  });

  it('calls all registered tasks on reconciliation', async () => {
    const fn1 = vi.fn().mockResolvedValue(undefined);
    const fn2 = vi.fn().mockResolvedValue(undefined);
    scheduler.registerTask('task_a', fn1, 30_000);
    scheduler.registerTask('task_b', fn2, 60_000);

    await scheduler.start();

    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });
});

// ── Interval execution ────────────────────────────────────────────────────────

describe('interval execution', () => {
  it('executes a task again after its interval elapses', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    scheduler.registerTask('interval_task', fn, 1_000);

    await scheduler.start();
    expect(fn).toHaveBeenCalledTimes(1); // reconciliation call

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('continues executing on each interval tick', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    scheduler.registerTask('repeat_task', fn, 1_000);

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    // 1 (reconciliation) + 3 (intervals) = 4
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

// ── stop() ────────────────────────────────────────────────────────────────────

describe('stop', () => {
  it('sets _isLeader to false', async () => {
    await scheduler.start();
    expect(scheduler._isLeader).toBe(true);
    scheduler.stop();
    expect(scheduler._isLeader).toBe(false);
  });

  it('prevents further task execution after stop', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    scheduler.registerTask('stoppable_task', fn, 1_000);

    await scheduler.start();
    scheduler.stop();
    fn.mockClear();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('removes leader state from localStorage', async () => {
    await scheduler.start();
    expect(localStorage.getItem('retailops:queue_leader')).not.toBeNull();

    scheduler.stop();
    expect(localStorage.getItem('retailops:queue_leader')).toBeNull();
  });
});
