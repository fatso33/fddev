// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness } from './fixtures/appHarness.js';
import { WidgetRegistry } from '../js/widgets/WidgetRegistry.js';
import { WakeLockManager } from '../js/core/WakeLockManager.js';

let harness;
beforeEach(async () => { harness = await createAppHarness(); });
afterEach(() => harness.cleanup());

function app() { return new harness.FlightDeckApp(); }
function handler(instance, topic) { return [...instance.eventBus.topics.get(topic)][0]; }
const topics = [
  'BRIDGE_STATUS', 'SIM_STATUS', 'BINDING_PROFILE_CHANGED', 'PENDING_MAPPINGS_UPDATED',
  'SIM_EVENT_DISPATCH_FAILED', 'SIMVAR_BINDING_ERROR', 'OPEN_PROPERTY_INSPECTOR',
  'REMOVE_WIDGET', 'VYOKE_REQUEST_CENTER', 'VYOKE_REQUEST_TOGGLE_ATTACH',
  'USER_PRESETS_SYNCED', 'WIDGET_CONFIG_CHANGED',
];

describe('FlightDeckApp UI wiring', () => {
  it('wires live menu, static navigation, one edit item, theme, wake lock and fullscreen', () => {
    const instance = app();
    const navigate = vi.spyOn(instance, 'switchPage').mockImplementation(() => {});
    const edit = vi.spyOn(instance, 'toggleEditMode').mockImplementation(() => {});
    const render = vi.spyOn(instance, 'renderActivePage').mockImplementation(() => {});
    const toast = vi.spyOn(instance, 'showToast').mockImplementation(() => {});
    const acquire = vi.spyOn(WakeLockManager.prototype, 'acquire').mockResolvedValue();
    const bindWake = vi.spyOn(WakeLockManager.prototype, 'bindToggle');
    const dropdown = document.getElementById('menu-dropdown');
    instance.initHeaderControls();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.getElementById('theme-toggle-checkbox').checked).toBe(true);
    const item = document.getElementById('menu-edit-mode-btn');
    expect(item.nextElementSibling.dataset.page).toBe('settings');
    instance.initHeaderControls();
    expect(document.querySelectorAll('#menu-edit-mode-btn')).toHaveLength(1);
    dropdown.classList.add('open');
    document.querySelector('[data-page="lights"]').click();
    expect(navigate).toHaveBeenCalledWith('page_lights');
    expect(dropdown.classList.contains('open')).toBe(false);
    dropdown.classList.add('open');
    item.click();
    expect(edit).toHaveBeenCalledWith(true);
    instance.menuToggleWidget = { element: document.createElement('div') };
    dropdown.classList.add('open');
    instance.menuToggleWidget.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dropdown.classList.contains('open')).toBe(true);
    instance.menuToggleWidget = { element: document.createElement('div') };
    document.body.click();
    expect(dropdown.classList.contains('open')).toBe(false);
    const theme = document.getElementById('theme-toggle-checkbox');
    theme.checked = false;
    theme.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('flightdeck_theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(render).toHaveBeenCalled();
    expect(instance.wakeLock).toBeTruthy();
    expect(bindWake).toHaveBeenCalledWith(document.getElementById('wakelock-toggle-checkbox'));
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(instance.fullscreen._checkbox).toBe(document.getElementById('fullscreen-toggle-checkbox'));
    instance.fullscreen.onEnter();
    expect(toast).toHaveBeenCalledWith('Fullscreen on — use the Fullscreen toggle in the menu to show the status bar again.');
  });

  it('inserts the edit item before the divider when Settings is absent', () => {
    document.querySelector('.menu-item-btn[data-page="settings"]').remove();
    const instance = app();
    instance.initHeaderControls();
    expect(document.getElementById('menu-edit-mode-btn').nextElementSibling.classList.contains('menu-divider')).toBe(true);
  });

  it('constructs and mounts UI in order; callbacks use live state and profile change order', async () => {
    const instance = app();
    const calls = [];
    const appEl = document.getElementById('app');
    for (const name of ['editToolbar', 'widgetDrawer', 'propertyInspector', 'buttonConfigPopover', 'profileSelector', 'rotatePrompt']) {
      Object.defineProperty(instance, name, { configurable: true, set(value) {
        calls.push(`construct:${name}`);
        Object.defineProperty(instance, name, { configurable: true, writable: true, value });
        vi.spyOn(value, 'mount').mockImplementation(() => calls.push(`mount:${name}`));
      } });
    }
    instance.initUIComponents();
    expect(calls).toEqual([
      'construct:editToolbar', 'mount:editToolbar', 'construct:widgetDrawer', 'mount:widgetDrawer',
      'construct:propertyInspector', 'mount:propertyInspector',
      'construct:buttonConfigPopover', 'mount:buttonConfigPopover',
      'construct:profileSelector', 'mount:profileSelector', 'construct:rotatePrompt', 'mount:rotatePrompt',
    ]);
    expect(appEl).toBeTruthy();
    const actions = [];
    for (const method of ['handleUndo', 'handleSaveLayout', 'handleCancelEdit', 'handleRevertPageToDefault', 'handleCompactLayout', 'toggleAutoReposition', 'addNewWidgetToPage', 'handleUpdateWidgetConfig', 'removeWidgetFromPage', 'openButtonConfigPopover', 'handleAddCustomPage', 'handleDeleteCustomPage', 'getCustomPages']) {
      vi.spyOn(instance, method).mockImplementation((...args) => { actions.push([method, ...args]); });
    }
    instance.activePageId = 'page_lights';
    instance.currentOrientation = 'landscape';
    instance.autoRepositionEnabled = true;
    instance.editToolbar.onAddWidget();
    instance.editToolbar.onUndo(); instance.editToolbar.onSave(); instance.editToolbar.onCancel();
    instance.editToolbar.onRevertPage(); instance.editToolbar.onCompactLayout(); instance.editToolbar.onToggleAutoReposition();
    instance.widgetDrawer.onSelectWidget('foo');
    instance.propertyInspector.onSaveConfig('id', { config: {} });
    instance.propertyInspector.onRemoveWidget('id');
    instance.propertyInspector.onConfigureButton('id');
    instance.buttonConfigPopover.onSaveConfig('id', { layout: {} });
    instance.buttonConfigPopover.onCancelAdd();
    instance.settingsView.onAddPage(); instance.settingsView.onDeletePage('custom'); instance.settingsView.getCustomPages();
    expect(actions).toEqual([
      ['handleUndo'], ['handleSaveLayout'], ['handleCancelEdit'], ['handleRevertPageToDefault', 'page_lights'],
      ['handleCompactLayout'], ['toggleAutoReposition', false], ['addNewWidgetToPage', 'foo'],
      ['handleUpdateWidgetConfig', 'id', { config: {} }, 'landscape'], ['removeWidgetFromPage', 'id', 'landscape'],
      ['openButtonConfigPopover', 'id', 'edit'], ['handleUpdateWidgetConfig', 'id', { layout: {} }, 'landscape'],
      ['handleUndo'], ['handleAddCustomPage'], ['handleDeleteCustomPage', 'custom'], ['getCustomPages'],
    ]);
    const refresh = vi.spyOn(instance.settingsView, 'refreshInstallCard').mockImplementation(() => {});
    instance.pwaInstall.onStateChange();
    expect(refresh).not.toHaveBeenCalled();
    instance.activePageId = 'page_settings'; instance.pwaInstall.onStateChange();
    expect(refresh).toHaveBeenCalledOnce();
    vi.spyOn(instance.storage, 'getProfile').mockResolvedValue({ id: 'new' });
    vi.spyOn(instance, 'activateProfile').mockImplementation(async () => { calls.push('activate'); return { name: 'Custom' }; });
    instance.appProfileWidget = { setLabel: (value) => calls.push(`label:${value}`) };
    vi.spyOn(instance, 'renderPageMenu').mockImplementation(() => calls.push('menu'));
    vi.spyOn(instance, 'renderActivePage').mockImplementation(() => calls.push('render'));
    await instance.profileSelector.onProfileChanged('new');
    expect(instance.storage.getProfile).toHaveBeenCalledWith('new');
    expect(calls.slice(-4)).toEqual(['activate', 'label:CUSTOM', 'menu', 'render']);
  });

  it('initializes flags before twelve ordered subscriptions and routes status, errors and widget actions', () => {
    const instance = app();
    const order = [];
    const subscribe = instance.eventBus.subscribe.bind(instance.eventBus);
    vi.spyOn(instance.eventBus, 'subscribe').mockImplementation((topic, cb) => {
      order.push([topic, instance.bridgeConnected, instance.simConnected]); return subscribe(topic, cb);
    });
    instance.initEventSubscriptions();
    expect(order).toEqual(topics.map((topic) => [topic, false, false]));
    const status = vi.spyOn(instance, 'updateMenuButtonStatus').mockImplementation(() => {});
    const toast = vi.spyOn(instance, 'showToast').mockImplementation(() => {});
    handler(instance, 'BRIDGE_STATUS')({ connected: true });
    handler(instance, 'SIM_STATUS')({ connected: true });
    expect([instance.bridgeConnected, instance.simConnected, status.mock.calls.length]).toEqual([true, true, 2]);
    handler(instance, 'BINDING_PROFILE_CHANGED')({ name: 'Aircraft' });
    expect(document.getElementById('menu-binding-profile-name').textContent).toBe('Aircraft');
    handler(instance, 'PENDING_MAPPINGS_UPDATED')({ pending: [{}, {}] });
    expect(document.getElementById('menu-binding-pending-count').textContent).toBe('2');
    expect(document.getElementById('menu-binding-pending-row').classList.contains('hidden')).toBe(false);
    handler(instance, 'PENDING_MAPPINGS_UPDATED')({ pending: null });
    expect(document.getElementById('menu-binding-pending-row').classList.contains('hidden')).toBe(true);
    handler(instance, 'SIM_EVENT_DISPATCH_FAILED')({ event: 'GEAR' });
    handler(instance, 'SIMVAR_BINDING_ERROR')({ simVar: 'A:ALT' });
    expect(toast.mock.calls.map(([s]) => s)).toEqual([
      '"GEAR" didn\'t fire — check its mapping in PC Bridge.',
      '"A:ALT" is misconfigured — check its unit/name in PC Bridge (Aircraft Profile settings).',
    ]);
    instance.activeWidgetInstances = [{ id: 'target' }];
    instance.currentOrientation = 'landscape'; instance.currentDeviceTier = 'tablet';
    instance.propertyInspector = { inspect: vi.fn() };
    handler(instance, 'OPEN_PROPERTY_INSPECTOR')({ widgetId: 'target' });
    expect(instance.propertyInspector.inspect).toHaveBeenCalledWith(instance.activeWidgetInstances[0], 'landscape', 'tablet');
    const remove = vi.spyOn(instance, 'removeWidgetFromPage').mockImplementation(() => {});
    handler(instance, 'REMOVE_WIDGET')({ widgetId: 'target' });
    expect(remove).toHaveBeenCalledWith('target', 'landscape');
  });

  it('routes yoke requests with exact permission messages and preset sync with render gate', async () => {
    const instance = app(); instance.initEventSubscriptions();
    const toast = vi.spyOn(instance, 'showToast').mockImplementation(() => {});
    vi.spyOn(instance.virtualYoke, 'center').mockResolvedValue(false);
    for (const [state, message] of [
      ['insecure-context', 'Virtual Yoke needs a secure connection (HTTPS, or http://localhost) — motion sensors are blocked on a plain http:// LAN address like this one.'],
      ['unsupported', 'This browser does not support motion/orientation sensors.'],
      ['denied', 'Motion access denied — enable motion/orientation access for this site in your browser settings to use the Virtual Yoke.'],
    ]) {
      instance.virtualYoke.permissionState = state;
      await handler(instance, 'VYOKE_REQUEST_CENTER')();
      expect(toast).toHaveBeenLastCalledWith(message);
    }
    const attach = vi.spyOn(instance.virtualYoke, 'toggleAttach').mockImplementation(() => {});
    handler(instance, 'VYOKE_REQUEST_TOGGLE_ATTACH')(); expect(attach).toHaveBeenCalledOnce();
    const definitions = vi.spyOn(WidgetRegistry, 'loadInstalledDefinitions').mockResolvedValue();
    instance.widgetDrawer = { populateCatalog: vi.fn() };
    instance.profileSelector = { refreshList: vi.fn() };
    instance.appProfileWidget = { setLabel: vi.fn() };
    vi.spyOn(instance.storage, 'getActiveProfileId').mockResolvedValue('custom');
    vi.spyOn(instance.storage, 'getProfile').mockResolvedValue({ id: 'custom' });
    vi.spyOn(instance, 'activateProfile').mockResolvedValue({ name: 'Custom' });
    const menu = vi.spyOn(instance, 'renderPageMenu').mockImplementation(() => {});
    const render = vi.spyOn(instance, 'renderActivePage').mockImplementation(() => {});
    await handler(instance, 'USER_PRESETS_SYNCED')({ stats: { total: 1 } });
    expect(definitions).toHaveBeenCalledWith(instance.storage);
    expect(instance.widgetDrawer.populateCatalog).toHaveBeenCalledOnce();
    expect(instance.profileSelector.refreshList).toHaveBeenCalledOnce();
    expect(instance.appProfileWidget.setLabel).toHaveBeenCalledWith('CUSTOM');
    expect(menu).toHaveBeenCalledOnce(); expect(render).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenLastCalledWith('PC Sync: Loaded 1 custom preset/widget to cache');
    instance.activePageId = 'page_settings';
    await handler(instance, 'USER_PRESETS_SYNCED')({ stats: { total: 2 } });
    expect(render).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenLastCalledWith('PC Sync: Loaded 2 custom presets/widgets to cache');
    instance.activePageId = 'page_lights'; instance.isEditMode = true;
    await handler(instance, 'USER_PRESETS_SYNCED')({ stats: null });
    expect(render).toHaveBeenCalledOnce();
  });

  it('writes config in both tiers and orientations, promotes inherited pages, and honors session persistence', async () => {
    const instance = app(); instance.initEventSubscriptions();
    const page = { id: 'page_lights', updateWidget: vi.fn() };
    instance.activePageId = page.id;
    instance.activeProfile = {
      parentProfileId: 'default', getPage: () => page, hasOwnPage: () => false,
      promoteToOwnPage: vi.fn(), toJSON: () => ({ id: 'custom' }),
    };
    const save = vi.spyOn(instance.storage, 'saveProfile').mockResolvedValue();
    const config = { value: 12 };
    await handler(instance, 'WIDGET_CONFIG_CHANGED')({ widgetId: 'w', config, sessionOnly: true });
    expect(page.updateWidget.mock.calls).toEqual([
      ['w', { config }, 'portrait', false, 'mobile'], ['w', { config }, 'landscape', false, 'mobile'],
      ['w', { config }, 'portrait', false, 'tablet'], ['w', { config }, 'landscape', false, 'tablet'],
    ]);
    expect(instance.activeProfile.promoteToOwnPage).toHaveBeenCalledWith(page.id);
    expect(save).not.toHaveBeenCalled();
    await handler(instance, 'WIDGET_CONFIG_CHANGED')({ widgetId: 'w', config });
    expect(save).toHaveBeenCalledWith({ id: 'custom' }, false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    save.mockRejectedValueOnce(new Error('disk'));
    await handler(instance, 'WIDGET_CONFIG_CHANGED')({ widgetId: 'w', config });
    expect(warn).toHaveBeenCalledWith('[FlightDeck] Failed to persist updated widget config:', expect.any(Error));
  });

  it('guards menu status before mount, reuses the toast with a reset timer and guards orientation APIs', async () => {
    const instance = app();
    expect(instance.updateMenuButtonStatus()).toBeUndefined();
    instance.menuToggleWidget = { setConnectionStatus: vi.fn() };
    instance.bridgeConnected = true; instance.simConnected = false;
    instance.updateMenuButtonStatus();
    expect(instance.menuToggleWidget.setConnectionStatus).toHaveBeenCalledWith({ bridgeConnected: true, simConnected: false });
    vi.useFakeTimers();
    try {
      instance.showToast('first');
      const toast = document.getElementById('fd-global-toast');
      vi.advanceTimersByTime(2000);
      instance.showToast('second');
      expect(document.querySelectorAll('#fd-global-toast')).toHaveLength(1);
      expect(toast.textContent).toBe('second');
      vi.advanceTimersByTime(3499); expect(toast.classList.contains('visible')).toBe(true);
      vi.advanceTimersByTime(1); expect(toast.classList.contains('visible')).toBe(false);
    } finally { vi.useRealTimers(); }
    const lock = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(screen, 'orientation', { configurable: true, value: { lock, unlock: vi.fn() } });
    expect(instance.tryLockOrientation('landscape')).toBeUndefined();
    await Promise.resolve();
    expect(lock).toHaveBeenCalledWith('landscape');
    instance.tryUnlockOrientation();
    expect(screen.orientation.unlock).toHaveBeenCalledOnce();
    screen.orientation.unlock.mockImplementation(() => { throw new Error('unsupported'); });
    expect(instance.tryUnlockOrientation()).toBeUndefined();
  });
});
