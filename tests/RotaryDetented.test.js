// @vitest-environment jsdom
/**
 * RotaryComponent's Detented rendering (Rotary rebuild, ticket 04): the named
 * positions drawn around the Face, and which one is highlighted as active.
 *
 * Lives here rather than in shared/ for the same reason RotaryDispatchFailure.test.js
 * does — BaseComponent.js's imports are written for the SYNCED layout, so a
 * BaseComponent-derived component is loadable from an app tree and not from shared/
 * directly. check-sync.mjs guarantees the copy under test is byte-identical to the
 * canonical file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../js/core/EventBus.js';
import { CompositeWidget } from '../js/widgets/CompositeWidget.js';
import { RotaryComponent } from '../js/widgets/components/RotaryComponent.js';

function makeBridge() {
  return {
    connected: true,
    sent: [],
    sendEvent(event, value) {
      this.sent.push({ event, value });
      return true;
    },
    subscribeSimVar() {},
    unregisterSimVar() {},
    registerDynamicEvent() {},
    subscribeArrayData() {}
  };
}

// Authored as TEXT (as an Author naturally would), matched below against a
// NUMERIC telemetry reading (the realistic case for an Enum-unit SimVar, per the
// ticket's own coercion note) -- RotaryComponent.update() only ever forwards a
// value Number() can parse, so telemetry itself is always a number in practice;
// it's the POSITION side that's text.
const POSITIONS = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'Left' },
  { value: '2', label: 'Right' },
  { value: '3', label: 'Both' },
  { value: '4', label: 'Start', momentary: true }
];

const DETENTED_DEF = {
  id: 'r1',
  type: 'core.rotary',
  binding: { readSimVar: 'apMagnetoValue', writeEvent: 'apMagnetoSet' },
  props: { rangeMode: 'detented', positions: POSITIONS, degreesPerUnit: 10 }
};

function makeComp(def = DETENTED_DEF) {
  const bus = new EventBus();
  bus.setBridgeClient(makeBridge());
  const widget = new CompositeWidget(
    { id: 'w1', type: 'test.widget', config: { definition: { id: 'test.widget', components: [def] } } },
    bus
  );
  const comp = new RotaryComponent(def, widget);
  document.body.appendChild(comp.render());
  return comp;
}

describe('RotaryComponent — Detented position markers', () => {
  let comp;

  afterEach(() => {
    if (comp) comp.destroy();
    document.body.innerHTML = '';
  });

  it('renders one marker per authored position, with a label from either the Label or the Value', () => {
    comp = makeComp();
    const markers = comp.faceNode.querySelectorAll('.fd-rotary-position');
    expect(markers.length).toBe(POSITIONS.length);
    expect([...markers].map((m) => m.textContent)).toEqual(['Off', 'Left', 'Right', 'Both', 'Start']);
  });

  it('highlights the position matching the bound telemetry value, tolerating the numeric-vs-text mismatch', () => {
    comp = makeComp();
    comp.update(1, {}); // numeric SimVar reading; position 1's authored value is the text '1'
    const markers = [...comp.faceNode.querySelectorAll('.fd-rotary-position')];
    expect(markers.map((m) => m.classList.contains('active'))).toEqual([false, true, false, false, false]);
  });

  it('highlights nothing when telemetry matches no authored position, rather than leaving a stale highlight', () => {
    comp = makeComp();
    comp.update(1, {});
    comp.update(99, {}); // matches none of '0'..'4'
    const markers = [...comp.faceNode.querySelectorAll('.fd-rotary-position')];
    expect(markers.some((m) => m.classList.contains('active'))).toBe(false);
  });

  it('renders no position markers at all in Bounded (the default) mode', () => {
    comp = makeComp({ ...DETENTED_DEF, props: { rangeMode: 'bounded', min: 0, max: 100 } });
    expect(comp.faceNode.querySelectorAll('.fd-rotary-position').length).toBe(0);
  });

  it('lays positions out using only the Face\'s own box, never this component\'s outer (possibly non-square) element', () => {
    // The deleted Selector measured its position markers as a percentage of its own
    // (potentially rectangular) element, which is what distorted into an ellipse on a
    // non-square box. Proving the fix structurally (jsdom doesn't run CSS container
    // queries, so the Face's actual squareness can't be measured here): the widened
    // outer box below must have zero influence on the markers' authored percentages.
    comp = makeComp();
    const before = [...comp.faceNode.querySelectorAll('.fd-rotary-position')].map((m) => m.style.left + '/' + m.style.top);

    Object.defineProperty(comp.element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 900, height: 60, right: 900, bottom: 60 })
    });
    comp.update(3, {}); // 'Both' -- forces a re-resolve/re-render pass
    const after = [...comp.faceNode.querySelectorAll('.fd-rotary-position')].map((m) => m.style.left + '/' + m.style.top);

    expect(after).toEqual(before);
  });

  it('survives renderFace() replacing the Face\'s entire innerHTML (a needle-angle change) without losing its markers', () => {
    comp = makeComp();
    // BOTH is a different needle angle than OFF (the initial resting position),
    // which is what makes renderFace() actually rebuild its markup this call.
    comp.update(3, {});
    expect(comp.faceNode.querySelectorAll('.fd-rotary-position').length).toBe(POSITIONS.length);
  });

  it('does not write to the binding merely because telemetry moved the highlighted position', () => {
    comp = makeComp();
    comp.update(1, {});
    // A telemetry-driven idle update must never itself dispatch a write — only a
    // user gesture's turn/turnEnd triggers do.
    const bridge = comp.widget.eventBus.bridgeClient;
    expect(bridge.sent).toEqual([]);
  });
});
