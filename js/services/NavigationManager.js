/**
 * @module NavigationManager
 * Owns active-page selection and custom menu entries while the app retains
 * the public facade and live state. It reads `activeProfile`, `isEditMode`,
 * `storage`, `settingsView`, and `activePageId`; it writes `activePageId`,
 * menu classes and edit-action visibility, and custom menu DOM. Page creation
 * and deletion remain in Settings; these entries only select existing pages.
 * It calls the facade's `handleCancelEdit`, `renderActivePage`, and
 * `switchPage` methods. Custom
 * button listeners live on replaceable buttons and are released when those
 * buttons are removed. The service owns no timers or long-lived listeners.
 */

import { SecurityValidator } from '../core/SecurityValidator.js';

/**
 * Coordinates page selection and menu construction against one live app.
 * Construction stores the reference without reading or mutating app state.
 */
export class NavigationManager {
  /**
   * Creates the page-navigation coordinator.
   * @param {import('../app.js').FlightDeckApp} app - Live app state and facade methods.
   */
  constructor(app) {
    this.app = app;
  }

  /**
   * Selects a page, updates the static navigation state, and renders it.
   * Edit cancellation remains un-awaited so the selected page renders before
   * cancel completes and the facade's cancellation path performs its second render.
   * @param {string} pageId - Destination page identifier.
   * @returns {void} Rendering and cancellation errors propagate to the caller.
   */
  switchPage(pageId) {
    if (this.app.isEditMode) {
      this.app.handleCancelEdit();
    }
    this.app.activePageId = pageId;

    // Update active state in nav dropdown.
    const menuDropdown = document.getElementById('menu-dropdown');
    if (menuDropdown) {
      for (const btn of menuDropdown.querySelectorAll('.menu-item-btn[data-page]')) {
        const key = btn.dataset.page;
        btn.classList.toggle('active', `page_${key}` === pageId);
      }

      // Hide or disable Customize Dashboard option on Settings.
      const editBtn = document.getElementById('menu-edit-mode-btn');
      if (editBtn) {
        editBtn.style.display = (pageId === 'page_settings') ? 'none' : 'flex';
      }
    }

    this.app.renderActivePage();
  }

  /**
   * Rebuilds custom-page entries from the active profile. Shipped navigation
   * remains static in index.html; custom entries navigate to existing profile
   * pages and are inserted before the dashboard action, Settings, or divider
   * in that priority order.
   * @returns {void} Missing menu/profile is a no-op; storage or DOM errors propagate.
   */
  renderPageMenu() {
    const app = this.app;
    const menuDropdown = document.getElementById('menu-dropdown');
    if (!menuDropdown || !app.activeProfile) return;

    for (const el of menuDropdown.querySelectorAll('.menu-item-btn[data-custom-page]')) el.remove();

    const shippedPageIds = new Set(app.storage.getDefaultProfiles()[0].pages.map((p) => p.id));
    const customPages = app.activeProfile.pages.filter((p) => !shippedPageIds.has(p.id));
    const anchor = document.getElementById('menu-edit-mode-btn')
      || menuDropdown.querySelector('.menu-item-btn[data-page="settings"]')
      || menuDropdown.querySelector('.menu-divider');

    for (const page of customPages) {
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
        app.switchPage(page.id);
        menuDropdown.classList.remove('open');
      });
      menuDropdown.insertBefore(btn, anchor);
    }

    if (app.settingsView && app.activePageId === 'page_settings') {
      app.settingsView.refreshPagesList();
    }
  }
}
