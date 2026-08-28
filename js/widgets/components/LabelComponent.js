/**
 * LabelComponent.js
 * Renderer for core.label (Static or telemetry-bound text label)
 */

import { BaseComponent } from './BaseComponent.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

export class LabelComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-label');

    const props = this.def.props || {};
    const textSpan = document.createElement('span');
    textSpan.className = 'fd-comp-label-text';

    // FDWS v1.8 §1.1: props.align is core.label's pre-v1.8, undocumented,
    // horizontal-only alignment field, superseded by the generic style.align.h
    // (handled in BaseComponent.applyStyles()) but kept as a renderer fallback for
    // widgets authored before v1.8 — only applies when style.align.h is absent, so a
    // widget migrated to style.align (by Studio, or by hand) always wins.
    if (props.align && !this.def.style?.align?.h) {
      this.element.style.justifyContent = props.align === 'center' ? 'center' : (props.align === 'right' ? 'flex-end' : 'flex-start');
      this.element.style.textAlign = props.align;
    }

    if (props.truncate) {
      textSpan.style.whiteSpace = 'nowrap';
      textSpan.style.overflow = 'hidden';
      textSpan.style.textOverflow = 'ellipsis';
    }

    const initialText = props.text !== undefined ? props.text : (this.def.label || '');
    SecurityValidator.setText(textSpan, initialText);

    this.labelNode = textSpan;
    this.element.appendChild(textSpan);

    // labelNode didn't exist yet when super.render() ran applyStyles(), so its
    // typography/offset cascade was skipped on that first pass — redo it now that
    // the text span actually exists.
    this.applyStyles();

    return this.element;
  }

  update(val, allState) {
    super.update(val, allState);
    if (this.labelNode) {
      const displayVal = val !== undefined && val !== null ? val : (this.def.props?.text || this.def.label || '');
      SecurityValidator.setText(this.labelNode, displayVal);
    }
  }
}
