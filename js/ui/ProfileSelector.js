/**
 * ProfileSelector.js
 * Multi-App-Profile Switcher & JSON Import/Export Management Modal
 * ("App Profile" = a saved set of page layouts, distinct from PC Bridge's
 * SimVar Binding Profile, which maps Deck Events to real SimConnect vars.)
 */

import { SecurityValidator } from '../core/SecurityValidator.js';
import { Profile } from '../models/Profile.js';

export class ProfileSelector {
  constructor({ storageManager, simBridge, onProfileChanged }) {
    this.storageManager = storageManager;
    this.simBridge = simBridge;
    this.onProfileChanged = onProfileChanged;
    this.element = null;
  }

  mount(container) {
    this.element = document.createElement('div');
    this.element.className = 'fd-profile-modal-overlay hidden';
    this.render();
    container.appendChild(this.element);
  }

  render() {
    this.element.innerHTML = `
      <div class="fd-profile-modal-card">
        <div class="fd-profile-modal-header">
          <div class="fd-profile-modal-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>
            <span>App Profiles</span>
          </div>
          <button id="fd-prof-close-btn" class="fd-drawer-close">✕</button>
        </div>

        <div class="fd-profile-list" id="fd-profile-list-container">
          <!-- Profiles populated here -->
        </div>

        <div class="fd-profile-actions-bar">
          <button id="fd-prof-new-btn" class="btn-secondary">
            <span>+ New Profile</span>
          </button>

          <label class="btn-secondary" style="cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
            <span>Import JSON</span>
            <input type="file" id="fd-prof-import-input" accept=".json,application/json" style="display: none;" />
          </label>
        </div>
      </div>
    `;

    this.element.querySelector('#fd-prof-close-btn').addEventListener('click', () => this.close());
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.close();
    });

    this.element.querySelector('#fd-prof-new-btn').addEventListener('click', () => this.handleCreateNewProfile());

    const fileInput = this.element.querySelector('#fd-prof-import-input');
    fileInput.addEventListener('change', (e) => this.handleFileImport(e));
  }

  async refreshList() {
    const container = this.element.querySelector('#fd-profile-list-container');
    if (!container) return;
    container.innerHTML = '';

    const profiles = await this.storageManager.getAllProfiles();
    const activeId = await this.storageManager.getActiveProfileId();

    profiles.forEach((prof) => {
      const card = document.createElement('div');
      const isActive = prof.id === activeId;
      const isDefault = this.storageManager.isDefaultProfile(prof.id);
      card.className = `fd-profile-card ${isActive ? 'active-profile' : ''}`;

      card.innerHTML = `
        <div class="fd-profile-card-info">
          <div class="fd-profile-card-name">
            <span>${SecurityValidator.escapeHTML(prof.name)}</span>
            ${isActive ? '<span class="fd-active-tag">ACTIVE</span>' : ''}
            ${!isDefault ? '<span class="fd-active-tag" style="background: rgba(0, 229, 255, 0.15); color: var(--accent-cyan); border: 1px solid rgba(0, 229, 255, 0.4);">PC SYNCED</span>' : '<span class="fd-active-tag" style="background: rgba(148, 163, 184, 0.15); color: var(--text-dim); border: 1px solid rgba(148, 163, 184, 0.3);">BUILT-IN</span>'}
          </div>
          <div class="fd-profile-card-desc">${SecurityValidator.escapeHTML(prof.description || prof.aircraftCategory || 'App Profile')}</div>
          <div class="fd-profile-card-pages">${prof.pages?.length || 0} configured pages</div>
        </div>

        <div class="fd-profile-card-btns">
          ${!isActive ? `<button class="fd-prof-select-btn" data-id="${prof.id}">Select</button>` : ''}
          <button class="fd-prof-export-btn" data-id="${prof.id}" title="Export Profile JSON">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          ${!isDefault && !isActive ? `
            <button class="fd-prof-delete-btn" data-id="${prof.id}" title="Delete Profile" style="background: transparent; border: 1px solid var(--border-color); color: var(--accent-red); border-radius: 6px; padding: 6px 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          ` : ''}
        </div>
      `;

      const selectBtn = card.querySelector('.fd-prof-select-btn');
      if (selectBtn) {
        selectBtn.addEventListener('click', () => this.handleSelectProfile(prof.id));
      }

      const exportBtn = card.querySelector('.fd-prof-export-btn');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => this.handleExportProfile(prof.id));
      }

      const deleteBtn = card.querySelector('.fd-prof-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (confirm(`Delete profile "${prof.name}"?`)) {
            await this.storageManager.deleteProfile(prof.id);
            this.refreshList();
          }
        });
      }

      container.appendChild(card);
    });
  }

  async handleSelectProfile(id) {
    await this.storageManager.setActiveProfileId(id);
    if (this.simBridge) {
      this.simBridge.setActiveProfile(id);
    }
    if (this.onProfileChanged) {
      await this.onProfileChanged(id);
    }
    this.close();
  }

  async handleExportProfile(id) {
    try {
      const jsonStr = await this.storageManager.exportProfileJSON(id);
      const profile = await this.storageManager.getProfile(id);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flightdeck_profile_${(profile?.name || 'aircraft').toLowerCase().replace(/\s+/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    }
  }

  async handleFileImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target.result;
        const imported = await this.storageManager.importProfileJSON(text);
        alert(`Successfully imported profile: ${imported.name}`);
        await this.handleSelectProfile(imported.id);
      } catch (err) {
        alert(`Import error: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async handleCreateNewProfile() {
    const name = prompt('Enter name for the new App Profile:', 'Custom');
    if (!name) return;

    const defaultProfiles = this.storageManager.getDefaultProfiles();
    const base = defaultProfiles[0];
    const newProf = {
      ...JSON.parse(JSON.stringify(base)),
      // Readable, filename-safe id (e.g. "custom_a91f") instead of the old
      // opaque `profile_<timestamp>` scheme -- this is what PC Bridge names
      // the synced file after (userPresetManager.js's sanitizeFileName(id)).
      id: Profile.slugifyName(name),
      name: name.trim().slice(0, 16),
      description: 'Custom User Configured App Profile'
    };

    await this.storageManager.saveProfile(newProf);
    await this.handleSelectProfile(newProf.id);
  }

  open() {
    this.refreshList();
    if (this.element) this.element.classList.remove('hidden');
  }

  close() {
    if (this.element) this.element.classList.add('hidden');
  }
}
