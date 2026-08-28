/**
 * DisplayComponent.js
 * Renderer for core.display (Read-only formatted telemetry readout)
 */

import { BaseComponent } from './BaseComponent.js';
import { ValueFormatter } from './ValueFormatter.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

export class DisplayComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-display');

    const props = this.def.props || {};
    const readoutBox = document.createElement('div');
    readoutBox.className = 'fd-comp-display-box';

    if (props.prefix) {
      const prefixEl = document.createElement('span');
      prefixEl.className = 'fd-comp-display-prefix';
      SecurityValidator.setText(prefixEl, props.prefix);
      readoutBox.appendChild(prefixEl);
    }

    const valueEl = document.createElement('span');
    valueEl.className = 'fd-comp-display-value';
    // FDWS v1.2 §2.3: props.literalOverride replaces the FIXED_0/FIXED_1 "always show
    // this constant" hack, bypassing format/val entirely when present.
    const initialFormatted = props.literalOverride !== undefined
      ? String(props.literalOverride)
      : ValueFormatter.format(
        props.defaultValue !== undefined ? props.defaultValue : null,
        props.format || 'RAW_INT',
        '',
        '',
        // FDWS v1.15 fix: props.coordAxis ('lat'|'lon') was never threaded
        // through to ValueFormatter's opts.axis before this — LATLON_DMS (and
        // now COORD_DECIMAL) silently always rendered N/S hemisphere labels,
        // even for a longitude-bound value that should show E/W.
        { decimals: props.decimals, axis: props.coordAxis }
      );
    SecurityValidator.setText(valueEl, initialFormatted);
    readoutBox.appendChild(valueEl);

    if (props.suffix) {
      const suffixEl = document.createElement('span');
      suffixEl.className = 'fd-comp-display-suffix';
      SecurityValidator.setText(suffixEl, props.suffix);
      readoutBox.appendChild(suffixEl);
    }

    // FDWS v1.2 §3.4: binding.transition — smooth value interpolation instead of snap.
    this.applyTransition(valueEl, this.def.binding?.transition, 'color');

    this.valueNode = valueEl;
    this.boxNode = readoutBox;
    this.element.appendChild(readoutBox);

    // Neither node existed yet when super.render() ran applyStyles(), so the
    // typography/alignment cascade was skipped on that first pass — redo it now that
    // both actually exist. readoutBox (boxNode) fills the wrapper edge-to-edge and is
    // itself the flex container centering prefix/value/suffix, so FDWS v1.8 align
    // needs to land there directly, not just on the (now-irrelevant) outer wrapper.
    this.applyStyles();

    return this.element;
  }

  update(val, allState) {
    super.update(val, allState);
    if (this.valueNode) {
      const props = this.def.props || {};
      const formatted = props.literalOverride !== undefined
        ? String(props.literalOverride)
        : ValueFormatter.format(val, props.format || 'RAW_INT', '', '', { decimals: props.decimals, axis: props.coordAxis });
      SecurityValidator.setText(this.valueNode, formatted);
    }
  }
}
