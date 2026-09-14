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

function makeWidget() {
  const bus = new EventBus();
  const published = [];
  bus.subscribe('SIM_EVENT_DISPATCH', (d) => published.push(d));
  const widget = new CompositeWidget(
    { id: 'w1', type: 'test.widget', config: { definition: { id: 'test.widget', components: [] } } },
    bus
  );
  return { widget, published };
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
});
