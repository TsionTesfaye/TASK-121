/**
 * BroadcastChannel facade for cross-tab coordination.
 *
 * All code that needs to publish or subscribe uses the functions exported here.
 * The underlying BroadcastService implementation is swappable:
 *   - In the browser:  BrowserBroadcastService (default, lazy-initialized)
 *   - In tests:        MockBroadcastService (injected via setBroadcastService)
 *
 * Channels:
 *   - 'retailops:state'  — general state changes (lock, logout, version publish)
 *   - 'retailops:queue'  — queue leader election and heartbeat
 */

import { BrowserBroadcastService } from './BrowserBroadcastService.js';

export const CHANNEL_NAMES = /** @type {const} */ ({
  STATE: 'retailops:state',
  QUEUE: 'retailops:queue',
});

export const EVENT_TYPES = /** @type {const} */ ({
  // Auth / session
  SESSION_LOCKED: 'session_locked',
  SESSION_UNLOCKED: 'session_unlocked',
  SESSION_LOGGED_OUT: 'session_logged_out',

  // Master data
  VERSION_PUBLISHED: 'version_published',

  // Queue leadership
  QUEUE_LEADER_CLAIM: 'queue_leader_claim',
  QUEUE_LEADER_HEARTBEAT: 'queue_leader_heartbeat',
  QUEUE_LEADER_RELEASE: 'queue_leader_release',

  // Risk / notifications
  RISK_CASE_UPDATED: 'risk_case_updated',
  NOTIFICATION_SENT: 'notification_sent',
});

/** @type {import('./BroadcastService.js').BroadcastService | null} */
let _service = null;

/**
 * Returns the active BroadcastService, lazily creating a BrowserBroadcastService
 * if none has been set.
 *
 * @returns {import('./BroadcastService.js').BroadcastService}
 */
export function getBroadcastService() {
  if (!_service) {
    _service = new BrowserBroadcastService();
  }
  return _service;
}

/**
 * Replaces the active BroadcastService.
 * Closes the previous service's channels before switching.
 * Call this in test setup to inject a MockBroadcastService.
 *
 * @param {import('./BroadcastService.js').BroadcastService} service
 */
export function setBroadcastService(service) {
  if (_service) _service.closeAll();
  _service = service;
}

/**
 * Posts a typed message on the given channel.
 *
 * @param {string} channelName  One of CHANNEL_NAMES
 * @param {string} type         One of EVENT_TYPES
 * @param {unknown} [payload]
 */
export function broadcast(channelName, type, payload = null) {
  getBroadcastService().publish(channelName, type, payload);
}

/**
 * Registers a message listener on a channel.
 * Returns a cleanup function that removes the listener.
 *
 * @param {string} channelName
 * @param {(event: { type: string; payload: unknown; timestamp: number }) => void} handler
 * @returns {() => void}
 */
export function subscribe(channelName, handler) {
  return getBroadcastService().subscribe(channelName, handler);
}

/**
 * Closes all open channels / subscriptions.
 * Call on logout or test teardown.
 */
export function closeAll() {
  getBroadcastService().closeAll();
}
