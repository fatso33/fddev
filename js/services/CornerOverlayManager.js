/**
 * @module CornerOverlayManager
 * Owns each render's corner overlay, its two widget instances, and their
 * element-scoped interactions. The app retains the public fields and methods;
 * this service reads live app state and writes only those four corner fields.
 * Destruction precedes content replacement on every page-render branch.
 */

import { WidgetRegistry } from '../widgets/WidgetRegistry.js';

/**
 * Destroys the current corner widgets and clears their app references.
 * Called before the page renderer clears #content-area; existing pointer
 * listeners remain attached only to the destroyed elements. A widget destroy
 * error propagates and stops later resets, retaining the original order.
 * @param {import('../app.js').FlightDeckApp} app - Live app instance.
 * @returns {void}
 */
export function teardown(app) {
  for (const widget of app.cornerWidgetInstances) widget.destroy();
  app.cornerWidgetInstances = [];
  app.menuToggleWidget = null;
  app.appProfileWidget = null;
  app.cornerOverlayEl = null;
}

/**
 * Appends, measures and mounts the overlay on every page-render branch.
 * The overlay must be attached before measuring its column width in pixels;
 * that width becomes the square-cell row height when nonzero. Indicators
 * paint below widgets and cover the full reserved grid spans.
 * Widget creation and layout errors propagate without a partial-mount cleanup.
 * @param {import('../app.js').FlightDeckApp} app - Live app instance and layout dependencies.
 * @param {'portrait'|'landscape'} orientation - Current screen orientation.
 * @param {'mobile'|'tablet'} deviceTier - Current layout tier.
 * @param {object} gridSpec - Page grid specification, including column count and gap.
 * @returns {void}
 */
export function mountCornerWidgets(app, orientation, deviceTier, gridSpec) {
  const overlay = document.createElement('div');
  overlay.className = 'fd-corner-overlay';
  // A disconnected element measures as zero and skips square-cell derivation.
  app.contentArea.appendChild(overlay);
  const resolvedGridSpec = { ...gridSpec };
  const liveColWidth = app.layoutEngine.measureColumnWidth(overlay, resolvedGridSpec);
  if (liveColWidth) resolvedGridSpec.rowHeight = liveColWidth;
  app.layoutEngine.applyGridToContainer(overlay, resolvedGridSpec);
  app.cornerOverlayEl = overlay;
  overlay.classList.toggle('edit-mode-active', app.isEditMode);

  const { menu, profile } = app.getCornerWidgetLayouts(orientation, deviceTier, gridSpec);
  // The invisible indicators reserve full footprints, including the edge
  // margins outside each visible control, while editing.
  for (const entry of [menu, profile]) {
    const indicator = document.createElement('div');
    indicator.className = 'fd-reserved-corner-indicator';
    indicator.style.gridColumn = `${entry.layout.col} / span ${entry.layout.w}`;
    indicator.style.gridRow = `${entry.layout.row} / span ${entry.layout.h}`;
    overlay.appendChild(indicator);
  }

  const menuInstance = WidgetRegistry.createWidget(menu, app.eventBus);
  menuInstance.mount(overlay);
  // The overlay passes pointer input through to real widgets; controls opt in.
  menuInstance.element.style.pointerEvents = 'auto';
  app.cornerWidgetInstances.push(menuInstance);
  app.menuToggleWidget = menuInstance;

  const profileInstance = WidgetRegistry.createWidget(profile, app.eventBus);
  profileInstance.mount(overlay);
  profileInstance.element.style.pointerEvents = 'auto';
  app.cornerWidgetInstances.push(profileInstance);
  app.appProfileWidget = profileInstance;

  app.updateMenuButtonStatus();
  app.wireCornerInteractions();
}

/**
 * Wires interactions to the current corner widget elements only. The app's
 * one-time document outside-click listener reads the live menu field, avoiding
 * a persistent listener per render. Long-press timing stays with the app's
 * existing attachLongPressOpen helper. Callback errors propagate to the event
 * dispatcher as before.
 * @param {import('../app.js').FlightDeckApp} app - Live app instance and UI callbacks.
 * @returns {void}
 */
export function wireCornerInteractions(app) {
  const badgeEl = app.appProfileWidget?.element;
  if (badgeEl) {
    app.attachLongPressOpen(badgeEl, () => {
      if (app.profileSelector) app.profileSelector.open();
    });
  }

  const menuBtn = app.menuToggleWidget?.element;
  const menuDropdown = document.getElementById('menu-dropdown');
  if (!menuBtn || !menuDropdown) return;

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // In edit mode the same control toggles the toolbar so it cannot cover
    // the corner widgets or real widgets placed between them.
    if (app.isEditMode) {
      app.toggleEditToolbarVisibility();
      return;
    }
    const editBtn = document.getElementById('menu-edit-mode-btn');
    if (editBtn) {
      editBtn.style.display = (app.activePageId === 'page_settings') ? 'none' : 'flex';
    }
    // Position at the current button rect on open only: tier/orientation
    // change its x coordinate, while closing must not shift the animation.
    const opening = !menuDropdown.classList.contains('open');
    if (opening) {
      const btnRect = menuBtn.getBoundingClientRect();
      menuDropdown.style.left = `${Math.round(btnRect.left)}px`;
    }
    menuDropdown.classList.toggle('open');
  });
}
