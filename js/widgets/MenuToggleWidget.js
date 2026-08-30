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

    const btn = document.createElement('button');
    btn.className = 'garmin-menu-btn';
    // Full-bleed within the widget's grid cell — main.css's .garmin-menu-btn
    // rule has no width/height:100% of its own (it was previously sized by
    // .top-bar's flex layout instead), so set it directly here rather than
    // fighting adoptedStyleSheets cascade ordering with a second stylesheet.
    btn.style.width = '100%';
    btn.style.height = '100%';

    this.buttonEl = btn;
    root.appendChild(btn);
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
