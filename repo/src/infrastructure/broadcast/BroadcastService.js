/**
 * BroadcastService — abstract base for cross-tab pub/sub.
 *
 * Implementations:
 *   - BrowserBroadcastService  : uses the native BroadcastChannel API
 *   - MockBroadcastService     : in-process delivery for unit tests
 */

export class BroadcastService {
  /**
   * Publishes a typed message on a named channel.
   *
   * @param {string} channelName
   * @param {string} type
   * @param {unknown} [payload]
   */
  // eslint-disable-next-line no-unused-vars
  publish(channelName, type, payload = null) {
    throw new Error('BroadcastService.publish() is not implemented');
  }

  /**
   * Subscribes to messages on a named channel.
   * Returns a cleanup function that removes the handler.
   *
   * @param {string} channelName
   * @param {(message: { type: string; payload: unknown; timestamp: number }) => void} handler
   * @returns {() => void}
   */
  // eslint-disable-next-line no-unused-vars
  subscribe(channelName, handler) {
    throw new Error('BroadcastService.subscribe() is not implemented');
  }

  /**
   * Closes all open channels and removes all listeners.
   */
  closeAll() {
    throw new Error('BroadcastService.closeAll() is not implemented');
  }
}
