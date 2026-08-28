/**
 * RotaryWidget.js
 * Dual Concentric Rotary Dial with Touch Angle Calculation & Fine/Coarse Stepping
 */

import { BaseWidget } from './BaseWidget.js';
import { SecurityValidator } from '../core/SecurityValidator.js';

export class RotaryWidget extends BaseWidget {
  constructor(instanceConfig, eventBus) {
    super(instanceConfig, eventBus);
    this.currentValue = instanceConfig.config?.defaultValue || 0;
    this.innerAngle = 0;
    this.outerAngle = 0;
    this.valueDisplayEl = null;
  }

  render() {
    const root = this.renderRoot;
    const toRemove = Array.from(root.children).filter((el) => el.tagName !== 'LINK' && el.tagName !== 'STYLE');
    toRemove.forEach((el) => el.remove());

    const {
      label = 'ROTARY',
      coarseStep = 10,
      fineStep = 1,
      centerButtonLabel = 'PUSH',
      orientation = 'horizontal',
      respondToSimEvents = true
    } = this.config;

    const container = document.createElement('div');
    container.className = `fd-rotary-card orient-${orientation}`;

    // Title & readout
    const header = document.createElement('div');
    header.className = 'fd-rotary-header';
    const title = document.createElement('span');
    title.className = 'fd-rotary-title';
    SecurityValidator.setText(title, label);
    header.appendChild(title);

    const valBadge = document.createElement('span');
    valBadge.className = 'fd-rotary-val';
    SecurityValidator.setText(valBadge, String(this.currentValue));
    this.valueDisplayEl = valBadge;
    header.appendChild(valBadge);
    container.appendChild(header);

    // Concentric Knob Graphic & Touch Stage
    const stage = document.createElement('div');
    stage.className = 'fd-rotary-stage';

    // Outer ring (Coarse)
    const outerRing = document.createElement('div');
    outerRing.className = 'fd-rotary-outer';
    outerRing.innerHTML = `<div class="fd-rotary-tick-outer"></div>`;

    // Inner knob (Fine)
    const innerKnob = document.createElement('div');
    innerKnob.className = 'fd-rotary-inner';
    innerKnob.innerHTML = `<div class="fd-rotary-tick-inner"></div>`;

    // Center Push Button
    const centerBtn = document.createElement('button');
    centerBtn.className = 'fd-rotary-center-btn';
    SecurityValidator.setText(centerBtn, centerButtonLabel);
    centerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isEditMode) return;
      this.handleCenterPush();
    });

    stage.appendChild(outerRing);
    stage.appendChild(innerKnob);
    stage.appendChild(centerBtn);

    // Quick Stepper Controls (Left/Right for easy mobile touch)
    const controlsRow = document.createElement('div');
    controlsRow.className = 'fd-rotary-controls';

    const coarseDec = document.createElement('button');
    coarseDec.className = 'fd-rot-btn';
    coarseDec.innerHTML = `« -${coarseStep}`;
    coarseDec.addEventListener('click', () => this.stepValue(-coarseStep, outerRing, 'outer'));

    const fineDec = document.createElement('button');
    fineDec.className = 'fd-rot-btn';
    fineDec.innerHTML = `‹ -${fineStep}`;
    fineDec.addEventListener('click', () => this.stepValue(-fineStep, innerKnob, 'inner'));

    const fineInc = document.createElement('button');
    fineInc.className = 'fd-rot-btn';
    fineInc.innerHTML = `+${fineStep} ›`;
    fineInc.addEventListener('click', () => this.stepValue(fineStep, innerKnob, 'inner'));

    const coarseInc = document.createElement('button');
    coarseInc.className = 'fd-rot-btn';
    coarseInc.innerHTML = `+${coarseStep} »`;
    coarseInc.addEventListener('click', () => this.stepValue(coarseStep, outerRing, 'outer'));

    controlsRow.appendChild(coarseDec);
    controlsRow.appendChild(fineDec);
    controlsRow.appendChild(fineInc);
    controlsRow.appendChild(coarseInc);

    container.appendChild(stage);
    container.appendChild(controlsRow);
    root.appendChild(container);
  }

  stepValue(delta, ringEl, ringType) {
    if (this.isEditMode) return;
    const { min = 0, max = 360, isCircular = true, binding } = this.config;

    let next = Number(this.currentValue) + delta;
    if (isCircular) {
      next = ((next % max) + max) % max;
      if (next === 0 && delta > 0) next = max;
    } else {
      next = Math.max(min, Math.min(max, next));
    }

    this.currentValue = next;
    if (this.valueDisplayEl) {
      SecurityValidator.setText(this.valueDisplayEl, String(this.currentValue));
    }

    // Hardware Accelerated 3D GPU Transform (v2.2 Spec)
    if (ringType === 'outer') {
      this.outerAngle += delta * 6;
      if (ringEl) ringEl.style.transform = `rotate3d(0, 0, 1, ${this.outerAngle}deg)`;
    } else {
      this.innerAngle += delta * 12;
      if (ringEl) ringEl.style.transform = `rotate3d(0, 0, 1, ${this.innerAngle}deg)`;
    }

    const writeEv = this.config.writeEvent || binding?.writeEvent;
    if (writeEv) {
      this.dispatchSimEvent(writeEv, this.currentValue);
    }
  }

  handleCenterPush() {
    const { pushEvent, binding } = this.config;
    const target = pushEvent || binding?.pushEvent;
    if (target) {
      this.dispatchSimEvent(target, 1);
    }
  }

  onTelemetryUpdate(simVar, val) {
    if (this.config.respondToSimEvents === false) return;
    if (val !== undefined && val !== null) {
      this.currentValue = val;
      if (this.valueDisplayEl) {
        SecurityValidator.setText(this.valueDisplayEl, String(this.currentValue));
      }
    }
  }
}
