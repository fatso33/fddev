/**
 * @module LayoutEditController
 * Coordinates edit mode, widget placement/configuration, history, and save/cancel.
 * FlightDeckApp retains the live activeProfile, activePageId, orientation/tier,
 * layoutEngine, activeWidgetInstances, grid/overlay/UI references, isEditMode,
 * editToolbarVisible, autoRepositionEnabled and historyStack fields. This
 * controller stores only the app reference. It writes through the app's
 * snapshot, reserved-corner, render, profile and toast facades and delegates
 * persistence to StorageManager. It owns no timer, listener or DOM lifecycle;
 * per-widget rendering and drag resources retain their existing owners.
 */

import { LayoutEngine } from '../core/LayoutEngine.js';
import { WidgetRegistry } from '../widgets/WidgetRegistry.js';

/** Operates on the live app state and its public layout/profile/UI facades. */
export class LayoutEditController {
  /** @param {import('../app.js').FlightDeckApp} app - Live app and facade methods. */
  constructor(app) {
    this.app = app;
  }

  /**
   * Sets edit mode when this page has an editable grid. Updates grid, overlay,
   * widgets, menu pencil and toolbar; snapshots on entry and shows a toast
   * for a portrait landscape-only page.
   * @param {boolean} active - Requested edit state.
   */
  toggleEditMode(active) {
    // The Settings page is static and non-editable
    if (this.app.activePageId === 'page_settings') {
      this.app.isEditMode = false;
      this.app.editToolbar.hide();
      return;
    }

    // Can't edit a landscape-only page's layout while it's showing the
    // rotate-device prompt — there's no grid mounted to drag widgets on.
    if (active) {
      const page = this.app.activeProfile.getPage(this.app.activePageId);
      if (page && page.orientationLock === 'landscape' && this.app.currentOrientation !== 'landscape') {
        this.app.showToast('Rotate your device to landscape to customize this page.');
        return;
      }
    }

    this.app.isEditMode = active;
    if (this.app.gridContainer) {
      this.app.gridContainer.classList.toggle('edit-mode-active', active);
    }
    this.app.cornerOverlayEl?.classList.toggle('edit-mode-active', active);

    for (const w of this.app.activeWidgetInstances) {
      w.setEditMode(active);
    }

    // Pencil-icon toggle on the menu corner widget; the toolbar always
    // starts visible on entry/exit -- the pencil is a temporary peek
    // toggle, not a persisted preference (see toggleEditToolbarVisibility()).
    this.app.editToolbarVisible = true;
    this.app.menuToggleWidget?.setAppEditMode(active);

    if (active) {
      this.app.saveHistorySnapshot();
      this.app.editToolbar.setOrientation(this.app.currentOrientation);
      this.app.editToolbar.show();
    } else {
      this.app.editToolbar.hide();
    }
  }

  /**
   * Shows or hides the edit toolbar without changing edit mode. The visibility
   * flag is reset on edit entry and exit.
   */
  toggleEditToolbarVisibility() {
    this.app.editToolbarVisible = !this.app.editToolbarVisible;
    if (this.app.editToolbarVisible) {
      this.app.editToolbar.show();
    } else {
      this.app.editToolbar.hide();
    }
  }

  /**
   * Persists the boolean nudge preference as a localStorage string and updates
   * the toolbar indicator.
   * @param {boolean} enabled - Whether occupied drops may nudge widgets.
   */
  toggleAutoReposition(enabled) {
    this.app.autoRepositionEnabled = enabled;
    localStorage.setItem('flightdeck_auto_reposition', String(enabled));
    this.app.editToolbar?.setAutoRepositionState(enabled);
  }

  /**
   * Adds a widget to the active tier and orientation after a snapshot and layout
   * normalization. Scales its declared width, avoids reserved corners, copies
   * config deeply, renders, and may open add configuration.
   * @param {string} widgetType - Catalog widget type.
   */
  addNewWidgetToPage(widgetType) {
    const page = this.app.activeProfile.getPage(this.app.activePageId);
    if (!page) return;

    this.app.saveHistorySnapshot();

    const orientation = this.app.currentOrientation;
    const tier = this.app.currentDeviceTier;
    const currentWidgets = page.getWidgets(orientation, tier);

    // Normalize layout data without closing intentional gaps.
    const compacted = this.app.layoutEngine.normalizeLayout(currentWidgets);
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
    const reserved = this.app.getReservedCornerEntries(orientation, tier, thisGrid);
    const layout = this.app.layoutEngine.findNextFreeSlot(
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

    // Page.addWidget() writes only to this tier and orientation. Keep the
    // opposite layout independently authored; explicit Mirror Layout is the
    // separate whole-layout copy action.
    page.addWidget(newWidgetConfig, orientation, tier);

    // Re-render to update and synchronize all layout positions.
    this.app.renderActivePage();

    // "Quick add" widget types (currently just the configurable button) open
    // their own config popover immediately after being placed -- Cancel
    // there undoes this whole add via handleUndo(), reusing the snapshot
    // saveHistorySnapshot() provides the state restored by the popover's Cancel.
    if (descriptor?.openConfigOnAdd) {
      const newInstance = this.app.activeWidgetInstances.find((w) => w.id === newWidgetConfig.id);
      if (newInstance) {
        this.app.openButtonConfigPopover(newInstance, 'add');
      }
    }
  }

  /**
   * Opens the button configuration popover in add or edit mode when the live
   * instance or its ID resolves; missing IDs do nothing.
   * @param {string|object} widgetOrId - Live widget or its ID.
   * @param {'add'|'edit'} mode - Popover mode.
   */
  openButtonConfigPopover(widgetOrId, mode) {
    const widget = typeof widgetOrId === 'string'
      ? this.app.activeWidgetInstances.find((w) => w.id === widgetOrId)
      : widgetOrId;
    if (widget) {
      this.app.buttonConfigPopover.open(widget, { mode });
    }
  }

  /**
   * Removes a removable widget in the requested orientation and current tier.
   * Refusals toast without a snapshot; accepted removals normalize and
   * synchronize surviving instances without rendering.
   * @param {string} widgetId - Widget ID.
   * @param {'portrait'|'landscape'} [orientation] - Defaults to the live app orientation.
   */
  removeWidgetFromPage(widgetId, orientation = this.app.currentOrientation) {
    const page = this.app.activeProfile.getPage(this.app.activePageId);
    if (!page) return;

    // Widgets marked non-removable (e.g. the Virtual Yoke page's built-in
    // Center / Detach controls) can't be removed via REMOVE_WIDGET even if
    // it's published directly — the primary UI-level guards live in
    // BaseWidget.renderEditOverlay() and PropertyInspector.handleRemove().
    const tier = this.app.currentDeviceTier;
    const target = page.getWidgets(orientation, tier).find((w) => w.id === widgetId);
    if (target && target.config?.removable === false) {
      this.app.showToast('This widget is built into the page and cannot be removed.');
      return;
    }

    this.app.saveHistorySnapshot();

    // Remove strictly from the layout tier + orientation where edit was initiated
    page.removeWidget(widgetId, orientation, tier);

    // Normalize current tier + orientation (no gap-closing — see renderActivePage)
    const updated = this.app.layoutEngine.normalizeLayout(page.getWidgets(orientation, tier));
    page.setWidgets(orientation, tier, updated);

    const instanceIdx = this.app.activeWidgetInstances.findIndex((w) => w.id === widgetId);
    if (instanceIdx !== -1) {
      this.app.activeWidgetInstances[instanceIdx].destroy();
      this.app.activeWidgetInstances.splice(instanceIdx, 1);
    }

    // Sync all remaining instances
    for (const inst of this.app.activeWidgetInstances) {
      const matching = updated.find((w) => w.id === inst.id);
      if (matching) {
        inst.layout = { ...matching.layout };
        inst.applyLayoutStyles();
      }
    }
  }

  /**
   * Snapshots and updates layout through reserved-corner resolution and config
   * in the requested orientation and active tier. Missing partial arguments
   * throw during destructuring.
   * @param {string} widgetId - Widget ID.
   * @param {{layout?: object, config?: object}} partial - Requested changes.
   * @param {'portrait'|'landscape'} [orientation] - Defaults to the live app orientation.
   */
  handleUpdateWidgetConfig(widgetId, { layout, config }, orientation = this.app.currentOrientation) {
    const page = this.app.activeProfile.getPage(this.app.activePageId);
    if (!page) return;

    this.app.saveHistorySnapshot();

    const tier = this.app.currentDeviceTier;
    const gridSpec = page.getGrid(orientation, tier) || LayoutEngine.getGridSpec(orientation, tier);
    if (gridSpec?.columns) {
      this.app.layoutEngine.gridCols = gridSpec.columns;
    }

    if (layout) {
      const reserved = this.app.getReservedCornerEntries(orientation, tier, gridSpec);
      const currentWidgets = page.getWidgets(orientation, tier);
      const updatedWidgets = this.app.resolveWithReservedCorners(widgetId, layout, currentWidgets, reserved);
      page.setWidgets(orientation, tier, updatedWidgets);

      for (const inst of this.app.activeWidgetInstances) {
        const matching = updatedWidgets.find((w) => w.id === inst.id);
        if (matching) {
          inst.layout = { ...matching.layout };
          inst.applyLayoutStyles();
        }
      }
    }

    if (config) {
      // Scoped strictly to the active tier + orientation layout
      page.updateWidget(widgetId, { config }, orientation, false, tier);
      const widgetInstance = this.app.activeWidgetInstances.find((w) => w.id === widgetId);
      if (widgetInstance) {
        widgetInstance.updateConfig(config);
      }
    }
  }

  /**
   * Copies the active layout to the opposite orientation of the same tier and
   * evicts target reserved-corner overlaps. This public method has no UI caller.
   */
  handleMirrorLayout() {
    const page = this.app.activeProfile.getPage(this.app.activePageId);
    if (!page) return;

    this.app.saveHistorySnapshot();

    const tier = this.app.currentDeviceTier;
    const fromOrientation = this.app.currentOrientation;
    const toOrientation = fromOrientation === 'portrait' ? 'landscape' : 'portrait';

    // Same-tier mirror only -- an author on the tablet/desktop tier mirrors
    // within that tier's own portrait/landscape, never into mobile's.
    const sourceWidgets = page.getWidgets(fromOrientation, tier);
    const sourceGrid = page.getGrid(fromOrientation, tier) || LayoutEngine.getGridSpec(fromOrientation, tier);
    const targetGrid = page.getGrid(toOrientation, tier) || LayoutEngine.getGridSpec(toOrientation, tier);

    let mirrored = this.app.layoutEngine.mirrorLayout(sourceWidgets, sourceGrid, targetGrid);

    // mirrorLayout() has no obstacle-list parameter to reserve the target
    // orientation's corner cells directly, so push anything that landed on
    // one out of the way as a post-pass -- see resolveListWithReservedCorners().
    const targetReserved = this.app.getReservedCornerEntries(toOrientation, tier, targetGrid);
    mirrored = this.app.resolveListWithReservedCorners(mirrored, targetReserved);

    page.setWidgets(toOrientation, tier, mirrored);

    console.log(`[FlightDeck] Layout mirrored from ${fromOrientation} to ${toOrientation}`);
  }

  /**
   * Pushes a JSON snapshot of the active profile and keeps the latest twenty.
   */
  saveHistorySnapshot() {
    const serialized = JSON.stringify(this.app.activeProfile.toJSON());
    this.app.historyStack.push(serialized);
    if (this.app.historyStack.length > 20) this.app.historyStack.shift();
  }

  /**
   * Restores the latest JSON profile snapshot through activation, then renders.
   * An empty stack resolves without changing state.
   * @returns {Promise<void>} Completes after the asynchronous profile operation.
   */
  async handleUndo() {
    if (this.app.historyStack.length === 0) return;
    const previous = this.app.historyStack.pop();
    this.app.activeProfile = await this.app.activateProfile(JSON.parse(previous));
    this.app.renderActivePage();
  }

  /**
   * Explicitly closes gaps while treating reserved corners as obstacles,
   * filters those fixtures from page storage, then renders.
   */
  handleCompactLayout() {
    const page = this.app.activeProfile.getPage(this.app.activePageId);
    if (!page) return;

    this.app.saveHistorySnapshot();

    const orientation = this.app.currentOrientation;
    const tier = this.app.currentDeviceTier;
    const gridSpec = page.getGrid(orientation, tier) || LayoutEngine.getGridSpec(orientation, tier);
    // Reserved corner cells count as obstacles here too, so compaction never
    // pulls a real widget up into one.
    const reserved = this.app.getReservedCornerEntries(orientation, tier, gridSpec);
    const compacted = this.app.layoutEngine.compactLayout([...page.getWidgets(orientation, tier), ...reserved])
      .filter((w) => !reserved.some((r) => r.id === w.id));
    page.setWidgets(orientation, tier, compacted);

    this.app.renderActivePage();
  }

  /**
   * Makes the active page persistable, saves the active profile JSON, then
   * exits edit mode. Rejected persistence propagates.
   * @returns {Promise<void>} Completes after the asynchronous profile operation.
   */
  async handleSaveLayout() {
    await this.app.ensureEditableProfile();
    await this.app.storage.saveProfile(this.app.activeProfile.toJSON());
    this.app.toggleEditMode(false);
  }

  /**
   * Reloads the stored profile when present, then exits edit mode and renders.
   * Storage or activation errors propagate.
   * @returns {Promise<void>} Completes after the asynchronous profile operation.
   */
  async handleCancelEdit() {
    const raw = await this.app.storage.getProfile(this.app.activeProfile.id);
    if (raw) {
      this.app.activeProfile = await this.app.activateProfile(raw);
    }
    this.app.toggleEditMode(false);
    this.app.renderActivePage();
  }
}
