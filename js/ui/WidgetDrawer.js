/**
 * WidgetDrawer.js
 * Slide-in Avionics Catalog Drawer with Category Filtering, Custom FDWS Package Installation,
 * and Instant Grid Placement.
 */

import { WidgetRegistry } from '../widgets/WidgetRegistry.js';
import { SecurityValidator } from '../core/SecurityValidator.js';

export class WidgetDrawer {
  /**
   * @param {object} options
   * @param {function} options.onSelectWidget
   * @param {import('../core/StorageManager.js').StorageManager} [options.storageManager]
   * @param {import('../core/EventBus.js').EventBus} [options.eventBus]
   */
  constructor({ onSelectWidget, storageManager, eventBus }) {
    this.onSelectWidget = onSelectWidget;
    this.storageManager = storageManager;
    this.eventBus = eventBus;
    this.element = null;
    this.isOpen = false;
    this.activeCategory = 'All';
  }

  mount(container) {
    this.element = document.createElement('div');
    this.element.className = 'fd-drawer-overlay hidden';
    this.render();
    container.appendChild(this.element);
  }

  render() {
    this.element.innerHTML = `
      <div class="fd-drawer-panel">
        <div class="fd-drawer-header">
          <div class="fd-drawer-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
            <span>Avionics Catalog</span>
          </div>
          <div class="fd-drawer-actions">
            <label class="fd-btn-install-fdws" title="Install .fdwidget package">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>Install .fdwidget</span>
              <input type="file" id="fd-file-import-fdws" accept=".fdwidget,.json" style="display:none;" />
            </label>
            <button id="fd-drawer-close-btn" class="fd-drawer-close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div class="fd-drawer-categories" id="fd-drawer-cat-filters">
          <button class="fd-cat-tab active" data-cat="All">All</button>
          <button class="fd-cat-tab" data-cat="Controls">Controls</button>
          <button class="fd-cat-tab" data-cat="Gauges">Gauges</button>
          <button class="fd-cat-tab" data-cat="Alerts">Alerts</button>
          <button class="fd-cat-tab" data-cat="Avionics">Avionics</button>
          <button class="fd-cat-tab" data-cat="Custom">FDWS v1.1 Custom</button>
        </div>

        <div class="fd-drawer-list" id="fd-drawer-catalog-list"></div>
      </div>
    `;

    this.element.querySelector('#fd-drawer-close-btn').addEventListener('click', () => {
      this.close();
    });

    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.close();
      }
    });

    // Category Tabs
    const catTabs = this.element.querySelectorAll('.fd-cat-tab');
    catTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        catTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeCategory = tab.dataset.cat;
        this.populateCatalog();
      });
    });

    // Import .fdwidget file input
    const fileInput = this.element.querySelector('#fd-file-import-fdws');
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const res = await WidgetRegistry.installDefinition(JSON.parse(text), this.storageManager);
        this.populateCatalog();
        const popoverNote = res.installedPopovers?.length > 0
          ? ` (+ ${res.installedPopovers.length} bundled popover${res.installedPopovers.length === 1 ? '' : 's'}: ${res.installedPopovers.map((p) => p.name).join(', ')})`
          : '';
        if (res.warnings?.length > 0) {
          alert(`Widget installed with warnings:\n• ${res.warnings.join('\n• ')}`);
        } else {
          alert(`Successfully installed widget: "${res.descriptor.name}"${popoverNote}`);
        }
      } catch (err) {
        alert(`Failed to import widget package: ${err.message}`);
      } finally {
        fileInput.value = '';
      }
    });

    this.populateCatalog();
  }

  populateCatalog() {
    const listContainer = this.element.querySelector('#fd-drawer-catalog-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const catalog = WidgetRegistry.getCatalog();
    const filtered = catalog.filter((item) => {
      // FDWS v1.3: popover-kind widgets are opened only via core.openWidgetPopover,
      // never placed directly on a page layout.
      if (item.kind === 'popover') return false;
      // 'system' widgets (e.g. the Virtual Yoke page's built-in Center /
      // Detach controls) ship pre-placed on their host page and are never
      // user-addable elsewhere.
      if (item.kind === 'system') return false;
      if (this.activeCategory === 'All') return true;
      if (this.activeCategory === 'Custom') return Boolean(item.isCustom);
      return item.category === this.activeCategory;
    });

    if (filtered.length === 0) {
      listContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-dim, #888);">No widgets in this category.</div>`;
      return;
    }

    filtered.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'fd-drawer-item-card';

      const isCustomBadge = item.isCustom
        ? `<span class="fd-badge-fdws">FDWS v1.1</span>`
        : `<span class="fd-badge-native">Built-in</span>`;

      card.innerHTML = `
        <div class="fd-drawer-item-info">
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
            <div class="fd-drawer-item-badge">${SecurityValidator.escapeHTML(item.category)}</div>
            ${isCustomBadge}
          </div>
          <div class="fd-drawer-item-name">${SecurityValidator.escapeHTML(item.name)}</div>
          <div class="fd-drawer-item-desc">${SecurityValidator.escapeHTML(item.description)}</div>
          <div class="fd-drawer-item-dims">Default size: ${item.defaultLayout.w} cols × ${item.defaultLayout.h} rows</div>
        </div>
        <div class="fd-drawer-card-actions">
          <button class="fd-drawer-item-add-btn">
            <span>+ Add</span>
          </button>
          ${
            item.isCustom
              ? `<button class="fd-btn-icon-export" title="Export .fdwidget">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button class="fd-btn-icon-delete" title="Uninstall widget">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>`
              : ''
          }
        </div>
      `;

      card.querySelector('.fd-drawer-item-add-btn').addEventListener('click', () => {
        if (this.onSelectWidget) {
          this.onSelectWidget(item.type);
        }
        this.close();
      });

      if (item.isCustom) {
        const exportBtn = card.querySelector('.fd-btn-icon-export');
        exportBtn?.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const jsonStr = await this.storageManager?.exportWidgetDefinitionJSON(item.type);
            if (jsonStr) {
              const blob = new Blob([jsonStr], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${item.type}.fdwidget`;
              a.click();
              URL.revokeObjectURL(url);
            }
          } catch (err) {
            alert(`Export failed: ${err.message}`);
          }
        });

        const deleteBtn = card.querySelector('.fd-btn-icon-delete');
        deleteBtn?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Uninstall custom widget "${item.name}"?`)) {
            await WidgetRegistry.uninstallDefinition(item.type, this.storageManager);
            this.populateCatalog();
          }
        });
      }

      listContainer.appendChild(card);
    });
  }

  open() {
    this.isOpen = true;
    if (this.element) {
      this.populateCatalog();
      this.element.classList.remove('hidden');
    }
  }

  close() {
    this.isOpen = false;
    if (this.element) {
      this.element.classList.add('hidden');
    }
  }
}
