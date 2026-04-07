/**
 * BrowserBroadcastService — BroadcastChannel-based implementation.
 *
 * Used in the production browser environment.
 * Each channel name maps to one BroadcastChannel instance (cached).
 */

import { BroadcastService } from './BroadcastService.js';

export class BrowserBroadcastService extends BroadcastService {
  constructor() {
    super();
    /** @type {Map<string, BroadcastChannel>} */
    this._channels = new Map();
  }

  /** @private */
  _getChannel(name) {
    if (!this._channels.has(name)) {
      this._channels.set(name, new BroadcastChannel(name));
    }
    return this._channels.get(name);
  }

  publish(channelName, type, payload = null) {
    this._getChannel(channelName).postMessage({ type, payload, timestamp: Date.now() });
  }

  subscribe(channelName, handler) {
    const channel = this._getChannel(channelName);
    const wrapper = (event) => handler(event.data);
    channel.addEventListener('message', wrapper);
    return () => channel.removeEventListener('message', wrapper);
  }

  closeAll() {
    for (const [, channel] of this._channels) {
      channel.close();
    }
    this._channels.clear();
  }
}
