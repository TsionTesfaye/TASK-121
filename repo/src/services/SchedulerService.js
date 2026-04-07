/**
 * SchedulerService — generic periodic task runner with multi-tab leader election.
 *
 * Usage:
 *   schedulerService.registerTask('queue_check', () => notificationService.processDueItems(), 30_000);
 *   schedulerService.registerTask('overdue_check', () => ticketService.evaluateOverdue(), 5 * 60_000);
 *   await schedulerService.start();
 *
 * Only one tab runs the tasks at a time.
 * Leader election uses BroadcastChannel heartbeats + a timestamp in LocalStorage.
 * If the leader tab goes silent, another tab takes over after LEADER_TTL_MS.
 */

import { schedule, cancel, cancelAll } from '../infrastructure/scheduler/timerManager.js';
import {
  broadcast,
  subscribe,
  CHANNEL_NAMES,
  EVENT_TYPES,
} from '../infrastructure/broadcast/broadcastManager.js';

const LEADER_KEY = 'retailops:queue_leader';
const LEADER_TTL_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

export class SchedulerService {
  constructor() {
    /** @type {Map<string, { fn: () => Promise<void>; intervalMs: number }>} */
    this._tasks = new Map();
    this._isLeader = false;
    this._tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this._unsubscribe = null;
  }

  /**
   * Registers a named recurring task.
   * Must be called before start().
   *
   * @param {string} name          Unique task identifier.
   * @param {() => Promise<void>} fn  Async task function.
   * @param {number} intervalMs    How often to run the task (milliseconds).
   */
  registerTask(name, fn, intervalMs) {
    this._tasks.set(name, { fn, intervalMs });
  }

  /**
   * Starts the scheduler.
   * Runs all registered tasks immediately (missed-work reconciliation),
   * then participates in leader election to own the recurring intervals.
   */
  async start() {
    await this._reconcileMissedWork();
    this._listenForLeaderEvents();
    this._attemptLeaderClaim();
  }

  /**
   * Stops all scheduled timers and releases leadership.
   */
  stop() {
    cancelAll();
    // Unsubscribe before broadcasting so we don't re-trigger _attemptLeaderClaim
    // on our own QUEUE_LEADER_RELEASE message.
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._isLeader) {
      localStorage.removeItem(LEADER_KEY);
      broadcast(CHANNEL_NAMES.QUEUE, EVENT_TYPES.QUEUE_LEADER_RELEASE, { tabId: this._tabId });
      this._isLeader = false;
    }
  }

  // ── Leader election ───────────────────────────────────────────────────────────

  _attemptLeaderClaim() {
    const existing = this._readLeaderState();
    const now = Date.now();

    if (!existing || now - existing.timestamp > LEADER_TTL_MS) {
      this._becomeLeader();
    } else {
      schedule('scheduler:standby_check', () => this._attemptLeaderClaim(), LEADER_TTL_MS + 1000);
    }
  }

  _becomeLeader() {
    this._isLeader = true;
    this._writeLeaderState();
    broadcast(CHANNEL_NAMES.QUEUE, EVENT_TYPES.QUEUE_LEADER_CLAIM, { tabId: this._tabId });

    schedule('scheduler:heartbeat', () => this._heartbeat(), HEARTBEAT_INTERVAL_MS);

    for (const [name, { fn, intervalMs }] of this._tasks) {
      this._scheduleTask(name, fn, intervalMs);
    }
  }

  _heartbeat() {
    if (!this._isLeader) return;
    this._writeLeaderState();
    broadcast(CHANNEL_NAMES.QUEUE, EVENT_TYPES.QUEUE_LEADER_HEARTBEAT, { tabId: this._tabId });
    schedule('scheduler:heartbeat', () => this._heartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  _listenForLeaderEvents() {
    this._unsubscribe = subscribe(CHANNEL_NAMES.QUEUE, (event) => {
      if (event.type === EVENT_TYPES.QUEUE_LEADER_CLAIM && event.payload?.tabId !== this._tabId) {
        // Another tab won the election; yield.
        this._isLeader = false;
        cancel('scheduler:heartbeat');
        for (const name of this._tasks.keys()) {
          cancel(`scheduler:task:${name}`);
        }
      }
      if (event.type === EVENT_TYPES.QUEUE_LEADER_RELEASE && event.payload?.tabId !== this._tabId) {
        // Another leader stepped down; try to claim.
        this._attemptLeaderClaim();
      }
    });
  }

  _readLeaderState() {
    try {
      const raw = localStorage.getItem(LEADER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  _writeLeaderState() {
    try {
      localStorage.setItem(LEADER_KEY, JSON.stringify({ tabId: this._tabId, timestamp: Date.now() }));
    } catch {
      // LocalStorage write failure is non-fatal.
    }
  }

  // ── Task execution ────────────────────────────────────────────────────────────

  /**
   * Schedules a single task interval tick.
   * The callback reschedules itself so the interval continues.
   *
   * @private
   */
  _scheduleTask(name, fn, intervalMs) {
    schedule(`scheduler:task:${name}`, async () => {
      if (!this._isLeader) return;
      try {
        await fn();
      } catch (err) {
        console.error(`[SchedulerService] Task "${name}" error:`, err.message);
      }
      this._scheduleTask(name, fn, intervalMs);
    }, intervalMs);
  }

  /**
   * Runs all registered tasks immediately on startup to catch up on work
   * that may have been missed while the app was closed.
   *
   * @private
   */
  async _reconcileMissedWork() {
    for (const [name, { fn }] of this._tasks) {
      try {
        await fn();
      } catch (err) {
        console.error(`[SchedulerService] Startup reconciliation for "${name}" error:`, err.message);
      }
    }
  }
}

export const schedulerService = new SchedulerService();
