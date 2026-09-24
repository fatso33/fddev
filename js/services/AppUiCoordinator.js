/**
 * @module AppUiCoordinator
 * Wires app-level controls, UI components, event subscriptions, notifications,
 * and best-effort orientation requests. FlightDeckApp retains the live state;
 * existing platform managers retain wake-lock and fullscreen ownership. This
 * coordinator holds only the app reference. The reusable toast and its timer
 * remain on the app. Header listeners and EventBus subscriptions are attached
 * during init without a separate teardown API.
 */

import { WakeLockManager } from '../core/WakeLockManager.js';
import { FullscreenManager } from '../core/FullscreenManager.js';
import { EditToolbar } from '../ui/EditToolbar.js';
import { WidgetDrawer } from '../ui/WidgetDrawer.js';
import { PropertyInspector } from '../ui/PropertyInspector.js';
import { ButtonConfigPopover } from '../ui/ButtonConfigPopover.js';
import { ProfileSelector } from '../ui/ProfileSelector.js';
import { SettingsView } from '../ui/SettingsView.js';
import { RotatePrompt } from '../ui/RotatePrompt.js';
import { WidgetRegistry } from '../widgets/WidgetRegistry.js';

/** Coordinates UI callbacks against the live FlightDeckApp facade and state. */
export class AppUiCoordinator {
  /** @param {import('../app.js').FlightDeckApp} app - The live app context. */
  constructor(app) { this.app = app; }

  /** Binds header controls and creates wake-lock/fullscreen managers on the app. */
  initHeaderControls() {
    // Menu button click and App Profile badge long-press are wired per
    // renderActivePage() call instead (see wireCornerInteractions()), since
    // both corner widgets are destroyed and recreated on every render.
    const menuDropdown = document.getElementById('menu-dropdown');
    if (menuDropdown) {
      // Outside-click closes the nav dropdown. Attaching this document-level
      // listener here avoids accumulation across renderActivePage() calls.
      // Read app.menuToggleWidget at click time rather than capturing it, since the instance is
      // replaced on every render.
      document.addEventListener('click', (e) => {
        const menuBtn = this.app.menuToggleWidget?.element;
        if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
          menuDropdown.classList.remove('open');
        }
      });

      // Menu navigation buttons
      for (const btn of menuDropdown.querySelectorAll('.menu-item-btn[data-page]')) {
        btn.addEventListener('click', () => {
          const pageKey = btn.dataset.page;
          const targetPageId = `page_${pageKey}`;
          this.app.switchPage(targetPageId);
          menuDropdown.classList.remove('open');
        });
      }

      // Edit Mode Toggle Button inside Menu
      let editModeMenuItem = document.getElementById('menu-edit-mode-btn');
      if (!editModeMenuItem) {
        editModeMenuItem = document.createElement('button');
        editModeMenuItem.id = 'menu-edit-mode-btn';
        editModeMenuItem.className = 'menu-item-btn';
        editModeMenuItem.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
          </svg>
          Customize Dashboard
        `;
        editModeMenuItem.addEventListener('click', () => {
          this.app.toggleEditMode(true);
          menuDropdown.classList.remove('open');
        });
        // Inserted directly above Settings (not just before the divider) so
        // it stays above Settings even once custom pages are injected
        // between Virtual Yoke and Settings by renderPageMenu().
        const settingsBtnForEditItem = menuDropdown.querySelector('.menu-item-btn[data-page="settings"]');
        menuDropdown.insertBefore(editModeMenuItem, settingsBtnForEditItem || menuDropdown.querySelector('.menu-divider'));
      }
    }

    // Theme Toggle (Dark theme is ON by default)
    const themeCheckbox = document.getElementById('theme-toggle-checkbox');
    const savedTheme = localStorage.getItem('flightdeck_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (themeCheckbox) {
      themeCheckbox.checked = savedTheme === 'dark';
      themeCheckbox.addEventListener('change', () => {
        const theme = themeCheckbox.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('flightdeck_theme', theme);
        // Custom widget colors are literal hex resolved once per component by
        // BaseComponent.applyStyles() (via CompositeWidget.getPreviewTheme()) —
        // unlike the app chrome's CSS custom properties, they don't react to the
        // [data-theme] attribute changing on their own, so every mounted widget
        // needs a fresh render pass to re-resolve its colors for the new theme.
        this.app.renderActivePage();
      });
    }

    // Keep Screen Awake (Screen Wake Lock API) — on by default
    this.app.wakeLock = new WakeLockManager();
    this.app.wakeLock.bindToggle(document.getElementById('wakelock-toggle-checkbox'));
    this.app.wakeLock.acquire();

    this.app.fullscreen = new FullscreenManager({
      // Android shows its own "press Back to exit full screen" system
      // toast on entering fullscreen, which can't be edited or suppressed
      // from the page and is wrong here (nothing in the app maps to a
      // Back action) -- this toast follows right after it with the actual
      // instructions, rather than trying to fight the OS's own message.
      onEnter: () => this.app.showToast('Fullscreen on — use the Fullscreen toggle in the menu to show the status bar again.')
    });
    this.app.fullscreen.bindToggle(document.getElementById('fullscreen-toggle-checkbox'));
  }

  /** Constructs and mounts UI controls in their startup order with live callbacks. */
  initUIComponents() {
    const appEl = document.getElementById('app');

    // 1. Edit Toolbar for interactive edit mode
    this.app.editToolbar = new EditToolbar({
      eventBus: this.app.eventBus,
      onAddWidget: () => this.app.widgetDrawer.open(),
      onUndo: () => this.app.handleUndo(),
      onSave: () => this.app.handleSaveLayout(),
      onCancel: () => this.app.handleCancelEdit(),
      onRevertPage: () => this.app.handleRevertPageToDefault(this.app.activePageId),
      onCompactLayout: () => this.app.handleCompactLayout(),
      onToggleAutoReposition: () => this.app.toggleAutoReposition(!this.app.autoRepositionEnabled),
      autoRepositionEnabled: this.app.autoRepositionEnabled
    });
    this.app.editToolbar.mount(appEl);
    this.app.editToolbar.setOrientation(this.app.currentOrientation);

    // 2. Widget Drawer
    this.app.widgetDrawer = new WidgetDrawer({
      onSelectWidget: (type) => this.app.addNewWidgetToPage(type),
      storageManager: this.app.storage,
      eventBus: this.app.eventBus
    });
    this.app.widgetDrawer.mount(appEl);

    // 3. Property Inspector
    this.app.propertyInspector = new PropertyInspector({
      eventBus: this.app.eventBus,
      storageManager: this.app.storage,
      // The bindings list resolves, probes and fires against the live
      // bridge, so the inspector needs the same connection ProfileSelector has.
      simBridge: this.app.simBridge,
      onSaveConfig: (widgetId, partial) => this.app.handleUpdateWidgetConfig(widgetId, partial, this.app.currentOrientation),
      onRemoveWidget: (widgetId) => this.app.removeWidgetFromPage(widgetId, this.app.currentOrientation),
      onConfigureButton: (widgetId) => this.app.openButtonConfigPopover(widgetId, 'edit')
    });
    this.app.propertyInspector.mount(appEl);

    // 3b. Button Config Popover (built-in configurable button widget)
    this.app.buttonConfigPopover = new ButtonConfigPopover({
      storageManager: this.app.storage,
      onSaveConfig: (widgetId, partial) => this.app.handleUpdateWidgetConfig(widgetId, partial, this.app.currentOrientation),
      onCancelAdd: () => this.app.handleUndo()
    });
    this.app.buttonConfigPopover.mount(appEl);

    // 4. Profile Selector
    this.app.profileSelector = new ProfileSelector({
      storageManager: this.app.storage,
      simBridge: this.app.simBridge,
      onProfileChanged: async (newProfileId) => {
        const raw = await this.app.storage.getProfile(newProfileId);
        this.app.activeProfile = await this.app.activateProfile(raw);
        if (this.app.appProfileWidget) {
          this.app.appProfileWidget.setLabel(this.app.activeProfile.name.toUpperCase().slice(0, 7));
        }
        this.app.renderPageMenu();
        this.app.renderActivePage();
      }
    });
    this.app.profileSelector.mount(appEl);

    // 5. Static Settings View
    this.app.settingsView = new SettingsView({
      eventBus: this.app.eventBus,
      simBridge: this.app.simBridge,
      virtualYoke: this.app.virtualYoke,
      pwaInstall: this.app.pwaInstall,
      onAddPage: () => this.app.handleAddCustomPage(),
      onDeletePage: (pageId) => this.app.handleDeleteCustomPage(pageId),
      getCustomPages: () => this.app.getCustomPages()
    });
    this.app.pwaInstall.onStateChange = () => {
      if (this.app.activePageId === 'page_settings') this.app.settingsView.refreshInstallCard();
    };

    // 6. Rotate-Device Prompt (shown for orientationLock: 'landscape' pages
    // while the device is still in portrait — currently only page_yoke)
    this.app.rotatePrompt = new RotatePrompt();
    this.app.rotatePrompt.mount(appEl);
  }

  /** Registers twelve app-level EventBus handlers in their startup order. */
  initEventSubscriptions() {
    // Connection status is folded into the menu button itself (see
    // main.css's .garmin-menu-btn.bridge-connected/.sim-connected) rather
    // than shown as separate indicator dots -- sim-connected implies
    // bridge-connected, so it takes priority (magenta over cyan) whenever
    // both are true. Tracked as flags since either event can fire alone.
    this.app.bridgeConnected = false;
    this.app.simConnected = false;

    this.app.eventBus.subscribe('BRIDGE_STATUS', ({ connected }) => {
      this.app.bridgeConnected = connected;
      this.app.updateMenuButtonStatus();
    });

    this.app.eventBus.subscribe('SIM_STATUS', ({ connected }) => {
      this.app.simConnected = connected;
      this.app.updateMenuButtonStatus();
    });

    // The PC Bridge Binding Profile is distinct from the app's page-layout
    // profile, shown on the corner badge; render its name in the nav menu.
    this.app.eventBus.subscribe('BINDING_PROFILE_CHANGED', ({ name }) => {
      const el = document.getElementById('menu-binding-profile-name');
      if (el) el.textContent = name || '—';
    });

    // Unmapped/auto-discovered bindings across all profiles are
    // requested once on every connect (SimBridge.js's onopen) since the
    // one-shot PENDING_MAPPINGS_UPDATED broadcast fires only at widget-install
    // time, which the phone is almost never connected for.
    this.app.eventBus.subscribe('PENDING_MAPPINGS_UPDATED', ({ pending }) => {
      const row = document.getElementById('menu-binding-pending-row');
      const countEl = document.getElementById('menu-binding-pending-count');
      if (!row || !countEl) return;
      const count = Array.isArray(pending) ? pending.length : 0;
      countEl.textContent = count;
      row.classList.toggle('hidden', count === 0);
    });

    // Binding failures follow a button press or broken read binding, so a
    // transient toast gives immediate feedback. Mapping repair is done in
    // PC Bridge.
    this.app.eventBus.subscribe('SIM_EVENT_DISPATCH_FAILED', ({ event, reason }) => {
      this.app.showToast(`"${event}" didn't fire — ${reason || 'check its mapping in PC Bridge.'}`);
    });
    this.app.eventBus.subscribe('SIMVAR_BINDING_ERROR', ({ logicalName, simVar }) => {
      this.app.showToast(`"${logicalName || simVar}" is misconfigured — check its unit/name in PC Bridge (Aircraft Profile settings).`);
    });

    // Inspector open trigger
    this.app.eventBus.subscribe('OPEN_PROPERTY_INSPECTOR', ({ widgetId }) => {
      const widget = this.app.activeWidgetInstances.find((w) => w.id === widgetId);
      if (widget) {
        this.app.propertyInspector.inspect(widget, this.app.currentOrientation, this.app.currentDeviceTier);
      }
    });

    // Widget remove trigger
    this.app.eventBus.subscribe('REMOVE_WIDGET', ({ widgetId }) => {
      this.app.removeWidgetFromPage(widgetId, this.app.currentOrientation);
    });

    // Virtual Yoke control requests from VirtualYokeCenterWidget /
    // VirtualYokeDetachWidget — routed through the app rather than handled
    // by the widgets directly so the engine's sensor state survives layout
    // edits (widget mount/unmount) untouched. See VirtualYokeEngine.js.
    this.app.eventBus.subscribe('VYOKE_REQUEST_CENTER', async () => {
      const granted = await this.app.virtualYoke.center();
      if (!granted) {
        const state = this.app.virtualYoke.permissionState;
        if (state === 'insecure-context') {
          this.app.showToast('Virtual Yoke needs a secure connection (HTTPS, or http://localhost) — motion sensors are blocked on a plain http:// LAN address like this one.');
        } else if (state === 'unsupported') {
          this.app.showToast('This browser does not support motion/orientation sensors.');
        } else {
          this.app.showToast('Motion access denied — enable motion/orientation access for this site in your browser settings to use the Virtual Yoke.');
        }
      }
    });
    this.app.eventBus.subscribe('VYOKE_REQUEST_TOGGLE_ATTACH', () => {
      this.app.virtualYoke.toggleAttach();
    });

    // PC Bridge Preset & Widget Persistence Synchronization
    this.app.eventBus.subscribe('USER_PRESETS_SYNCED', async ({ stats }) => {
      console.log('[FlightDeck Sync] Synchronized non-default assets with PC Bridge:', stats);

      // Re-hydrate dynamic widget catalog from updated cache
      await WidgetRegistry.loadInstalledDefinitions(this.app.storage);

      // Update catalog drawer if open
      if (this.app.widgetDrawer) {
        this.app.widgetDrawer.populateCatalog();
      }

      // Update profile selector list
      if (this.app.profileSelector) {
        this.app.profileSelector.refreshList();
      }

      // If active profile has updated remote changes, reload active profile
      const activeProfId = await this.app.storage.getActiveProfileId();
      const raw = await this.app.storage.getProfile(activeProfId);
      if (raw) {
        this.app.activeProfile = await this.app.activateProfile(raw);
        if (this.app.appProfileWidget) {
          this.app.appProfileWidget.setLabel(this.app.activeProfile.name.toUpperCase().slice(0, 7));
        }
        this.app.renderPageMenu();
        if (this.app.activePageId !== 'page_settings' && !this.app.isEditMode) {
          this.app.renderActivePage();
        }
      }

      if (stats && stats.total > 0) {
        this.app.showToast(`PC Sync: Loaded ${stats.total} custom preset${stats.total > 1 ? 's' : ''}/widget${stats.total > 1 ? 's' : ''} to cache`);
      }
    });

    // Runtime Widget Configuration Changes (Presets, Custom State, etc.)
    this.app.eventBus.subscribe('WIDGET_CONFIG_CHANGED', async ({ widgetId, config, sessionOnly }) => {
      if (!this.app.activeProfile) return;
      const page = this.app.activeProfile.getPage(this.app.activePageId);
      if (page) {
        // Runtime config changes (e.g. radio presets from the PC Bridge)
        // apply to every stored copy of this widget id, across both
        // orientations AND both device tiers -- config values are shared
        // regardless of which layout the widget instance happens to be
        // placed in, unlike position/size which is per-tier. This part
        // happens for both durable and session-only config changes —
        // it's what makes a widget instance destroyed and rebuilt by
        // switchPage() (e.g. navigating away and back within the running
        // app) see the value again, since it lives on this in-memory
        // Page/Profile object, not on the doomed widget instance itself.
        for (const tier of ['mobile', 'tablet']) {
          page.updateWidget(widgetId, { config }, 'portrait', false, tier);
          page.updateWidget(widgetId, { config }, 'landscape', false, tier);
        }
        // If this page is still only inherited from a parent fork (never
        // directly edited), toJSON() would silently drop it -- and this
        // runtime update along with it -- since an inherited page isn't
        // persisted as an override. Promote it now that it actually has a
        // real change to save.
        if (this.app.activeProfile.parentProfileId && !this.app.activeProfile.hasOwnPage(page.id)) {
          this.app.activeProfile.promoteToOwnPage(page.id);
        }
        // Session-only persistence stops here — the in-memory update
        // above already makes it survive a page switch, but it must NOT
        // reach IndexedDB, or it would durably outlive the current app
        // session (the whole point of "session" over plain persist:true).
        // It's gone the next time the app actually reloads this profile
        // from disk, since that copy was never written.
        if (sessionOnly) return;
        try {
          await this.app.storage.saveProfile(this.app.activeProfile.toJSON(), false);
        } catch (err) {
          console.warn('[FlightDeck] Failed to persist updated widget config:', err);
        }
      }
    });
  }

  /** Updates the mounted corner menu status, or no-ops before its first render. */
  updateMenuButtonStatus() {
    // BRIDGE_STATUS/SIM_STATUS can fire before the corner overlay's first
    // renderActivePage() call has mounted the menu widget (simBridge.connect()
    // runs earlier in init()) -- guard rather than assuming it already exists.
    if (!this.app.menuToggleWidget) return;
    this.app.menuToggleWidget.setConnectionStatus({
      bridgeConnected: this.app.bridgeConnected,
      simConnected: this.app.simConnected
    });
  }

  /** Displays a message for 3500 ms, reusing the app's one toast and timer.
   * @param {string} message - Text shown in the toast.
   */
  showToast(message) {
    let toast = document.getElementById('fd-global-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'fd-global-toast';
      toast.className = 'fd-global-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    if (this.app._toastTimer) clearTimeout(this.app._toastTimer);
    this.app._toastTimer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 3500);
  }

  /** Requests a best-effort screen lock; rejects and unsupported APIs are ignored.
   * @param {'landscape'|'portrait'} orientation - Requested screen orientation.
   */
  tryLockOrientation(orientation) {
    try {
      if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.lock === 'function') {
        const result = screen.orientation.lock(orientation);
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
      }
    } catch (_) {
      // Unsupported in this browser/context — RotatePrompt covers it.
    }
  }

  /** Releases a platform orientation lock when available, ignoring unsupported APIs. */
  tryUnlockOrientation() {
    try {
      if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.unlock === 'function') {
        screen.orientation.unlock();
      }
    } catch (_) {}
  }
}
