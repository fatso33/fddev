/**
 * ImageComponent.js
 * Renderer for core.image (Decorative or state-driven image / background art asset)
 */

import { BaseComponent } from './BaseComponent.js';

export class ImageComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-image');

    const props = this.def.props || {};
    const img = document.createElement('img');
    img.className = 'fd-comp-img-element';
    img.alt = this.def.label || 'Widget Art';

    const assetId = props.assetId;
    if (assetId) {
      const assetUrl = this.widget.resolveAssetUrl(assetId);
      if (assetUrl) {
        img.src = assetUrl;
      }
    }

    const fit = props.fit || 'contain';
    img.style.objectFit = fit;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.display = 'block';

    if (this.def.layer?.pointerEvents === 'none') {
      img.style.pointerEvents = 'none';
    }

    this.imgNode = img;
    this.element.appendChild(img);
    return this.element;
  }

  update(val, allState) {
    super.update(val, allState);
    const props = this.def.props || {};
    // Check if style states swap image or if binding determines asset
    if (this.imgNode && this.activeStateName) {
      const stateStyle = this.def.style?.states?.[this.activeStateName];
      if (stateStyle?.background?.image?.assetId) {
        const url = this.widget.resolveAssetUrl(stateStyle.background.image.assetId);
        if (url) this.imgNode.src = url;
      }
    }
  }
}
