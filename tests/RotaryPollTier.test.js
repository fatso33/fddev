/**
 * Host-side half of the Rotary's poll-tier wiring (Rotary rebuild, ticket 02).
 *
 * The Component asks its host two things — "what is my binding's ACTUAL poll period?"
 * and "boost me to the fast tier while I'm engaged" — and this is where those are
 * answered. Both are pure bookkeeping over EventBus, so they're testable without a
 * DOM, a bridge or a sim.
 *
 * FDWS v1.30 ticket 01: the third test here used to be a deliberate executable
 * record of ticket 02's "verify and record" item ("no downgrade path anywhere in
 * the stack"). That's now closed — the tests below document the new contract
 * (downgrade IS supported, only once nothing still wants the fast tier) instead
 * of deleting the history of why it mattered.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../js/core/EventBus.js';
import { CompositeWidget } from '../js/widgets/CompositeWidget.js';

/** Records every call PC Bridge would have received. */
function makeBridge() {
  const calls = [];
  return {
    calls,
    subscribeSimVar: (simVar, unit, deadband, hz, group, allowDemote) => calls.push({ kind: 'subscribe', simVar, hz, group, allowDemote: !!allowDemote }),
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
    expect(bridge.calls).toEqual([{ kind: 'subscribe', simVar: 'apHdgBugValue', hz: 1, group: undefined, allowDemote: false }]);
  });

  it('promotes the var when a later subscriber asks for a faster rate (the Rotary grabbing the knob)', () => {
    bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 1);
    bridge.calls.length = 0;

    bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 30);

    expect(bridge.calls).toEqual([{ kind: 'subscribe', simVar: 'apHdgBugValue', hz: 30, group: undefined, allowDemote: false }]);
  });

  it('drops back to the normal tier when the fast-tier subscriber releases and nothing else needs it fast (FDWS v1.30 ticket 01)', () => {
    const baseCb = () => {};
    bus.subscribeSimVar('apHdgBugValue', 'Number', baseCb, 0, 1);
    const releaseFast = bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 30);
    bridge.calls.length = 0;

    releaseFast();

    // The bridge is told the recomputed rate, flagged as an authoritative
    // downgrade (allowDemote) rather than an ordinary subscribe-time ask.
    expect(bridge.calls).toEqual([
      { kind: 'subscribe', simVar: 'apHdgBugValue', hz: 1, group: undefined, allowDemote: true }
    ]);
    // The base subscription survives, now back at the normal rate.
    const manifest = bus.getActiveSchemaManifest();
    expect(manifest.simVars).toEqual([
      expect.objectContaining({ simVar: 'apHdgBugValue', pollFrequencyHz: 1 })
    ]);
  });

  it('stays fast when a fast-tier subscriber remains after another one releases', () => {
    const baseCb = () => {};
    bus.subscribeSimVar('apHdgBugValue', 'Number', baseCb, 0, 1);
    const releaseFastA = bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 30);
    const releaseFastB = bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 30);
    bridge.calls.length = 0;

    releaseFastA();

    // One fast-tier holder is still present, so nothing changes: no downgrade
    // notification, and the manifest still reports the fast rate.
    expect(bridge.calls).toEqual([]);
    const manifest = bus.getActiveSchemaManifest();
    expect(manifest.simVars).toEqual([
      expect.objectContaining({ simVar: 'apHdgBugValue', pollFrequencyHz: 30 })
    ]);

    releaseFastB();
    // The base (hz 1) listener is still around, so this is a genuine
    // downgrade — not a full unregister.
    expect(bridge.calls).toEqual([
      { kind: 'subscribe', simVar: 'apHdgBugValue', hz: 1, group: undefined, allowDemote: true }
    ]);
  });

  it('does not leak subscriptions or duplicate bookkeeping across repeated upgrade/downgrade cycles', () => {
    // Code review correction: the original version of this test had no base
    // (hz 1) subscriber, so every "cycle" was a full subscribe/unsubscribe —
    // its own assertion that no `allowDemote` calls ever happened proved
    // that, and meant it never actually exercised a promote-then-demote
    // cycle at all. A persistent base subscriber is what makes each cycle a
    // genuine one (the entry survives the fast listener's release).
    const baseCb = () => {};
    bus.subscribeSimVar('apHdgBugValue', 'Number', baseCb, 0, 1);
    bridge.calls.length = 0;

    for (let i = 0; i < 3; i++) {
      const releaseFast = bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 30);
      // Exactly one promote call, no duplicate/leaked listener bookkeeping.
      expect(bus.simVarSubscriptions.get('apHdgBugValue').listeners.size).toBe(2);
      expect(bridge.calls.at(-1)).toEqual(
        { kind: 'subscribe', simVar: 'apHdgBugValue', hz: 30, group: undefined, allowDemote: false }
      );

      releaseFast();
      // Base listener survives; exactly one demote call.
      expect(bus.simVarSubscriptions.get('apHdgBugValue').listeners.size).toBe(1);
      expect(bridge.calls.at(-1)).toEqual(
        { kind: 'subscribe', simVar: 'apHdgBugValue', hz: 1, group: undefined, allowDemote: true }
      );
    }

    // Exactly one promote + one demote per cycle -- three cycles, six calls,
    // nothing leaked or duplicated across repeats.
    expect(bridge.calls).toHaveLength(6);
    expect(bus.simVarSubscriptions.get('apHdgBugValue').refCount).toBe(1);
  });

  it('demotes on unmount when the LAST listener (with no base subscriber) was the fast one (code review finding 4)', () => {
    // No base subscriber here: this fast-tier listener is the var's only
    // one, so releasing it hits the refCount === 0 / full-unsubscribe
    // branch -- not the multi-listener recompute path the earlier tests
    // cover. unregisterSimVar() alone is a client-side-only no-op on PC
    // Bridge, so without an explicit demote here the var would stay pinned
    // fast for the rest of the session even though nothing is subscribed to
    // it at all any more.
    const releaseFast = bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 30);
    bridge.calls.length = 0;

    releaseFast();

    expect(bridge.calls).toEqual([
      { kind: 'subscribe', simVar: 'apHdgBugValue', hz: 1, group: undefined, allowDemote: true },
      { kind: 'unregister', simVar: 'apHdgBugValue' }
    ]);
    expect(bus.simVarSubscriptions.has('apHdgBugValue')).toBe(false);
  });

  it('leaves an existing normal-tier-only subscriber behaving exactly as before', () => {
    const release = bus.subscribeSimVar('apHdgBugValue', 'Number', () => {}, 0, 1);
    bridge.calls.length = 0;

    release();

    expect(bridge.calls).toEqual([{ kind: 'unregister', simVar: 'apHdgBugValue' }]);
    expect(bus.simVarSubscriptions.has('apHdgBugValue')).toBe(false);
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

  it('releasing the fast tier tells PC Bridge to demote the var, and a Rotary turned again re-promotes it (FDWS v1.30 ticket 01)', () => {
    const { widget, bridge } = makeWidget();
    widget.registerDynamicBindings();
    bridge.calls.length = 0;

    const release = widget.requestFastPoll(ROTARY);
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0].allowDemote).toBe(false);
    bridge.calls.length = 0;

    release();
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0]).toMatchObject({ simVar: 'apHdgBugValue', allowDemote: true });
    expect(bridge.calls[0].hz).toBeLessThanOrEqual(2);
    bridge.calls.length = 0;

    // Turning it again raises it once more.
    widget.requestFastPoll(ROTARY);
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0].allowDemote).toBe(false);
    expect(bridge.calls[0].hz).toBeGreaterThan(2);
  });

  it('is a no-op for a component with nothing readable to boost', () => {
    const writeOnly = { id: 'rot', type: 'core.rotary', binding: { writeEvent: 'apHdgSet' } };
    const { widget, bridge } = makeWidget(writeOnly);
    expect(widget.requestFastPoll(writeOnly)).toBeNull();
    expect(bridge.calls).toEqual([]);
  });
});
