/**
 * ButtonConfigPopover.js
 * Dedicated quick-config popover for the built-in "Switch / Push Button"
 * widget (catalog type 'ButtonWidget', a composite widget with one
 * core.button component -- see buildDefaultButtonDefinition.js). Opened
 * automatically right after adding a fresh button (mode:'add'), or later via
 * PropertyInspector's "Configure Button…" affordance (mode:'edit'). Modeled
 * on PropertyInspector.js's own overlay/card chrome and Escape/backdrop
 * conventions, and reuses its Deck Event binding-field logic via
 * DeckEventBindingField.js -- kept as its own component rather than folded
 * into PropertyInspector's generic per-type form, since its target shape
 * (a composite widget's embedded component props/style/binding) and its
 * Cancel semantics (undo the add, in 'add' mode) both differ from the
 * generic layout-focused form there.
 */
import { SecurityValidator } from '../core/SecurityValidator.js';
import { STYLE_PRESETS } from '../widgets/StylePresets.js';
import {
  bindingFieldHTML,
  populateDefaultSelect,
  wireBindingControls,
  refreshCustomDeckEvents,
  setBindingControlValue,
  getBindingControlValue
} from './DeckEventBindingField.js';

const PREFIX = 'btncfg';

export class ButtonConfigPopover {
  constructor({ onSaveConfig, onCancelAdd, storageManager }) {
    this.onSaveConfig = onSaveConfig;
    this.onCancelAdd = onCancelAdd;
    this.storageManager = storageManager;
    this.element = null;
    this.activeWidget = null;
    this.mode = 'edit';
    this.selectedPresetId = STYLE_PRESETS[0].id;
  }

  mount(container) {
    this.element = document.createElement('div');
    this.element.className = 'fd-inspector-overlay hidden';
    this.render();
    container.appendChild(this.element);
  }

  render() {
    const swatches = STYLE_PRESETS.map((p) => `
      <button type="button" class="fd-btncfg-swatch" data-preset-id="${p.id}" title="${p.name}"
        style="background:${p.swatch.bg}; border-color:${p.swatch.border}; color:${p.swatch.fg};">${p.name}</button>
    `).join('');

    this.element.innerHTML = `
      <div class="fd-inspector-card">
        <div class="fd-inspector-header">
          <div class="fd-insp-header-titles">
            <h3>Configure Button</h3>
          </div>
          <button id="btncfg-close" class="fd-drawer-close" aria-label="Close">✕</button>
        </div>

        <div class="fd-inspector-body">
          <div class="fd-insp-field">
            <label for="btncfg-input-label">Button Label</label>
            <input type="text" id="btncfg-input-label" placeholder="e.g. AP MASTER" maxlength="32" />
          </div>

          <div class="fd-insp-field">
            <label for="btncfg-select-type">Button Type</label>
            <select id="btncfg-select-type">
              <option value="toggle">Toggle (stays on/off, reflects live state)</option>
              <option value="momentary">Momentary (fires once, springs back)</option>
            </select>
          </div>

          <div class="fd-insp-field">
            <label>Style</label>
            <div class="fd-btncfg-swatch-row" id="btncfg-swatch-row">${swatches}</div>
          </div>

          <div class="fd-insp-toggle-box">
            <div class="fd-insp-toggle-info">
              <span class="fd-insp-toggle-title">Show LED When Active</span>
              <span class="fd-insp-toggle-desc">Small status dot in the corner (toggle type only)</span>
            </div>
            <label class="switch" for="btncfg-toggle-led">
              <input type="checkbox" id="btncfg-toggle-led" />
              <span class="slider"></span>
            </label>
          </div>

          ${bindingFieldHTML({ prefix: PREFIX, kind: 'event', label: 'Deck Event Trigger (Write)', customHint: 'Or type a new custom event / raw SimConnect event (H:/K:...)', placeholder: 'e.g. myCustomEvent, H:GTN750_DirectToPush' })}
          ${bindingFieldHTML({ prefix: PREFIX, kind: 'simvar', label: 'Deck Event Telemetry (Read Feedback)', customHint: 'Or type a new custom variable / raw SimVar (L:/A:...)', placeholder: 'e.g. myCustomVar, L:FBW_TAXI_LIGHT_INTENSITY' })}
        </div>

        <div class="fd-inspector-actions">
          <div class="fd-insp-actions-left"></div>
          <div class="fd-insp-actions-right">
            <button type="button" id="btncfg-cancel-btn" class="btn-secondary">Cancel</button>
            <button type="button" id="btncfg-save-btn" class="btn-primary">Save</button>
          </div>
        </div>
      </div>
    `;

    this.element.querySelector('#btncfg-close').addEventListener('click', () => this.handleCancel());
    this.element.querySelector('#btncfg-cancel-btn').addEventListener('click', () => this.handleCancel());
    this.element.querySelector('#btncfg-save-btn').addEventListener('click', () => this.handleSave());
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.handleCancel();
    });
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.handleCancel();
    });

    this.element.querySelector('#btncfg-swatch-row').addEventListener('click', (e) => {
      const btn = e.target.closest('.fd-btncfg-swatch');
      if (!btn) return;
      this.selectPreset(btn.dataset.presetId);
    });

    populateDefaultSelect(this.element, PREFIX, 'event', 'write');
    populateDefaultSelect(this.element, PREFIX, 'simvar', 'read');
    wireBindingControls(this.element, PREFIX, 'event');
    wireBindingControls(this.element, PREFIX, 'simvar');
  }

  selectPreset(presetId) {
    this.selectedPresetId = presetId;
    this.element.querySelectorAll('.fd-btncfg-swatch').forEach((el) => {
      el.classList.toggle('selected', el.dataset.presetId === presetId);
    });
  }

  /**
   * @param {object} widget - the live mounted widget instance (has id/type/config/layout)
   * @param {{mode: 'add'|'edit'}} [opts]
   */
  async open(widget, { mode = 'edit' } = {}) {
    this.activeWidget = widget;
    this.mode = mode;
    if (!widget) return;

    const component = widget.config?.definition?.components?.[0];
    const props = component?.props || {};
    const binding = component?.binding || {};
    const presetId = STYLE_PRESETS.find((p) => JSON.stringify(p.style) === JSON.stringify(component?.style))?.id || STYLE_PRESETS[0].id;

    this.element.querySelector('#btncfg-input-label').value = props.label || '';
    this.element.querySelector('#btncfg-select-type').value = props.variant === 'momentary' ? 'momentary' : 'toggle';
    this.element.querySelector('#btncfg-toggle-led').checked = Boolean(props.hasLed);
    this.selectPreset(presetId);

    await refreshCustomDeckEvents(this.element, PREFIX, this.storageManager);
    setBindingControlValue(this.element, PREFIX, 'event', binding.writeEvent || '');
    setBindingControlValue(this.element, PREFIX, 'simvar', binding.readSimVar || '');

    this.show();
  }

  show() {
    if (this.element) this.element.classList.remove('hidden');
  }

  close() {
    if (this.element) this.element.classList.add('hidden');
    this.activeWidget = null;
  }

  handleSave() {
    if (!this.activeWidget) return;

    const label = this.element.querySelector('#btncfg-input-label').value.trim() || 'BUTTON';
    const variant = this.element.querySelector('#btncfg-select-type').value === 'momentary' ? 'momentary' : 'toggle';
    const hasLed = this.element.querySelector('#btncfg-toggle-led').checked;
    const preset = STYLE_PRESETS.find((p) => p.id === this.selectedPresetId) || STYLE_PRESETS[0];

    const rawEvent = getBindingControlValue(this.element, PREFIX, 'event');
    const rawSimvar = getBindingControlValue(this.element, PREFIX, 'simvar');
    const sanitizedEvent = rawEvent ? SecurityValidator.sanitizeEventName(rawEvent) : '';
    const sanitizedSimvar = rawSimvar ? SecurityValidator.sanitizeSimVar(rawSimvar) : '';

    const oldDefinition = this.activeWidget.config?.definition;
    const newDefinition = JSON.parse(JSON.stringify(oldDefinition));
    const component = newDefinition.components[0];
    component.props = { ...component.props, variant, label, hasLed };
    component.style = JSON.parse(JSON.stringify(preset.style));
    component.binding = { readSimVar: sanitizedSimvar || '', writeEvent: sanitizedEvent || '' };

    if (this.onSaveConfig) {
      this.onSaveConfig(this.activeWidget.id, {
        config: { ...this.activeWidget.config, label, definition: newDefinition }
      });
    }

    this.mode = 'edit';
    this.close();
  }

  handleCancel() {
    const wasAdd = this.mode === 'add';
    const widgetId = this.activeWidget?.id;
    this.close();
    if (wasAdd && this.onCancelAdd) {
      this.onCancelAdd(widgetId);
    }
  }
}
