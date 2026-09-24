// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness } from './fixtures/appHarness.js';
import { LayoutEngine } from '../js/core/LayoutEngine.js';

let harness;
beforeEach(async () => {
  harness = await createAppHarness();
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'vibrate');
  harness.cleanup();
});

const LAYOUTS = [
  { id: 'a', type: 'ButtonWidget', layout: { col: 5, row: 5, w: 4, h: 4 }, config: {} },
  { id: 'b', type: 'ButtonWidget', layout: { col: 10, row: 5, w: 4, h: 4 }, config: {} },
];

// Ten pixels per cell keeps pointer positions readable: (45, 45) is cell 5/5.
async function editingApp() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  const app = new harness.FlightDeckApp();
  await app.init();
  const page = app.activeProfile.getPage(app.activePageId);
  page.setWidgets('portrait', 'mobile', structuredClone(LAYOUTS));
  app.renderActivePage();
  app.isEditMode = true;
  vi.spyOn(app.layoutEngine, 'measureColumnWidth').mockReturnValue(17);
  vi.spyOn(app.layoutEngine, 'pixelToGridCell').mockImplementation((x, y) => ({
    col: Math.floor(x / 10) + 1,
    row: Math.floor(y / 10) + 1,
  }));
  const widget = app.activeWidgetInstances.find((w) => w.id === 'a');
  const el = widget.element;
  el.setPointerCapture = vi.fn();
  el.hasPointerCapture = vi.fn(() => true);
  el.releasePointerCapture = vi.fn();
  const spec = page.getGrid('portrait', 'mobile') || LayoutEngine.getGridSpec('portrait', 'mobile');
  return { app, page, widget, el, spec };
}

function down(target, x, y, init = {}) {
  const event = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId: 3,
    clientX: x,
    clientY: y,
    ...init,
  });
  vi.spyOn(event, 'preventDefault');
  target.dispatchEvent(event);
  return event;
}
const move = (x, y) =>
  window.dispatchEvent(
    new PointerEvent('pointermove', { cancelable: true, clientX: x, clientY: y }),
  );
const up = (x, y, type = 'pointerup') =>
  window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y }));
function flushFrames() {
  const pending = [...harness.frames];
  harness.frames.clear();
  for (const [, callback] of pending) callback();
  return pending.length;
}
// Frames stay on the harness's manual queue; only timeouts are faked.
const fakeTimeouts = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
const pointerListeners = (spy) =>
  spy.mock.calls.filter(([type]) => String(type).startsWith('pointer'));

describe('FlightDeckApp drag and long-press gestures', () => {
  it('starts only in edit mode away from edit controls, then captures and releases one gesture', async () => {
    const { app, widget, el, spec } = await editingApp();
    const added = vi.mocked(window.addEventListener);
    const before = pointerListeners(added).length;
    app.isEditMode = false;
    expect(down(el, 45, 45).preventDefault).not.toHaveBeenCalled();
    app.isEditMode = true;
    for (const className of ['widget-edit-btn', 'widget-delete-btn']) {
      const button = document.createElement('button');
      button.className = className;
      el.appendChild(button);
      down(button, 45, 45);
      button.remove();
    }
    expect(app.draggedWidget).toBeNull();
    expect(pointerListeners(added)).toHaveLength(before);
    expect(el.setPointerCapture).not.toHaveBeenCalled();

    const passive = down(el, 45, 45, { cancelable: false });
    expect(passive.preventDefault).not.toHaveBeenCalled();
    up(45, 45);
    app.layoutEngine.gridCols = 99;
    app.layoutEngine.defaultRowHeight = 1;
    expect(down(el, 45, 45).preventDefault).toHaveBeenCalledOnce();
    expect(app.draggedWidget).toBe(widget);
    expect(app.dragStartLayout).toEqual(widget.layout);
    expect(app.dragStartLayout).not.toBe(widget.layout);
    expect(app.dragStartPointer).toEqual({ x: 45, y: 45 });
    expect([app.layoutEngine.gridCols, app.layoutEngine.defaultRowHeight]).toEqual([
      spec.columns,
      17,
    ]);
    const ghost = app.gridContainer.querySelector('.fd-drop-ghost');
    expect([ghost.style.gridColumn, ghost.style.gridRow, ghost.style.display]).toEqual([
      '5 / span 4',
      '5 / span 4',
      'block',
    ]);
    expect(el.classList.contains('is-dragging')).toBe(true);
    expect(el.setPointerCapture).toHaveBeenLastCalledWith(3);
    expect(
      pointerListeners(added)
        .slice(-3)
        .map(([type, , options]) => [type, options]),
    ).toEqual([
      ['pointermove', { capture: true, passive: false }],
      ['pointerup', { capture: true }],
      ['pointercancel', { capture: true }],
    ]);
    up(45, 45);
    expect(el.hasPointerCapture).toHaveBeenLastCalledWith(3);
    expect(el.releasePointerCapture).toHaveBeenLastCalledWith(3);
    expect(ghost.isConnected).toBe(false);
    expect(el.classList.contains('is-dragging')).toBe(false);
    expect(app.draggedWidget).toBeNull();
  });

  it('opens the inspector after a steady 500 ms hold, then commits nothing on release', async () => {
    const { app, page, widget, el } = await editingApp();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    const inspect = vi.spyOn(app.propertyInspector, 'inspect').mockImplementation(() => {});
    const history = vi.spyOn(app, 'saveHistorySnapshot');
    const setWidgets = vi.spyOn(page, 'setWidgets');
    const start = structuredClone(widget.layout);
    fakeTimeouts();

    down(el, 45, 45);
    move(54, 45);
    vi.advanceTimersByTime(500);
    expect(inspect).not.toHaveBeenCalled();
    expect(app.draggedWidget).toBe(widget);
    up(45, 45);
    // Moving past 8 px makes release a drop, even back onto the start cell.
    expect(history).toHaveBeenCalledOnce();
    history.mockClear();
    setWidgets.mockClear();

    down(el, 45, 45);
    move(50, 50);
    vi.advanceTimersByTime(499);
    expect(inspect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(app.draggedWidget).toBeNull();
    expect(el.classList.contains('is-dragging')).toBe(false);
    expect(el.style.transform).toBe('');
    expect(app.gridContainer.querySelector('.fd-drop-ghost')).toBeNull();
    expect(vibrate).toHaveBeenCalledWith(40);
    expect(inspect).toHaveBeenCalledWith(widget, 'portrait', 'mobile');
    move(145, 145);
    up(145, 145);
    expect(harness.frames.size).toBe(0);
    expect(history).not.toHaveBeenCalled();
    expect(setWidgets).not.toHaveBeenCalled();
    expect(widget.layout).toEqual(start);
  });

  it('coalesces moves into one frame, clamps columns, and delays or blocks the nudge preview', async () => {
    const { app, el } = await editingApp();
    const previews = () => app.gridContainer.querySelectorAll('.fd-nudge-preview');
    app.autoRepositionEnabled = true;
    fakeTimeouts();
    down(el, 45, 45);
    const ghost = app.gridContainer.querySelector('.fd-drop-ghost');
    move(60, 45);
    move(70, 45);
    move(300, 45);
    expect(harness.frames.size).toBe(1);
    expect(flushFrames()).toBe(1);
    expect(ghost.style.gridColumn).toBe('17 / span 4');
    expect(el.style.transform).toBe('translate3d(255px, 0px, 0)');

    move(95, 45);
    flushFrames();
    vi.advanceTimersByTime(999);
    expect(previews()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(previews().length).toBeGreaterThan(0);
    expect(ghost.classList.contains('is-blocked')).toBe(false);
    move(145, 145);
    flushFrames();
    expect(previews()).toHaveLength(0);

    app.autoRepositionEnabled = false;
    move(95, 45);
    flushFrames();
    vi.advanceTimersByTime(1000);
    expect(previews()).toHaveLength(0);
    expect(ghost.classList.contains('is-blocked')).toBe(true);
    move(145, 145);
    flushFrames();
    expect(ghost.classList.contains('is-blocked')).toBe(false);
    up(145, 145);
  });

  it('refuses blocked drops with exact toasts and commits accepted drops after one snapshot', async () => {
    const { app, page, widget, el } = await editingApp();
    const order = [];
    const toast = vi.spyOn(app, 'showToast');
    const snapshot = app.saveHistorySnapshot.bind(app);
    const history = vi.spyOn(app, 'saveHistorySnapshot').mockImplementation(() => {
      order.push('history');
      return snapshot();
    });
    const set = page.setWidgets.bind(page);
    vi.spyOn(page, 'setWidgets').mockImplementation((...args) => {
      order.push('set');
      return set(...args);
    });
    const start = structuredClone(widget.layout);

    for (const [enabled, x, y, text] of [
      [false, 95, 45, 'Auto-Reposition is off -- that spot is occupied.'],
      [true, 5, 5, "Can't place there -- no room to move the widget in the way."],
    ]) {
      app.autoRepositionEnabled = enabled;
      down(el, 45, 45);
      move(x, y);
      up(x, y);
      expect(toast).toHaveBeenLastCalledWith(text);
    }
    expect(history).not.toHaveBeenCalled();
    expect(widget.layout).toEqual(start);

    const other = app.activeWidgetInstances.find((w) => w.id === 'b');
    down(el, 45, 45);
    move(145, 145);
    up(145, 145);
    expect(order).toEqual(['history', 'set']);
    expect(page.getWidgets('portrait', 'mobile').find((w) => w.id === 'a').layout).toMatchObject({
      col: 15,
      row: 15,
      w: 4,
      h: 4,
    });
    expect(widget.layout).toMatchObject({ col: 15, row: 15, w: 4, h: 4 });
    expect(widget.applyLayoutStyles).toHaveBeenCalledOnce();
    expect(other.applyLayoutStyles).toHaveBeenCalledOnce();
    expect(app.draggedWidget).toBeNull();
  });

  it('pointercancel takes the pointerup path and leaves no live gesture listeners', async () => {
    const { app, widget, el } = await editingApp();
    const added = vi.mocked(window.addEventListener);
    const removed = vi.spyOn(window, 'removeEventListener');
    down(el, 45, 45);
    const listeners = pointerListeners(added).slice(-3);
    move(145, 145);
    expect(harness.frames.size).toBe(1);
    up(145, 145, 'pointercancel');
    expect(harness.frames.size).toBe(0);
    expect(
      pointerListeners(removed).map(([type, callback, options]) => [type, callback, options]),
    ).toEqual(listeners.map(([type, callback]) => [type, callback, { capture: true }]));
    expect(el.releasePointerCapture).toHaveBeenCalledWith(3);
    expect(app.gridContainer.querySelector('.fd-drop-ghost')).toBeNull();
    expect(widget.layout).toMatchObject({ col: 15, row: 15 });
    expect(app.draggedWidget).toBeNull();
    move(300, 300);
    expect(harness.frames.size).toBe(0);
    expect(el.style.transform).toBe('');
  });

  it('long-press helper fires after 500 ms and removes its capture listeners on every exit', async () => {
    const app = new harness.FlightDeckApp();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const order = [];
    const vibrate = vi.fn(() => order.push('vibrate'));
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    const onLongPress = vi.fn(() => order.push('open'));
    const removed = vi.spyOn(window, 'removeEventListener');
    const added = vi.mocked(window.addEventListener);
    fakeTimeouts();
    app.attachLongPressOpen(el, onLongPress);
    const expectRemoved = () => {
      const listeners = pointerListeners(added).slice(-3);
      expect(listeners.map(([type, , options]) => [type, options])).toEqual([
        ['pointermove', { capture: true }],
        ['pointerup', { capture: true }],
        ['pointercancel', { capture: true }],
      ]);
      expect(pointerListeners(removed).slice(-3)).toEqual(
        listeners.map(([type, callback]) => [type, callback, { capture: true }]),
      );
    };

    down(el, 10, 10);
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(order).toEqual(['vibrate', 'open']);
    expect(vibrate).toHaveBeenCalledWith(40);
    expectRemoved();

    down(el, 10, 10);
    move(18, 10);
    vi.advanceTimersByTime(100);
    expect(pointerListeners(removed)).toHaveLength(3);
    move(19, 10);
    expectRemoved();
    down(el, 10, 10);
    up(10, 10, 'pointercancel');
    expectRemoved();
    vi.advanceTimersByTime(1000);
    expect(onLongPress).toHaveBeenCalledOnce();
  });
});
