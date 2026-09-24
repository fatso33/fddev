// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness } from './fixtures/appHarness.js';

let harness;
let readyStateDescriptor;
let workerDescriptor;
beforeEach(async () => {
  readyStateDescriptor = Object.getOwnPropertyDescriptor(document, 'readyState');
  workerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  harness = await createAppHarness();
});
afterEach(() => {
  harness.cleanup();
  if (readyStateDescriptor) Object.defineProperty(document, 'readyState', readyStateDescriptor);
  else Reflect.deleteProperty(document, 'readyState');
  if (workerDescriptor) Object.defineProperty(navigator, 'serviceWorker', workerDescriptor);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
});

const methods = [
  'constructor', 'init', 'handleOrientationChange', 'refreshGridGeometry',
  'initHeaderControls', 'initUIComponents', 'initEventSubscriptions',
  'updateMenuButtonStatus', 'showToast', 'switchPage', 'renderActivePage',
  'getCornerWidgetLayouts', 'getReservedCornerEntries', 'resolveWithReservedCorners',
  'resolveDropPlacement', 'resolveListWithReservedCorners', 'mountCornerWidgets',
  'wireCornerInteractions', 'tryLockOrientation', 'tryUnlockOrientation',
  'toggleEditMode', 'toggleEditToolbarVisibility', 'toggleAutoReposition',
  'attachLongPressOpen', 'attachDragHandlers', 'addNewWidgetToPage',
  'openButtonConfigPopover', 'removeWidgetFromPage', 'handleUpdateWidgetConfig',
  'handleMirrorLayout', 'saveHistorySnapshot', 'handleUndo', 'handleCompactLayout',
  'handleSaveLayout', 'handleCancelEdit', 'activateProfile', 'ensureEditableProfile',
  'forkFromDefault', 'handleAddCustomPage', 'handleDeleteCustomPage',
  'getCustomPages', 'renderPageMenu', 'handleRevertPageToDefault', 'initServiceWorker',
];
const asyncMethods = [
  'init', 'activateProfile', 'ensureEditableProfile', 'forkFromDefault',
  'handleAddCustomPage', 'handleDeleteCustomPage', 'handleRevertPageToDefault',
];

describe('FlightDeckApp public facade', () => {
  it('keeps its sole named export, exact prototype and async declarations', () => {
    expect(harness.exportNames).toEqual(['FlightDeckApp']);
    const proto = harness.FlightDeckApp.prototype;
    expect(Object.getOwnPropertyNames(proto)).toEqual(methods);
    expect(methods.filter((name) => proto[name].constructor.name === 'AsyncFunction')).toEqual(asyncMethods);
  });

  it('uses live orientation defaults, omitted fork argument and returns collaborator Promises', async () => {
    const app = new harness.FlightDeckApp();
    const first = Promise.resolve('first');
    const second = Promise.resolve('second');
    const remove = vi.spyOn(app.layoutEdit, 'removeWidgetFromPage').mockReturnValue(first);
    const update = vi.spyOn(app.layoutEdit, 'handleUpdateWidgetConfig').mockReturnValue(second);
    app.currentOrientation = 'landscape';
    expect(app.removeWidgetFromPage('one')).toBe(first);
    expect(remove).toHaveBeenCalledWith('one', 'landscape');
    app.currentOrientation = 'portrait';
    expect(app.handleUpdateWidgetConfig('one', { config: {} })).toBe(second);
    expect(update).toHaveBeenCalledWith('one', { layout: undefined, config: {} }, 'portrait');
    const fork = vi.spyOn(app.profileCoordinator, 'forkFromDefault').mockReturnValue(first);
    await expect(app.forkFromDefault()).resolves.toBe('first');
    expect(fork).toHaveBeenCalledWith(null);
    for (const [name, owner] of [
      ['handleUndo', app.layoutEdit], ['handleSaveLayout', app.layoutEdit],
      ['handleCancelEdit', app.layoutEdit],
    ]) {
      const result = Promise.resolve(name);
      vi.spyOn(owner, name).mockReturnValue(result);
      expect(app[name]()).toBe(result);
    }
    const ensure = Promise.resolve('ensured');
    vi.spyOn(app.profileCoordinator, 'ensureEditableProfile').mockReturnValue(ensure);
    await expect(app.ensureEditableProfile()).resolves.toBe('ensured');
  });

  it('waits for DOM readiness, reuses an existing global and registers the same worker path', async () => {
    const sentinel = window.flightDeck;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });
    const add = vi.mocked(document.addEventListener);
    await import('../js/app.js?facade-loading');
    expect(add.mock.calls.filter(([name]) => name === 'DOMContentLoaded')).toHaveLength(1);
    expect(window.flightDeck).toBe(sentinel);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(window.flightDeck).toBe(sentinel);
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    await import('../js/app.js?facade-ready');
    expect(window.flightDeck).toBe(sentinel);

    const app = new harness.FlightDeckApp();
    const register = vi.fn().mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
    app.initServiceWorker();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(register).toHaveBeenCalledWith('./sw.js');
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('creates one app after DOMContentLoaded when no global exists', async () => {
    window.flightDeck = undefined;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });
    const { FlightDeckApp } = await import('../js/app.js?facade-bootstrap-new');
    expect(window.flightDeck).toBeUndefined();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    const app = window.flightDeck;
    expect(app).toBeInstanceOf(FlightDeckApp);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(window.flightDeck).toBe(app);
    await vi.waitFor(() => expect(app.activeProfile?.id).toBe('default_ga'));
    expect(harness.sockets).toHaveLength(1);
  });

  it('keeps the ordered init seam and complete field inventory', async () => {
    const app = new harness.FlightDeckApp();
    const trace = [];
    for (const [target, name] of [
      [app.storage, 'init'], [app.simBridge, 'setStorageManager'],
      [app.storage, 'setSimBridge'], [app.storage, 'getActiveProfileId'],
      [app.storage, 'getProfile'], [app, 'activateProfile'], [app.simBridge, 'connect'],
      [app, 'initHeaderControls'], [app, 'initUIComponents'],
      [app, 'initEventSubscriptions'], [app.layoutEngine, 'initOrientationWatcher'],
      [app, 'renderPageMenu'], [app, 'renderActivePage'], [app, 'initServiceWorker'],
    ]) {
      const original = target[name];
      vi.spyOn(target, name).mockImplementation(function (...args) {
        trace.push(name);
        return original.apply(this, args);
      });
    }
    await app.init();
    expect(trace).toEqual([
      'init', 'setStorageManager', 'setSimBridge', 'setSimBridge', 'getActiveProfileId',
      'getProfile', 'activateProfile', 'connect', 'initHeaderControls',
      'initUIComponents', 'initEventSubscriptions', 'initOrientationWatcher',
      'renderPageMenu', 'renderActivePage', 'initServiceWorker',
    ]);
    expect(Object.keys(app)).toEqual([
      'eventBus', 'storage', 'simBridge', 'layoutEngine', 'virtualYoke', 'pwaInstall',
      'activeProfile', 'activePageId', 'activeWidgetInstances', 'currentOrientation',
      'isEditMode', 'draggedWidget', 'dragStartLayout', 'dragStartPointer',
      'autoRepositionEnabled', 'historyStack', 'editToolbar', 'widgetDrawer',
      'propertyInspector', 'profileSelector', 'rotatePrompt', 'cornerWidgetInstances',
      'menuToggleWidget', 'appProfileWidget', 'cornerOverlayEl', 'editToolbarVisible',
      'contentArea', 'gridContainer', 'orientationUnsub', 'navigation',
      'profileCoordinator', 'layoutEdit', 'appUi', 'wakeLock', 'fullscreen',
      'buttonConfigPopover', 'settingsView', 'bridgeConnected', 'simConnected',
      'currentDeviceTier',
    ]);
    expect(app.orientationUnsub).toEqual(expect.any(Function));
    expect(harness.sockets).toHaveLength(1);
  });

  it('carries one app through edit, drag, fork/save, navigation, rotation and preset sync', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    const app = new harness.FlightDeckApp();
    const trace = [];
    for (const name of [
      'toggleEditMode', 'attachDragHandlers', 'saveHistorySnapshot',
      'handleSaveLayout', 'ensureEditableProfile', 'forkFromDefault',
      'switchPage', 'handleOrientationChange', 'renderActivePage', 'activateProfile',
    ]) {
      const original = app[name];
      vi.spyOn(app, name).mockImplementation(function (...args) {
        trace.push(name);
        return original.apply(this, args);
      });
    }
    await app.init();
    app.switchPage('page_autopilot');
    trace.length = 0;
    app.toggleEditMode(true);
    const widget = app.activeWidgetInstances[0];
    expect(widget).toBeDefined();
    widget.element.setPointerCapture = vi.fn();
    widget.element.hasPointerCapture = vi.fn(() => true);
    widget.element.releasePointerCapture = vi.fn();
    widget.element.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 7, clientX: 40, clientY: 40,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 55, clientY: 45 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 55, clientY: 45 }));
    expect(app.draggedWidget).toBeNull();
    expect(widget.element.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(app.historyStack).toHaveLength(2);
    await app.handleSaveLayout();
    expect(app.activeProfile.parentProfileId).toBe('default_ga');
    expect(app.isEditMode).toBe(false);
    app.switchPage('page_lights');
    expect(app.activePageId).toBe('page_lights');
    app.handleOrientationChange('portrait', true);
    const current = app.activeProfile;
    app.eventBus.publish('USER_PRESETS_SYNCED', { stats: { total: 1 } });
    await vi.waitFor(() => expect(document.getElementById('fd-global-toast')?.textContent)
      .toBe('PC Sync: Loaded 1 custom preset/widget to cache'));
    expect(app.activeProfile.id).toBe(current.id);
    expect(trace).toEqual(expect.arrayContaining([
      'toggleEditMode', 'saveHistorySnapshot', 'handleSaveLayout',
      'ensureEditableProfile', 'forkFromDefault', 'switchPage',
      'handleOrientationChange', 'renderActivePage', 'activateProfile',
    ]));
    expect(trace.indexOf('handleSaveLayout')).toBeLessThan(trace.indexOf('forkFromDefault'));
    expect(trace.lastIndexOf('switchPage')).toBeLessThan(trace.indexOf('handleOrientationChange'));
  });
});
