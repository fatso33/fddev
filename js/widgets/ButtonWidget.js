/**
 * ButtonWidget.js
 * Momentary & Toggle Switch Implementation with LED Status & Tactile Feedback
 */

import { BaseWidget } from './BaseWidget.js';
import { SecurityValidator } from '../core/SecurityValidator.js';

export class ButtonWidget extends BaseWidget {
  constructor(instanceConfig, eventBus) {
    super(instanceConfig, eventBus);
    this.isActive = false;
    this.buttonEl = null;
    this.ledEl = null;
  }

  render() {
    const root = this.renderRoot;
    // Clear any previous dynamic children while keeping attached stylesheets
    const toRemove = Array.from(root.children).filter((el) => el.tagName !== 'LINK' && el.tagName !== 'STYLE');
    toRemove.forEach((el) => el.remove());

    const {
      label = 'BUTTON',
      shortLabel = null,
      variant = 'toggle', // 'toggle', 'momentary', 'primary', 'danger'
      hasLed = false,
      color = 'cyan', // 'cyan', 'green', 'amber', 'red'
      orientation = 'horizontal', // 'horizontal', 'vertical'
      respondToSimEvents = true
    } = this.config;

    const btn = document.createElement('button');
    btn.className = `fd-btn-control fd-btn-${variant} fd-color-${color} orient-${orientation}`;
    btn.dataset.orientation = orientation;
    if (this.isActive) btn.classList.add('active');

    // Title / Label text
    const labelSpan = document.createElement('span');
    labelSpan.className = 'fd-btn-label';
    SecurityValidator.setText(labelSpan, label || shortLabel || 'BUTTON');
    btn.appendChild(labelSpan);

    // Optional LED Status Dot
    if (hasLed) {
      const led = document.createElement('div');
      led.className = `fd-btn-led ${this.isActive ? 'on' : ''}`;
      btn.appendChild(led);
      this.ledEl = led;
    }

    // Interaction handlers
    btn.addEventListener('click', (e) => {
      if (this.isEditMode) return;
      this.handleClick();
    });

    this.buttonEl = btn;
    root.appendChild(btn);
  }

  handleClick() {
    const { variant = 'toggle', writeEvent, binding } = this.config;
    const targetEvent = writeEvent || binding?.writeEvent;

    if (variant === 'toggle') {
      this.isActive = !this.isActive;
      this.updateVisualState();
      if (targetEvent) {
        this.dispatchSimEvent(targetEvent, this.isActive ? 1 : 0);
      }
    } else if (variant === 'momentary' || variant === 'danger' || variant === 'primary') {
      this.buttonEl.classList.add('pressed');
      setTimeout(() => {
        if (this.buttonEl) this.buttonEl.classList.remove('pressed');
      }, 150);

      if (targetEvent) {
        this.dispatchSimEvent(targetEvent, 1);
      }
    }
  }

  onTelemetryUpdate(simVar, val) {
    if (this.config.respondToSimEvents === false) {
      return;
    }
    const truthy = typeof val === 'boolean' ? val : Number(val) > 0;
    this.isActive = truthy;
    this.updateVisualState();
  }

  updateVisualState() {
    if (this.buttonEl) {
      this.buttonEl.classList.toggle('active', this.isActive);
    }
    if (this.ledEl) {
      this.ledEl.classList.toggle('on', this.isActive);
    }
  }
}
