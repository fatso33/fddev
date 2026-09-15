/**
 * `SimBridge.sendEvent()` reports whether a write actually reached the socket
 * (Rotary rebuild, ticket 02 correction).
 *
 * This is the only layer that can answer for a dead PC Bridge. The server's own
 * SIM_EVENT_DISPATCH_FAILED broadcast covers a write that ARRIVED and was rejected —
 * it can say nothing about one sent into a closed socket, because there is no
 * connection left to carry the report back. Without this return value, core.rotary
 * had no signal at all for the case the live test actually hit (bridge killed
 * mid-turn), and the knob sat on a value the sim never took.
 *
 * Exercises the synced copy: shared/SimBridge.js's own imports are written for the
 * synced layout, so it only resolves from an app tree (CLAUDE.md, "Import paths under
 * shared/"); check-sync.mjs guarantees the two are byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { SimBridge } from '../js/core/SimBridge.js';

/** A SimBridge with just the socket state sendRaw() reads — the constructor would
 * otherwise start connecting to a PC that isn't there. */
function bridgeWithSocket(ws) {
  const bridge = Object.create(SimBridge.prototype);
  bridge.ws = ws;
  return bridge;
}

const OPEN = { readyState: 1, sent: [], send(payload) { this.sent.push(payload); } };

describe('SimBridge.sendEvent() result', () => {
  it('reports true and transmits when the socket is open', () => {
    const ws = { ...OPEN, sent: [] };
    expect(bridgeWithSocket(ws).sendEvent('apHdgSet', 180)).toBe(true);
    expect(JSON.parse(ws.sent[0])).toMatchObject({ type: 'event', event: 'apHdgSet', value: 180 });
  });

  it('reports false when PC Bridge is not connected at all', () => {
    expect(bridgeWithSocket(null).sendEvent('apHdgSet', 180)).toBe(false);
  });

  it('reports false when the socket exists but is closed/closing', () => {
    // 3 === CLOSED. This is the killed-mid-turn case: the object is still there, the
    // connection is not.
    expect(bridgeWithSocket({ readyState: 3, send() {} }).sendEvent('apHdgSet', 180)).toBe(false);
  });

  it('reports false for an event name that never passes sanitization', () => {
    const ws = { ...OPEN, sent: [] };
    expect(bridgeWithSocket(ws).sendEvent('', 180)).toBe(false);
    expect(ws.sent).toEqual([]);
  });
});
