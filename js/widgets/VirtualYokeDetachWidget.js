/**
 * VirtualYokeDetachWidget.js
 * Built-in "Detach" control for the Virtual Yoke page (page_yoke). Toggles
 * whether phone motion is currently driving the yoke axis — lets the user
 * set the phone down (e.g. once the autopilot is engaged) without the
 * yoke drifting from whatever position it last commanded.
 *
 * Ships pre-placed on page_yoke with config.removable === false — see
 * docs/Virtual-Yoke-Page.md for the non-removable-widget mechanism.
 */

import { BaseWidget } from './BaseWidget.js';
import { SecurityValidator } from '../core/SecurityValidator.js';

export class VirtualYokeDetachWidget extends BaseWidget {
  constructor(instanceConfig, eventBus) {
    super(instanceConfig, eventBus);
    this.attached = true;
    this.hasReference = false;
    this.buttonEl = null;
    this.ledEl = null;
    this.labelSpan = null;
  }

  render() {
    const root = this.renderRoot;
    const toRemove = Array.from(root.children).filter((el) => el.tagName !== 'LINK' && el.tagName !== 'STYLE');
    toRemove.forEach((el) => el.remove());

    const btn = document.createElement('button');
    btn.className = 'fd-btn-control fd-btn-toggle fd-color-amber fd-vyoke-btn fd-vyoke-detach-btn';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'fd-btn-label';
    btn.appendChild(labelSpan);
    this.labelSpan = labelSpan;

    const led = document.createElement('div');
    led.className = 'fd-btn-led on';
    btn.appendChild(led);
    this.ledEl = led;

    btn.addEventListener('click', () => {
      if (this.isEditMode) return;
      this.eventBus.publish('VYOKE_REQUEST_TOGGLE_ATTACH', {});
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
    this.attached = Boolean(state.attached);
    this.hasReference = Boolean(state.hasReference);
    this.updateVisualState();
  }

  updateVisualState() {
    const { label, detachedLabel } = this.config;
    if (this.labelSpan) {
      SecurityValidator.setText(
        this.labelSpan,
        this.attached ? (label || 'DETACH') : (detachedLabel || 'ATTACH')
      );
    }
    if (this.buttonEl) {
      this.buttonEl.classList.toggle('active', !this.attached);
      this.buttonEl.classList.toggle('fd-vyoke-disabled', !this.hasReference);
    }
    if (this.ledEl) {
      this.ledEl.classList.toggle('on', this.attached);
    }
  }
}
