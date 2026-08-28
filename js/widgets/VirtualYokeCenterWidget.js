/**
 * VirtualYokeCenterWidget.js
 * Built-in "Center" control for the Virtual Yoke page (page_yoke). Captures
 * the phone's current orientation as the yoke's zero reference. Requests
 * DeviceOrientation permission on first tap if needed (must run inside this
 * click handler on iOS 13+ — see VirtualYokeEngine.requestPermission()).
 *
 * Ships pre-placed on page_yoke with config.removable === false; it never
 * dispatches REMOVE_WIDGET itself — the widget-drawer/inspector/BaseWidget
 * guards described in docs/Virtual-Yoke-Page.md keep it off the delete
 * path entirely.
 */

import { BaseWidget } from './BaseWidget.js';
import { SecurityValidator } from '../core/SecurityValidator.js';

export class VirtualYokeCenterWidget extends BaseWidget {
  constructor(instanceConfig, eventBus) {
    super(instanceConfig, eventBus);
    this.hasReference = false;
    this.permissionState = 'unknown';
    this.buttonEl = null;
    this.ledEl = null;
    this.statusEl = null;
  }

  render() {
    const root = this.renderRoot;
    const toRemove = Array.from(root.children).filter((el) => el.tagName !== 'LINK' && el.tagName !== 'STYLE');
    toRemove.forEach((el) => el.remove());

    const { label = 'CENTER' } = this.config;

    const btn = document.createElement('button');
    btn.className = 'fd-btn-control fd-btn-primary fd-color-cyan fd-vyoke-btn fd-vyoke-center-btn';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'fd-btn-label';
    SecurityValidator.setText(labelSpan, label);
    btn.appendChild(labelSpan);

    const status = document.createElement('span');
    status.className = 'fd-vyoke-status';
    status.textContent = 'NOT SET';
    btn.appendChild(status);
    this.statusEl = status;

    const led = document.createElement('div');
    led.className = 'fd-btn-led';
    btn.appendChild(led);
    this.ledEl = led;

    btn.addEventListener('click', () => {
      if (this.isEditMode) return;
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 150);
      this.eventBus.publish('VYOKE_REQUEST_CENTER', {});
    });

    this.buttonEl = btn;
    root.appendChild(btn);

    this.updateVisualState();
  }

  registerDynamicBindings() {
    super.registerDynamicBindings();
    const unsub = this.eventBus.subscribe('VYOKE_STATE_CHANGED', (state) => this.onEngineState(state));
    this.unsubscribers.push(unsub);
  }

  onEngineState(state) {
    this.hasReference = Boolean(state.hasReference);
    this.permissionState = state.permissionState;
    this.updateVisualState();
  }

  updateVisualState() {
    if (this.ledEl) this.ledEl.classList.toggle('on', this.hasReference);
    const isBlocked = this.permissionState === 'denied' || this.permissionState === 'insecure-context' || this.permissionState === 'unsupported';
    if (this.buttonEl) this.buttonEl.classList.toggle('fd-vyoke-denied', isBlocked);
    if (this.statusEl) {
      if (this.permissionState === 'insecure-context') {
        this.statusEl.textContent = 'NEEDS HTTPS';
      } else if (this.permissionState === 'denied') {
        this.statusEl.textContent = 'MOTION BLOCKED';
      } else if (this.permissionState === 'unsupported') {
        this.statusEl.textContent = 'UNSUPPORTED';
      } else {
        this.statusEl.textContent = this.hasReference ? 'REFERENCE SET' : 'NOT SET';
      }
    }
  }
}
