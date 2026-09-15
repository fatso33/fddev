/**
 * dispatchSimEvent()'s success/failure result (Rotary rebuild, ticket 02).
 *
 * The Rotary writes to its binding directly and feeds a FAILED write back into the
 * engine, which reverts to telemetry rather than leaving a value the sim never
 * applied (ticket 01's dispatch-failure release path). That path needs a real signal
 * from the host: before this, dispatchSimEvent() returned undefined whether it sent
 * anything or silently bailed on a rejected event name.
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../js/core/EventBus.js';
import { CompositeWidget } from '../js/widgets/CompositeWidget.js';

function makeWidget(bridge) {
  const bus = new EventBus();
  const published = [];
  bus.subscribe('SIM_EVENT_DISPATCH', (d) => published.push(d));
  if (bridge) bus.setBridgeClient(bridge);
  const widget = new CompositeWidget(
    { id: 'w1', type: 'test.widget', config: { definition: { id: 'test.widget', components: [] } } },
    bus
  );
  return { widget, published, bus };
}

describe('CompositeWidget.dispatchSimEvent result', () => {
  it('reports success when the event is actually published', () => {
    const { widget, published } = makeWidget();
    expect(widget.dispatchSimEvent('apHdgSet', 180)).toBe(true);
    expect(published).toEqual([expect.objectContaining({ event: 'apHdgSet', value: 180 })]);
  });

  it('reports failure when the event name is rejected and nothing is sent', () => {
    const { widget, published } = makeWidget();
    expect(widget.dispatchSimEvent('', 180)).toBe(false);
    expect(widget.dispatchSimEvent(undefined, 180)).toBe(false);
    expect(published).toEqual([]);
  });

  // Ticket 02 correction: a rejected name was the ONLY failure this reported, and it
  // is a purely local check — with PC Bridge killed, `SimBridge.sendEvent()` drops the
  // write on a closed socket and this still answered "sent", which is what left the
  // Rotary parked on a value the sim never took in the live test.
  it('reports failure when the bridge cannot take the event (PC Bridge down / socket closed)', () => {
    const bridge = { sendEvent: () => false };
    const { widget, published } = makeWidget(bridge);
    expect(widget.dispatchSimEvent('apHdgSet', 180)).toBe(false);
    // Still published locally — anything else listening on the bus is unaffected;
    // only the caller's "did this reach the sim" answer changes.
    expect(published).toEqual([expect.objectContaining({ event: 'apHdgSet' })]);
  });

  it('still reports success when the bridge accepts the event', () => {
    const { widget } = makeWidget({ sendEvent: () => true });
    expect(widget.dispatchSimEvent('apHdgSet', 180)).toBe(true);
  });

  // WidgetSandbox.js and VirtualYokeEngine.js publish SIM_EVENT_DISPATCH directly,
  // bypassing dispatchSimEvent()'s pre-check, so publish()'s own answer has to be
  // right for a name that is rejected inside it. (Neither caller reads the result
  // yet — see the report's follow-up note.)
  it('publish() reports failure for an event name rejected inside the forward itself', () => {
    const { bus } = makeWidget({ sendEvent: () => true });
    expect(bus.publish('SIM_EVENT_DISPATCH', { event: '', value: 1 })).toBe(false);
    expect(bus.publish('SIM_EVENT_DISPATCH', { event: 'apHdgSet', value: 1 })).toBe(true);
  });

  it('treats a bridge stub with no sendEvent() as sent, rather than as a failure', () => {
    // Several existing bridge fakes (and Studio's mock host) have no transport at all;
    // "no transport" must not read as "the transport refused".
    const { widget } = makeWidget({ subscribeSimVar() {} });
    expect(widget.dispatchSimEvent('apHdgSet', 180)).toBe(true);
  });
});
