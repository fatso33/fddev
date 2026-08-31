/**
 * AppProfileWidget.js
 * Corner-pinned widget for the App Profile badge (aircraft/profile name,
 * long-press to open the App Profile switcher). Instantiated fresh on every
 * FlightDeckApp.renderActivePage() call (see getCornerWidgetLayouts()) and
 * mounted into the .fd-corner-overlay floated above the page grid's top-right
 * cells, not stored on any Profile/Page, and never user-removable.
 *
 * Only renders the visual badge — the long-press-to-open wiring stays owned
 * by app.js (wireCornerInteractions/attachLongPressOpen), reading this
 * widget's `.element` the same way it used to read the old static
 * #aircraft-model element. See VirtualYokeCenterWidget.js for the same
 * "thin, host-app-driven widget" pattern.
 */

import { BaseWidget } from './BaseWidget.js';
import { SecurityValidator } from '../core/SecurityValidator.js';

export class AppProfileWidget extends BaseWidget {
  render() {
    const root = this.renderRoot;
    const toRemove = Array.from(root.children).filter((el) => el.tagName !== 'LINK' && el.tagName !== 'STYLE');
    toRemove.forEach((el) => el.remove());

    // See MenuToggleWidget.js's identical comment -- the widget's own grid
    // cell (totalCols) is deliberately wider than the visible badge
    // (visibleCols), permanent reserved padding toward the true screen
    // edge. A nested CSS Grid matching the outer page grid's column
    // count/gap reproduces its exact per-column pixel width, so the badge
    // stays exactly its pre-widen size, just shifted inward.
    const totalCols = Math.max(1, this.config.totalCols || 1);
    const visibleCols = Math.max(1, Math.min(totalCols, this.config.visibleCols || totalCols));
    const gap = this.config.gap || 0;

    const wrapper = document.createElement('div');
    wrapper.style.display = 'grid';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.gridTemplateColumns = `repeat(${totalCols}, minmax(0, 1fr))`;
    wrapper.style.gap = `${gap}px`;

    const badge = document.createElement('div');
    badge.className = 'aircraft-badge';
    badge.setAttribute('title', 'Long-press to switch App Profile');
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.boxSizing = 'border-box';
    // Left-aligned within the wider cell (toward the page's center, away
    // from the true right screen edge) via the leading visibleCols columns.
    badge.style.gridColumn = `1 / span ${visibleCols}`;
    // See MenuToggleWidget.js's identical comment -- prevents the grid
    // item's default min-width:auto from overflowing a too-narrow track.
    badge.style.minWidth = '0';

    this.badgeEl = badge;
    wrapper.appendChild(badge);
    root.appendChild(wrapper);
    this.setLabel(this.config.label || 'DEFAULT');
  }

  /**
   * @param {string} text
   */
  setLabel(text) {
    this._label = text;
    if (this.badgeEl) {
      SecurityValidator.setText(this.badgeEl, text);
    }
  }
}
