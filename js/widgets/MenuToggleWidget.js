/**
 * MenuToggleWidget.js
 * Corner-pinned widget for the navigation menu toggle / PC Bridge & Simulator
 * connection status indicator. Instantiated fresh on every
 * FlightDeckApp.renderActivePage() call (see getCornerWidgetLayouts()) and
 * mounted into the .fd-corner-overlay floated above the page grid's top-left
 * cells, not stored on any Profile/Page, and never user-removable.
 *
 * This widget only renders the visual button — the dropdown open/close
 * logic, outside-click handling, and connection-status updates stay owned by
 * app.js (wireCornerInteractions/updateMenuButtonStatus), reading this
 * widget's `.element` the same way it used to read the old static
 * #menu-toggle-btn element. See VirtualYokeCenterWidget.js for the same
 * "thin, host-app-driven widget" pattern.
 *
 * While the app is in page-edit mode, this button swaps to a pencil icon and
 * its click behavior changes (app.js's wireCornerInteractions branches on
 * FlightDeckApp.isEditMode) from "open the nav dropdown" to "show/hide the
 * edit toolbar" — see FlightDeckApp.toggleEditToolbarVisibility(). That's
 * needed because the edit toolbar can otherwise cover the same top rows
 * these corner widgets (and any real widget placed between them) occupy.
 */

import { BaseWidget } from './BaseWidget.js';

const HAMBURGER_SVG = `
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="4" x2="20" y1="12" y2="12"></line>
    <line x1="4" x2="20" y1="6" y2="6"></line>
    <line x1="4" x2="20" y1="18" y2="18"></line>
  </svg>
`;

const PENCIL_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
  </svg>
`;

export class MenuToggleWidget extends BaseWidget {
  render() {
    const root = this.renderRoot;
    const toRemove = Array.from(root.children).filter((el) => el.tagName !== 'LINK' && el.tagName !== 'STYLE');
    toRemove.forEach((el) => el.remove());

    // The widget's own grid cell (totalCols) is deliberately 2 columns
    // wider than the visible button (visibleCols) -- permanent reserved
    // padding toward the true screen edge, so a curved-corner phone's
    // rounding never clips the button (see FlightDeckApp.
    // getCornerWidgetLayouts()). A nested CSS Grid with the same column
    // count/gap as the outer page grid reproduces its exact per-column
    // pixel width, so the button lands at exactly the same visual size as
    // the pre-widen 3-col cell, just shifted inward -- rather than
    // stretching to fill the wider cell.
    const totalCols = Math.max(1, this.config.totalCols || 1);
    const visibleCols = Math.max(1, Math.min(totalCols, this.config.visibleCols || totalCols));
    const gap = this.config.gap || 0;

    const wrapper = document.createElement('div');
    wrapper.style.display = 'grid';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.gridTemplateColumns = `repeat(${totalCols}, minmax(0, 1fr))`;
    wrapper.style.gap = `${gap}px`;

    const btn = document.createElement('button');
    btn.className = 'garmin-menu-btn';
    // Right-aligned within the wider cell (toward the page's center, away
    // from the true left screen edge) via the trailing visibleCols columns.
    btn.style.gridColumn = `${totalCols - visibleCols + 1} / span ${visibleCols}`;
    // A grid item's default min-width is `auto` (its content's own min
    // size), which can overflow past an assigned track that's narrower
    // than the button's icon+padding -- shrink instead of spilling into
    // the reserved padding columns whenever that happens.
    btn.style.minWidth = '0';

    this.buttonEl = btn;
    wrapper.appendChild(btn);
    root.appendChild(wrapper);
    this.setAppEditMode(Boolean(this.config.appEditMode));
    this.updateVisualState();
  }

  /**
   * @param {{bridgeConnected: boolean, simConnected: boolean}} status
   */
  setConnectionStatus({ bridgeConnected = false, simConnected = false } = {}) {
    this.bridgeConnected = bridgeConnected;
    this.simConnected = simConnected;
    this.updateVisualState();
  }

  updateVisualState() {
    if (!this.buttonEl) return;
    this.buttonEl.classList.toggle('bridge-connected', Boolean(this.bridgeConnected));
    this.buttonEl.classList.toggle('sim-connected', Boolean(this.simConnected));
  }

  /**
   * Swaps the hamburger icon for a pencil while the app is in page-edit
   * mode. Distinct from BaseWidget.setEditMode()/isEditMode -- app.js never
   * calls that generic edit-mode machinery on corner widgets, since they're
   * excluded from drag/edit-overlay entirely. This is purely a visual +
   * click-target-swap toggle driven directly by FlightDeckApp.toggleEditMode().
   * @param {boolean} active
   */
  setAppEditMode(active) {
    this.appEditMode = Boolean(active);
    if (!this.buttonEl) return;
    this.buttonEl.innerHTML = this.appEditMode ? PENCIL_SVG : HAMBURGER_SVG;
    this.buttonEl.setAttribute('aria-label', this.appEditMode ? 'Show/Hide Edit Toolbar' : 'Open Navigation Menu');
    this.buttonEl.setAttribute('title', this.appEditMode
      ? 'Show/hide the edit toolbar'
      : 'Menu — also shows PC Bridge/Simulator connection status');
  }
}
