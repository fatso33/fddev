/**
 * @module PageRenderer
 * Renders the active page and updates orientation geometry using the live app.
 * Reads the profile, page, layout, widget, UI and orientation fields; writes
 * currentOrientation, currentDeviceTier, activePageId, activeWidgetInstances,
 * gridContainer, isEditMode and the body's device tier. It delegates corner
 * teardown/mount and drag, lock and reserved-cell operations to their owners.
 * Each render destroys page widgets and the prior overlay before clearing DOM;
 * an in-place resize only updates grid CSS and mounted widget layout styles.
 * This module owns no persistent listener, timer, socket or storage write.
 */

import { LayoutEngine } from '../core/LayoutEngine.js';
import { WidgetRegistry } from '../widgets/WidgetRegistry.js';

/**
 * Updates toolbar and current orientation for a watcher event. Settings
 * returns after that update. A same-orientation, same-tier resize refreshes
 * mounted geometry; other changes use the app's full render facade.
 * @param {import('../app.js').FlightDeckApp} app - Live app state and facades.
 * @param {'portrait'|'landscape'} newOrientation - Watcher-reported orientation.
 * @param {boolean} isResize - Watcher metadata; retained for facade compatibility.
 * @returns {void} Collaborator errors propagate without recovery.
 */
export function handleOrientationChange(app, newOrientation, isResize = false) {
  const currentWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const currentHeight = typeof window !== 'undefined' ? window.innerHeight : 768;
  const newDeviceTier = LayoutEngine.getDeviceTier(currentWidth, currentHeight);
  const orientationActuallyChanged = newOrientation !== app.currentOrientation;
  const tierActuallyChanged = newDeviceTier !== app.currentDeviceTier;

  app.currentOrientation = newOrientation;
  if (app.editToolbar) {
    app.editToolbar.setOrientation(newOrientation);
  }

  if (app.activePageId === 'page_settings') {
    return;
  }

  // The watcher's >5 px threshold also fires for keyboard, fullscreen and
  // browser-chrome height changes. Rebuilding widgets in those cases loses
  // focus and can paint twice at transient sizes. If orientation and tier
  // are unchanged, only pixel geometry needs an in-place refresh.
  if (!orientationActuallyChanged && !tierActuallyChanged) {
    app.currentDeviceTier = newDeviceTier;
    app.refreshGridGeometry(newOrientation, newDeviceTier);
    return;
  }

  app.renderActivePage();
}

/**
 * Re-measures column width for an unchanged orientation and tier, updates
 * mounted grid CSS, and asks widgets to apply their existing layout styles.
 * Retaining DOM identity preserves focus, keyboard state and in-progress edits.
 * @param {import('../app.js').FlightDeckApp} app - Live app state and mounted containers.
 * @param {'portrait'|'landscape'} orientation - Current layout orientation.
 * @param {'mobile'|'tablet'} deviceTier - Current layout tier.
 * @returns {void} Updates CSS and widget styles in place; collaborator errors propagate.
 */
export function refreshGridGeometry(app, orientation, deviceTier) {
  if (app.cornerOverlayEl) {
    const page =
      app.activePageId === 'page_settings' ? null : app.activeProfile.getPage(app.activePageId);
    const gridSpecForCorners = {
      ...(page?.getGrid(orientation, deviceTier) ||
        LayoutEngine.getGridSpec(orientation, deviceTier)),
    };
    const liveCornerColWidth = app.layoutEngine.measureColumnWidth(
      app.cornerOverlayEl,
      gridSpecForCorners,
    );
    if (liveCornerColWidth) gridSpecForCorners.rowHeight = liveCornerColWidth;
    app.layoutEngine.applyGridToContainer(app.cornerOverlayEl, gridSpecForCorners);
    // biome-ignore lint/complexity/noForEach: Preserve the original sparse-array iteration behavior.
    app.cornerWidgetInstances.forEach((w) => w.applyLayoutStyles());
  }

  if (app.gridContainer) {
    const page =
      app.activePageId === 'page_settings' ? null : app.activeProfile.getPage(app.activePageId);
    if (page) {
      const gridSpec = {
        ...(page.getGrid(orientation, deviceTier) ||
          LayoutEngine.getGridSpec(orientation, deviceTier)),
      };
      const liveColWidth = app.layoutEngine.measureColumnWidth(app.gridContainer, gridSpec);
      if (liveColWidth) gridSpec.rowHeight = liveColWidth;
      app.layoutEngine.applyGridToContainer(app.gridContainer, gridSpec);
      // biome-ignore lint/complexity/noForEach: Preserve the original sparse-array iteration behavior.
      app.activeWidgetInstances.forEach((w) => w.applyLayoutStyles());
    }
  }
}

/**
 * Destroys the previous page and corner instances, then mounts the current
 * branch in the original order. Page layout is normalized and pushed out of
 * reserved corner cells in memory; it is not persisted by rendering. Measured
 * column width in pixels overrides row height to keep grid cells square.
 * @param {import('../app.js').FlightDeckApp} app - Live app state and public facades.
 * @param {{teardown: (app: import('../app.js').FlightDeckApp) => void,
 *   mount: (orientation: string, tier: string, gridSpec: object) => void}} corners
 *   - Injected corner owner operations; mount calls the public facade method.
 * @returns {void} Rendering, widget and DOM errors propagate without rollback.
 */
export function renderActivePage(app, corners) {
  const currentWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const currentHeight = typeof window !== 'undefined' ? window.innerHeight : 768;
  const orientation = app.layoutEngine.getOrientation(currentWidth, currentHeight);
  app.currentOrientation = orientation;
  const deviceTier = LayoutEngine.getDeviceTier(currentWidth, currentHeight);
  app.currentDeviceTier = deviceTier;
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.deviceTier = deviceTier;
  }

  // Clean up active + corner widget instances
  // biome-ignore lint/complexity/noForEach: Preserve the original sparse-array iteration behavior.
  app.activeWidgetInstances.forEach((w) => w.destroy());
  app.activeWidgetInstances = [];
  corners.teardown(app);

  // Clean up settings view if previously mounted
  if (app.settingsView) {
    app.settingsView.destroy();
  }

  app.contentArea.innerHTML = '';

  // Corner overlay (menu toggle + App Profile badge) -- built as the
  // first child of #content-area on EVERY branch below (Settings,
  // no-page, rotate-prompt, normal), since these two widgets must always
  // be visible and are never stored per-page/profile data (they're
  // destroyed above and rebuilt fresh every render -- cheap, since they
  // carry no bindings/state). Uses the current page's own gridSpec when
  // one resolves (so column math matches the real grid exactly, even if a
  // page ever declares a custom grid), falling back to the tier default
  // for 'page_settings' (no real Page entry) or an as-yet-unresolved page.
  let page =
    app.activePageId === 'page_settings' ? null : app.activeProfile.getPage(app.activePageId);
  const gridSpecForCorners =
    page?.getGrid(orientation, deviceTier) ||
    LayoutEngine.getGridSpec(orientation, deviceTier);
  corners.mount(orientation, deviceTier, gridSpecForCorners);

  // If active page is Settings, render the static non-editable Settings View
  if (app.activePageId === 'page_settings') {
    if (app.isEditMode) {
      app.isEditMode = false;
    }
    app.editToolbar.hide();
    app.rotatePrompt.hide();
    app.virtualYoke.stop();
    app.settingsView.mount(app.contentArea);
    return;
  }

  // Get current page (falls back to the profile's first page if the
  // stored activePageId no longer resolves to anything)
  if (!page) {
    page = app.activeProfile.pages[0];
    if (page) app.activePageId = page.id;
  }

  if (!page) {
    app.rotatePrompt.hide();
    app.virtualYoke.stop();
    app.gridContainer = document.createElement('div');
    app.gridContainer.className = 'fd-page-grid';
    app.gridContainer.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 40px 0;">No avionics widgets on this page.</div>`;
    app.contentArea.appendChild(app.gridContainer);
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
    app.tryLockOrientation('landscape');
  } else {
    app.tryUnlockOrientation();
  }

  if (needsLandscape && orientation !== 'landscape') {
    app.editToolbar.hide();
    app.rotatePrompt.show();
    app.virtualYoke.stop();
    return;
  }
  app.rotatePrompt.hide();

  // Create Grid Container for standard widget pages
  app.gridContainer = document.createElement('div');
  app.gridContainer.className = `fd-page-grid ${app.isEditMode ? 'edit-mode-active' : ''}`;
  app.contentArea.appendChild(app.gridContainer);

  const gridSpec = {
    ...(page.getGrid(orientation, deviceTier) || LayoutEngine.getGridSpec(orientation, deviceTier)),
  };
  // Square cells: derive row height from the actually-rendered column
  // width instead of trusting the tier's static default (or a stale
  // rowHeight baked into an old saved page's grid spec). Measured against
  // gridContainer since it's already attached to #content-area above.
  const liveColWidth = app.layoutEngine.measureColumnWidth(app.gridContainer, gridSpec);
  if (liveColWidth) gridSpec.rowHeight = liveColWidth;
  app.layoutEngine.applyGridToContainer(app.gridContainer, gridSpec);

  // Each tier and orientation is authored independently. An empty layout
  // stays empty until the explicit Mirror Layout action copies another.
  const widgets = page.getWidgets(orientation, deviceTier);

  // Normalize (not auto-compact) so old col/row-vs-x/y-only saved data
  // still resolves correctly, without pulling widgets up over a gap the
  // user deliberately left. Use the edit toolbar's explicit "Compact"
  // action to actually close gaps.
  const compacted = app.layoutEngine.normalizeLayout(widgets || []);

  // A saved layout may place widgets in the menu/App Profile corner cells.
  // Push overlaps away on each render; write only to the live Profile, with
  // durable persistence deferred until an explicit edit-mode Save.
  const reservedForReflow = app.getReservedCornerEntries(orientation, deviceTier, gridSpec);
  const finalWidgets = app.resolveListWithReservedCorners(compacted, reservedForReflow);
  page.setWidgets(orientation, deviceTier, finalWidgets);

  // Instantiate and mount all widgets
  // biome-ignore lint/complexity/noForEach: Preserve the original sparse-array iteration behavior.
  finalWidgets.forEach((wConfig) => {
    const widgetInstance = WidgetRegistry.createWidget(wConfig, app.eventBus);
    if (!widgetInstance) return;
    widgetInstance.mount(app.gridContainer);
    widgetInstance.setEditMode(app.isEditMode);
    app.attachDragHandlers(widgetInstance);
    app.activeWidgetInstances.push(widgetInstance);
  });

  // If edit toolbar is active, keep it visible (unless the user manually
  // hid it via the menu corner widget's pencil toggle -- see
  // toggleEditToolbarVisibility()) and update orientation badge
  if (app.isEditMode) {
    app.editToolbar.setOrientation(orientation);
    if (app.editToolbarVisible) {
      app.editToolbar.show();
    } else {
      app.editToolbar.hide();
    }
  } else {
    app.editToolbar.hide();
  }

  if (app.activePageId === 'page_yoke') {
    app.virtualYoke.start();
  } else {
    app.virtualYoke.stop();
  }
}
