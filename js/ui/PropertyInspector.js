/**
 * PropertyInspector.js
 * Real-Time Widget Configuration Modal & Dynamic SimBinding Inspector
 * Provides long-press popup editing: dimensions, telemetry response, label, and layout-scoped removal
 */

import { SecurityValidator } from '../core/SecurityValidator.js';
import { WidgetRegistry } from '../widgets/WidgetRegistry.js';
import { LayoutEngine } from '../core/LayoutEngine.js';
import { getDeckEventsByKind, DECK_EVENT_NAMES } from '../core/deckEvents.js';
import { extractCustomDeckEvents } from '../core/widgetVarExtractor.js';
import { getPackSuggestedEvents } from '../core/deckEventPacks.js';

const CUSTOM_OPTION_VALUE = '__custom__';

export class PropertyInspector {
  constructor({ onSaveConfig, onRemoveWidget, eventBus, storageManager }) {
    this.onSaveConfig = onSaveConfig;
    this.onRemoveWidget = onRemoveWidget;
    this.eventBus = eventBus;
    this.storageManager = storageManager;
    this.element = null;
    this.activeWidget = null;
    this.activeOrientation = 'portrait';
    this.tempLayout = null;
    this.tempRespondToSim = true;
    this.defaultDims = { w: 8, h: 4 };
    // Custom (non-default) Deck Events currently referenced by any other
    // installed widget — rescanned each time the inspector opens, since a
    // widget can be installed/synced from PC Bridge while the app is
    // running. See shared/widgetVarExtractor.js.
    this.customReadEvents = [];
    this.customWriteEvents = [];
  }

  mount(container) {
    this.element = document.createElement('div');
    this.element.className = 'fd-inspector-overlay hidden';
    this.render();
    container.appendChild(this.element);
  }

  render() {
    this.element.innerHTML = `
      <div class="fd-inspector-card">
        <div class="fd-inspector-header">
          <div class="fd-insp-header-titles">
            <h3 id="fd-insp-title">Configure Widget</h3>
            <span id="fd-insp-layout-badge" class="fd-insp-layout-tag">PORTRAIT LAYOUT</span>
          </div>
          <button id="fd-insp-close" class="fd-drawer-close" aria-label="Close">✕</button>
        </div>

        <div class="fd-inspector-body">
          <!-- Widget Label Field -->
          <div class="fd-insp-field">
            <label for="insp-input-label">Widget Display Label</label>
            <input type="text" id="insp-input-label" placeholder="e.g. NAV, HDG, AP MASTER" maxlength="32" />
          </div>

          <!-- Grid Dimensions (Width & Height) -->
          <div class="fd-insp-grid-dims-container">
            <div class="fd-insp-grid-dims-header">
              <label class="fd-insp-section-label">Grid Dimensions (Columns × Rows)</label>
              <button type="button" id="insp-reset-size-btn" class="fd-insp-reset-btn" title="Revert to Widget Default Size">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
                <span>Reset to Default (<span id="insp-default-dims-tag">8×4</span>)</span>
              </button>
            </div>
            <div class="fd-insp-grid-dims">
              <div class="fd-insp-field">
                <label>Width (Cols)</label>
                <div class="fd-insp-stepper">
                  <button type="button" id="insp-w-dec" class="fd-insp-step-btn" aria-label="Decrease Width">−</button>
                  <span id="insp-w-val" class="fd-insp-step-val">4</span>
                  <button type="button" id="insp-w-inc" class="fd-insp-step-btn" aria-label="Increase Width">+</button>
                </div>
              </div>
              <div class="fd-insp-field">
                <label>Height (Rows)</label>
                <div class="fd-insp-stepper">
                  <button type="button" id="insp-h-dec" class="fd-insp-step-btn" aria-label="Decrease Height">−</button>
                  <span id="insp-h-val" class="fd-insp-step-val">2</span>
                  <button type="button" id="insp-h-inc" class="fd-insp-step-btn" aria-label="Increase Height">+</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Respond to Simulator Events Toggle -->
          <div class="fd-insp-toggle-box">
            <div class="fd-insp-toggle-info">
              <span class="fd-insp-toggle-title">Respond to Simulator Events</span>
            </div>
            <label class="switch" for="insp-toggle-sim-events">
              <input type="checkbox" id="insp-toggle-sim-events" checked />
              <span class="slider"></span>
            </label>
          </div>

          <!-- Deck Event Binding (write) -->
          <div class="fd-insp-field">
            <label for="insp-select-event">Deck Event Trigger (Write)</label>
            <select id="insp-select-event"></select>
          </div>
          <div class="fd-insp-field fd-insp-custom-block hidden" id="insp-custom-event-block">
            <label for="insp-select-custom-event">Custom Deck Event (used by another installed widget)</label>
            <select id="insp-select-custom-event"></select>
            <label for="insp-input-custom-event">Or type a new custom event / raw SimConnect event (H:/K:...)</label>
            <input type="text" id="insp-input-custom-event" placeholder="e.g. myCustomEvent, H:GTN750_DirectToPush" />
          </div>

          <!-- Deck Event Binding (read) -->
          <div class="fd-insp-field">
            <label for="insp-select-simvar">Deck Event Telemetry (Read Feedback)</label>
            <select id="insp-select-simvar"></select>
          </div>
          <div class="fd-insp-field fd-insp-custom-block hidden" id="insp-custom-simvar-block">
            <label for="insp-select-custom-simvar">Custom Deck Event (used by another installed widget)</label>
            <select id="insp-select-custom-simvar"></select>
            <label for="insp-input-custom-simvar">Or type a new custom variable / raw SimVar (L:/A:...)</label>
            <input type="text" id="insp-input-custom-simvar" placeholder="e.g. myCustomVar, L:FBW_TAXI_LIGHT_INTENSITY" />
          </div>
        </div>

        <div class="fd-inspector-actions">
          <div class="fd-insp-actions-left">
            <button type="button" id="insp-remove-btn" class="fd-insp-btn-danger">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Remove Widget
            </button>
          </div>
          <div class="fd-insp-actions-right">
            <button type="button" id="insp-cancel-btn" class="btn-secondary">Cancel</button>
            <button type="button" id="insp-save-btn" class="btn-primary">Apply Changes</button>
          </div>
        </div>
      </div>
    `;

    const closeBtn = this.element.querySelector('#fd-insp-close');
    const cancelBtn = this.element.querySelector('#insp-cancel-btn');
    const saveBtn = this.element.querySelector('#insp-save-btn');
    const removeBtn = this.element.querySelector('#insp-remove-btn');

    closeBtn.addEventListener('click', () => this.close());
    cancelBtn.addEventListener('click', () => this.close());
    saveBtn.addEventListener('click', () => this.handleSave());
    removeBtn.addEventListener('click', () => this.handleRemove());

    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.close();
    });

    // Dimension steppers
    this.element.querySelector('#insp-w-dec').addEventListener('click', () => this.adjustDim('w', -1));
    this.element.querySelector('#insp-w-inc').addEventListener('click', () => this.adjustDim('w', 1));
    this.element.querySelector('#insp-h-dec').addEventListener('click', () => this.adjustDim('h', -1));
    this.element.querySelector('#insp-h-inc').addEventListener('click', () => this.adjustDim('h', 1));

    // Reset to Default Size button
    const resetBtn = this.element.querySelector('#insp-reset-size-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetToDefaultSize());
    }

    // Respond to Sim Events checkbox toggle
    const toggleSimCheckbox = this.element.querySelector('#insp-toggle-sim-events');
    toggleSimCheckbox.addEventListener('change', () => {
      this.tempRespondToSim = toggleSimCheckbox.checked;
    });

    this.populateDefaultSelects();
    this.wireBindingControls('event');
    this.wireBindingControls('simvar');
  }

  /**
   * Fills the two default-Deck-Event <select> elements from
   * shared/deckEvents.js (getDeckEventsByKind) plus a trailing "Custom..."
   * option. Static for the app's lifetime — default Deck Events don't
   * change at runtime, so this only needs to run once, unlike the custom
   * dropdowns (see refreshCustomDeckEvents()).
   */
  populateDefaultSelects() {
    const fill = (selectEl, kind) => {
      selectEl.innerHTML = '';
      for (const deckEvent of getDeckEventsByKind(kind)) {
        const opt = document.createElement('option');
        opt.value = deckEvent.name;
        opt.textContent = deckEvent.label;
        selectEl.appendChild(opt);
      }
      const customOpt = document.createElement('option');
      customOpt.value = CUSTOM_OPTION_VALUE;
      customOpt.textContent = 'Custom…';
      selectEl.appendChild(customOpt);
    };
    fill(this.element.querySelector('#insp-select-event'), 'write');
    fill(this.element.querySelector('#insp-select-simvar'), 'read');
  }

  /**
   * Wires the show/hide + value-forwarding behavior shared by the write
   * (event) and read (simvar) binding controls.
   * @param {'event'|'simvar'} kind
   */
  wireBindingControls(kind) {
    const defaultSelect = this.element.querySelector(`#insp-select-${kind}`);
    const customBlock = this.element.querySelector(`#insp-custom-${kind}-block`);
    const customSelect = this.element.querySelector(`#insp-select-custom-${kind}`);
    const customInput = this.element.querySelector(`#insp-input-custom-${kind}`);

    defaultSelect.addEventListener('change', () => {
      const isCustom = defaultSelect.value === CUSTOM_OPTION_VALUE;
      customBlock.classList.toggle('hidden', !isCustom);
    });

    // Picking a known custom Deck Event copies it into the free-text field,
    // which stays the single source of truth handleSave() reads from —
    // avoids ambiguity between "what's selected" and "what's typed."
    customSelect.addEventListener('change', () => {
      if (customSelect.value) customInput.value = customSelect.value;
    });
  }

  /**
   * Rescans every currently-installed widget (via storageManager — the same
   * local store PC Bridge sync writes into, so this reflects whatever
   * custom widgets are currently synced) for non-default Deck Events, merges
   * in any Community Deck Events Packs imported via SettingsView.js (see
   * core/deckEventPacks.js), and repopulates the two custom-mode dropdowns.
   * Called each time the inspector opens, since a widget can be installed
   * (or a pack imported) while the app is running.
   */
  async refreshCustomDeckEvents() {
    this.customReadEvents = [];
    this.customWriteEvents = [];

    let widgetDefs = [];
    if (this.storageManager && typeof this.storageManager.getAllWidgetDefinitions === 'function') {
      try {
        widgetDefs = await this.storageManager.getAllWidgetDefinitions();
      } catch (err) {
        console.warn('[PropertyInspector] Could not scan widgets for custom Deck Events:', err);
      }
    }

    const fromWidgets = extractCustomDeckEvents(widgetDefs, DECK_EVENT_NAMES).map((e) => ({
      ...e,
      source: e.widgetIds.length ? `used by ${e.widgetIds.join(', ')}` : ''
    }));
    const fromPacks = getPackSuggestedEvents()
      .filter((e) => !fromWidgets.some((w) => w.name === e.name))
      .map((e) => ({ name: e.name, kind: e.kind, source: `from pack: ${e.fromPack}` }));
    const merged = [...fromWidgets, ...fromPacks];

    this.customReadEvents = merged.filter((e) => e.kind === 'read');
    this.customWriteEvents = merged.filter((e) => e.kind === 'write');

    this.fillCustomSelect('event', this.customWriteEvents);
    this.fillCustomSelect('simvar', this.customReadEvents);
  }

  fillCustomSelect(kind, entries) {
    const selectEl = this.element.querySelector(`#insp-select-custom-${kind}`);
    if (!selectEl) return;
    selectEl.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = entries.length > 0 ? '— select or type below —' : '(no custom Deck Events in use yet — try importing a Community Pack in Settings)';
    selectEl.appendChild(placeholder);

    for (const entry of entries) {
      const opt = document.createElement('option');
      opt.value = entry.name;
      opt.textContent = entry.source ? `${entry.name} (${entry.source})` : entry.name;
      selectEl.appendChild(opt);
    }
  }

  /**
   * Sets up one binding control pair (default select + custom block) for
   * the widget currently being inspected: selects the matching default
   * option if `value` is a known default Deck Event, otherwise switches to
   * custom mode — selecting the matching custom-dropdown entry if `value`
   * is already in use by another widget, or just dropping it into the
   * free-text field if it's genuinely new (or a raw SimVar/H:/L:/K: escape
   * hatch).
   * @param {'event'|'simvar'} kind
   * @param {string} value - current binding value, may be ''
   */
  setBindingControlValue(kind, value) {
    const defaultSelect = this.element.querySelector(`#insp-select-${kind}`);
    const customBlock = this.element.querySelector(`#insp-custom-${kind}-block`);
    const customSelect = this.element.querySelector(`#insp-select-custom-${kind}`);
    const customInput = this.element.querySelector(`#insp-input-custom-${kind}`);

    const isKnownDefault = value && [...defaultSelect.options].some((o) => o.value === value && o.value !== CUSTOM_OPTION_VALUE);

    if (isKnownDefault) {
      defaultSelect.value = value;
      customBlock.classList.add('hidden');
      customSelect.value = '';
      customInput.value = '';
      return;
    }

    defaultSelect.value = CUSTOM_OPTION_VALUE;
    customBlock.classList.remove('hidden');

    const isKnownCustom = value && [...customSelect.options].some((o) => o.value === value);
    if (isKnownCustom) {
      customSelect.value = value;
      customInput.value = value;
    } else {
      customSelect.value = '';
      customInput.value = value || '';
    }
  }

  /**
   * Reads back the effective binding value for one control pair — whatever
   * ended up in the custom free-text field if the default select is on
   * "Custom…", otherwise the default select's own value.
   * @param {'event'|'simvar'} kind
   * @returns {string}
   */
  getBindingControlValue(kind) {
    const defaultSelect = this.element.querySelector(`#insp-select-${kind}`);
    if (defaultSelect.value !== CUSTOM_OPTION_VALUE) return defaultSelect.value;
    const customInput = this.element.querySelector(`#insp-input-custom-${kind}`);
    return customInput.value.trim();
  }

  async inspect(widget, orientation = 'portrait', tier = 'mobile') {
    this.activeWidget = widget;
    this.activeOrientation = orientation;
    this.activeTier = tier;
    if (!widget) return;

    const descriptor = WidgetRegistry.getDescriptor(widget.type);
    this.defaultDims = descriptor?.defaultLayout ? { ...descriptor.defaultLayout } : { w: 5, h: 2 };

    const title = this.element.querySelector('#fd-insp-title');
    const layoutBadge = this.element.querySelector('#fd-insp-layout-badge');
    const defaultDimsTag = this.element.querySelector('#insp-default-dims-tag');
    const labelInput = this.element.querySelector('#insp-input-label');
    const wVal = this.element.querySelector('#insp-w-val');
    const hVal = this.element.querySelector('#insp-h-val');
    const toggleSim = this.element.querySelector('#insp-toggle-sim-events');

    title.textContent = `Configure ${widget.config.label || widget.type}`;
    if (layoutBadge) {
      layoutBadge.textContent = `${orientation.toUpperCase()} LAYOUT ONLY`;
    }
    if (defaultDimsTag) {
      defaultDimsTag.textContent = `${this.defaultDims.w}×${this.defaultDims.h}`;
    }

    labelInput.value = widget.config.label || '';
    wVal.textContent = widget.layout.w;
    hVal.textContent = widget.layout.h;

    // Non-removable widgets (config.removable === false) can still be
    // resized/repositioned/relabeled here — just never removed.
    const removeBtn = this.element.querySelector('#insp-remove-btn');
    if (removeBtn) {
      removeBtn.style.display = widget.config.removable === false ? 'none' : '';
    }

    this.tempLayout = { ...widget.layout };
    this.tempRespondToSim = widget.config.respondToSimEvents !== false;
    toggleSim.checked = this.tempRespondToSim;

    // Rescan before wiring up the binding controls, so a custom Deck Event
    // already in use by another widget correctly pre-selects in the custom
    // dropdown instead of only landing in the free-text field.
    await this.refreshCustomDeckEvents();
    const currentEvent = widget.config.writeEvent || widget.config.binding?.writeEvent || '';
    const currentSimVar = widget.config.binding?.readSimVar || widget.config.activeSimVar || '';
    this.setBindingControlValue('event', currentEvent);
    this.setBindingControlValue('simvar', currentSimVar);

    this.open();
  }

  resetToDefaultSize() {
    if (!this.tempLayout || !this.defaultDims) return;
    this.tempLayout.w = this.defaultDims.w;
    this.tempLayout.h = this.defaultDims.h;
    const wVal = this.element.querySelector('#insp-w-val');
    const hVal = this.element.querySelector('#insp-h-val');
    if (wVal) wVal.textContent = this.tempLayout.w;
    if (hVal) hVal.textContent = this.tempLayout.h;
  }

  adjustDim(axis, delta) {
    if (!this.tempLayout) return;
    const gridSpec = LayoutEngine.getGridSpec(this.activeOrientation, this.activeTier);
    if (axis === 'w') {
      this.tempLayout.w = Math.max(1, Math.min(gridSpec.columns, this.tempLayout.w + delta));
      this.element.querySelector('#insp-w-val').textContent = this.tempLayout.w;
    } else {
      this.tempLayout.h = Math.max(1, Math.min(gridSpec.rows, this.tempLayout.h + delta));
      this.element.querySelector('#insp-h-val').textContent = this.tempLayout.h;
    }
  }

  handleSave() {
    if (!this.activeWidget) return;

    const labelInput = this.element.querySelector('#insp-input-label');

    const cleanLabel = labelInput.value.trim();
    const rawEvent = this.getBindingControlValue('event');
    const rawSimvar = this.getBindingControlValue('simvar');

    const sanitizedEvent = rawEvent ? SecurityValidator.sanitizeEventName(rawEvent) : '';
    const sanitizedSimvar = rawSimvar ? SecurityValidator.sanitizeSimVar(rawSimvar) : '';

    const newConfig = {
      ...this.activeWidget.config,
      label: cleanLabel || this.activeWidget.config.label || 'WIDGET',
      shortLabel: cleanLabel || this.activeWidget.config.shortLabel || undefined,
      respondToSimEvents: this.tempRespondToSim,
      writeEvent: sanitizedEvent || undefined,
      binding: {
        ...(this.activeWidget.config.binding || {}),
        writeEvent: sanitizedEvent || undefined,
        readSimVar: sanitizedSimvar || undefined
      }
    };

    if (this.onSaveConfig) {
      this.onSaveConfig(this.activeWidget.id, {
        layout: this.tempLayout,
        config: newConfig
      });
    }

    this.close();
  }

  handleRemove() {
    if (!this.activeWidget) return;
    if (this.activeWidget.config.removable === false) {
      this.close();
      return;
    }
    const widgetId = this.activeWidget.id;
    this.close();
    if (this.onRemoveWidget) {
      this.onRemoveWidget(widgetId);
    }
  }

  open() {
    if (this.element) this.element.classList.remove('hidden');
  }

  close() {
    if (this.element) this.element.classList.add('hidden');
    this.activeWidget = null;
  }
}

