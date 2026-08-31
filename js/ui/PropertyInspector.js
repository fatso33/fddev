/**
 * PropertyInspector.js
 * Real-Time Widget Configuration Modal & Dynamic SimBinding Inspector
 * Provides long-press popup editing: dimensions, telemetry response, label, and layout-scoped removal
 */

import { SecurityValidator } from '../core/SecurityValidator.js';
import { WidgetRegistry } from '../widgets/WidgetRegistry.js';
import { LayoutEngine } from '../core/LayoutEngine.js';
import {
  CUSTOM_OPTION_VALUE,
  populateDefaultSelect,
  wireBindingControls,
  refreshCustomDeckEvents,
  setBindingControlValue,
  getBindingControlValue
} from './DeckEventBindingField.js';

export class PropertyInspector {
  constructor({ onSaveConfig, onRemoveWidget, onConfigureButton, eventBus, storageManager }) {
    this.onSaveConfig = onSaveConfig;
    this.onRemoveWidget = onRemoveWidget;
    this.onConfigureButton = onConfigureButton;
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
          <!-- Configurable Button widgets: type/style/LED/label/binding are
               all edited in their own dedicated popover instead of the
               generic fields below -- see ButtonConfigPopover.js. -->
          <div class="fd-insp-field hidden" id="fd-insp-configure-button-row">
            <button type="button" id="insp-configure-button-btn" class="btn-secondary" style="width:100%;">Configure Button…</button>
          </div>

          <!-- Grid Dimensions (Width & Height) -- always applies, even to
               widgets whose content fields live in the popover above. -->
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

          <div id="fd-insp-generic-config-group">

          <!-- Widget Label Field -->
          <div class="fd-insp-field">
            <label for="insp-input-label">Widget Display Label</label>
            <input type="text" id="insp-input-label" placeholder="e.g. NAV, HDG, AP MASTER" maxlength="32" />
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
    const configureBtn = this.element.querySelector('#insp-configure-button-btn');
    configureBtn.addEventListener('click', () => {
      if (this.activeWidget && this.onConfigureButton) {
        const widgetId = this.activeWidget.id;
        this.close();
        this.onConfigureButton(widgetId);
      }
    });

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

    populateDefaultSelect(this.element, 'insp', 'event', 'write');
    populateDefaultSelect(this.element, 'insp', 'simvar', 'read');
    wireBindingControls(this.element, 'insp', 'event');
    wireBindingControls(this.element, 'insp', 'simvar');
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
    await refreshCustomDeckEvents(this.element, 'insp', this.storageManager);
    const currentEvent = widget.config.writeEvent || widget.config.binding?.writeEvent || '';
    const currentSimVar = widget.config.binding?.readSimVar || widget.config.activeSimVar || '';
    setBindingControlValue(this.element, 'insp', 'event', currentEvent);
    setBindingControlValue(this.element, 'insp', 'simvar', currentSimVar);

    // The composite button widget's type/style/label/binding are edited via
    // its own dedicated popover, not this generic form -- surface a link to
    // it instead of duplicating those fields here. Layout/resize below still
    // applies to this widget type unchanged.
    const isConfigurableButton = widget.type === 'ButtonWidget';
    const configureBtnRow = this.element.querySelector('#fd-insp-configure-button-row');
    if (configureBtnRow) {
      configureBtnRow.classList.toggle('hidden', !isConfigurableButton);
    }
    const genericGroup = this.element.querySelector('#fd-insp-generic-config-group');
    if (genericGroup) {
      genericGroup.classList.toggle('hidden', isConfigurableButton);
    }

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
    // A widget type's own declared minimum (e.g. the configurable button's
    // 2x2) is a real floor, not just documentation -- clamp against it in
    // addition to the grid's own column/row ceiling.
    const minW = this.defaultDims?.minW || 1;
    const minH = this.defaultDims?.minH || 1;
    if (axis === 'w') {
      this.tempLayout.w = Math.max(minW, Math.min(gridSpec.columns, this.tempLayout.w + delta));
      this.element.querySelector('#insp-w-val').textContent = this.tempLayout.w;
    } else {
      this.tempLayout.h = Math.max(minH, Math.min(gridSpec.rows, this.tempLayout.h + delta));
      this.element.querySelector('#insp-h-val').textContent = this.tempLayout.h;
    }
  }

  handleSave() {
    if (!this.activeWidget) return;

    // ButtonWidget's real label/binding live inside config.definition,
    // edited via its own popover (see #fd-insp-configure-button-row) --
    // the generic fields below are hidden and hold stale/blank values for
    // this type, so applying them here would clobber the real config.
    if (this.activeWidget.type === 'ButtonWidget') {
      if (this.onSaveConfig) {
        this.onSaveConfig(this.activeWidget.id, { layout: this.tempLayout });
      }
      this.close();
      return;
    }

    const labelInput = this.element.querySelector('#insp-input-label');

    const cleanLabel = labelInput.value.trim();
    const rawEvent = getBindingControlValue(this.element, 'insp', 'event');
    const rawSimvar = getBindingControlValue(this.element, 'insp', 'simvar');

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

