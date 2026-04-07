/**
 * MockBroadcastService — in-process pub/sub for unit tests.
 *
 * Delivers messages synchronously to all subscribers on the same channel
 * within the same process. Does NOT use the BroadcastChannel API.
 */

import { BroadcastService } from './BroadcastService.js';

export class MockBroadcastService extends BroadcastService {
  constructor() {
    super();
    /** @type {Map<string, Set<Function>>} */
    this._subscriptions = new Map();
  }

  publish(channelName, type, payload = null) {
    const handlers = this._subscriptions.get(channelName);
    if (!handlers) return;
    const message = { type, payload, timestamp: Date.now() };
    for (const handler of handlers) {
      handler(message);
    }
  }

  subscribe(channelName, handler) {
    if (!this._subscriptions.has(channelName)) {
      this._subscriptions.set(channelName, new Set());
    }
    this._subscriptions.get(channelName).add(handler);
    return () => this._subscriptions.get(channelName)?.delete(handler);
  }

  closeAll() {
    this._subscriptions.clear();
  }
}
