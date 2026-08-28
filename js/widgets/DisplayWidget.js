/**
 * DisplayWidget.js
 * Numeric Readout and Formatted Avionics Display with Interactive Stepper Controls
 */

import { BaseWidget } from './BaseWidget.js';
import { SecurityValidator } from '../core/SecurityValidator.js';

export class DisplayWidget extends BaseWidget {
  constructor(instanceConfig, eventBus) {
    super(instanceConfig, eventBus);
    this.currentValue = instanceConfig.config?.defaultValue || 0;
    this.valueDisplayEl = null;
  }

  render() {
    const root = this.renderRoot;
    const toRemove = Array.from(root.children).filter((el) => el.tagName !== 'LINK' && el.tagName !== 'STYLE');
    toRemove.forEach((el) => el.remove());

    const {
      label = 'DISPLAY',
      prefix = '',
      suffix = '',
      step = 1,
      min = -99999,
      max = 99999,
      orientation = 'horizontal',
      respondToSimEvents = true
    } = this.config;

    const card = document.createElement('div');
    card.className = `fd-display-card orient-${orientation}`;

    // Header label
    const header = document.createElement('div');
    header.className = 'fd-display-header';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'fd-display-title';
    SecurityValidator.setText(labelSpan, label);
    header.appendChild(labelSpan);

    if (prefix) {
      const pfxSpan = document.createElement('span');
      pfxSpan.className = 'fd-display-badge';
      SecurityValidator.setText(pfxSpan, prefix);
      header.appendChild(pfxSpan);
    }
    card.appendChild(header);

    // Main Value Row with Stepper Controls
    const valueRow = document.createElement('div');
    valueRow.className = 'fd-display-val-row';

    const decBtn = document.createElement('button');
    decBtn.className = 'fd-step-btn fd-step-dec';
    decBtn.innerHTML = '−';
    decBtn.setAttribute('aria-label', `Decrease ${label}`);
    decBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isEditMode) return;
      this.adjustValue(-step);
    });

    const valBox = document.createElement('div');
    valBox.className = 'fd-display-val-box';
    const valText = document.createElement('span');
    valText.className = 'fd-display-num';
    SecurityValidator.setText(valText, this.formatValue(this.currentValue));
    this.valueDisplayEl = valText;
    valBox.appendChild(valText);

    if (suffix) {
      const sfxSpan = document.createElement('span');
      sfxSpan.className = 'fd-display-unit';
      SecurityValidator.setText(sfxSpan, suffix);
      valBox.appendChild(sfxSpan);
    }

    const incBtn = document.createElement('button');
    incBtn.className = 'fd-step-btn fd-step-inc';
    incBtn.innerHTML = '+';
    incBtn.setAttribute('aria-label', `Increase ${label}`);
    incBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isEditMode) return;
      this.adjustValue(step);
    });

    valueRow.appendChild(decBtn);
    valueRow.appendChild(valBox);
    valueRow.appendChild(incBtn);

    card.appendChild(valueRow);
    root.appendChild(card);
  }

  adjustValue(delta) {
    const { min = -99999, max = 99999, format, binding } = this.config;
    let next = Number(this.currentValue) + delta;

    if (format === 'DEGREE_3') {
      next = ((next % 360) + 360) % 360;
      if (next === 0 && delta > 0) next = 360;
    } else {
      next = Math.max(min, Math.min(max, next));
    }

    this.currentValue = next;
    this.updateVisualValue();

    const writeEv = this.config.writeEvent || binding?.writeEvent;
    if (writeEv) {
      this.dispatchSimEvent(writeEv, this.currentValue);
    }
  }

  formatValue(val) {
    const { format } = this.config;
    const num = Number(val) || 0;

    switch (format) {
      case 'DEGREE_3':
        return String(Math.round(num) || 360).padStart(3, '0') + '°';
      case 'ALTITUDE':
        return Math.round(num).toLocaleString('en-US');
      case 'SIGN_INT':
        const rounded = Math.round(num);
        return (rounded > 0 ? '+' : '') + rounded;
      case 'RAW_INT':
        return String(Math.round(num));
      case 'FREQ_COM':
        return typeof val === 'string' ? val : Number(val).toFixed(3);
      case 'FREQ_NAV':
        return typeof val === 'string' ? val : Number(val).toFixed(2);
      default:
        return String(val);
    }
  }

  onTelemetryUpdate(simVar, val) {
    if (this.config.respondToSimEvents === false) return;
    if (val !== undefined && val !== null) {
      this.currentValue = val;
      this.updateVisualValue();
    }
  }

  updateVisualValue() {
    if (this.valueDisplayEl) {
      SecurityValidator.setText(this.valueDisplayEl, this.formatValue(this.currentValue));
    }
  }
}
