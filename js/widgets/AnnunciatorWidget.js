/**
 * AnnunciatorWidget.js
 * Multi-State Warning / Caution / Advisory Avionics Annunciator Indicator
 */

import { BaseWidget } from './BaseWidget.js';
import { SecurityValidator } from '../core/SecurityValidator.js';

export class AnnunciatorWidget extends BaseWidget {
  constructor(instanceConfig, eventBus) {
    super(instanceConfig, eventBus);
    this.status = instanceConfig.config?.defaultStatus || 'OFF'; // 'OFF', 'ADVISORY', 'CAUTION', 'WARNING'
    this.tileEl = null;
  }

  render() {
    const root = this.renderRoot;
    const toRemove = Array.from(root.children).filter((el) => el.tagName !== 'LINK' && el.tagName !== 'STYLE');
    toRemove.forEach((el) => el.remove());

    const {
      label = 'ANNUNCIATOR',
      sublabel = '',
      severity = 'caution', // 'warning', 'caution', 'advisory', 'status'
      orientation = 'horizontal',
      respondToSimEvents = true
    } = this.config;

    const tile = document.createElement('div');
    tile.className = `fd-annunciator-tile fd-annun-${severity.toLowerCase()} orient-${orientation}`;
    if (this.status !== 'OFF') tile.classList.add('active');

    const labelSpan = document.createElement('div');
    labelSpan.className = 'fd-annun-label';
    SecurityValidator.setText(labelSpan, label);
    tile.appendChild(labelSpan);

    if (sublabel) {
      const subSpan = document.createElement('div');
      subSpan.className = 'fd-annun-sub';
      SecurityValidator.setText(subSpan, sublabel);
      tile.appendChild(subSpan);
    }

    tile.addEventListener('click', () => {
      if (this.isEditMode) return;
      const { ackEvent } = this.config;
      if (ackEvent) {
        this.dispatchSimEvent(ackEvent, 1);
      }
    });

    this.tileEl = tile;
    root.appendChild(tile);
  }

  onTelemetryUpdate(simVar, val) {
    if (this.config.respondToSimEvents === false) return;
    const isTriggered = typeof val === 'boolean' ? val : Number(val) > 0;
    this.status = isTriggered ? 'ACTIVE' : 'OFF';
    if (this.tileEl) {
      this.tileEl.classList.toggle('active', isTriggered);
    }
  }
}
