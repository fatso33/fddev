/**
 * app.js
 * Flight Deck v2.4 Bootstrap & Lifecycle Coordinator
 * Integrates Declarative Dual-Orientation Grid Engine, Hardware Orientation Watcher,
 * Reactive SimData Pipeline & Dynamic PC Bridge Protocol
 */

import { EventBus } from './core/EventBus.js';
import { StorageManager } from './core/StorageManager.js';
import { SimBridge } from './core/SimBridge.js';
import { LayoutEngine } from './core/LayoutEngine.js';
import { VirtualYokeEngine } from './core/VirtualYokeEngine.js';
import { WakeLockManager } from './core/WakeLockManager.js';
import { FullscreenManager } from './core/FullscreenManager.js';
import { PwaInstallManager } from './core/PwaInstallManager.js';
import { WidgetRegistry } from './widgets/WidgetRegistry.js';
import { BaseWidget } from './widgets/BaseWidget.js';
import { EditToolbar } from './ui/EditToolbar.js';
import { WidgetDrawer } from './ui/WidgetDrawer.js';
import { PropertyInspector } from './ui/PropertyInspector.js';
import { ProfileSelector } from './ui/ProfileSelector.js';
import { SettingsView } from './ui/SettingsView.js';
import { RotatePrompt } from './ui/RotatePrompt.js';
import { Profile } from './models/Profile.js';
import { Page } from './models/Page.js';
import { SecurityValidator } from './core/SecurityValidator.js';

export class FlightDeckApp {
  constructor() {
    this.eventBus = new EventBus();
    this.storage = new StorageManager();
    this.simBridge = new SimBridge(this.eventBus);
    this.layoutEngine = new LayoutEngine({ gridCols: 20, defaultRowHeight: 16, gap: 3 });
    this.virtualYoke = new VirtualYokeEngine(this.eventBus);
    // Constructed here (not later in init()) so the 'beforeinstallprompt'
    // listener is attached as early as possible -- Chromium can fire it
    // before the rest of app init has finished.
    this.pwaInstall = new PwaInstallManager();

    this.activeProfile = null;
    this.activePageId = 'page_radios';
    this.activeWidgetInstances = [];
    this.currentOrientation = this.layoutEngine.getOrientation();

    this.isEditMode = false;
    this.draggedWidget = null;
    this.dragStartLayout = null;
    this.dragStartPointer = null;

    // Undo/Redo history stack for edit mode
    this.historyStack = [];

    // UI Modules
    this.editToolbar = null;
    this.widgetDrawer = null;
    this.propertyInspector = null;
    this.profileSelector = null;
    this.rotatePrompt = null;

    // Corner widgets (menu toggle + App Profile badge) -- fixed,
    // non-draggable, non-removable fixtures floated over the real page
    // grid's top-left/top-right cells (see .fd-corner-overlay,
    // mountCornerWidgets()). Destroyed and recreated on every
    // renderActivePage() call, all branches -- see that method -- so these
    // fields are reassigned every render, not set once at startup.
    this.cornerWidgetInstances = [];
    this.menuToggleWidget = null;
    this.appProfileWidget = null;
    this.editToolbarVisible = true;

    this.contentArea = document.getElementById('content-area');
    this.gridContainer = null;
    this.orientationUnsub = null;
  }

  async init() {
    console.log('[FlightDeck v2.4] Initializing dual-orientation companion engine...');

    // 1. Initialize Storage & load active profile
    await this.storage.init();
    this.simBridge.setStorageManager(this.storage);
    this.storage.setSimBridge(this.simBridge);
    await WidgetRegistry.loadInstalledDefinitions(this.storage);
    const activeProfId = await this.storage.getActiveProfileId();
    let rawProfile = await this.storage.getProfile(activeProfId);
    if (!rawProfile) {
      const all = await this.storage.getAllProfiles();
      rawProfile = all[0];
    }
    this.activeProfile = await this.activateProfile(rawProfile);

    // 2. Initialize SimBridge connection
    this.simBridge.connect();

    // 3. Initialize Top Global Controls & Theme
    this.initHeaderControls();

    // 4. Initialize UI Toolbars & Modals
    this.initUIComponents();

    // 5. Subscribe to EventBus core topics
    this.initEventSubscriptions();

    // 6. Preload and compile shared widget stylesheets into memory for zero-FOUC rendering
    await BaseWidget.preloadStyles();

    // 7. Mount hardware orientation listener & resize watcher
    this.orientationUnsub = this.layoutEngine.initOrientationWatcher((newOrientation, isResize) => {
      this.handleOrientationChange(newOrientation, isResize);
    });

    // 8. Mount and render current active page -- this also builds the
    // corner overlay (menu toggle + App Profile badge) on every branch, see
    // renderActivePage()/mountCornerWidgets().
    this.renderPageMenu();
    this.renderActivePage();

    // 9. Register Service Worker
    this.initServiceWorker();
  }

  handleOrientationChange(newOrientation, isResize = false) {
    this.currentOrientation = newOrientation;
    if (this.editToolbar) {
      this.editToolbar.setOrientation(newOrientation);
    }

    if (this.activePageId === 'page_settings') {
      return;
    }

    this.renderActivePage();
  }

  initHeaderControls() {
    // Menu button click and App Profile badge long-press are wired per
    // renderActivePage() call instead (see wireCornerInteractions()), since
    // both corner widgets are destroyed and recreated on every render, not
    // created once here the way the old static index.html elements were.
    const menuDropdown = document.getElementById('menu-dropdown');
    if (menuDropdown) {
      // Outside-click closes the nav dropdown -- attached once here (NOT
      // inside wireCornerInteractions(), which reruns every render; a
      // document-level listener attached there would accumulate forever
      // across renderActivePage() calls). Reads this.menuToggleWidget live
      // at click time rather than capturing it, since that instance is
      // replaced on every render.
      document.addEventListener('click', (e) => {
        const menuBtn = this.menuToggleWidget?.element;
        if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
          menuDropdown.classList.remove('open');
        }
      });

      // Menu navigation buttons
      menuDropdown.querySelectorAll('.menu-item-btn[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pageKey = btn.dataset.page;
          const targetPageId = `page_${pageKey}`;
          this.switchPage(targetPageId);
          menuDropdown.classList.remove('open');
        });
      });

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
          this.toggleEditMode(true);
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
        this.renderActivePage();
      });
    }

    // Keep Screen Awake (Screen Wake Lock API) — on by default
    this.wakeLock = new WakeLockManager();
    this.wakeLock.bindToggle(document.getElementById('wakelock-toggle-checkbox'));
    this.wakeLock.acquire();

    this.fullscreen = new FullscreenManager({
      // Android shows its own "press Back to exit full screen" system
      // toast on entering fullscreen, which can't be edited or suppressed
      // from the page and is wrong here (nothing in this app maps to a
      // Back action) -- this toast follows right after it with the actual
      // instructions, rather than trying to fight the OS's own message.
      onEnter: () => this.showToast('Fullscreen on — use the Fullscreen toggle in the menu to show the status bar again.')
    });
    this.fullscreen.bindToggle(document.getElementById('fullscreen-toggle-checkbox'));

    // One-time listener (not inside wireCornerInteractions(), which reruns
    // every render) -- fullscreen can be entered/exited without a render
    // happening at all, and the corner widgets need to react either way.
    // See updateFullscreenInset().
    document.addEventListener('fullscreenchange', () => this.updateFullscreenInset());
  }

  initUIComponents() {
    const appEl = document.getElementById('app');

    // 1. Edit Toolbar for interactive edit mode
    this.editToolbar = new EditToolbar({
      eventBus: this.eventBus,
      onAddWidget: () => this.widgetDrawer.open(),
      onUndo: () => this.handleUndo(),
      onSave: () => this.handleSaveLayout(),
      onCancel: () => this.handleCancelEdit(),
      onRevertPage: () => this.handleRevertPageToDefault(this.activePageId),
      onCompactLayout: () => this.handleCompactLayout()
    });
    this.editToolbar.mount(appEl);
    this.editToolbar.setOrientation(this.currentOrientation);

    // 2. Widget Drawer
    this.widgetDrawer = new WidgetDrawer({
      onSelectWidget: (type) => this.addNewWidgetToPage(type),
      storageManager: this.storage,
      eventBus: this.eventBus
    });
    this.widgetDrawer.mount(appEl);

    // 3. Property Inspector
    this.propertyInspector = new PropertyInspector({
      eventBus: this.eventBus,
      storageManager: this.storage,
      onSaveConfig: (widgetId, partial) => this.handleUpdateWidgetConfig(widgetId, partial, this.currentOrientation),
      onRemoveWidget: (widgetId) => this.removeWidgetFromPage(widgetId, this.currentOrientation)
    });
    this.propertyInspector.mount(appEl);

    // 4. Profile Selector
    this.profileSelector = new ProfileSelector({
      storageManager: this.storage,
      simBridge: this.simBridge,
      onProfileChanged: async (newProfileId) => {
        const raw = await this.storage.getProfile(newProfileId);
        this.activeProfile = await this.activateProfile(raw);
        if (this.appProfileWidget) {
          this.appProfileWidget.setLabel(this.activeProfile.name.toUpperCase().slice(0, 7));
        }
        this.renderPageMenu();
        this.renderActivePage();
      }
    });
    this.profileSelector.mount(appEl);

    // 5. Static Settings View
    this.settingsView = new SettingsView({
      eventBus: this.eventBus,
      simBridge: this.simBridge,
      virtualYoke: this.virtualYoke,
      pwaInstall: this.pwaInstall,
      onAddPage: () => this.handleAddCustomPage(),
      onDeletePage: (pageId) => this.handleDeleteCustomPage(pageId),
      getCustomPages: () => this.getCustomPages()
    });
    this.pwaInstall.onStateChange = () => {
      if (this.activePageId === 'page_settings') this.settingsView.refreshInstallCard();
    };

    // 6. Rotate-Device Prompt (shown for orientationLock: 'landscape' pages
    // while the device is still in portrait — currently only page_yoke)
    this.rotatePrompt = new RotatePrompt();
    this.rotatePrompt.mount(appEl);
  }

  initEventSubscriptions() {
    // Connection status is folded into the menu button itself (see
    // main.css's .garmin-menu-btn.bridge-connected/.sim-connected) rather
    // than shown as separate indicator dots -- sim-connected implies
    // bridge-connected, so it takes priority (magenta over cyan) whenever
    // both are true. Tracked as flags since either event can fire alone.
    this.bridgeConnected = false;
    this.simConnected = false;

    this.eventBus.subscribe('BRIDGE_STATUS', ({ connected }) => {
      this.bridgeConnected = connected;
      this.updateMenuButtonStatus();
    });

    this.eventBus.subscribe('SIM_STATUS', ({ connected }) => {
      this.simConnected = connected;
      this.updateMenuButtonStatus();
    });

    // Telemetry updates for profile name
    this.eventBus.subscribe('TELEMETRY_STREAM', (data) => {
      if (data.profile && this.appProfileWidget) {
        this.appProfileWidget.setLabel(data.profile.toUpperCase().slice(0, 7));
      }
    });

    // Inspector open trigger
    this.eventBus.subscribe('OPEN_PROPERTY_INSPECTOR', ({ widgetId }) => {
      const widget = this.activeWidgetInstances.find((w) => w.id === widgetId);
      if (widget) {
        this.propertyInspector.inspect(widget, this.currentOrientation, this.currentDeviceTier);
      }
    });

    // Widget remove trigger
    this.eventBus.subscribe('REMOVE_WIDGET', ({ widgetId }) => {
      this.removeWidgetFromPage(widgetId, this.currentOrientation);
    });

    // Virtual Yoke control requests from VirtualYokeCenterWidget /
    // VirtualYokeDetachWidget — routed through the app rather than handled
    // by the widgets directly so the engine's sensor state survives layout
    // edits (widget mount/unmount) untouched. See VirtualYokeEngine.js.
    this.eventBus.subscribe('VYOKE_REQUEST_CENTER', async () => {
      const granted = await this.virtualYoke.center();
      if (!granted) {
        const state = this.virtualYoke.permissionState;
        if (state === 'insecure-context') {
          this.showToast('Virtual Yoke needs a secure connection (HTTPS, or http://localhost) — motion sensors are blocked on a plain http:// LAN address like this one.');
        } else if (state === 'unsupported') {
          this.showToast('This browser does not support motion/orientation sensors.');
        } else {
          this.showToast('Motion access denied — enable motion/orientation access for this site in your browser settings to use the Virtual Yoke.');
        }
      }
    });
    this.eventBus.subscribe('VYOKE_REQUEST_TOGGLE_ATTACH', () => {
      this.virtualYoke.toggleAttach();
    });

    // PC Bridge Preset & Widget Persistence Synchronization
    this.eventBus.subscribe('USER_PRESETS_SYNCED', async ({ stats }) => {
      console.log('[FlightDeck Sync] Synchronized non-default assets with PC Bridge:', stats);

      // Re-hydrate dynamic widget catalog from updated cache
      await WidgetRegistry.loadInstalledDefinitions(this.storage);

      // Update catalog drawer if open
      if (this.widgetDrawer) {
        this.widgetDrawer.populateCatalog();
      }

      // Update profile selector list
      if (this.profileSelector) {
        this.profileSelector.refreshList();
      }

      // If active profile has updated remote changes, reload active profile
      const activeProfId = await this.storage.getActiveProfileId();
      const raw = await this.storage.getProfile(activeProfId);
      if (raw) {
        this.activeProfile = await this.activateProfile(raw);
        if (this.appProfileWidget) {
          this.appProfileWidget.setLabel(this.activeProfile.name.toUpperCase().slice(0, 7));
        }
        this.renderPageMenu();
        if (this.activePageId !== 'page_settings' && !this.isEditMode) {
          this.renderActivePage();
        }
      }

      if (stats && stats.total > 0) {
        this.showToast(`PC Sync: Loaded ${stats.total} custom preset${stats.total > 1 ? 's' : ''}/widget${stats.total > 1 ? 's' : ''} to cache`);
      }
    });

    // Runtime Widget Configuration Changes (Presets, Custom State, etc.)
    this.eventBus.subscribe('WIDGET_CONFIG_CHANGED', async ({ widgetId, config, sessionOnly }) => {
      if (!this.activeProfile) return;
      const page = this.activeProfile.getPage(this.activePageId);
      if (page) {
        // Runtime config changes (e.g. radio presets from the PC Bridge)
        // apply to every stored copy of this widget id, across both
        // orientations AND both device tiers -- config values are shared
        // regardless of which layout the widget instance happens to be
        // placed in, unlike position/size which is per-tier. This part
        // happens for BOTH persist:true and FDWS v1.22's persist:"session" —
        // it's what makes a widget instance destroyed and rebuilt by
        // switchPage() (e.g. navigating away and back within the running
        // app) see the value again, since it lives on this in-memory
        // Page/Profile object, not on the doomed widget instance itself.
        ['mobile', 'tablet'].forEach((tier) => {
          page.updateWidget(widgetId, { config }, 'portrait', false, tier);
          page.updateWidget(widgetId, { config }, 'landscape', false, tier);
        });
        // If this page is still only inherited from a parent fork (never
        // directly edited), toJSON() would silently drop it -- and this
        // runtime update along with it -- since an inherited page isn't
        // persisted as an override. Promote it now that it actually has a
        // real change to save.
        if (this.activeProfile.parentProfileId && !this.activeProfile.hasOwnPage(page.id)) {
          this.activeProfile.promoteToOwnPage(page.id);
        }
        // FDWS v1.22: persist:"session" stops here — the in-memory update
        // above already makes it survive a page switch, but it must NOT
        // reach IndexedDB, or it would durably outlive the current app
        // session (the whole point of "session" over plain persist:true).
        // It's gone the next time the app actually reloads this profile
        // from disk, since that copy was never written.
        if (sessionOnly) return;
        try {
          await this.storage.saveProfile(this.activeProfile.toJSON(), false);
        } catch (err) {
          console.warn('[FlightDeck] Failed to persist updated widget config:', err);
        }
      }
    });
  }

  updateMenuButtonStatus() {
    // BRIDGE_STATUS/SIM_STATUS can fire before the corner overlay's first
    // renderActivePage() call has mounted the menu widget (simBridge.connect()
    // runs earlier in init()) -- guard rather than assuming it already exists.
    if (!this.menuToggleWidget) return;
    this.menuToggleWidget.setConnectionStatus({
      bridgeConnected: this.bridgeConnected,
      simConnected: this.simConnected
    });
  }

  /**
   * Pushes the current real Fullscreen API state onto both corner widgets
   * as a JS-toggled class (see MenuToggleWidget/AppProfileWidget's
   * setFullscreenInset() for why this can't just be a CSS :fullscreen
   * selector). Called both from mountCornerWidgets() -- since the corner
   * widgets are destroyed/recreated every render and would otherwise lose
   * the class -- and from a one-time 'fullscreenchange' listener (see
   * initHeaderControls()), since fullscreen can toggle without a render
   * happening at all.
   */
  updateFullscreenInset() {
    const active = Boolean(document.fullscreenElement);
    this.menuToggleWidget?.setFullscreenInset(active);
    this.appProfileWidget?.setFullscreenInset(active);
  }

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
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 3500);
  }

  switchPage(pageId) {
    if (this.isEditMode) {
      this.handleCancelEdit();
    }
    this.activePageId = pageId;

    // Update active state in nav dropdown
    const menuDropdown = document.getElementById('menu-dropdown');
    if (menuDropdown) {
      menuDropdown.querySelectorAll('.menu-item-btn[data-page]').forEach((btn) => {
        const key = btn.dataset.page;
        btn.classList.toggle('active', `page_${key}` === pageId);
      });

      // Hide or disable Customize Dashboard option if on Settings page
      const editBtn = document.getElementById('menu-edit-mode-btn');
      if (editBtn) {
        editBtn.style.display = (pageId === 'page_settings') ? 'none' : 'flex';
      }
    }

    this.renderActivePage();
  }

  renderActivePage() {
    const currentWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const currentHeight = typeof window !== 'undefined' ? window.innerHeight : 768;
    const orientation = this.layoutEngine.getOrientation(currentWidth, currentHeight);
    this.currentOrientation = orientation;
    const deviceTier = LayoutEngine.getDeviceTier(currentWidth, currentHeight);
    this.currentDeviceTier = deviceTier;
    if (typeof document !== 'undefined' && document.body) {
      document.body.dataset.deviceTier = deviceTier;
    }

    // Clean up active + corner widget instances
    this.activeWidgetInstances.forEach((w) => w.destroy());
    this.activeWidgetInstances = [];
    this.cornerWidgetInstances.forEach((w) => w.destroy());
    this.cornerWidgetInstances = [];
    this.menuToggleWidget = null;
    this.appProfileWidget = null;

    // Clean up settings view if previously mounted
    if (this.settingsView) {
      this.settingsView.destroy();
    }

    this.contentArea.innerHTML = '';

    // Corner overlay (menu toggle + App Profile badge) -- built as the
    // first child of #content-area on EVERY branch below (Settings,
    // no-page, rotate-prompt, normal), since these two widgets must always
    // be visible and are never stored per-page/profile data (they're
    // destroyed above and rebuilt fresh every render -- cheap, since they
    // carry no bindings/state). Uses the current page's own gridSpec when
    // one resolves (so column math matches the real grid exactly, even if a
    // page ever declares a custom grid), falling back to the tier default
    // for 'page_settings' (no real Page entry) or an as-yet-unresolved page.
    let page = this.activePageId === 'page_settings' ? null : this.activeProfile.getPage(this.activePageId);
    const gridSpecForCorners = (page && page.getGrid(orientation, deviceTier)) || LayoutEngine.getGridSpec(orientation, deviceTier);
    this.mountCornerWidgets(orientation, deviceTier, gridSpecForCorners);

    // If active page is Settings, render the static non-editable Settings View
    if (this.activePageId === 'page_settings') {
      if (this.isEditMode) {
        this.isEditMode = false;
      }
      this.editToolbar.hide();
      this.rotatePrompt.hide();
      this.virtualYoke.stop();
      this.settingsView.mount(this.contentArea);
      return;
    }

    // Get current page (falls back to the profile's first page if the
    // stored activePageId no longer resolves to anything)
    if (!page) {
      page = this.activeProfile.pages[0];
      if (page) this.activePageId = page.id;
    }

    if (!page) {
      this.rotatePrompt.hide();
      this.virtualYoke.stop();
      this.gridContainer = document.createElement('div');
      this.gridContainer.className = 'fd-page-grid';
      this.gridContainer.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 40px 0;">No avionics widgets on this page.</div>`;
      this.contentArea.appendChild(this.gridContainer);
      return;
    }

    // Orientation-lock enforcement (currently only page_yoke declares
    // orientationLock: 'landscape'). screen.orientation.lock() is
    // best-effort — it silently no-ops on iOS Safari and outside standalone
    // display mode — so the rotate-prompt overlay below is the real
    // cross-browser gate: while blocked, the widget grid is never built and
    // the Virtual Yoke engine stays stopped.
    const needsLandscape = page.orientationLock === 'landscape';
    if (needsLandscape) {
      this.tryLockOrientation('landscape');
    } else {
      this.tryUnlockOrientation();
    }

    if (needsLandscape && orientation !== 'landscape') {
      this.editToolbar.hide();
      this.rotatePrompt.show();
      this.virtualYoke.stop();
      return;
    }
    this.rotatePrompt.hide();

    // Create Grid Container for standard widget pages
    this.gridContainer = document.createElement('div');
    this.gridContainer.className = `fd-page-grid ${this.isEditMode ? 'edit-mode-active' : ''}`;
    this.contentArea.appendChild(this.gridContainer);

    const gridSpec = page.getGrid(orientation, deviceTier) || LayoutEngine.getGridSpec(orientation, deviceTier);
    this.layoutEngine.applyGridToContainer(this.gridContainer, gridSpec);

    // Get widgets for the active tier + orientation. Each (tier,
    // orientation) combination is authored independently -- shipped pages
    // and future custom pages are hand-tailored per combination, so an
    // empty combination is rendered as an empty page rather than
    // auto-mirrored from elsewhere. Use the explicit "Mirror Layout"
    // toolbar action to copy a layout across as a one-time starting point.
    const widgets = page.getWidgets(orientation, deviceTier);

    // Normalize (not auto-compact) so old col/row-vs-x/y-only saved data
    // still resolves correctly, without pulling widgets up over a gap the
    // user deliberately left. Use the edit toolbar's explicit "Compact"
    // action to actually close gaps.
    const compacted = this.layoutEngine.normalizeLayout(widgets || []);

    // Saved layouts from before the corner-widget feature existed may have
    // real widgets sitting in row 1-2 cells the menu/App Profile corners now
    // occupy -- push anything overlapping a reserved cell out of the way on
    // every render (see resolveListWithReservedCorners()). Only written back
    // into the live in-memory Profile here, same as normalizeLayout() above
    // -- it isn't durably persisted to storage unless the user enters edit
    // mode and Saves.
    const reservedForReflow = this.getReservedCornerEntries(orientation, deviceTier, gridSpec);
    const finalWidgets = this.resolveListWithReservedCorners(compacted, reservedForReflow);
    page.setWidgets(orientation, deviceTier, finalWidgets);

    // Instantiate and mount all widgets
    finalWidgets.forEach((wConfig) => {
      const widgetInstance = WidgetRegistry.createWidget(wConfig, this.eventBus);
      widgetInstance.mount(this.gridContainer);
      widgetInstance.setEditMode(this.isEditMode);
      this.attachDragHandlers(widgetInstance);
      this.activeWidgetInstances.push(widgetInstance);
    });

    // If edit toolbar is active, keep it visible (unless the user manually
    // hid it via the menu corner widget's pencil toggle -- see
    // toggleEditToolbarVisibility()) and update orientation badge
    if (this.isEditMode) {
      this.editToolbar.setOrientation(orientation);
      if (this.editToolbarVisible) {
        this.editToolbar.show();
      } else {
        this.editToolbar.hide();
      }
    } else {
      this.editToolbar.hide();
    }

    if (this.activePageId === 'page_yoke') {
      this.virtualYoke.start();
    } else {
      this.virtualYoke.stop();
    }
  }

  /**
   * Computes the fixed corner layouts for the menu toggle (top-left, 3x2)
   * and App Profile badge (top-right, 5x2), scaled proportionally from the
   * same 20-col-portrait/44-col-landscape mobile reference every other
   * widget's defaultLayout is authored against -- same declaredForCols
   * scaling addNewWidgetToPage() already uses for ordinary widgets.
   * @param {'portrait'|'landscape'} orientation
   * @param {'mobile'|'tablet'} deviceTier
   * @param {{columns:number}} gridSpec
   */
  getCornerWidgetLayouts(orientation, deviceTier, gridSpec) {
    const declaredForCols = orientation === 'landscape' ? 44 : 20;
    const scale = (declaredW) => Math.max(1, Math.min(gridSpec.columns, Math.round((declaredW / declaredForCols) * gridSpec.columns)));
    const menuW = scale(3);
    const profileW = scale(5);
    return {
      menu: {
        id: '__corner_menu__',
        type: 'MenuToggleWidget',
        layout: { col: 1, row: 1, w: menuW, h: 2 },
        config: { removable: false, appEditMode: this.isEditMode }
      },
      profile: {
        id: '__corner_profile__',
        type: 'AppProfileWidget',
        layout: { col: Math.max(1, gridSpec.columns - profileW + 1), row: 1, w: profileW, h: 2 },
        config: { removable: false, label: this.activeProfile ? this.activeProfile.name.toUpperCase().slice(0, 7) : 'DEFAULT' }
      }
    };
  }

  /**
   * The same two corner positions as getCornerWidgetLayouts(), reduced to
   * the {id, layout} shape LayoutEngine's collision functions already
   * expect -- spliced into a widgetList at every collision-aware call site
   * (addNewWidgetToPage, attachDragHandlers's endDrag,
   * handleUpdateWidgetConfig, handleCompactLayout, handleMirrorLayout) so
   * real widgets are never auto-placed or dragged into a corner cell, then
   * filtered back out before the result is written via page.setWidgets() --
   * this reservation is virtual/computed, never persisted (the corner
   * widgets are app-global, not page content).
   */
  getReservedCornerEntries(orientation, deviceTier, gridSpec) {
    const { menu, profile } = this.getCornerWidgetLayouts(orientation, deviceTier, gridSpec);
    return [
      { id: menu.id, layout: menu.layout },
      { id: profile.id, layout: profile.layout }
    ];
  }

  /**
   * Resolves a widgetList's layout via LayoutEngine.resolveLayoutWithPushDown()
   * as normal (movingId authoritative at targetLayout, colliding real
   * widgets pushed down) and THEN makes one additional pass per reserved
   * corner entry, each time treating that corner as the "moving" widget at
   * its own fixed position -- so real widgets get pushed away from a
   * reserved cell, never the other way around. Calling
   * resolveLayoutWithPushDown() directly with reserved corners simply
   * mixed into the list would do the opposite: since the function always
   * keeps whichever id is passed as movingId exactly at its target and
   * pushes everything else, a real widget passed as movingId would shove
   * the "reserved" corner entries out of the way instead, since they're
   * just ordinary list entries to that function otherwise. Reserved entries
   * are always stripped from the returned list before it's used.
   * @param {string} movingId
   * @param {object} targetLayout
   * @param {Array<object>} widgetList - real widgets only, no reserved entries
   * @param {Array<object>} reserved - from getReservedCornerEntries()
   * @returns {Array<object>} real widgets only, reserved-corner-safe
   */
  resolveWithReservedCorners(movingId, targetLayout, widgetList, reserved) {
    let list = this.layoutEngine.resolveLayoutWithPushDown(movingId, targetLayout, widgetList);
    for (const r of reserved) {
      list = this.layoutEngine.resolveLayoutWithPushDown(r.id, r.layout, [...list, r]);
    }
    return list.filter((w) => !reserved.some((res) => res.id === w.id));
  }

  /**
   * Same idea as resolveWithReservedCorners() but for building a whole
   * layout from scratch rather than moving one widget: inserts each item in
   * `items` one at a time via resolveLayoutWithPushDown() (so later
   * insertions cascade-push earlier real ones, same insert-one-at-a-time
   * pattern LayoutEngine.mirrorLayout() already uses internally), then runs
   * the same reserved-corner-eviction pass. Used by handleMirrorLayout()'s
   * post-pass and renderActivePage()'s pre-existing-data reflow.
   * @param {Array<object>} items
   * @param {Array<object>} reserved - from getReservedCornerEntries()
   * @returns {Array<object>}
   */
  resolveListWithReservedCorners(items, reserved) {
    let list = [];
    for (const item of items) {
      list = this.layoutEngine.resolveLayoutWithPushDown(item.id, item.layout, [...list, item]);
    }
    for (const r of reserved) {
      list = this.layoutEngine.resolveLayoutWithPushDown(r.id, r.layout, [...list, r]);
    }
    return list.filter((w) => !reserved.some((res) => res.id === w.id));
  }

  /**
   * Builds the .fd-corner-overlay (see grid.css) as the first child of
   * #content-area and mounts the two corner widgets into it. Called once
   * per renderActivePage() call, on every branch.
   */
  mountCornerWidgets(orientation, deviceTier, gridSpec) {
    const overlay = document.createElement('div');
    overlay.className = 'fd-corner-overlay';
    this.layoutEngine.applyGridToContainer(overlay, gridSpec);
    this.contentArea.appendChild(overlay);

    const { menu, profile } = this.getCornerWidgetLayouts(orientation, deviceTier, gridSpec);

    const menuInstance = WidgetRegistry.createWidget(menu, this.eventBus);
    menuInstance.mount(overlay);
    // The overlay itself is pointer-events:none (see grid.css) so clicks
    // pass through to real widgets in the reserved-but-otherwise-empty
    // middle columns; these two are the exception.
    menuInstance.element.style.pointerEvents = 'auto';
    this.cornerWidgetInstances.push(menuInstance);
    this.menuToggleWidget = menuInstance;

    const profileInstance = WidgetRegistry.createWidget(profile, this.eventBus);
    profileInstance.mount(overlay);
    profileInstance.element.style.pointerEvents = 'auto';
    this.cornerWidgetInstances.push(profileInstance);
    this.appProfileWidget = profileInstance;

    this.updateMenuButtonStatus();
    this.updateFullscreenInset();
    this.wireCornerInteractions();
  }

  /**
   * (Re)wires the menu button's click handler and the App Profile badge's
   * long-press handler. Called once per renderActivePage() (from
   * mountCornerWidgets()), since both corner widgets are destroyed and
   * recreated every render. The dropdown's own outside-click-to-close
   * listener is NOT here -- see initHeaderControls()'s one-time setup, to
   * avoid accumulating a new document-level listener on every render.
   */
  wireCornerInteractions() {
    const badgeEl = this.appProfileWidget?.element;
    if (badgeEl) {
      this.attachLongPressOpen(badgeEl, () => {
        if (this.profileSelector) this.profileSelector.open();
      });
    }

    const menuBtn = this.menuToggleWidget?.element;
    const menuDropdown = document.getElementById('menu-dropdown');
    if (!menuBtn || !menuDropdown) return;

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // While editing, the menu corner widget shows a pencil icon (see
      // MenuToggleWidget.setAppEditMode()) and toggles the edit toolbar's
      // visibility instead of opening the nav dropdown -- the toolbar can
      // otherwise cover the same top rows this widget and the App Profile
      // badge (and any real widget placed between them) occupy.
      if (this.isEditMode) {
        this.toggleEditToolbarVisibility();
        return;
      }
      const editBtn = document.getElementById('menu-edit-mode-btn');
      if (editBtn) {
        editBtn.style.display = (this.activePageId === 'page_settings') ? 'none' : 'flex';
      }
      menuDropdown.classList.toggle('open');
    });
  }

  /**
   * Best-effort Screen Orientation API lock. No-ops (silently) on iOS
   * Safari and in several other browser contexts — the RotatePrompt
   * overlay in renderActivePage() is the actual enforcement mechanism,
   * this is just a nicety where the platform supports it.
   * @param {'landscape'|'portrait'} orientation
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

  tryUnlockOrientation() {
    try {
      if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.unlock === 'function') {
        screen.orientation.unlock();
      }
    } catch (_) {}
  }

  toggleEditMode(active) {
    // The Settings page is static and non-editable
    if (this.activePageId === 'page_settings') {
      this.isEditMode = false;
      this.editToolbar.hide();
      return;
    }

    // Can't edit a landscape-only page's layout while it's showing the
    // rotate-device prompt — there's no grid mounted to drag widgets on.
    if (active) {
      const page = this.activeProfile.getPage(this.activePageId);
      if (page && page.orientationLock === 'landscape' && this.currentOrientation !== 'landscape') {
        this.showToast('Rotate your device to landscape to customize this page.');
        return;
      }
    }

    this.isEditMode = active;
    if (this.gridContainer) {
      this.gridContainer.classList.toggle('edit-mode-active', active);
    }

    this.activeWidgetInstances.forEach((w) => {
      w.setEditMode(active);
    });

    // Pencil-icon toggle on the menu corner widget; the toolbar always
    // starts visible on entry/exit -- the pencil is a temporary peek
    // toggle, not a persisted preference (see toggleEditToolbarVisibility()).
    this.editToolbarVisible = true;
    this.menuToggleWidget?.setAppEditMode(active);

    if (active) {
      this.saveHistorySnapshot();
      this.editToolbar.setOrientation(this.currentOrientation);
      this.editToolbar.show();
    } else {
      this.editToolbar.hide();
    }
  }

  /**
   * Toggles the edit-mode toolbar's visibility without leaving edit mode --
   * triggered by tapping the menu corner widget's pencil icon while editing
   * (see MenuToggleWidget.setAppEditMode()/wireCornerInteractions()). Needed
   * because the toolbar's own row can otherwise cover the same top rows the
   * corner widgets (and any real widget placed between them) occupy.
   */
  toggleEditToolbarVisibility() {
    this.editToolbarVisible = !this.editToolbarVisible;
    if (this.editToolbarVisible) {
      this.editToolbar.show();
    } else {
      this.editToolbar.hide();
    }
  }

  /**
   * Generic long-press (500ms, cancels if the pointer moves more than 8px
   * or is released early) gesture binder. Used for the App Profile badge so
   * a stray tap doesn't pop open the App Profiles popover.
   * @param {HTMLElement} el
   * @param {Function} onLongPress
   */
  attachLongPressOpen(el, onLongPress) {
    const LONG_PRESS_MS = 500;
    const MOVE_TOLERANCE = 8;
    let timer = null;
    let startX = 0;
    let startY = 0;

    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('pointercancel', onUp, { capture: true });
    };

    const onMove = (moveEvent) => {
      const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (dist > MOVE_TOLERANCE) clear();
    };

    const onUp = () => clear();

    el.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      startY = e.clientY;
      timer = setTimeout(() => {
        clear();
        if (navigator.vibrate) {
          try { navigator.vibrate(40); } catch (_) {}
        }
        onLongPress();
      }, LONG_PRESS_MS);

      window.addEventListener('pointermove', onMove, { capture: true });
      window.addEventListener('pointerup', onUp, { capture: true });
      window.addEventListener('pointercancel', onUp, { capture: true });
    });
  }

  attachDragHandlers(widgetInstance) {
    const el = widgetInstance.element;
    if (!el) return;

    el.addEventListener('pointerdown', (e) => {
      if (!this.isEditMode) return;
      if (e.target.closest('.widget-edit-btn') || e.target.closest('.widget-delete-btn')) return;

      // Prevent native touch gestures (like scroll/pull-to-refresh) from canceling drag
      if (e.cancelable) e.preventDefault();

      let longPressTimer = null;
      let longPressFired = false;
      let isMoved = false;

      const startX = e.clientX;
      const startY = e.clientY;

      this.draggedWidget = widgetInstance;
      this.dragStartLayout = { ...widgetInstance.layout };
      this.dragStartPointer = { x: e.clientX, y: e.clientY };

      // Long press detection timer (500ms threshold)
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        if (el.classList.contains('is-dragging')) {
          el.classList.remove('is-dragging');
        }
        el.style.transform = '';

        const existingGhost = this.gridContainer.querySelector('.fd-drop-ghost');
        if (existingGhost) existingGhost.remove();

        this.draggedWidget = null;

        // Trigger subtle tactile haptic if supported
        if (navigator.vibrate) {
          try {
            navigator.vibrate(40);
          } catch (_) {}
        }

        // Open widget inspector popup for the current orientation layout
        this.propertyInspector.inspect(widgetInstance, this.currentOrientation, this.currentDeviceTier);
      }, 500);

      el.classList.add('is-dragging');

      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {
        // Pointer capture fallback
      }

      // Create live drop preview ghost
      let dropGhost = this.gridContainer.querySelector('.fd-drop-ghost');
      if (!dropGhost) {
        dropGhost = document.createElement('div');
        dropGhost.className = 'fd-drop-ghost';
        this.gridContainer.appendChild(dropGhost);
      }
      dropGhost.style.gridColumn = `${this.dragStartLayout.col} / span ${this.dragStartLayout.w}`;
      dropGhost.style.gridRow = `${this.dragStartLayout.row} / span ${this.dragStartLayout.h}`;
      dropGhost.style.display = 'block';

      let rafId = null;
      let lastClientX = e.clientX;
      let lastClientY = e.clientY;

      const updateDragVisuals = () => {
        if (!this.draggedWidget || longPressFired) return;
        const dx = lastClientX - this.dragStartPointer.x;
        const dy = lastClientY - this.dragStartPointer.y;
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;

        // Update live drop ghost coordinates
        const targetCell = this.layoutEngine.pixelToGridCell(
          lastClientX,
          lastClientY,
          this.gridContainer
        );
        const maxCol = this.layoutEngine.gridCols || LayoutEngine.getGridSpec(this.currentOrientation, this.currentDeviceTier).columns;
        const clampedCol = Math.max(1, Math.min(maxCol - this.dragStartLayout.w + 1, targetCell.col));
        const clampedRow = Math.max(1, targetCell.row);

        if (dropGhost) {
          dropGhost.style.gridColumn = `${clampedCol} / span ${this.dragStartLayout.w}`;
          dropGhost.style.gridRow = `${clampedRow} / span ${this.dragStartLayout.h}`;
        }
        rafId = null;
      };

      const onPointerMove = (moveEvent) => {
        if (longPressFired) return;
        const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (dist > 8) {
          isMoved = true;
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        }

        if (!this.draggedWidget) return;
        if (moveEvent.cancelable) moveEvent.preventDefault();
        lastClientX = moveEvent.clientX;
        lastClientY = moveEvent.clientY;

        if (!rafId) {
          rafId = requestAnimationFrame(updateDragVisuals);
        }
      };

      const endDrag = (upEvent) => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }

        window.removeEventListener('pointermove', onPointerMove, { capture: true });
        window.removeEventListener('pointerup', endDrag, { capture: true });
        window.removeEventListener('pointercancel', endDrag, { capture: true });

        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        try {
          if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          }
        } catch (_) {
          // Ignored
        }

        el.classList.remove('is-dragging');
        el.style.transform = '';

        if (dropGhost) {
          dropGhost.remove();
        }

        if (longPressFired) {
          this.draggedWidget = null;
          return;
        }

        if (this.draggedWidget && isMoved) {
          const finalX = upEvent ? upEvent.clientX : lastClientX;
          const finalY = upEvent ? upEvent.clientY : lastClientY;

          const targetCell = this.layoutEngine.pixelToGridCell(
            finalX,
            finalY,
            this.gridContainer
          );

          // Strictly preserve exact widget width and height during drag
          const candidate = {
            col: targetCell.col,
            row: targetCell.row,
            w: this.dragStartLayout.w,
            h: this.dragStartLayout.h
          };

          const page = this.activeProfile.getPage(this.activePageId);
          if (page) {
            this.saveHistorySnapshot();

            const gridSpec = page.getGrid(this.currentOrientation, this.currentDeviceTier) || LayoutEngine.getGridSpec(this.currentOrientation, this.currentDeviceTier);
            if (gridSpec && gridSpec.columns) {
              this.layoutEngine.gridCols = gridSpec.columns;
            }

            // Cascading push-down reordering & auto-compact for active tier +
            // orientation, plus a reserved-corner eviction pass (menu/App
            // Profile badge cells) -- see resolveWithReservedCorners().
            const reserved = this.getReservedCornerEntries(this.currentOrientation, this.currentDeviceTier, gridSpec);
            const currentWidgets = page.getWidgets(this.currentOrientation, this.currentDeviceTier);
            const updatedWidgets = this.resolveWithReservedCorners(
              widgetInstance.id,
              candidate,
              currentWidgets,
              reserved
            );

            page.setWidgets(this.currentOrientation, this.currentDeviceTier, updatedWidgets);

            // Sync all DOM widget positions
            this.activeWidgetInstances.forEach((inst) => {
              const matching = updatedWidgets.find((w) => w.id === inst.id);
              if (matching) {
                inst.layout = { ...matching.layout };
                inst.applyLayoutStyles();
              }
            });
          }
        }

        this.draggedWidget = null;
      };

      window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
      window.addEventListener('pointerup', endDrag, { capture: true });
      window.addEventListener('pointercancel', endDrag, { capture: true });
    });
  }

  addNewWidgetToPage(widgetType) {
    const page = this.activeProfile.getPage(this.activePageId);
    if (!page) return;

    this.saveHistorySnapshot();

    const orientation = this.currentOrientation;
    const tier = this.currentDeviceTier;
    const currentWidgets = page.getWidgets(orientation, tier);

    // 1. Normalize existing widgets' layout data (no gap-closing — see renderActivePage)
    const compacted = this.layoutEngine.normalizeLayout(currentWidgets);
    page.setWidgets(orientation, tier, compacted);

    const thisGrid = page.getGrid(orientation, tier) || LayoutEngine.getGridSpec(orientation, tier);
    const descriptor = WidgetRegistry.getDescriptor(widgetType);
    // Scale the widget-type's declared default width (authored against
    // mobile's 20/44-col grids) proportionally into the active tier+orientation's
    // actual column count, rather than a hardcoded mobile-only lookup table.
    const declaredW = descriptor?.defaultLayout?.w || 10;
    const declaredForCols = orientation === 'landscape' ? 44 : 20;
    const defW = Math.max(1, Math.min(thisGrid.columns, Math.round((declaredW / declaredForCols) * thisGrid.columns)));
    const defH = descriptor?.defaultLayout?.h || 2;

    // Reserved corner cells (menu/App Profile badge) count as occupied so a
    // new widget is never auto-placed on top of them.
    const reserved = this.getReservedCornerEntries(orientation, tier, thisGrid);
    const layout = this.layoutEngine.findNextFreeSlot(
      defW,
      defH,
      [...compacted, ...reserved]
    );

    const newWidgetConfig = {
      id: `w_${Date.now()}`,
      type: widgetType,
      layout,
      config: JSON.parse(JSON.stringify(descriptor?.defaultConfig || {}))
    };

    // Page.addWidget() already auto-mirrors this into the opposite
    // orientation of the same tier internally -- do not mirror it again
    // here, that previously pushed a second duplicate entry sharing the
    // same id into the opposite orientation's widget list.
    page.addWidget(newWidgetConfig, orientation, tier);

    // 2. Re-render active page to cleanly update and synchronize all layout positions
    this.renderActivePage();
  }

  removeWidgetFromPage(widgetId, orientation = this.currentOrientation) {
    const page = this.activeProfile.getPage(this.activePageId);
    if (!page) return;

    // Widgets marked non-removable (e.g. the Virtual Yoke page's built-in
    // Center / Detach controls) can't be removed via REMOVE_WIDGET even if
    // it's published directly — the primary UI-level guards live in
    // BaseWidget.renderEditOverlay() and PropertyInspector.handleRemove().
    const tier = this.currentDeviceTier;
    const target = page.getWidgets(orientation, tier).find((w) => w.id === widgetId);
    if (target && target.config?.removable === false) {
      this.showToast('This widget is built into the page and cannot be removed.');
      return;
    }

    this.saveHistorySnapshot();

    // Remove strictly from the layout tier + orientation where edit was initiated
    page.removeWidget(widgetId, orientation, tier);

    // Normalize current tier + orientation (no gap-closing — see renderActivePage)
    const updated = this.layoutEngine.normalizeLayout(page.getWidgets(orientation, tier));
    page.setWidgets(orientation, tier, updated);

    const instanceIdx = this.activeWidgetInstances.findIndex((w) => w.id === widgetId);
    if (instanceIdx !== -1) {
      this.activeWidgetInstances[instanceIdx].destroy();
      this.activeWidgetInstances.splice(instanceIdx, 1);
    }

    // Sync all remaining instances
    this.activeWidgetInstances.forEach((inst) => {
      const matching = updated.find((w) => w.id === inst.id);
      if (matching) {
        inst.layout = { ...matching.layout };
        inst.applyLayoutStyles();
      }
    });
  }

  handleUpdateWidgetConfig(widgetId, { layout, config }, orientation = this.currentOrientation) {
    const page = this.activeProfile.getPage(this.activePageId);
    if (!page) return;

    this.saveHistorySnapshot();

    const tier = this.currentDeviceTier;
    const gridSpec = page.getGrid(orientation, tier) || LayoutEngine.getGridSpec(orientation, tier);
    if (gridSpec && gridSpec.columns) {
      this.layoutEngine.gridCols = gridSpec.columns;
    }

    if (layout) {
      const reserved = this.getReservedCornerEntries(orientation, tier, gridSpec);
      const currentWidgets = page.getWidgets(orientation, tier);
      const updatedWidgets = this.resolveWithReservedCorners(widgetId, layout, currentWidgets, reserved);
      page.setWidgets(orientation, tier, updatedWidgets);

      this.activeWidgetInstances.forEach((inst) => {
        const matching = updatedWidgets.find((w) => w.id === inst.id);
        if (matching) {
          inst.layout = { ...matching.layout };
          inst.applyLayoutStyles();
        }
      });
    }

    if (config) {
      // Scoped strictly to the active tier + orientation layout
      page.updateWidget(widgetId, { config }, orientation, false, tier);
      const widgetInstance = this.activeWidgetInstances.find((w) => w.id === widgetId);
      if (widgetInstance) {
        widgetInstance.updateConfig(config);
      }
    }
  }

  handleMirrorLayout() {
    const page = this.activeProfile.getPage(this.activePageId);
    if (!page) return;

    this.saveHistorySnapshot();

    const tier = this.currentDeviceTier;
    const fromOrientation = this.currentOrientation;
    const toOrientation = fromOrientation === 'portrait' ? 'landscape' : 'portrait';

    // Same-tier mirror only -- an author on the tablet/desktop tier mirrors
    // within that tier's own portrait/landscape, never into mobile's.
    const sourceWidgets = page.getWidgets(fromOrientation, tier);
    const sourceGrid = page.getGrid(fromOrientation, tier) || LayoutEngine.getGridSpec(fromOrientation, tier);
    const targetGrid = page.getGrid(toOrientation, tier) || LayoutEngine.getGridSpec(toOrientation, tier);

    let mirrored = this.layoutEngine.mirrorLayout(sourceWidgets, sourceGrid, targetGrid);

    // mirrorLayout() has no obstacle-list parameter to reserve the target
    // orientation's corner cells directly, so push anything that landed on
    // one out of the way as a post-pass -- see resolveListWithReservedCorners().
    const targetReserved = this.getReservedCornerEntries(toOrientation, tier, targetGrid);
    mirrored = this.resolveListWithReservedCorners(mirrored, targetReserved);

    page.setWidgets(toOrientation, tier, mirrored);

    console.log(`[FlightDeck] Layout mirrored from ${fromOrientation} to ${toOrientation}`);
  }

  saveHistorySnapshot() {
    const serialized = JSON.stringify(this.activeProfile.toJSON());
    this.historyStack.push(serialized);
    if (this.historyStack.length > 20) this.historyStack.shift();
  }

  async handleUndo() {
    if (this.historyStack.length === 0) return;
    const previous = this.historyStack.pop();
    this.activeProfile = await this.activateProfile(JSON.parse(previous));
    this.renderActivePage();
  }

  /**
   * "Compact" edit-toolbar action — the only path that still pulls widgets
   * up to close gaps (see LayoutEngine.compactLayout()'s doc comment).
   * Everywhere else (render/add/remove/move) leaves a deliberately-left gap
   * alone; this is the explicit, user-requested way to actually close them.
   */
  handleCompactLayout() {
    const page = this.activeProfile.getPage(this.activePageId);
    if (!page) return;

    this.saveHistorySnapshot();

    const orientation = this.currentOrientation;
    const tier = this.currentDeviceTier;
    const gridSpec = page.getGrid(orientation, tier) || LayoutEngine.getGridSpec(orientation, tier);
    // Reserved corner cells count as obstacles here too, so compaction never
    // pulls a real widget up into one.
    const reserved = this.getReservedCornerEntries(orientation, tier, gridSpec);
    const compacted = this.layoutEngine.compactLayout([...page.getWidgets(orientation, tier), ...reserved])
      .filter((w) => !reserved.some((r) => r.id === w.id));
    page.setWidgets(orientation, tier, compacted);

    this.renderActivePage();
  }

  async handleSaveLayout() {
    await this.ensureEditableProfile();
    await this.storage.saveProfile(this.activeProfile.toJSON());
    this.toggleEditMode(false);
  }

  async handleCancelEdit() {
    const raw = await this.storage.getProfile(this.activeProfile.id);
    if (raw) {
      this.activeProfile = await this.activateProfile(raw);
    }
    this.toggleEditMode(false);
    this.renderActivePage();
  }

  /**
   * Constructs a Profile from raw storage data and, if it's a fork
   * (parentProfileId set), hydrates in any pages it doesn't override yet
   * from its parent -- see Profile.hydrateInheritedPages(). Every place
   * that activates a profile for viewing/editing should go through this
   * instead of `new Profile(raw)` directly, or pages the fork hasn't
   * touched won't resolve.
   * @param {object} raw
   * @returns {Promise<Profile>}
   */
  async activateProfile(raw) {
    const profile = new Profile(raw);
    if (profile.parentProfileId) {
      const parentRaw = await this.storage.getProfile(profile.parentProfileId);
      if (parentRaw) {
        profile.hydrateInheritedPages(new Profile(parentRaw));
      }
    }
    return profile;
  }

  /**
   * Ensures the currently-edited page can actually be persisted:
   * - If the active profile is a shipped default (e.g. 'default_ga'), the
   *   very first edit auto-forks a "Custom" App Profile (or reuses an
   *   existing fork of this same default) and moves the edited page into it
   *   as a real override -- shipped defaults are never written to directly,
   *   both because StorageManager.saveProfile() would silently skip pushing
   *   them to PC Bridge, and because editing them in place would remove the
   *   "revert this one page" option entirely.
   * - If the active profile is already a fork and the edited page is still
   *   only inherited (not yet its own override), promotes it in place.
   * Called once, right before persisting, from handleSaveLayout().
   */
  async ensureEditableProfile() {
    if (!this.storage.isDefaultProfile(this.activeProfile.id)) {
      if (this.activeProfile.parentProfileId && !this.activeProfile.hasOwnPage(this.activePageId)) {
        this.activeProfile.promoteToOwnPage(this.activePageId);
      }
      return;
    }
    const editedPage = this.activeProfile.getPage(this.activePageId);
    await this.forkFromDefault(editedPage);
  }

  /**
   * Forks the active (shipped default) profile into a "Custom" App Profile,
   * reusing an existing fork of this same default if one is already active,
   * and switches to it. If `pageToMove` is given, it's moved into the fork
   * as a real override (used when an edited page needs to land somewhere
   * persistable); omit it when forking just to make room for a brand-new
   * custom page (see handleAddCustomPage()).
   * @param {Page|null} pageToMove
   */
  async forkFromDefault(pageToMove = null) {
    const defaultId = this.activeProfile.id;
    const allProfiles = await this.storage.getAllProfiles();
    let forkRaw = allProfiles.find((p) => p.parentProfileId === defaultId);

    if (!forkRaw) {
      let name = 'Custom';
      let suffix = 2;
      while (allProfiles.some((p) => p.name === name)) {
        name = `Custom (${suffix++})`;
      }
      forkRaw = {
        id: `custom_${defaultId}`,
        profileId: `custom_${defaultId}`,
        name,
        aircraft: name,
        description: `Custom App Profile forked from ${this.activeProfile.name}`,
        aircraftCategory: this.activeProfile.aircraftCategory,
        version: this.activeProfile.version,
        parentProfileId: defaultId,
        pages: []
      };
    }

    const forkProfile = new Profile(forkRaw);
    if (pageToMove) {
      forkProfile.removeOwnPage(pageToMove.id);
      forkProfile.addPage(new Page(JSON.parse(JSON.stringify(pageToMove.toJSON()))));
    }

    await this.storage.saveProfile(forkProfile.toJSON());
    await this.storage.setActiveProfileId(forkProfile.id);
    this.activeProfile = await this.activateProfile(forkProfile.toJSON());

    if (this.profileSelector) this.profileSelector.refreshList();
    if (this.appProfileWidget) {
      this.appProfileWidget.setLabel(this.activeProfile.name.toUpperCase().slice(0, 7));
    }
  }

  /**
   * Prompts for a name and adds a brand-new custom page to the active
   * profile (forking off the shipped default first if needed, same rule as
   * any other edit), then adds it to the nav menu and switches to it.
   */
  async handleAddCustomPage() {
    const name = prompt('Enter a name for the new page:');
    if (!name || !name.trim()) return;

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'page';
    const newPage = new Page({
      id: `page_custom_${slug}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      icon: 'grid'
    });

    if (this.storage.isDefaultProfile(this.activeProfile.id)) {
      await this.forkFromDefault();
    }
    this.activeProfile.addPage(newPage);
    await this.storage.saveProfile(this.activeProfile.toJSON());
    this.renderPageMenu();
    this.switchPage(newPage.id);
  }

  /**
   * Permanently deletes a custom (non-shipped) page from the active
   * profile, called from the Settings page's Manage Pages card. Unlike
   * handleRevertPageToDefault() there is no fallback to hydrate in -- a
   * custom page has no shipped-default counterpart -- so this is a real,
   * unrecoverable delete via Profile.removePage(). If the deleted page was
   * currently active, falls back to the first remaining page.
   * @param {string} pageId
   */
  async handleDeleteCustomPage(pageId) {
    if (!this.activeProfile) return;
    const shippedPageIds = new Set(this.storage.getDefaultProfiles()[0].pages.map((p) => p.id));
    if (shippedPageIds.has(pageId)) return;

    this.activeProfile.removePage(pageId);
    await this.storage.saveProfile(this.activeProfile.toJSON());
    this.renderPageMenu();

    if (this.activePageId === pageId) {
      const fallback = this.activeProfile.pages[0];
      this.activePageId = fallback ? fallback.id : 'page_settings';
    }
    this.showToast('Page deleted.');
  }

  /**
   * Read-only snapshot of the active profile's custom (non-shipped) pages,
   * for the Settings page's Manage Pages card.
   * @returns {Array<{id: string, name: string}>}
   */
  getCustomPages() {
    if (!this.activeProfile) return [];
    const shippedPageIds = new Set(this.storage.getDefaultProfiles()[0].pages.map((p) => p.id));
    return this.activeProfile.pages
      .filter((p) => !shippedPageIds.has(p.id))
      .map((p) => ({ id: p.id, name: p.name }));
  }

  /**
   * Rebuilds the nav menu dropdown's custom-page entries from the active
   * profile's page list. The shipped default pages (Radios/Autopilot/
   * Lights/Virtual Yoke/Settings) stay as static markup in index.html --
   * only pages NOT part of the shipped default set are injected here, since
   * those are the only ones that can vary between profiles/forks. Adding
   * and deleting custom pages themselves is done from the Settings page
   * (see SettingsView's Manage Pages card) rather than from this dropdown,
   * so a user scrolling the menu can't accidentally trigger either action.
   */
  renderPageMenu() {
    const menuDropdown = document.getElementById('menu-dropdown');
    if (!menuDropdown || !this.activeProfile) return;

    menuDropdown.querySelectorAll('.menu-item-btn[data-custom-page]').forEach((el) => el.remove());

    const shippedPageIds = new Set(this.storage.getDefaultProfiles()[0].pages.map((p) => p.id));
    const customPages = this.activeProfile.pages.filter((p) => !shippedPageIds.has(p.id));
    // Anchor custom pages before "Customize Dashboard" (falling back to
    // Settings, then the divider) so they stay grouped with the other page
    // nav buttons rather than landing after the dashboard/settings actions.
    const anchor = document.getElementById('menu-edit-mode-btn')
      || menuDropdown.querySelector('.menu-item-btn[data-page="settings"]')
      || menuDropdown.querySelector('.menu-divider');

    customPages.forEach((page) => {
      const btn = document.createElement('button');
      btn.className = 'menu-item-btn';
      btn.dataset.customPage = page.id;
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>
        </svg>
        ${SecurityValidator.escapeHTML(page.name)}
      `;
      btn.addEventListener('click', () => {
        this.switchPage(page.id);
        menuDropdown.classList.remove('open');
      });
      menuDropdown.insertBefore(btn, anchor);
    });

    // Refresh the Settings page's page-management list too, in case it's
    // the currently mounted view (e.g. right after adding/deleting a page).
    if (this.settingsView && this.activePageId === 'page_settings') {
      this.settingsView.refreshPagesList();
    }
  }

  /**
   * Reverts one page in the active fork back to its shipped-default state
   * by removing the fork's own override, then re-hydrating the inherited
   * fallback so rendering keeps working. Leaves every other overridden page
   * in the fork untouched -- that per-page independence is the whole point
   * of the overlay model (see Profile.js). No-op (besides the toast) if the
   * page isn't actually an override here.
   * @param {string} pageId
   */
  async handleRevertPageToDefault(pageId) {
    // Only a fork (parentProfileId set) has a shipped-default fallback to
    // revert into -- reverting on the shipped default itself, or on a
    // standalone profile with no parent, would just delete the page outright.
    if (!this.activeProfile.parentProfileId) {
      this.showToast('This page has no default version to revert to.');
      return;
    }
    if (!this.activeProfile.hasOwnPage(pageId)) {
      this.showToast('This page has no custom changes to revert.');
      return;
    }
    this.activeProfile.removeOwnPage(pageId);
    const parentRaw = await this.storage.getProfile(this.activeProfile.parentProfileId);
    if (parentRaw) {
      this.activeProfile.hydrateInheritedPages(new Profile(parentRaw));
    }
    await this.storage.saveProfile(this.activeProfile.toJSON());
    this.renderActivePage();
    this.showToast('Page reverted to default.');
  }

  initServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('[PWA] Service Worker registration failed:', err);
      });
    }
  }
}

// Bootstrap Flight Deck application on DOM Ready or immediately if loaded
function startFlightDeck() {
  if (!window.flightDeck) {
    window.flightDeck = new FlightDeckApp();
    window.flightDeck.init();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startFlightDeck);
} else {
  startFlightDeck();
}

