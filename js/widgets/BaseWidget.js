/**
 * BaseWidget.js
 * Abstract Polymorphic Base Class for Avionics Components
 * Enforces dynamic SimConnect / WASM bindings and zero-trust DOM lifecycle
 */

import { SecurityValidator } from '../core/SecurityValidator.js';
import { WidgetSandbox } from '../core/WidgetSandbox.js';

let sharedStyleSheets = null;
let sharedCssText = null;
let preloadPromise = null;

export class BaseWidget {
  constructor(instanceConfig, eventBus) {
    if (new.target === BaseWidget) {
      throw new Error('Cannot instantiate abstract BaseWidget directly');
    }

    this.id = instanceConfig.id;
    this.type = instanceConfig.type;
    this.layout = { ...instanceConfig.layout };
    this.config = { ...instanceConfig.config };
    this.eventBus = eventBus;
    this.element = null;
    this.shadowRoot = null;
    this.unsubscribers = [];
    this.isEditMode = false;

    // Zero-Trust Mediated Context Proxy (v2.2 Spec)
    this.sandbox = WidgetSandbox.createScopedContext(this, this.eventBus);
  }

  /**
   * Preloads and compiles shared CSS stylesheets into memory (Zero FOUC)
   * @returns {Promise<void>}
   */
  static async preloadStyles() {
    if (sharedStyleSheets || sharedCssText) return;
    if (preloadPromise) return preloadPromise;

    preloadPromise = (async () => {
      try {
        const [mainRes, widgetsRes] = await Promise.all([
          fetch(new URL('../../css/main.css', import.meta.url)),
          fetch(new URL('../../css/widgets.css', import.meta.url))
        ]);
        const mainCss = await mainRes.text();
        const widgetsCss = await widgetsRes.text();
        const baseCss = `
          :host {
            display: flex;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
          }
          * {
            box-sizing: border-box;
          }
        `;
        sharedCssText = `${mainCss}\n${widgetsCss}\n${baseCss}`;

        if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in Document.prototype) {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(sharedCssText);
          sharedStyleSheets = [sheet];
        }
      } catch (err) {
        console.warn('[BaseWidget] Style preload warning:', err);
      }
    })();

    return preloadPromise;
  }

  /**
   * Mounts DOM root into container, initializes Shadow DOM boundary, and registers dynamic bindings
   * @param {HTMLElement} container
   */
  mount(container) {
    this.element = document.createElement('div');
    const orient = this.config.orientation || 'horizontal';
    this.element.className = `fd-widget fd-widget-${this.type.toLowerCase()} fd-orient-${orient}`;
    this.element.dataset.widgetId = this.id;
    this.element.dataset.orientation = orient;
    this.applyLayoutStyles();

    // Initialize Shadow DOM boundary for style and markup encapsulation (v2.2 Spec)
    this.shadowRoot = this.element.attachShadow({ mode: 'open' });
    this.attachScopedStyles();

    this.render();
    this.registerDynamicBindings();
    container.appendChild(this.element);
  }

  /**
   * Attaches scoped CSS stylesheet to Shadow Root synchronously with zero FOUC
   */
  attachScopedStyles() {
    if (!this.shadowRoot) return;

    // 1. Preferred modern path: Constructed & Adopted StyleSheet (Instant 0ms synchronous attach)
    if (sharedStyleSheets && this.shadowRoot.adoptedStyleSheets !== undefined) {
      this.shadowRoot.adoptedStyleSheets = sharedStyleSheets;
      return;
    }

    // 2. Synchronous in-memory style tag injection
    if (sharedCssText) {
      const styleEl = document.createElement('style');
      styleEl.textContent = sharedCssText;
      this.shadowRoot.appendChild(styleEl);
      return;
    }

    // 3. Fallback: If preload hasn't completed yet, kick off preload and attach static links
    BaseWidget.preloadStyles().then(() => {
      if (this.shadowRoot) {
        if (sharedStyleSheets && this.shadowRoot.adoptedStyleSheets !== undefined) {
          this.shadowRoot.adoptedStyleSheets = sharedStyleSheets;
        } else if (sharedCssText) {
          const styleEl = document.createElement('style');
          styleEl.textContent = sharedCssText;
          this.shadowRoot.appendChild(styleEl);
        }
      }
    });

    const styleLinkMain = document.createElement('link');
    styleLinkMain.rel = 'stylesheet';
    styleLinkMain.href = new URL('../../css/main.css', import.meta.url);

    const styleLinkWidgets = document.createElement('link');
    styleLinkWidgets.rel = 'stylesheet';
    styleLinkWidgets.href = new URL('../../css/widgets.css', import.meta.url);

    const scopedBaseStyle = document.createElement('style');
    scopedBaseStyle.textContent = `
      :host {
        display: flex;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
      }
      * {
        box-sizing: border-box;
      }
    `;

    this.shadowRoot.appendChild(styleLinkMain);
    this.shadowRoot.appendChild(styleLinkWidgets);
    this.shadowRoot.appendChild(scopedBaseStyle);
  }

  /**
   * Returns root container for DOM rendering (ShadowRoot or fallback element)
   */
  get renderRoot() {
    return this.shadowRoot || this.element;
  }

  /**
   * Updates layout position during orientation transition without re-mounting
   * @param {object} newLayout
   */
  updateLayout(newLayout) {
    this.layout = { ...newLayout };
    this.applyLayoutStyles();
  }

  /**
   * Applies CSS Grid coordinate styles to DOM element
   */
  applyLayoutStyles() {
    if (!this.element) return;
    const col = Math.max(1, this.layout.col !== undefined ? this.layout.col : (this.layout.x !== undefined ? this.layout.x + 1 : 1));
    const row = Math.max(1, this.layout.row !== undefined ? this.layout.row : (this.layout.y !== undefined ? this.layout.y + 1 : 1));
    const w = Math.max(1, this.layout.w || 1);
    const h = Math.max(1, this.layout.h || 1);

    this.element.style.gridColumnStart = `${col}`;
    this.element.style.gridColumnEnd = `span ${w}`;
    this.element.style.gridRowStart = `${row}`;
    this.element.style.gridRowEnd = `span ${h}`;
  }

  /**
   * Renders component content inside this.renderRoot (Implemented by concrete widget subclasses)
   */
  render() {
    // Abstract hook
  }

  /**
   * Sets edit mode active/inactive
   * @param {boolean} editActive
   */
  setEditMode(editActive) {
    this.isEditMode = editActive;
    if (this.element) {
      this.element.classList.toggle('edit-active', editActive);
      this.renderEditOverlay();
    }
  }

  /**
   * Renders edit mode drag handle, badge, and quick action icons
   */
  renderEditOverlay() {
    let overlay = this.element.querySelector('.widget-edit-overlay');
    if (this.isEditMode) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'widget-edit-overlay';

        const label = document.createElement('span');
        label.className = 'widget-edit-label';
        label.textContent = this.config.label || this.type;

        const editBtn = document.createElement('button');
        editBtn.className = 'widget-edit-btn';
        editBtn.setAttribute('title', 'Configure Widget');
        editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.eventBus.publish('OPEN_PROPERTY_INSPECTOR', { widgetId: this.id });
        });

        overlay.appendChild(label);
        overlay.appendChild(editBtn);

        // Widgets marked non-removable (config.removable === false — e.g. the
        // Virtual Yoke page's built-in Center / Detach controls) can still be
        // dragged and configured in edit mode, but never get a delete button.
        if (this.config.removable !== false) {
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'widget-delete-btn';
          deleteBtn.setAttribute('title', 'Remove Widget');
          deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.eventBus.publish('REMOVE_WIDGET', { widgetId: this.id });
          });
          overlay.appendChild(deleteBtn);
        } else {
          overlay.classList.add('widget-locked');
        }

        this.element.appendChild(overlay);
      }
    } else {
      if (overlay) {
        overlay.remove();
      }
    }
  }

  /**
   * Registers dynamic SimVars and SimEvents with EventBus / SimBridge
   */
  registerDynamicBindings() {
    const { binding } = this.config;
    if (!binding) return;

    // Dynamic SimVar subscription with deadband
    if (binding.readSimVar) {
      const cleanVar = SecurityValidator.sanitizeSimVar(binding.readSimVar);
      if (cleanVar) {
        const unsub = this.eventBus.subscribeSimVar(
          cleanVar,
          binding.unit || 'Number',
          (val) => {
            this.onTelemetryUpdate(cleanVar, val);
          },
          binding.deadband || 0,
          binding.pollFrequencyHz || 1
        );
        this.unsubscribers.push(unsub);
      }
    }

    // Pre-register dynamic write events with PC Bridge
    if (binding.writeEvent) {
      const cleanEvent = SecurityValidator.sanitizeEventName(binding.writeEvent);
      if (cleanEvent) {
        const unreg = this.eventBus.registerDynamicSimEvent({
          eventName: cleanEvent,
          category: binding.eventCategory || 'K_EVENT',
          description: this.config.label || this.type
        });
        this.unsubscribers.push(unreg);
      }
    }
  }

  /**
   * Callback invoked when a subscribed SimVar changes
   * @param {string} simVar
   * @param {any} val
   */
  onTelemetryUpdate(simVar, val) {
    // Abstract hook
  }

  /**
   * Dispatches dynamic SimEvent over EventBus
   * @param {string} eventName
   * @param {number|string} value
   */
  dispatchSimEvent(eventName, value = 0) {
    const cleanEvent = SecurityValidator.sanitizeEventName(eventName);
    if (!cleanEvent) return;

    this.eventBus.publish('SIM_EVENT_DISPATCH', {
      event: cleanEvent,
      value,
      sourceId: this.id,
      category: this.config.binding?.eventCategory || 'K_EVENT'
    });
  }

  /**
   * Updates configuration dynamically and re-renders
   * @param {object} newConfig
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    if (this.element) {
      const orient = this.config.orientation || 'horizontal';
      this.element.className = `fd-widget fd-widget-${this.type.toLowerCase()} fd-orient-${orient} ${this.isEditMode ? 'edit-active' : ''}`;
      this.element.dataset.orientation = orient;
    }
    this.cleanupBindings();
    this.render();
    this.registerDynamicBindings();
    if (this.isEditMode) {
      this.renderEditOverlay();
    }
  }

  /**
   * Cleanly unsubscribes all active EventBus listeners
   */
  cleanupBindings() {
    this.unsubscribers.forEach((unsub) => {
      try {
        unsub();
      } catch (_) {}
    });
    this.unsubscribers = [];
  }

  /**
   * Lifecycle cleanup
   */
  destroy() {
    this.cleanupBindings();
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.shadowRoot = null;
  }
}
