// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness } from './fixtures/appHarness.js';
import { WidgetRegistry } from '../js/widgets/WidgetRegistry.js';

let harness;
beforeEach(async () => {
  harness = await createAppHarness();
});
afterEach(() => {
  harness.cleanup();
});

async function initializedApp() {
  const app = new harness.FlightDeckApp();
  await app.init();
  return app;
}

function viewport(width, height) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

describe('FlightDeckApp page rendering and orientation', () => {
  it('normalizes and reflows before writing the live page, then mounts valid widgets in order', async () => {
    viewport(390, 844);
    const app = await initializedApp();
    const page = app.activeProfile.getPage('page_radios');
    const input = [
      { id: 'first', type: 'ButtonWidget', layout: { col: 8, row: 8, w: 2, h: 2 }, config: {} },
      { id: 'missing', type: 'ButtonWidget', layout: { col: 12, row: 8, w: 2, h: 2 }, config: {} },
      { id: 'last', type: 'ButtonWidget', layout: { col: 15, row: 8, w: 2, h: 2 }, config: {} },
    ];
    const calls = [];
    vi.spyOn(page, 'getWidgets').mockReturnValue(input);
    vi.spyOn(page, 'getGrid').mockReturnValue({ columns: 20, rows: 44, rowHeight: 16, gap: 3 });
    vi.spyOn(app.layoutEngine, 'measureColumnWidth').mockImplementation((el) =>
      el === app.gridContainer ? 19 : 23,
    );
    const apply = vi.spyOn(app.layoutEngine, 'applyGridToContainer');
    const normalize = app.layoutEngine.normalizeLayout.bind(app.layoutEngine);
    vi.spyOn(app.layoutEngine, 'normalizeLayout').mockImplementation((items) => {
      calls.push('normalize');
      return normalize(items);
    });
    const reflow = app.resolveListWithReservedCorners.bind(app);
    vi.spyOn(app, 'resolveListWithReservedCorners').mockImplementation((items, reserved) => {
      calls.push('reflow');
      return reflow(items, reserved);
    });
    const setWidgets = page.setWidgets.bind(page);
    vi.spyOn(page, 'setWidgets').mockImplementation((...args) => {
      calls.push('set');
      return setWidgets(...args);
    });
    const save = vi.spyOn(app.storage, 'saveProfile');
    const create = vi.mocked(WidgetRegistry.createWidget).getMockImplementation();
    vi.spyOn(WidgetRegistry, 'createWidget').mockImplementation((config, bus) => {
      if (config.id === 'missing') {
        calls.push('missing');
        return null;
      }
      const widget = create(config, bus);
      if (config.id !== '__corner_menu__' && config.id !== '__corner_profile__') {
        calls.push(`create:${config.id}`);
        widget.mount.mockImplementation((parent) => {
          calls.push(`mount:${config.id}`);
          parent.appendChild(widget.element);
        });
        widget.setEditMode.mockImplementation(() => calls.push(`edit:${config.id}`));
      }
      return widget;
    });
    const drag = app.attachDragHandlers.bind(app);
    vi.spyOn(app, 'attachDragHandlers').mockImplementation((widget) => {
      calls.push(`drag:${widget.id}`);
      return drag(widget);
    });
    app.renderActivePage();
    expect([
      app.currentOrientation,
      app.currentDeviceTier,
      document.body.dataset.deviceTier,
    ]).toEqual(['portrait', 'mobile', 'mobile']);
    expect(app.gridContainer.style.gridAutoRows).toBe('19px');
    expect(app.cornerOverlayEl.style.gridAutoRows).toBe('23px');
    expect(app.contentArea.firstElementChild).toBe(app.cornerOverlayEl);
    expect(app.activeWidgetInstances.map((w) => w.id)).toEqual(['first', 'last']);
    expect(calls.slice(0, 2)).toEqual(['normalize', 'reflow']);
    expect(calls.slice(calls.indexOf('set'))).toEqual([
      'set',
      'create:first',
      'mount:first',
      'edit:first',
      'drag:first',
      'missing',
      'create:last',
      'mount:last',
      'edit:last',
      'drag:last',
    ]);
    expect(page.setWidgets).toHaveBeenCalledWith('portrait', 'mobile', expect.any(Array));
    expect(save).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledWith(
      app.gridContainer,
      expect.objectContaining({ rowHeight: 19 }),
    );
  });

  it('keeps branch teardown, toolbar, prompt, lock and yoke decisions in order', async () => {
    const app = await initializedApp();
    const old = [...app.activeWidgetInstances];
    const events = [];
    for (const [target, method, label] of [
      [app.settingsView, 'destroy', 'settings-destroy'],
      [app.editToolbar, 'hide', 'toolbar-hide'],
      [app.rotatePrompt, 'hide', 'prompt-hide'],
      [app.rotatePrompt, 'show', 'prompt-show'],
      [app.virtualYoke, 'stop', 'yoke-stop'],
      [app.virtualYoke, 'start', 'yoke-start'],
      [app, 'tryLockOrientation', 'lock'],
      [app, 'tryUnlockOrientation', 'unlock'],
    ]) {
      const original = target[method].bind(target);
      vi.spyOn(target, method).mockImplementation((...args) => {
        events.push(label);
        return original(...args);
      });
    }
    app.activePageId = 'page_settings';
    app.isEditMode = true;
    app.renderActivePage();
    expect(old.every((w) => w.destroy.mock.calls.length === 1)).toBe(true);
    expect(app.isEditMode).toBe(false);
    expect(events.slice(0, 4)).toEqual([
      'settings-destroy',
      'toolbar-hide',
      'prompt-hide',
      'yoke-stop',
    ]);
    events.length = 0;
    viewport(390, 844);
    app.activePageId = 'page_yoke';
    app.renderActivePage();
    expect(events).toEqual([
      'settings-destroy',
      'lock',
      'toolbar-hide',
      'prompt-show',
      'yoke-stop',
    ]);
    expect(app.contentArea.querySelector('.fd-page-grid')).toBeNull();
    events.length = 0;
    viewport(844, 390);
    app.renderActivePage();
    expect(events).toEqual([
      'settings-destroy',
      'lock',
      'prompt-hide',
      'toolbar-hide',
      'yoke-start',
    ]);
    events.length = 0;
    app.activePageId = 'page_radios';
    app.renderActivePage();
    expect(events).toEqual([
      'settings-destroy',
      'unlock',
      'prompt-hide',
      'toolbar-hide',
      'yoke-stop',
    ]);
  });

  it('refreshes an unchanged orientation and tier in place, but rebuilds on a change', async () => {
    viewport(390, 844);
    const app = await initializedApp();
    const original = [...app.activeWidgetInstances, ...app.cornerWidgetInstances];
    const grid = app.gridContainer;
    const overlay = app.cornerOverlayEl;
    vi.spyOn(app.layoutEngine, 'measureColumnWidth').mockReturnValue(27);
    const apply = vi.spyOn(app.layoutEngine, 'applyGridToContainer');
    const toolbar = vi.spyOn(app.editToolbar, 'setOrientation');
    viewport(390, 744);
    app.handleOrientationChange('portrait', true);
    expect(toolbar).toHaveBeenCalledWith('portrait');
    expect(app.currentDeviceTier).toBe('mobile');
    expect(app.gridContainer).toBe(grid);
    expect(app.cornerOverlayEl).toBe(overlay);
    expect(
      original.every(
        (w) => w.destroy.mock.calls.length === 0 && w.applyLayoutStyles.mock.calls.length === 1,
      ),
    ).toBe(true);
    expect(apply).toHaveBeenCalledWith(grid, expect.objectContaining({ rowHeight: 27 }));
    expect(apply).toHaveBeenCalledWith(overlay, expect.objectContaining({ rowHeight: 27 }));
    app.activePageId = 'page_settings';
    app.handleOrientationChange('landscape');
    expect(toolbar).toHaveBeenCalledWith('landscape');
    expect(app.currentOrientation).toBe('landscape');
    expect(app.gridContainer).toBe(grid);
    app.activePageId = 'page_radios';
    app.currentOrientation = 'portrait';
    viewport(844, 390);
    app.handleOrientationChange('landscape');
    expect(app.gridContainer).not.toBe(grid);
    expect(original.every((w) => w.destroy.mock.calls.length === 1)).toBe(true);
    expect(app.currentOrientation).toBe('landscape');
  });

  it('uses the default grid and keeps the toolbar hidden when explicitly toggled off', async () => {
    viewport(390, 844);
    const app = await initializedApp();
    const page = app.activeProfile.getPage('page_radios');
    vi.spyOn(page, 'getGrid').mockReturnValue(null);
    app.isEditMode = true;
    app.editToolbarVisible = false;
    app.renderActivePage();
    expect(app.gridContainer.style.getPropertyValue('--grid-cols')).toBe('20');
    expect(app.editToolbar.element.classList.contains('hidden')).toBe(true);
    expect(app.editToolbar.element.textContent).toBeTruthy();
  });
});
