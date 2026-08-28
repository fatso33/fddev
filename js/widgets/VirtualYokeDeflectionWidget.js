/**
 * VirtualYokeDeflectionWidget.js
 * Static gray pitch/roll cross with a Garmin-green ball indicator showing
 * live Virtual Yoke deflection — full forward/back tilt puts the ball at
 * the top/bottom of the vertical (pitch) arm, full left/right roll puts it
 * at the left/right end of the horizontal (roll) arm, proportionally for
 * anything in between. Purely a readout — never dispatches anything, no
 * label/chrome — the cross fills the entire widget.
 *
 * Driven by VirtualYokeEngine's VYOKE_DEFLECTION_CHANGED broadcast
 * (normalized -1..1 per axis, already scaled by the user's configured
 * pitch/roll sensitivity degrees from the Settings page — this widget never
 * needs to know the actual degree values, just the resulting -1..1
 * fraction of full deflection).
 */

import { BaseWidget } from './BaseWidget.js';

export class VirtualYokeDeflectionWidget extends BaseWidget {
  constructor(instanceConfig, eventBus) {
    super(instanceConfig, eventBus);
    this.pitchNorm = 0;
    this.rollNorm = 0;
    this.ballEl = null;
  }

  render() {
    const root = this.renderRoot;
    const toRemove = Array.from(root.children).filter((el) => el.tagName !== 'LINK' && el.tagName !== 'STYLE');
    toRemove.forEach((el) => el.remove());

    const field = document.createElement('div');
    field.className = 'fd-yoke-deflection';

    const vLine = document.createElement('div');
    vLine.className = 'fd-yoke-axis-line fd-yoke-axis-v';
    field.appendChild(vLine);

    const hLine = document.createElement('div');
    hLine.className = 'fd-yoke-axis-line fd-yoke-axis-h';
    field.appendChild(hLine);

    const centerTick = document.createElement('div');
    centerTick.className = 'fd-yoke-center-tick';
    field.appendChild(centerTick);

    const ball = document.createElement('div');
    ball.className = 'fd-yoke-ball';
    field.appendChild(ball);
    this.ballEl = ball;

    root.appendChild(field);

    this.updateBallPosition();
  }

  registerDynamicBindings() {
    super.registerDynamicBindings();
    const unsub = this.eventBus.subscribe('VYOKE_DEFLECTION_CHANGED', (state) => this.onDeflectionChanged(state));
    this.unsubscribers.push(unsub);
  }

  onDeflectionChanged(state) {
    this.pitchNorm = typeof state?.pitchNorm === 'number' ? state.pitchNorm : 0;
    this.rollNorm = typeof state?.rollNorm === 'number' ? state.rollNorm : 0;
    this.updateBallPosition();
  }

  /**
   * Positions the ball via left/top percentages of the field's own box —
   * NOT via a CSS transform() percentage, which resolves against the
   * *ball's* own (tiny) size rather than the field's, and was why full
   * deflection previously only moved the ball a few pixels instead of all
   * the way to the end of the axis.
   *
   * +pitchNorm (forward tilt) moves the ball up. Empirically, on-device,
   * +rollNorm (rolling right) is reported by VirtualYokeEngine as
   * *negative* — the same left/right-flipped relationship the engine class
   * doc already calls out as "sign is empirically tuned" for its own axis
   * dispatch — so this widget flips it back to match the physical roll
   * direction the user is holding, purely for display. If a specific
   * device still shows either axis backwards, config.invertPitch /
   * config.invertRoll flip it per-widget without touching that shared
   * engine math.
   */
  updateBallPosition() {
    if (!this.ballEl) return;
    const { invertPitch = false, invertRoll = false } = this.config;

    const pitchSign = invertPitch ? -1 : 1;
    const rollSign = invertRoll ? 1 : -1; // -1 is the un-inverted default (see doc comment)

    const pitch = Math.max(-1, Math.min(1, pitchSign * this.pitchNorm));
    const roll = Math.max(-1, Math.min(1, rollSign * this.rollNorm));

    this.ballEl.style.left = `${50 + roll * 50}%`;
    this.ballEl.style.top = `${50 - pitch * 50}%`;
  }
}
