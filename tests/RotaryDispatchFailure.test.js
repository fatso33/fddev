// @vitest-environment jsdom
/**
 * A Rotary whose write never reached the sim must revert to last-known telemetry
 * (Rotary rebuild, ticket 01's signed-off criterion: "A dispatch failure reverts the
 * value to telemetry rather than leaving a value that was never applied").
 *
 * Ticket 02 shipped only HALF of that. `dispatchSimEvent()` answered synchronously and
 * reported failure for exactly one thing — an event NAME rejected by SecurityValidator,
 * a purely local check. Every real-world failure was invisible to it:
 *
 *   1. PC Bridge down / socket closed. The live test (bridge killed mid-turn) left the
 *      knob parked on a value the sim never took, indefinitely.
 *   2. Sent, then refused server-side (unmapped Deck Event, SimConnect error). PC
 *      Bridge does broadcast SIM_EVENT_DISPATCH_FAILED for this, but nothing routed it
 *      past a toast in app.js.
 *
 * Both now feed the same deferred-failure path in the Component, which is what these
 * tests exercise — through the REAL EventBus, the REAL CompositeWidget host, the real
 * engine and real pointer events. Only the WebSocket transport is faked, because that
 * is precisely where a dispatch failure originates, so faking it is how a failure gets
 * simulated at all.
 *
 * Case 1's failure is raised MID-TURN, which is the subtle half: the engine only
 * honours `dispatchFailed` while a Reconciliation window is open, so a failure during
 * an 'engaged' gesture has to be held until release rather than dropped on the floor.
 *
 * This lives here rather than in shared/ (where the canonical Component is) only
 * because BaseComponent.js's imports are written for the SYNCED layout — see CLAUDE.md,
 * "Import paths under shared/" — so a BaseComponent-derived component is loadable from
 * an app tree and not from shared/. check-sync.mjs guarantees the copy under test is
 * byte-identical to the canonical file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../js/core/EventBus.js';
import { CompositeWidget } from '../js/widgets/CompositeWidget.js';
import { RotaryComponent } from '../js/widgets/components/RotaryComponent.js';

const WRITE_EVENT = 'apHdgSet';
const TELEMETRY_VALUE = 100;
const RADIUS = 100;

/** getBoundingClientRect() is all-zeros in jsdom, so client coords ARE the offsets
 * from the knob's centre — which is all the gesture wiring passes to the engine. */
function pointAt(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: RADIUS * Math.cos(rad), y: RADIUS * Math.sin(rad) };
}

function pointerEvent(type, { x, y }) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  // jsdom has no PointerEvent; the listeners only ever read pointerId off it.
  Object.defineProperty(e, 'pointerId', { value: 1 });
  return e;
}

const COMP_DEF = {
  id: 'r1',
  type: 'core.rotary',
  binding: { readSimVar: 'apHdgBugValue', writeEvent: WRITE_EVENT },
  props: { min: 0, max: 360, degreesPerUnit: 1 }
};

/** Stands in for the WebSocket to PC Bridge. `connected: false` is a killed bridge. */
function makeBridge() {
  return {
    connected: true,
    sent: [],
    sendEvent(event, value) {
      if (!this.connected) return false;
      this.sent.push({ event, value });
      return true;
    },
    subscribeSimVar() {},
    unregisterSimVar() {},
    registerDynamicEvent() {},
    subscribeArrayData() {}
  };
}

/** grab -> turn `degrees` -> release, as real pointer events on the Face. */
function turn(comp, degrees) {
  comp.faceNode.dispatchEvent(pointerEvent('pointerdown', pointAt(0)));
  comp.faceNode.dispatchEvent(pointerEvent('pointermove', pointAt(degrees)));
  comp.faceNode.dispatchEvent(pointerEvent('pointerup', pointAt(degrees)));
}

describe('core.rotary reverts to telemetry when a write never reached the sim', () => {
  let bus;
  let bridge;
  let widget;
  let comp;

  beforeEach(() => {
    bus = new EventBus();
    bridge = makeBridge();
    bus.setBridgeClient(bridge);
    widget = new CompositeWidget(
      { id: 'w1', type: 'test.widget', config: { definition: { id: 'test.widget', components: [COMP_DEF] } } },
      bus
    );
    comp = new RotaryComponent(COMP_DEF, widget);
    document.body.appendChild(comp.render());
    // Last-known telemetry: the value a failed write must fall back to.
    comp.update(TELEMETRY_VALUE, {});
  });

  afterEach(() => {
    comp.destroy();
    document.body.innerHTML = '';
  });

  it('holds the turned value when the write actually goes out (control — the revert must not be unconditional)', () => {
    turn(comp, 30);
    expect(comp.currentValue).toBeCloseTo(TELEMETRY_VALUE + 30, 0);
    expect(bridge.sent.length).toBeGreaterThan(0);
  });

  it('reverts to last-known telemetry when PC Bridge is down mid-turn', () => {
    bridge.connected = false;
    turn(comp, 30);
    // Not 130: that value was never applied, so the knob must not sit parked on it.
    expect(comp.currentValue).toBe(TELEMETRY_VALUE);
    expect(bridge.sent).toEqual([]);
  });

  it('reverts on a failure PC Bridge reports after the write was sent (server-side rejection)', () => {
    turn(comp, 30);
    expect(comp.currentValue).toBeCloseTo(TELEMETRY_VALUE + 30, 0);

    // Exactly what SimBridge republishes on receiving the PC's broadcast.
    bus.publish('SIM_EVENT_DISPATCH_FAILED', { type: 'SIM_EVENT_DISPATCH_FAILED', event: WRITE_EVENT, reason: 'no mapping' });

    expect(comp.currentValue).toBe(TELEMETRY_VALUE);
  });

  it('holds a failure reported WHILE the knob is still being turned and applies it on release', () => {
    // The engine only honours `dispatchFailed` once a Reconciliation window is open,
    // so a failure arriving mid-gesture is dropped unless the Component defers it.
    comp.faceNode.dispatchEvent(pointerEvent('pointerdown', pointAt(0)));
    comp.faceNode.dispatchEvent(pointerEvent('pointermove', pointAt(30)));

    bus.publish('SIM_EVENT_DISPATCH_FAILED', { event: WRITE_EVENT, reason: 'no mapping' });
    // Still engaged: the finger owns the knob, nothing may move under it yet.
    expect(comp.currentValue).toBeCloseTo(TELEMETRY_VALUE + 30, 0);

    comp.faceNode.dispatchEvent(pointerEvent('pointerup', pointAt(30)));
    expect(comp.currentValue).toBe(TELEMETRY_VALUE);
  });

  // Both of the following are regressions introduced by the first fix pass and caught
  // on re-review. They share a root cause: failure was treated as a property of the
  // GESTURE ("did anything go wrong while turning?") rather than of a specific write.
  it('does NOT revert when an early write in the turn failed but a later one succeeded', () => {
    comp.faceNode.dispatchEvent(pointerEvent('pointerdown', pointAt(0)));

    bridge.connected = false;
    comp.faceNode.dispatchEvent(pointerEvent('pointermove', pointAt(15)));

    // Bridge comes back mid-turn; this write genuinely reaches the sim, and it is the
    // one the released value corresponds to.
    bridge.connected = true;
    comp.faceNode.dispatchEvent(pointerEvent('pointermove', pointAt(30)));
    comp.faceNode.dispatchEvent(pointerEvent('pointerup', pointAt(30)));

    expect(comp.currentValue).toBeCloseTo(TELEMETRY_VALUE + 30, 0);
    expect(bridge.sent.at(-1).value).toBeCloseTo(TELEMETRY_VALUE + 30, 0);
  });

  it('retries a value whose previous write failed, instead of answering from the dedup cache', () => {
    // Fail a write to a specific value, so the repeat-skip cache holds it as failed.
    bridge.connected = false;
    turn(comp, 30);
    expect(comp.currentValue).toBe(TELEMETRY_VALUE);

    // Bridge recovers and the user turns back to that SAME value. It must actually be
    // re-dispatched: answering "failed" from the cache left the knob unable to reach
    // that one value at all until some other value had been dispatched first.
    bridge.connected = true;
    turn(comp, 30);

    expect(bridge.sent.map((s) => Math.round(s.value))).toContain(TELEMETRY_VALUE + 30);
    expect(comp.currentValue).toBeCloseTo(TELEMETRY_VALUE + 30, 0);
  });

  it('still skips a repeat write of a value that already went out successfully', () => {
    // The dedup the cache exists for: turnEnd re-committing the last turn frame's
    // value must not double-dispatch it.
    turn(comp, 30);
    const sentForFinalValue = bridge.sent.filter((s) => Math.round(s.value) === TELEMETRY_VALUE + 30);
    expect(sentForFinalValue.length).toBe(1);
  });

  it('ignores a reported failure for a different component\'s write event', () => {
    turn(comp, 30);
    bus.publish('SIM_EVENT_DISPATCH_FAILED', { event: 'apAltSet', reason: 'no mapping' });
    expect(comp.currentValue).toBeCloseTo(TELEMETRY_VALUE + 30, 0);
  });

  it('follows telemetry again after reverting, rather than staying stuck', () => {
    bridge.connected = false;
    turn(comp, 30);
    comp.update(215, {});
    expect(comp.currentValue).toBe(215);
  });

  it('does not revert on a failure that arrives while the knob is idle', () => {
    bus.publish('SIM_EVENT_DISPATCH_FAILED', { event: WRITE_EVENT, reason: 'no mapping' });
    expect(comp.currentValue).toBe(TELEMETRY_VALUE);
    // And that stale failure must not fire on the NEXT release instead.
    turn(comp, 30);
    expect(comp.currentValue).toBeCloseTo(TELEMETRY_VALUE + 30, 0);
  });

  it('drops its SIM_EVENT_DISPATCH_FAILED subscription on destroy', () => {
    expect(comp.releaseDispatchFailureWatch).toBeTypeOf('function');
    comp.destroy();
    expect(comp.releaseDispatchFailureWatch).toBeNull();
    // Nothing left listening, so a later failure can't reach a torn-down knob.
    expect(bus.topics.get('SIM_EVENT_DISPATCH_FAILED')).toBeUndefined();
  });
});
