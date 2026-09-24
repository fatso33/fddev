/**
 * @module app
 * Owns the single PWA app context, ordered initialization, service-worker
 * registration and DOM-ready bootstrap. Services share this live context;
 * SimBridge owns its connection, while the app retains widget, edit, profile,
 * UI and orientation state exposed through the original facade methods.
 */

import { EventBus } from './core/EventBus.js';
import { StorageManager } from './core/StorageManager.js';
import { SimBridge } from './core/SimBridge.js';
import { LayoutEngine } from './core/LayoutEngine.js';
import { VirtualYokeEngine } from './core/VirtualYokeEngine.js';
import { PwaInstallManager } from './core/PwaInstallManager.js';
import { WidgetRegistry } from './widgets/WidgetRegistry.js';
import { BaseWidget } from './widgets/BaseWidget.js';
import { ProfileCoordinator } from './services/ProfileCoordinator.js';
import { LayoutEditController } from './services/LayoutEditController.js';
import { AppUiCoordinator } from './services/AppUiCoordinator.js';
import { NavigationManager } from './services/NavigationManager.js';
import {
  attachDragHandlers as bindDragHandlers,
  attachLongPressOpen as bindLongPressOpen,
} from './services/DragController.js';
import { handleOrientationChange, refreshGridGeometry, renderActivePage } from './services/PageRenderer.js';
import {
  getCornerWidgetLayouts as calculateCornerWidgetLayouts,
  getReservedCornerEntries as calculateReservedCornerEntries,
  resolveWithReservedCorners as calculateWithReservedCorners,
  resolveDropPlacement as calculateDropPlacement,
  resolveListWithReservedCorners as calculateListWithReservedCorners,
} from './services/CornerLayout.js';
import {
  teardown as teardownCornerOverlay,
  mountCornerWidgets as mountCornerOverlay,
  wireCornerInteractions as wireCornerOverlayInteractions,
} from './services/CornerOverlayManager.js';

/** Composes the PWA services around one mutable app state and public facade. */
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

    // Whether dropping a widget onto another nudges the existing widget out
    // of the way (LayoutEngine.resolveSmartNudge()) or refuses the drop
    // entirely. Defaults off -- a widget can't overlap another until the
    // user explicitly turns nudging on via the edit toolbar. Persisted like
    // FullscreenManager/WakeLockManager's own toggles.
    this.autoRepositionEnabled = localStorage.getItem('flightdeck_auto_reposition') === 'true';

    // Edit history is held on the app so controller callbacks share one stack.
    this.historyStack = [];

    // UI instances are mounted during initUIComponents().
    this.editToolbar = null;
    this.widgetDrawer = null;
    this.propertyInspector = null;
    this.profileSelector = null;
    this.rotatePrompt = null;

    // Corner controls are rebuilt on every page-render branch; these fields
    // keep the current overlay and widget instances, including their teardown.
    this.cornerWidgetInstances = [];
    this.menuToggleWidget = null;
    this.appProfileWidget = null;
    this.cornerOverlayEl = null;
    this.editToolbarVisible = true;

    this.contentArea = document.getElementById('content-area');
    this.gridContainer = null;
    this.orientationUnsub = null;
    this.navigation = new NavigationManager(this);
    this.profileCoordinator = new ProfileCoordinator(this);
    this.layoutEdit = new LayoutEditController(this);
    this.appUi = new AppUiCoordinator(this);
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

    // 3. Initialize global controls and theme.
    this.initHeaderControls();

    // 4. Initialize toolbars and modals.
    this.initUIComponents();

    // 5. Subscribe to app EventBus topics.
    this.initEventSubscriptions();

    // 6. Preload shared widget stylesheets before the first render to avoid FOUC.
    await BaseWidget.preloadStyles();

    // 7. Mount hardware orientation listener & resize watcher
    this.orientationUnsub = this.layoutEngine.initOrientationWatcher((newOrientation, isResize) => {
      this.handleOrientationChange(newOrientation, isResize);
    });

    // 8. Build the menu and render the active page with its corner overlay.
    this.renderPageMenu();
    this.renderActivePage();

    // 9. Register Service Worker
    this.initServiceWorker();
  }

  handleOrientationChange(newOrientation, isResize = false) {
    return handleOrientationChange(this, newOrientation, isResize);
  }

  refreshGridGeometry(orientation, deviceTier) {
    return refreshGridGeometry(this, orientation, deviceTier);
  }

  initHeaderControls() {
    return this.appUi.initHeaderControls();
  }

  initUIComponents() {
    return this.appUi.initUIComponents();
  }

  initEventSubscriptions() {
    return this.appUi.initEventSubscriptions();
  }

  updateMenuButtonStatus() {
    return this.appUi.updateMenuButtonStatus();
  }


  showToast(message) {
    return this.appUi.showToast(message);
  }

  switchPage(pageId) {
    return this.navigation.switchPage(pageId);
  }

  renderActivePage() {
    return renderActivePage(this, {
      teardown: teardownCornerOverlay,
      mount: (orientation, deviceTier, gridSpec) => this.mountCornerWidgets(orientation, deviceTier, gridSpec),
    });
  }

  /** Returns the scaled menu and badge layouts with their reserved edge margins. */
  getCornerWidgetLayouts(orientation, deviceTier, gridSpec) {
    return calculateCornerWidgetLayouts(orientation, deviceTier, gridSpec, this.isEditMode, this.activeProfile);
  }

  /** Returns virtual corner obstacles; page data never stores them. */
  getReservedCornerEntries(orientation, deviceTier, gridSpec) {
    return calculateReservedCornerEntries(this.getCornerWidgetLayouts(orientation, deviceTier, gridSpec));
  }

  /**
   * Resolves a real widget with fixed corners authoritative. LayoutEngine
   * protects its moving ID, so each corner must take that role in a postpass;
   * placing corner entries in the first widget list would let them be pushed.
   */
  resolveWithReservedCorners(movingId, targetLayout, widgetList, reserved) {
    return calculateWithReservedCorners(this.layoutEngine, movingId, targetLayout, widgetList, reserved);
  }

  /** Uses the live nudge preference for both drag preview and drop. */
  resolveDropPlacement(movingWidgetId, candidate, widgetList, gridSpec, reserved) {
    return calculateDropPlacement(this.layoutEngine, this.autoRepositionEnabled, movingWidgetId, candidate, widgetList, gridSpec, reserved);
  }

  /** Builds a full layout in insertion order, then evicts corner overlaps. */
  resolveListWithReservedCorners(items, reserved) {
    return calculateListWithReservedCorners(this.layoutEngine, items, reserved);
  }

  /** Mounts the corner overlay for the current page-render branch. */
  mountCornerWidgets(orientation, deviceTier, gridSpec) {
    return mountCornerOverlay(this, orientation, deviceTier, gridSpec);
  }

  /** Wires the current corner widgets; the outside-click listener is one-time. */
  wireCornerInteractions() {
    return wireCornerOverlayInteractions(this);
  }

  /** Requests a best-effort platform lock; RotatePrompt enforces the page UI. */
  tryLockOrientation(orientation) {
    return this.appUi.tryLockOrientation(orientation);
  }

  tryUnlockOrientation() {
    return this.appUi.tryUnlockOrientation();
  }

  toggleEditMode(active) {
    return this.layoutEdit.toggleEditMode(active);
  }

  /** Toggles the toolbar without leaving edit mode or changing page layout. */
  toggleEditToolbarVisibility() {
    return this.layoutEdit.toggleEditToolbarVisibility();
  }

  /** Persists whether occupied drops nudge another widget or are refused. */
  toggleAutoReposition(enabled) {
    return this.layoutEdit.toggleAutoReposition(enabled);
  }

  /** Binds the badge's 500 ms long press with its 8 px movement tolerance. */
  attachLongPressOpen(el, onLongPress) {
    return bindLongPressOpen(el, onLongPress);
  }

  attachDragHandlers(widgetInstance) {
    return bindDragHandlers(this, widgetInstance);
  }

  addNewWidgetToPage(widgetType) {
    return this.layoutEdit.addNewWidgetToPage(widgetType);
  }

  /**
   * @param {string|object} widgetOrId - a widget id (resolved against
   *   activeWidgetInstances) or an already-resolved live widget instance.
   * @param {'add'|'edit'} mode
   */
  openButtonConfigPopover(widgetOrId, mode) {
    return this.layoutEdit.openButtonConfigPopover(widgetOrId, mode);
  }

  removeWidgetFromPage(widgetId, orientation = this.currentOrientation) {
    return this.layoutEdit.removeWidgetFromPage(widgetId, orientation);
  }

  handleUpdateWidgetConfig(widgetId, { layout, config }, orientation = this.currentOrientation) {
    return this.layoutEdit.handleUpdateWidgetConfig(widgetId, { layout, config }, orientation);
  }

  handleMirrorLayout() {
    return this.layoutEdit.handleMirrorLayout();
  }

  saveHistorySnapshot() {
    return this.layoutEdit.saveHistorySnapshot();
  }

  handleUndo() {
    return this.layoutEdit.handleUndo();
  }

  /** Closes intentional layout gaps only on the explicit Compact action. */
  handleCompactLayout() {
    return this.layoutEdit.handleCompactLayout();
  }

  handleSaveLayout() {
    return this.layoutEdit.handleSaveLayout();
  }

  handleCancelEdit() {
    return this.layoutEdit.handleCancelEdit();
  }

  /** Activates stored data with inherited pages hydrated from its parent. */
  async activateProfile(raw) {
    return this.profileCoordinator.activateProfile(raw);
  }

  /** Makes the edited page an own override, forking shipped defaults first. */
  async ensureEditableProfile() {
    return this.profileCoordinator.ensureEditableProfile();
  }

  /** Reuses or creates a default fork, optionally copying an edited page. */
  async forkFromDefault(pageToMove = null) {
    return this.profileCoordinator.forkFromDefault(pageToMove);
  }

  /** Prompts for and persists a custom page, then navigates to it. */
  async handleAddCustomPage() {
    return this.profileCoordinator.handleAddCustomPage();
  }

  /** Removes a custom page and selects a fallback ID when it was active. */
  async handleDeleteCustomPage(pageId) {
    return this.profileCoordinator.handleDeleteCustomPage(pageId);
  }

  /** Returns the active profile's custom page IDs and names. */
  getCustomPages() {
    return this.profileCoordinator.getCustomPages();
  }

  /** Rebuilds custom menu entries; shipped page entries remain static markup. */
  renderPageMenu() {
    return this.navigation.renderPageMenu();
  }

  /** Reverts one own page and hydrates its inherited fallback. */
  async handleRevertPageToDefault(pageId) {
    return this.profileCoordinator.handleRevertPageToDefault(pageId);
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
