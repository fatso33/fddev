// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness } from './fixtures/appHarness.js';
import { WidgetRegistry } from '../js/widgets/WidgetRegistry.js';

let harness;
let app;
let page;
const widgets = (items) => items.map(([id, col, row, extra = {}]) => ({
  id, type: 'ButtonWidget', layout: { col, row, w: 3, h: 2 }, config: extra,
}));
const current = () => page.getWidgets(app.currentOrientation, app.currentDeviceTier);

beforeEach(async () => {
  harness = await createAppHarness();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  app = new harness.FlightDeckApp();
  await app.init();
  app.activePageId = 'page_autopilot';
  page = app.activeProfile.getPage(app.activePageId);
  page.setWidgets('portrait', 'mobile', widgets([['one', 5, 5], ['two', 11, 9]]));
  app.renderActivePage();
});
afterEach(() => harness.cleanup());

describe('FlightDeckApp layout editing', () => {
  it('guards Settings and landscape-only pages, then toggles grid, overlay, widgets and toolbar', () => {
    const toast = vi.spyOn(app, 'showToast').mockImplementation(() => {});
    app.activePageId = 'page_settings';
    app.isEditMode = true;
    app.toggleEditMode(true);
    expect(app.isEditMode).toBe(false);
    expect(app.editToolbar.element.classList.contains('hidden')).toBe(true);
    app.activePageId = 'page_yoke';
    app.toggleEditMode(true);
    expect(toast).toHaveBeenCalledWith('Rotate your device to landscape to customize this page.');
    expect(app.isEditMode).toBe(false);
    app.activePageId = 'page_autopilot';
    app.editToolbarVisible = false;
    const snapshot = vi.spyOn(app, 'saveHistorySnapshot');
    app.toggleEditMode(true);
    expect(snapshot).toHaveBeenCalledOnce();
    expect(app.isEditMode).toBe(true);
    expect(app.editToolbarVisible).toBe(true);
    expect(app.gridContainer.classList.contains('edit-mode-active')).toBe(true);
    expect(app.cornerOverlayEl.classList.contains('edit-mode-active')).toBe(true);
    expect(app.activeWidgetInstances.every((w) => w.setEditMode.mock.lastCall[0] === true)).toBe(true);
    expect(app.menuToggleWidget.setAppEditMode).toHaveBeenLastCalledWith(true);
    expect(app.editToolbar.currentOrientation).toBe('portrait');
    expect(app.editToolbar.element.classList.contains('hidden')).toBe(false);
    app.toggleEditToolbarVisibility();
    expect(app.editToolbarVisible).toBe(false);
    expect(app.editToolbar.element.classList.contains('hidden')).toBe(true);
    app.toggleEditMode(false);
    expect(app.editToolbarVisible).toBe(true);
    expect(app.gridContainer.classList.contains('edit-mode-active')).toBe(false);
    expect(app.cornerOverlayEl.classList.contains('edit-mode-active')).toBe(false);
    expect(app.menuToggleWidget.setAppEditMode).toHaveBeenLastCalledWith(false);
  });

  it('persists auto-reposition and adds a scaled, reserved-aware widget only to the active layout', () => {
    app.toggleAutoReposition(true);
    expect(localStorage.getItem('flightdeck_auto_reposition')).toBe('true');
    expect(app.editToolbar.autoRepositionEnabled).toBe(true);
    app.toggleAutoReposition(false);
    expect(localStorage.getItem('flightdeck_auto_reposition')).toBe('false');
    const events = [];
    const descriptor = { defaultLayout: { w: 10, h: 3 }, defaultConfig: { nested: { value: 1 } }, openConfigOnAdd: true };
    vi.spyOn(WidgetRegistry, 'getDescriptor').mockReturnValue(descriptor);
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    vi.spyOn(app.layoutEngine, 'normalizeLayout').mockImplementation((list) => {
      events.push('normalize'); return list;
    });
    vi.spyOn(app.layoutEngine, 'findNextFreeSlot').mockImplementation((w, h, occupied) => {
      expect([w, h]).toEqual([10, 3]);
      expect(occupied.some((entry) => entry.id.startsWith('__corner_'))).toBe(true);
      return { col: 7, row: 20, w, h };
    });
    vi.spyOn(app, 'saveHistorySnapshot').mockImplementation(() => events.push('snapshot'));
    vi.spyOn(app, 'openButtonConfigPopover').mockImplementation((widget, mode) => events.push(['popover', widget.id, mode]));
    app.addNewWidgetToPage('ButtonWidget');
    expect(events.slice(0, 2)).toEqual(['snapshot', 'normalize']);
    expect(current().find((w) => w.id === 'w_1234')).toMatchObject({
      layout: { col: 7, row: 20, w: 10, h: 3 }, config: { nested: { value: 1 } },
    });
    expect(current().filter((w) => w.id === 'w_1234')).toHaveLength(1);
    expect(page.getWidgets('landscape', 'mobile').filter((w) => w.id === 'w_1234')).toHaveLength(0);
    descriptor.defaultConfig.nested.value = 9;
    expect(current().find((w) => w.id === 'w_1234').config.nested.value).toBe(1);
    expect(events.at(-1)).toEqual(['popover', 'w_1234', 'add']);
  });

  it('refuses non-removable removal, then destroys one instance and updates peers without rendering', () => {
    page.setWidgets('portrait', 'mobile', widgets([['one', 5, 5, { removable: false }], ['two', 11, 9]]));
    app.renderActivePage();
    const one = app.activeWidgetInstances.find((w) => w.id === 'one');
    const two = app.activeWidgetInstances.find((w) => w.id === 'two');
    const snapshot = vi.spyOn(app, 'saveHistorySnapshot');
    const render = vi.spyOn(app, 'renderActivePage');
    const toast = vi.spyOn(app, 'showToast').mockImplementation(() => {});
    app.removeWidgetFromPage('one');
    expect(toast).toHaveBeenCalledWith('This widget is built into the page and cannot be removed.');
    expect(snapshot).not.toHaveBeenCalled();
    expect(one.destroy).not.toHaveBeenCalled();
    current().find((w) => w.id === 'one').config.removable = true;
    app.removeWidgetFromPage('one');
    expect(snapshot).toHaveBeenCalledOnce();
    expect(one.destroy).toHaveBeenCalledOnce();
    expect(app.activeWidgetInstances).toEqual([two]);
    expect(two.applyLayoutStyles).toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('updates layout through reserved placement, config in one tier, and opens edit popover by ID', () => {
    const one = app.activeWidgetInstances.find((w) => w.id === 'one');
    const resolve = vi.spyOn(app, 'resolveWithReservedCorners').mockReturnValue(widgets([['one', 8, 12], ['two', 11, 9]]));
    const reserved = vi.spyOn(app, 'getReservedCornerEntries');
    const update = vi.spyOn(page, 'updateWidget');
    app.layoutEngine.gridCols = 1;
    app.handleUpdateWidgetConfig('one', { layout: { col: 1, row: 1, w: 3, h: 2 }, config: { label: 'Changed' } });
    expect(app.layoutEngine.gridCols).toBe(20);
    expect(reserved).toHaveBeenCalled();
    expect(resolve).toHaveBeenCalled();
    expect(current().find((w) => w.id === 'one').layout.col).toBe(8);
    expect(one.layout.col).toBe(8);
    expect(one.applyLayoutStyles).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('one', { config: { label: 'Changed' } }, 'portrait', false, 'mobile');
    expect(one.updateConfig).toHaveBeenCalledWith({ label: 'Changed' });
    expect(() => app.handleUpdateWidgetConfig('one', undefined)).toThrow(TypeError);
    const open = vi.spyOn(app.buttonConfigPopover, 'open').mockImplementation(() => {});
    app.openButtonConfigPopover('one', 'edit');
    expect(open).toHaveBeenCalledWith(one, { mode: 'edit' });
    app.openButtonConfigPopover('missing', 'edit');
    expect(open).toHaveBeenCalledOnce();
  });

  it('mirrors only the same tier with a reserved post-pass and compacts around reserved cells', () => {
    const mirror = vi.spyOn(app.layoutEngine, 'mirrorLayout').mockReturnValue(widgets([['one', 1, 1]]));
    const post = vi.spyOn(app, 'resolveListWithReservedCorners').mockReturnValue(widgets([['one', 6, 6]]));
    app.handleMirrorLayout();
    expect(mirror).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce();
    expect(page.getWidgets('landscape', 'mobile').find((w) => w.id === 'one').layout.col).toBe(6);
    expect(current().find((w) => w.id === 'one').layout.col).toBe(5);
    const compact = vi.spyOn(app.layoutEngine, 'compactLayout').mockImplementation((list) => {
      expect(list.some((entry) => entry.id.startsWith('__corner_'))).toBe(true);
      return [...widgets([['one', 5, 3]]), ...list.filter((entry) => entry.id.startsWith('__corner_'))];
    });
    const render = vi.spyOn(app, 'renderActivePage').mockImplementation(() => {});
    app.handleCompactLayout();
    expect(compact).toHaveBeenCalledOnce();
    expect(current().map((w) => w.id)).toEqual(['one']);
    expect(render).toHaveBeenCalledOnce();
  });

  it('keeps twenty JSON history entries, undoes via activation, and treats empty history as a no-op', async () => {
    app.historyStack = [];
    for (let index = 0; index < 21; index++) {
      app.activeProfile.name = `State ${index}`;
      app.saveHistorySnapshot();
    }
    expect(app.historyStack).toHaveLength(20);
    expect(JSON.parse(app.historyStack[0]).name).toBe('State 1');
    expect(JSON.parse(app.historyStack.at(-1)).name).toBe('State 20');
    app.activeProfile.name = 'Changed';
    const activate = vi.spyOn(app, 'activateProfile');
    const render = vi.spyOn(app, 'renderActivePage').mockImplementation(() => {});
    await app.handleUndo();
    expect(activate).toHaveBeenCalledOnce();
    expect(app.activeProfile.name).toBe('State 20');
    expect(render).toHaveBeenCalledOnce();
    app.historyStack = [];
    await app.handleUndo();
    expect(render).toHaveBeenCalledOnce();
  });

  it('saves through ensure-editable then exits, and cancel reloads before exit and render', async () => {
    const events = [];
    vi.spyOn(app, 'ensureEditableProfile').mockImplementation(async () => events.push('ensure'));
    vi.spyOn(app.storage, 'saveProfile').mockImplementation(async (raw) => events.push(['save', raw]));
    vi.spyOn(app, 'toggleEditMode').mockImplementation((active) => events.push(['edit', active]));
    await app.handleSaveLayout();
    expect(events.map((event) => Array.isArray(event) ? event[0] : event)).toEqual(['ensure', 'save', 'edit']);
    expect(events[1][1]).toEqual(app.activeProfile.toJSON());
    expect(events[2]).toEqual(['edit', false]);
    events.length = 0;
    const stored = app.activeProfile.toJSON();
    vi.spyOn(app.storage, 'getProfile').mockImplementation(async () => { events.push('load'); return stored; });
    vi.spyOn(app, 'activateProfile').mockImplementation(async (raw) => { events.push('activate'); return raw; });
    vi.spyOn(app, 'renderActivePage').mockImplementation(() => events.push('render'));
    await app.handleCancelEdit();
    expect(events).toEqual(['load', 'activate', ['edit', false], 'render']);
  });
});
