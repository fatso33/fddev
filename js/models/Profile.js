/**
 * Profile.js
 * Aircraft profile domain entity with v2.3 Dual-Orientation Schemas
 */

import { Page } from './Page.js';

export class Profile {
  constructor({
    id,
    profileId,
    name,
    aircraft,
    description = '',
    aircraftCategory = 'General Aviation',
    version = '2.3.0',
    // Set only on a "Custom" App Profile auto-forked from a shipped default
    // (e.g. 'default_ga') the first time a user edits a page while that
    // default is active -- see app.js's ensureEditableProfile(). A forked
    // profile only ever stores the pages it actually overrides; any page
    // not present here is inherited live from the parent at activation time
    // (see hydrateInheritedPages() below), which is what lets a single page
    // ("Radios") be reverted independently of other edited pages ("Autopilot")
    // in the same fork.
    parentProfileId = null,
    pages = []
  } = {}) {
    this.id = id || profileId || `profile_${Date.now()}`;
    this.name = name || aircraft || 'New Aircraft';
    this.description = description;
    this.aircraftCategory = aircraftCategory;
    this.version = version || '2.3.0';
    this.parentProfileId = parentProfileId || null;
    this.pages = pages.map((p) => (p instanceof Page ? p : new Page(p)));
    // Runtime-only bookkeeping populated by hydrateInheritedPages() -- never
    // read from/written to the constructor payload or toJSON(), so an
    // inherited page never gets persisted as if it were a real override.
    this._inheritedPageIds = new Set();
  }

  /**
   * Retrieves page by ID -- includes pages hydrated in from a parent profile
   * via hydrateInheritedPages(), so rendering/editing code doesn't need to
   * know or care whether a given page is a real override or an inherited
   * fallback.
   * @param {string} pageId
   * @returns {Page|null}
   */
  getPage(pageId) {
    return this.pages.find((p) => p.id === pageId) || null;
  }

  /**
   * True if this profile stores a real override for the page (as opposed to
   * it being inherited from the parent, or absent entirely).
   * @param {string} pageId
   * @returns {boolean}
   */
  hasOwnPage(pageId) {
    return this.pages.some((p) => p.id === pageId) && !this._inheritedPageIds.has(pageId);
  }

  /**
   * Copies in any page the parent profile has that this fork doesn't
   * already override, tagging each as inherited (excluded from toJSON() and
   * from hasOwnPage()). No-op for a profile with no parentProfileId. Safe to
   * call more than once -- only fills gaps, never overwrites an existing page.
   * @param {Profile} parentProfile
   */
  hydrateInheritedPages(parentProfile) {
    if (!parentProfile) return;
    for (const parentPage of parentProfile.pages) {
      if (this.pages.some((p) => p.id === parentPage.id)) continue;
      const cloned = new Page(JSON.parse(JSON.stringify(parentPage.toJSON())));
      this.pages.push(cloned);
      this._inheritedPageIds.add(cloned.id);
    }
  }

  /**
   * Reverts a page to its inherited/default state by removing this
   * profile's own override, if any. Returns false if the page was already
   * inherited (nothing to revert) or doesn't exist here at all -- callers
   * should re-run hydrateInheritedPages() against the parent afterward to
   * restore the fallback copy for rendering.
   * @param {string} pageId
   * @returns {boolean}
   */
  removeOwnPage(pageId) {
    if (!this.hasOwnPage(pageId)) return false;
    const idx = this.pages.findIndex((p) => p.id === pageId);
    if (idx === -1) return false;
    this.pages.splice(idx, 1);
    return true;
  }

  /**
   * Promotes a currently-inherited page to a real override in place, so a
   * subsequent toJSON()/save persists it. Used when a page in an existing
   * fork is edited for the first time -- up to that point it was only ever
   * a live in-memory copy hydrated from the parent.
   * @param {string} pageId
   */
  promoteToOwnPage(pageId) {
    this._inheritedPageIds.delete(pageId);
  }

  /**
   * Adds or replaces page in profile
   * @param {Page|object} page
   */
  addPage(page) {
    const pageInstance = page instanceof Page ? page : new Page(page);
    const existingIdx = this.pages.findIndex((p) => p.id === pageInstance.id);
    if (existingIdx !== -1) {
      this.pages[existingIdx] = pageInstance;
    } else {
      this.pages.push(pageInstance);
    }
  }

  /**
   * Removes page by ID
   * @param {string} pageId
   */
  removePage(pageId) {
    const idx = this.pages.findIndex((p) => p.id === pageId);
    if (idx !== -1 && this.pages.length > 1) {
      this.pages.splice(idx, 1);
    }
  }

  /**
   * Clones profile with a new ID and name
   * @param {string} newName
   * @returns {Profile}
   */
  clone(newName) {
    const serialized = this.toJSON();
    const finalName = newName || `${this.name} (Copy)`;
    serialized.id = Profile.slugifyName(finalName);
    serialized.name = finalName;
    return new Profile(serialized);
  }

  /**
   * Readable, filename-safe id from a display name (e.g. "C172 v2" ->
   * "c172_v2_a91f") -- what PC Bridge names the synced file after
   * (userPresetManager.js's sanitizeFileName(id)), instead of the old
   * opaque `profile_<timestamp>` scheme.
   * @param {string} name
   * @returns {string}
   */
  static slugifyName(name) {
    const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'profile';
    const shortId = Math.random().toString(36).slice(2, 6);
    return `${slug}_${shortId}`;
  }

  toJSON() {
    // Inherited pages are a live, in-memory-only fallback hydrated from the
    // parent (see hydrateInheritedPages()) -- persisting them would defeat
    // the whole point of the overlay model (a fork should only ever store
    // what it actually overrides).
    const ownPages = this.pages.filter((p) => !this._inheritedPageIds.has(p.id));
    return {
      $schema: 'https://flightdeck.local/schemas/profile.v2.3.json',
      id: this.id,
      profileId: this.id,
      name: this.name,
      aircraft: this.name,
      version: this.version,
      description: this.description,
      aircraftCategory: this.aircraftCategory,
      parentProfileId: this.parentProfileId,
      pages: ownPages.map((p) => p.toJSON())
    };
  }
}

