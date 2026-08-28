/**
 * GaugeComponent.js
 * Renderer for core.gauge (FDWS v1.2 §1.1) — display-only needle/bar/arc driven by a
 * bound value through a rotate/translate/arc-fill visual transform. Never interactive;
 * see BaseComponent.resolvePointerEvents() for the always-none-unless-interactions rule.
 *
 * `props.compose` (additive, backward-compatible): lets a single gauge apply a SECOND
 * transform function on top of its primary one — e.g. a rotate(bank) horizon that also
 * translates for pitch, as one rigid body, instead of two independently-moving layers.
 * The secondary value is read from local widget state (`allState`, already passed into
 * every component's update()) rather than a second SimVar subscription — no new binding
 * plumbing needed. `props.compose` shape: { transform, axis?, stateVar, valueRange,
 * outputRange, clamp? }. Composed as `<primary> <secondary>` in that order, so the
 * secondary (typically translate) is applied in the pre-rotation frame and the primary
 * (typically rotate) carries it around the pivot — matching real ADI kinematics. Omitting
 * `props.compose` preserves the original single-transform behavior exactly.
 */

import { BaseComponent } from './BaseComponent.js';

export class GaugeComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-gauge');

    const props = this.def.props || {};
    const layer = document.createElement('div');
    layer.className = props.transform === 'arc-fill' ? 'fd-gauge-arc-fill' : 'fd-gauge-transform-layer';

    if (props.transform !== 'arc-fill') {
      const assetId = this.def.assets?.image;
      if (assetId) {
        const img = document.createElement('img');
        img.className = 'fd-comp-img-element';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.style.pointerEvents = 'none';
        const url = this.widget.resolveAssetUrl(assetId);
        if (url) img.src = url;
        layer.appendChild(img);
      }
    }

    if (props.transform === 'rotate' || props.compose?.transform === 'rotate') {
      const pivot = props.pivot || { x: '50%', y: '50%' };
      layer.style.transformOrigin = `${pivot.x} ${pivot.y}`;
    }

    this.applyTransition(layer, this.def.binding?.transition, 'transform');

    this.transformLayer = layer;
    this.element.appendChild(layer);
    return this.element;
  }

  /**
   * Maps a raw bound value through a {transform, axis, valueRange, outputRange, clamp}
   * config into a single CSS transform function string (e.g. "rotate(12deg)").
   * @param {object} cfg
   * @param {any} rawVal
   * @returns {string}
   */
  resolveTransformFn(cfg, rawVal) {
    const [domainMin, domainMax] = cfg.valueRange || [0, 1];
    const [outMin, outMax] = cfg.outputRange || [0, 1];
    const clamp = cfg.clamp !== false;

    let num = Number(rawVal);
    if (isNaN(num)) num = domainMin;

    const domainSpan = domainMax - domainMin || 1;
    let ratio = (num - domainMin) / domainSpan;
    if (clamp) ratio = Math.max(0, Math.min(1, ratio));

    const outSpan = outMax - outMin;
    const outVal = outMin + ratio * outSpan;

    switch (cfg.transform) {
      case 'translate': {
        const axis = cfg.axis === 'x' ? 'X' : 'Y';
        return `translate${axis}(${outVal}px)`;
      }
      case 'arc-fill': {
        const fillRatio = clamp ? Math.max(0, Math.min(1, outVal)) : outVal;
        return `scaleX(${fillRatio})`;
      }
      case 'rotate':
      default:
        return `rotate(${outVal}deg)`;
    }
  }

  update(val, allState) {
    super.update(val, allState);
    if (!this.transformLayer) return;

    const props = this.def.props || {};
    let transform = this.resolveTransformFn(props, val);

    if (props.compose && props.compose.stateVar) {
      let secondaryVal = (allState || {})[props.compose.stateVar];
      // v1.5.1 (local extension): compose.relativeToStateVar — for a gauge
      // showing a TARGET against a background that already moved to reflect
      // the CURRENT reading (e.g. an FD command bar over a pitch ladder that
      // itself translates by current pitch), the on-screen delta needs to be
      // (target - current), not target run through the same absolute-value
      // formula the background uses — that only coincides with the fixed
      // reference symbol when target happens to equal current, and renders
      // wrong by exactly (target - current)'s worth of offset otherwise.
      // Optional and additive: omitting it preserves the original absolute-
      // value behavior exactly.
      if (props.compose.relativeToStateVar) {
        const referenceVal = (allState || {})[props.compose.relativeToStateVar];
        secondaryVal = (Number(secondaryVal) || 0) - (Number(referenceVal) || 0);
      }
      transform += ` ${this.resolveTransformFn(props.compose, secondaryVal)}`;
    }

    this.transformLayer.style.transform = transform;
  }
}
