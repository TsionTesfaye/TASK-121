/**
 * Timer manager for the Scheduler service.
 *
 * Provides a thin wrapper around setTimeout / clearTimeout so that:
 *   1. All active timers can be cleared at once (e.g. on tab close or test teardown).
 *   2. Individual timers can be cancelled by their handle.
 *   3. The module is independently unit-testable with fake timers.
 */

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const _timers = new Map();

/**
 * Schedules a callback to fire after `delayMs` milliseconds.
 * If a timer with the same `key` already exists it is replaced.
 *
 * @param {string} key       Unique identifier for this timer.
 * @param {() => void} fn    Callback to invoke.
 * @param {number} delayMs   Delay in milliseconds.
 */
export function schedule(key, fn, delayMs) {
  if (_timers.has(key)) {
    clearTimeout(_timers.get(key));
  }
  const handle = setTimeout(() => {
    _timers.delete(key);
    fn();
  }, delayMs);
  _timers.set(key, handle);
}

/**
 * Cancels a scheduled timer by key.
 * Safe to call even if the timer does not exist.
 *
 * @param {string} key
 */
export function cancel(key) {
  if (_timers.has(key)) {
    clearTimeout(_timers.get(key));
    _timers.delete(key);
  }
}

/**
 * Cancels all active timers.
 * Use on teardown (logout, tab close, test cleanup).
 */
export function cancelAll() {
  for (const [, handle] of _timers) {
    clearTimeout(handle);
  }
  _timers.clear();
}

/**
 * Returns the number of currently active timers.
 * Useful in tests.
 * @returns {number}
 */
export function activeCount() {
  return _timers.size;
}
