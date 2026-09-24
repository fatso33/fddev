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
    return calculateCornerWidgetLayouts(orientation, deviceTier, gridSpec, this.isEditMode, this.activeProfile);
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
    return calculateReservedCornerEntries(this.getCornerWidgetLayouts(orientation, deviceTier, gridSpec));
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
    return calculateWithReservedCorners(this.layoutEngine, movingId, targetLayout, widgetList, reserved);
  }

  /**
   * Resolves where `candidate` should land for `movingWidgetId` during a
   * drag-and-drop move, respecting the Auto-Reposition toggle
   * (this.autoRepositionEnabled, see toggleAutoReposition()): if it
   * collides with anything and Auto-Reposition is off, the placement is
   * rejected outright rather than nudged; otherwise
   * LayoutEngine.resolveSmartNudge() runs (a plain no-op placement when
   * there was nothing to nudge in the first place, i.e. no collision).
   * Shared by attachDragHandlers()'s live 1-second hold preview and its
   * actual drop commit, so both always agree on the outcome.
   * @param {string} movingWidgetId
   * @param {{col:number,row:number,w:number,h:number}} candidate
   * @param {Array<object>} widgetList - real widgets only
   * @param {object} gridSpec
   * @param {Array<{id:string,layout:object}>} reserved
   * @returns {{ok:true, widgets:Array<object>}|{ok:false}}
   */
  resolveDropPlacement(movingWidgetId, candidate, widgetList, gridSpec, reserved) {
    return calculateDropPlacement(this.layoutEngine, this.autoRepositionEnabled, movingWidgetId, candidate, widgetList, gridSpec, reserved);
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
    return calculateListWithReservedCorners(this.layoutEngine, items, reserved);
  }

  /**
   * Builds the .fd-corner-overlay (see grid.css) as the first child of
   * #content-area and mounts the two corner widgets into it. Called once
   * per renderActivePage() call, on every branch.
   */
  mountCornerWidgets(orientation, deviceTier, gridSpec) {
    return mountCornerOverlay(this, orientation, deviceTier, gridSpec);
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
    return wireCornerOverlayInteractions(this);
  }

  /**
   * Best-effort Screen Orientation API lock. No-ops (silently) on iOS
   * Safari and in several other browser contexts — the RotatePrompt
   * overlay in renderActivePage() is the actual enforcement mechanism,
   * this is just a nicety where the platform supports it.
   * @param {'landscape'|'portrait'} orientation
   */
  tryLockOrientation(orientation) {
    return this.appUi.tryLockOrientation(orientation);
  }

  tryUnlockOrientation() {
    return this.appUi.tryUnlockOrientation();
  }

  toggleEditMode(active) {
    return this.layoutEdit.toggleEditMode(active);
  }

  /**
   * Toggles the edit-mode toolbar's visibility without leaving edit mode --
   * triggered by tapping the menu corner widget's pencil icon while editing
   * (see MenuToggleWidget.setAppEditMode()/wireCornerInteractions()). Needed
   * because the toolbar's own row can otherwise cover the same top rows the
   * corner widgets (and any real widget placed between them) occupy.
   */
  toggleEditToolbarVisibility() {
    return this.layoutEdit.toggleEditToolbarVisibility();
  }

  /**
   * Flips whether dropping a widget onto another nudges the existing widget
   * out of the way (LayoutEngine.resolveSmartNudge(), see attachDragHandlers)
   * or refuses the drop outright. Persisted so the preference survives a
   * reload, same pattern as FullscreenManager/WakeLockManager.
   * @param {boolean} enabled
   */
  toggleAutoReposition(enabled) {
    return this.layoutEdit.toggleAutoReposition(enabled);
  }

  /**
   * Generic long-press (500ms, cancels if the pointer moves more than 8px
   * or is released early) gesture binder. Used for the App Profile badge so
   * a stray tap doesn't pop open the App Profiles popover.
   * @param {HTMLElement} el
   * @param {Function} onLongPress
   */
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

  /**
   * "Compact" edit-toolbar action — the only path that still pulls widgets
   * up to close gaps (see LayoutEngine.compactLayout()'s doc comment).
   * Everywhere else (render/add/remove/move) leaves a deliberately-left gap
   * alone; this is the explicit, user-requested way to actually close them.
   */
  handleCompactLayout() {
    return this.layoutEdit.handleCompactLayout();
  }

  handleSaveLayout() {
    return this.layoutEdit.handleSaveLayout();
  }

  handleCancelEdit() {
    return this.layoutEdit.handleCancelEdit();
  }

  /**
   * Constructs a Profile from raw storage data and, if it's a fork
   * (parentProfileId set), hydrates in any pages it doesn't override yet
   * from its parent -- see Profile.hydrateInheritedPages(). Every place
   * that activates a profile for viewing/editing should go through this
   * instead of `new Profile(raw)` directly, or pages the fork hasn't
   * touched won't resolve.
   * @param {object} raw
   * @returns {Promise<import('./models/Profile.js').Profile>}
   */
  async activateProfile(raw) {
    return this.profileCoordinator.activateProfile(raw);
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
    return this.profileCoordinator.ensureEditableProfile();
  }

  /**
   * Forks the active (shipped default) profile into a "Custom" App Profile,
   * reusing an existing fork of this same default if one is already active,
   * and switches to it. If `pageToMove` is given, it's moved into the fork
   * as a real override (used when an edited page needs to land somewhere
   * persistable); omit it when forking just to make room for a brand-new
   * custom page (see handleAddCustomPage()).
   * @param {import('./models/Page.js').Page|null} pageToMove
   */
  async forkFromDefault(pageToMove = null) {
    return this.profileCoordinator.forkFromDefault(pageToMove);
  }

  /**
   * Prompts for a name and adds a brand-new custom page to the active
   * profile (forking off the shipped default first if needed, same rule as
   * any other edit), then adds it to the nav menu and switches to it.
   */
  async handleAddCustomPage() {
    return this.profileCoordinator.handleAddCustomPage();
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
    return this.profileCoordinator.handleDeleteCustomPage(pageId);
  }

  /**
   * Read-only snapshot of the active profile's custom (non-shipped) pages,
   * for the Settings page's Manage Pages card.
   * @returns {Array<{id: string, name: string}>}
   */
  getCustomPages() {
    return this.profileCoordinator.getCustomPages();
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
    return this.navigation.renderPageMenu();
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
