/**
 * Global test setup for RetailOps Console
 *
 * Configures:
 *   - Web Crypto      : explicitly binds globalThis.crypto from node:crypto for Node 18
 *   - fake-indexeddb  : shims globalThis.indexedDB for Node 18
 *   - BroadcastChannel: jsdom shim (retained for modules that construct BroadcastChannel
 *                       directly; production code uses BroadcastService abstractions)
 */

// ── Web Crypto — explicit binding ─────────────────────────────────────────────
// Node 18 ships globalThis.crypto natively, but some jsdom configurations may
// shadow it. Explicitly assign webcrypto from node:crypto to guarantee it is
// always the real SubtleCrypto implementation.
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  // @ts-ignore — TypeScript does not accept webcrypto as Crypto directly
  globalThis.crypto = webcrypto;
}

// ── IndexedDB shim ────────────────────────────────────────────────────────────
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';

// ── BroadcastChannel shim ─────────────────────────────────────────────────────
// jsdom does not implement BroadcastChannel. This in-process mock is kept so
// that BrowserBroadcastService can be instantiated without throwing; tests that
// care about messaging should inject MockBroadcastService via setBroadcastService.
if (typeof globalThis.BroadcastChannel === 'undefined') {
  const registry = new Map(); // name → Set<instance>

  class BroadcastChannelMock {
    constructor(name) {
      this.name = name;
      this._closed = false;
      this._handlers = [];

      if (!registry.has(name)) registry.set(name, new Set());
      registry.get(name).add(this);
    }

    postMessage(data) {
      if (this._closed) return;
      const peers = registry.get(this.name) ?? new Set();
      for (const peer of peers) {
        if (peer !== this && !peer._closed) {
          const evt = { data, type: 'message' };
          peer._handlers.forEach((fn) => fn(evt));
          if (typeof peer.onmessage === 'function') peer.onmessage(evt);
        }
      }
    }

    addEventListener(_type, fn) {
      this._handlers.push(fn);
    }

    removeEventListener(_type, fn) {
      this._handlers = this._handlers.filter((h) => h !== fn);
    }

    close() {
      this._closed = true;
      registry.get(this.name)?.delete(this);
    }
  }

  globalThis.BroadcastChannel = BroadcastChannelMock;
}

// ── Blob polyfills for jsdom ──────────────────────────────────────────────────
// jsdom's Blob/File implementation omits .text() and .arrayBuffer().
// Polyfill both via FileReader, which jsdom does implement.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result));
      reader.addEventListener('error', reject);
      reader.readAsText(this);
    });
  };
}
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result));
      reader.addEventListener('error', reject);
      reader.readAsArrayBuffer(this);
    });
  };
}

// ── Final assertion ───────────────────────────────────────────────────────────
if (!globalThis.crypto?.subtle) {
  throw new Error(
    'globalThis.crypto.subtle is not available. ' +
      'Ensure you are running Node 18+ or have a Web Crypto polyfill installed.',
  );
}
