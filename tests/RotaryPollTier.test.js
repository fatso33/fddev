/**
 * Host-side half of the Rotary's poll-tier wiring (Rotary rebuild, ticket 02).
 *
 * The Component asks its host two things — "what is my binding's ACTUAL poll period?"
 * and "boost me to the fast tier while I'm engaged" — and this is where those are
 * answered. Both are pure bookkeeping over EventBus, so they're testable without a
 * DOM, a bridge or a sim.
 *
 * The third test here is a deliberate executable record of ticket 02's "verify and
 * record" item: the reference-counted subscription can UPGRADE a SimVar's tier, but
 * there is no downgrade path anywhere in the stack. See its own comment.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../js/core/EventBus.js';
import { CompositeWidget } from '../js/widgets/CompositeWidget.js';

/** Records every call PC Bridge would have received. */
function makeBridge() {
  const calls = [];
  return {
    calls,
    subscribeSimVar: (simVar, unit, deadband, hz, group) => calls.push({ kind: 'subscribe', simVar, hz, group }),
    unregisterSimVar: (simVar) => calls.push({ kind: 'unregister', simVar }),
    registerDynamicEvent: () => {},
    subscribeArrayData: () => {}
  };
}

describe('EventBus poll-tier ref-counting (what a Rotary\'s fast-tier request rides on)', () => {
  let bus;
  let bridge;

  beforeEach(() => {
    bus = new EventBus();
    bridge = makeBridge();
    bus.setBridgeClient(bridge);
  });

  it('subscribes the first listener at its declared rate', () => {
    bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 1);
    expect(bridge.calls).toEqual([{ kind: 'subscribe', simVar: 'apHdgBugValue', hz: 1, group: undefined }]);
  });

  it('promotes the var when a later subscriber asks for a faster rate (the Rotary grabbing the knob)', () => {
    bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 1);
    bridge.calls.length = 0;

    bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 30);

    expect(bridge.calls).toEqual([{ kind: 'subscribe', simVar: 'apHdgBugValue', hz: 30, group: undefined }]);
  });

  it('does NOT drop back to the normal tier when the fast-tier subscriber releases (recorded finding, ticket 02)', () => {
    const baseCb = () => {};
    bus.subscribeSimVar('apHdgBugValue', 'Number', baseCb, 0, 1);
    const releaseFast = bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 30);
    bridge.calls.length = 0;

    releaseFast();

    // Nothing is sent to PC Bridge on release: EventBus only re-notifies on a
    // PROMOTION, and `entry.pollFrequencyHz` is a running max that is never
    // recomputed downward. PC Bridge could not act on it anyway — server.js's
    // subscribeDynamicSimVar() documents that a SimConnect data definition cannot
    // drop a field once added, so there is no demotion at that end either.
    // Accepted per the ticket: the cost is bandwidth for the session, not correctness.
    expect(bridge.calls).toEqual([]);
    // The base subscription survives, still at the fast rate.
    const manifest = bus.getActiveSchemaManifest();
    expect(manifest.simVars).toEqual([
      expect.objectContaining({ simVar: 'apHdgBugValue', pollFrequencyHz: 30 })
    ]);
  });

  it('keeps the base subscription alive when the fast-tier one is released', () => {
    const seen = [];
    bus.subscribeSimVar('apHdgBugValue', 'Number', (v) => seen.push(v), 0, 1);
    const releaseFast = bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 30);
    releaseFast();

    bus.simVarSubscriptions.get('apHdgBugValue').listeners.forEach((meta, cb) => cb(42));
    expect(seen).toEqual([42]);
  });
});

describe('CompositeWidget poll-period / fast-tier host methods', () => {
  const ROTARY = {
    id: 'rot',
    type: 'core.rotary',
    binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet', pollFrequencyHz: 1, deadband: 2 }
  };

  const makeWidget = (comp = ROTARY) => {
    const bus = new EventBus();
    const bridge = makeBridge();
    bus.setBridgeClient(bridge);
    const widget = new CompositeWidget(
      { id: 'w1', type: 'test.widget', config: { definition: { id: 'test.widget', components: [comp] } } },
      bus
    );
    return { widget, bus, bridge };
  };

  it('reports the binding\'s declared poll rate as a period in milliseconds', () => {
    const { widget } = makeWidget();
    expect(widget.getPollPeriodMs(ROTARY)).toBe(1000);

    const fast = { ...ROTARY, binding: { ...ROTARY.binding, pollFrequencyHz: 4 } };
    const { widget: w2 } = makeWidget(fast);
    expect(w2.getPollPeriodMs(fast)).toBe(250);
  });

  it('reports the FAST period while a fast-poll request is held, and the declared one again after release', () => {
    const { widget } = makeWidget();
    const release = widget.requestFastPoll(ROTARY);
    const boosted = widget.getPollPeriodMs(ROTARY);
    expect(boosted).toBeLessThan(1000);

    release();
    expect(widget.getPollPeriodMs(ROTARY)).toBe(1000);
  });

  it('requesting the fast tier subscribes the same SimVar again at a fast rate, promoting it with PC Bridge', () => {
    const { widget, bridge } = makeWidget();
    widget.registerDynamicBindings();
    bridge.calls.length = 0;

    widget.requestFastPoll(ROTARY);

    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0].simVar).toBe('apHdgBugValue');
    // Above PC Bridge's FAST_TIER_THRESHOLD_HZ (2), which is what selects the fast tier.
    expect(bridge.calls[0].hz).toBeGreaterThan(2);
  });

  it('releasing the fast tier leaves the component\'s ordinary subscription intact', () => {
    const { widget, bus } = makeWidget();
    widget.registerDynamicBindings();
    const before = bus.simVarSubscriptions.get('apHdgBugValue').refCount;

    const release = widget.requestFastPoll(ROTARY);
    expect(bus.simVarSubscriptions.get('apHdgBugValue').refCount).toBe(before + 1);
    release();
    expect(bus.simVarSubscriptions.get('apHdgBugValue').refCount).toBe(before);
    // Releasing twice must not double-decrement someone else's subscription.
    release();
    expect(bus.simVarSubscriptions.get('apHdgBugValue').refCount).toBe(before);
  });

  it('is a no-op for a component with nothing readable to boost', () => {
    const writeOnly = { id: 'rot', type: 'core.rotary', binding: { writeEvent: 'apHdgSet' } };
    const { widget, bridge } = makeWidget(writeOnly);
    expect(widget.requestFastPoll(writeOnly)).toBeNull();
    expect(bridge.calls).toEqual([]);
  });
});
