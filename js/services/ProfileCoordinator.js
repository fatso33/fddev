/**
 * @module ProfileCoordinator
 * Coordinates App Profile activation, default forks, custom pages and reverts.
 * The app retains the sole active-profile and active-page fields; StorageManager
 * remains the sole persistent store. This service holds only the live app
 * reference and owns no timers, listeners, sockets or DOM nodes. UI refreshes
 * go through the app facade so each call observes current state.
 */

import { Profile } from '../models/Profile.js';
import { Page } from '../models/Page.js';

/**
 * Operates on one app's live profile and delegates persistence to its storage.
 */
export class ProfileCoordinator {
  /**
   * @param {import('../app.js').FlightDeckApp} app - Live app state and UI facades.
   */
  constructor(app) {
    this.app = app;
  }

  /**
   * Creates a fresh Profile from raw data and fills inherited pages only when
   * the referenced parent exists. The returned object is not made active here.
   * @param {object} raw - Stored profile data.
   * @returns {Promise<Profile>} Hydrated profile; storage errors propagate.
   */
  async activateProfile(raw) {
    const profile = new Profile(raw);
    if (profile.parentProfileId) {
      const parentRaw = await this.app.storage.getProfile(profile.parentProfileId);
      if (parentRaw) {
        profile.hydrateInheritedPages(new Profile(parentRaw));
      }
    }
    return profile;
  }

  /**
   * Makes the current page persistable: an inherited page becomes an own
   * override; an edit of a shipped default forks it first. Shipped defaults
   * stay intact, preserving per-page revert and Bridge sync semantics.
   * @returns {Promise<void>} Persistence failures from a fork propagate.
   */
  async ensureEditableProfile() {
    if (!this.app.storage.isDefaultProfile(this.app.activeProfile.id)) {
      if (this.app.activeProfile.parentProfileId && !this.app.activeProfile.hasOwnPage(this.app.activePageId)) {
        this.app.activeProfile.promoteToOwnPage(this.app.activePageId);
      }
      return;
    }
    const editedPage = this.app.activeProfile.getPage(this.app.activePageId);
    await this.app.forkFromDefault(editedPage);
  }

  /**
   * Reuses the first fork of the current default or creates a uniquely named
   * Custom fork. An optional page is deep-copied as its sole own override.
   * Saves before selecting, reactivating and refreshing the visible label.
   * @param {Page|null} pageToMove - Edited page to retain, or null for a new page.
   * @returns {Promise<void>} Storage failures propagate before UI refresh.
   */
  async forkFromDefault(pageToMove = null) {
    const defaultId = this.app.activeProfile.id;
    const allProfiles = await this.app.storage.getAllProfiles();
    let forkRaw = allProfiles.find((p) => p.parentProfileId === defaultId);

    if (!forkRaw) {
      let name = 'Custom';
      let suffix = 2;
      while (allProfiles.some((p) => p.name === name)) {
        name = `Custom (${suffix++})`;
      }
      forkRaw = {
        id: `custom_${defaultId}`,
        profileId: `custom_${defaultId}`,
        name,
        aircraft: name,
        description: `Custom App Profile forked from ${this.app.activeProfile.name}`,
        aircraftCategory: this.app.activeProfile.aircraftCategory,
        version: this.app.activeProfile.version,
        parentProfileId: defaultId,
        pages: []
      };
    }

    const forkProfile = new Profile(forkRaw);
    if (pageToMove) {
      forkProfile.removeOwnPage(pageToMove.id);
      forkProfile.addPage(new Page(JSON.parse(JSON.stringify(pageToMove.toJSON()))));
    }

    await this.app.storage.saveProfile(forkProfile.toJSON());
    await this.app.storage.setActiveProfileId(forkProfile.id);
    this.app.activeProfile = await this.app.activateProfile(forkProfile.toJSON());

    if (this.app.profileSelector) this.app.profileSelector.refreshList();
    if (this.app.appProfileWidget) {
      this.app.appProfileWidget.setLabel(this.app.activeProfile.name.toUpperCase().slice(0, 7));
    }
  }

  /**
   * Prompts for a page name and adds a new custom page. Empty input is a no-op;
   * a shipped default is forked before the new page is persisted and shown.
   * @returns {Promise<void>} Prompt, storage and navigation errors propagate.
   */
  async handleAddCustomPage() {
    const name = prompt('Enter a name for the new page:');
    if (!name || !name.trim()) return;

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'page';
    const newPage = new Page({
      id: `page_custom_${slug}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      icon: 'grid'
    });

    if (this.app.storage.isDefaultProfile(this.app.activeProfile.id)) {
      await this.app.forkFromDefault();
    }
    this.app.activeProfile.addPage(newPage);
    await this.app.storage.saveProfile(this.app.activeProfile.toJSON());
    this.app.renderPageMenu();
    this.app.switchPage(newPage.id);
  }

  /**
   * Removes a non-shipped page, persists, refreshes the menu and selects a
   * fallback ID if needed. Rendering remains with the caller's next action.
   * @param {string} pageId - Custom page identifier.
   * @returns {Promise<void>} Missing profile or shipped page is a no-op.
   */
  async handleDeleteCustomPage(pageId) {
    if (!this.app.activeProfile) return;
    const shippedPageIds = new Set(this.app.storage.getDefaultProfiles()[0].pages.map((p) => p.id));
    if (shippedPageIds.has(pageId)) return;

    this.app.activeProfile.removePage(pageId);
    await this.app.storage.saveProfile(this.app.activeProfile.toJSON());
    this.app.renderPageMenu();

    if (this.app.activePageId === pageId) {
      const fallback = this.app.activeProfile.pages[0];
      this.app.activePageId = fallback ? fallback.id : 'page_settings';
    }
    this.app.showToast('Page deleted.');
  }

  /**
   * Returns the current profile's non-shipped page IDs and display names.
   * @returns {Array<{id: string, name: string}>} A new list, or empty without an active profile.
   */
  getCustomPages() {
    if (!this.app.activeProfile) return [];
    const shippedPageIds = new Set(this.app.storage.getDefaultProfiles()[0].pages.map((p) => p.id));
    return this.app.activeProfile.pages
      .filter((p) => !shippedPageIds.has(p.id))
      .map((p) => ({ id: p.id, name: p.name }));
  }

  /**
   * Removes one own-page override, rehydrates the parent fallback and saves
   * before rendering. Other overrides remain intact. Refusals show exact
   * explanatory toasts without storage writes.
   * @param {string} pageId - Page to restore from the parent.
   * @returns {Promise<void>} Storage or render errors propagate.
   */
  async handleRevertPageToDefault(pageId) {
    // Only a fork has a parent page to restore; removing a standalone page
    // would delete it without a fallback.
    if (!this.app.activeProfile.parentProfileId) {
      this.app.showToast('This page has no default version to revert to.');
      return;
    }
    if (!this.app.activeProfile.hasOwnPage(pageId)) {
      this.app.showToast('This page has no custom changes to revert.');
      return;
    }
    this.app.activeProfile.removeOwnPage(pageId);
    const parentRaw = await this.app.storage.getProfile(this.app.activeProfile.parentProfileId);
    if (parentRaw) {
      this.app.activeProfile.hydrateInheritedPages(new Profile(parentRaw));
    }
    await this.app.storage.saveProfile(this.app.activeProfile.toJSON());
    this.app.renderActivePage();
    this.app.showToast('Page reverted to default.');
  }
}
