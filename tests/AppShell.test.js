// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness } from './fixtures/appHarness.js';
import { WidgetRegistry } from '../js/widgets/WidgetRegistry.js';
import { BaseWidget } from '../js/widgets/BaseWidget.js';
import { Profile } from '../js/models/Profile.js';
import { EventBus } from '../js/core/EventBus.js';
import { StorageManager } from '../js/core/StorageManager.js';
import { SimBridge } from '../js/core/SimBridge.js';
import { LayoutEngine } from '../js/core/LayoutEngine.js';
import { VirtualYokeEngine } from '../js/core/VirtualYokeEngine.js';
import { PwaInstallManager } from '../js/core/PwaInstallManager.js';

let harness;
beforeEach(async () => { harness = await createAppHarness(); });
afterEach(() => harness.cleanup());

async function initializedApp() {
  const app = new harness.FlightDeckApp();
  await app.init();
  return app;
}

function observeCall(target, method, events, name = method) {
  const original = target[method];
  return vi.spyOn(target, method).mockImplementation(function (...args) {
    events.push(name);
    return original.apply(this, args);
  });
}

describe('FlightDeckApp shell before extraction', () => {
  it('exports only the class, suppresses bootstrap with the sentinel, and initializes fields at their original time', () => {
    expect(harness.exportNames).toEqual(['FlightDeckApp']);
    expect(window.flightDeck).toBe(harness.sentinel);
    expect(harness.sockets).toHaveLength(0);
    const app = new harness.FlightDeckApp();
    expect(Object.keys(app)).toEqual([
      'eventBus', 'storage', 'simBridge', 'layoutEngine', 'virtualYoke', 'pwaInstall',
      'activeProfile', 'activePageId', 'activeWidgetInstances', 'currentOrientation',
      'isEditMode', 'draggedWidget', 'dragStartLayout', 'dragStartPointer',
      'autoRepositionEnabled', 'historyStack', 'editToolbar', 'widgetDrawer',
      'propertyInspector', 'profileSelector', 'rotatePrompt', 'cornerWidgetInstances',
      'menuToggleWidget', 'appProfileWidget', 'cornerOverlayEl', 'editToolbarVisible',
      'contentArea', 'gridContainer', 'orientationUnsub',
    ]);
    for (const [field, Class] of [
      ['eventBus', EventBus], ['storage', StorageManager], ['simBridge', SimBridge],
      ['layoutEngine', LayoutEngine], ['virtualYoke', VirtualYokeEngine],
      ['pwaInstall', PwaInstallManager],
    ]) expect(app[field]).toBeInstanceOf(Class);
    expect(app.simBridge.eventBus).toBe(app.eventBus);
    expect(app.virtualYoke.eventBus).toBe(app.eventBus);
    expect(app.activeProfile).toBeNull();
    expect(app.activePageId).toBe('page_radios');
    expect(app.activeWidgetInstances).toEqual([]);
    expect(app.currentOrientation).toBe(app.layoutEngine.getOrientation());
    expect([app.isEditMode, app.autoRepositionEnabled, app.editToolbarVisible]).toEqual([false, false, true]);
    expect([app.draggedWidget, app.dragStartLayout, app.dragStartPointer]).toEqual([null, null, null]);
    expect(app.historyStack).toEqual([]);
    for (const field of ['editToolbar', 'widgetDrawer', 'propertyInspector', 'profileSelector', 'rotatePrompt', 'menuToggleWidget', 'appProfileWidget', 'cornerOverlayEl', 'gridContainer', 'orientationUnsub']) {
      expect(app[field]).toBeNull();
    }
    expect(app.cornerWidgetInstances).toEqual([]);
    expect(app.contentArea).toBe(document.getElementById('content-area'));
    for (const late of ['currentDeviceTier', 'wakeLock', 'fullscreen', 'buttonConfigPopover', 'settingsView', 'bridgeConnected', 'simConnected', '_toastTimer']) {
      expect(Object.hasOwn(app, late)).toBe(false);
    }
    localStorage.setItem('flightdeck_auto_reposition', 'TRUE');
    expect(new harness.FlightDeckApp().autoRepositionEnabled).toBe(false);
    localStorage.setItem('flightdeck_auto_reposition', 'true');
    expect(new harness.FlightDeckApp().autoRepositionEnabled).toBe(true);
  });

  it('initializes in the 15-step order including the missing-profile fallback', async () => {
    const app = new harness.FlightDeckApp();
    const calls = [];
    for (const [target, method, label] of [
      [app.storage, 'init', 'storage.init'],
      [app.simBridge, 'setStorageManager', 'bridge.setStorage'],
      [app.storage, 'setSimBridge', 'storage.setBridge'],
      [WidgetRegistry, 'loadInstalledDefinitions', 'definitions'],
      [app.storage, 'getActiveProfileId', 'active-id'],
      [app.storage, 'getAllProfiles', 'all-profiles'],
      [app, 'activateProfile', 'activate'],
      [app.simBridge, 'connect', 'connect'],
      [app, 'initHeaderControls', 'header'],
      [app, 'initUIComponents', 'ui'],
      [app, 'initEventSubscriptions', 'events'],
      [BaseWidget, 'preloadStyles', 'styles'],
      [app.layoutEngine, 'initOrientationWatcher', 'orientation'],
      [app, 'renderPageMenu', 'menu'],
      [app, 'renderActivePage', 'render'],
      [app, 'initServiceWorker', 'service-worker'],
    ]) observeCall(target, method, calls, label);
    const getProfile = app.storage.getProfile.bind(app.storage);
    let first = true;
    vi.spyOn(app.storage, 'getProfile').mockImplementation((id) => {
      calls.push('get-profile');
      if (first) { first = false; return Promise.resolve(null); }
      return getProfile(id);
    });
    await app.init();
    expect(calls).toEqual([
      'storage.init', 'bridge.setStorage', 'storage.setBridge', 'storage.setBridge', 'definitions',
      'active-id', 'get-profile', 'all-profiles', 'activate', 'connect', 'header',
      'ui', 'events', 'styles', 'orientation', 'menu', 'render', 'service-worker',
    ]);
    expect(app.activeProfile.id).toBe('default_ga');
    expect(harness.sockets).toHaveLength(1);
    expect(harness.fetches).toEqual([]);
  });

  it('tracks shipped menu state and keeps exactly one first-child overlay through navigation', async () => {
    const app = await initializedApp();
    for (const key of ['radios', 'autopilot', 'lights', 'yoke', 'settings', 'radios']) {
      app.switchPage(`page_${key}`);
      const active = [...document.querySelectorAll('.menu-item-btn[data-page].active')].map((el) => el.dataset.page);
      expect(active).toEqual([key]);
      expect(document.getElementById('menu-edit-mode-btn').style.display).toBe(key === 'settings' ? 'none' : 'flex');
      expect(app.contentArea.firstElementChild).toBe(app.cornerOverlayEl);
      expect(app.contentArea.querySelectorAll('.fd-corner-overlay')).toHaveLength(1);
    }
  });

  it('renders Settings, blocked and active Yoke, unknown-page fallback, and an empty profile', async () => {
    const app = await initializedApp();
    const stop = vi.spyOn(app.virtualYoke, 'stop');
    const start = vi.spyOn(app.virtualYoke, 'start');
    app.switchPage('page_settings');
    expect(harness.settingsMount).toHaveBeenCalledWith(app.contentArea);
    expect(app.editToolbar.element.classList.contains('hidden')).toBe(true);
    expect(app.rotatePrompt.element.classList.contains('hidden')).toBe(true);
    expect(stop).toHaveBeenCalled();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    app.switchPage('page_yoke');
    expect(app.rotatePrompt.element.classList.contains('hidden')).toBe(false);
    expect(app.contentArea.querySelector('.fd-page-grid')).toBeNull();
    expect(stop).toHaveBeenCalled();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 844 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 390 });
    app.renderActivePage();
    expect(start).toHaveBeenCalled();
    expect(app.contentArea.querySelector('.fd-page-grid')).not.toBeNull();
    app.switchPage('page_unknown');
    expect(app.activePageId).toBe(app.activeProfile.pages[0].id);
    app.activeProfile = new Profile({ id: 'empty', name: 'Empty', pages: [] });
    app.switchPage('page_unknown');
    expect(app.contentArea.textContent).toContain('No avionics widgets on this page.');
    expect(app.contentArea.querySelector('.fd-page-grid')).not.toBeNull();
  });

  it('destroys old page and corner widgets on every render without overlay accumulation', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    const app = await initializedApp();
    app.switchPage('page_autopilot');
    const old = [...app.activeWidgetInstances, ...app.cornerWidgetInstances];
    expect(old.length).toBeGreaterThan(2);
    app.renderActivePage();
    for (const widget of old) expect(widget.destroy).toHaveBeenCalledOnce();
    expect(app.contentArea.firstElementChild).toBe(app.cornerOverlayEl);
    expect(app.contentArea.querySelectorAll('.fd-corner-overlay')).toHaveLength(1);
    expect(app.cornerWidgetInstances).toHaveLength(2);
  });

  it('renders a new page once during edit before asynchronous cancel restores it and renders again', async () => {
    const app = await initializedApp();
    const target = app.activeProfile.getPage('page_autopilot');
    const original = target.getWidgets(app.currentOrientation, app.currentDeviceTier);
    target.setWidgets(app.currentOrientation, app.currentDeviceTier, [
      ...original, { id: 'unsaved-pin', type: 'ButtonWidget', layout: { col: 7, row: 20, w: 2, h: 2 }, config: {} },
    ]);
    app.toggleEditMode(true);
    const states = [];
    const render = app.renderActivePage;
    vi.spyOn(app, 'renderActivePage').mockImplementation(function (...args) {
      const result = render.apply(this, args);
      states.push({ edit: this.isEditMode, ids: this.activeWidgetInstances.map((w) => w.id) });
      return result;
    });
    app.switchPage('page_autopilot');
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual({ edit: true, ids: expect.arrayContaining(['unsaved-pin']) });
    await vi.waitFor(() => expect(states).toHaveLength(2));
    expect(states[1].edit).toBe(false);
    expect(states[1].ids).not.toContain('unsaved-pin');
    expect(app.isEditMode).toBe(false);
  });
});
