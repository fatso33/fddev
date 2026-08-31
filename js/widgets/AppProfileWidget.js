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

    const badge = document.createElement('div');
    badge.className = 'aircraft-badge';
    badge.setAttribute('title', 'Long-press to switch App Profile');
    // See MenuToggleWidget.js's identical comment — sized directly here
    // rather than via a second shadow-root stylesheet.
    badge.style.width = '100%';
    badge.style.height = '100%';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.boxSizing = 'border-box';

    this.badgeEl = badge;
    root.appendChild(badge);
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

  /**
   * See MenuToggleWidget.setFullscreenInset() for why this is a JS-toggled
   * class rather than a CSS :fullscreen selector -- this badge renders
   * inside a real Shadow DOM, and :fullscreen only ever matches <html>,
   * outside that shadow tree.
   * @param {boolean} active
   */
  setFullscreenInset(active) {
    if (!this.badgeEl) return;
    this.badgeEl.classList.toggle('fs-inset', Boolean(active));
  }
}
