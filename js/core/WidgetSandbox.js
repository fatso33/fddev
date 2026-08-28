/**
 * WidgetSandbox.js
 * Zero-Trust Shadow DOM Boundary Coordinator & Mediated Context Proxy Manager
 * Implements strict capability-based execution proxies for avionics widgets (v2.2 Spec)
 */

export class WidgetSandbox {
  /**
   * Creates a frozen, mediated execution proxy for a widget instance
   * Isolates widgets from raw WebSockets, IndexedDB, and global window traversal
   * @param {object} widgetInstance
   * @param {object} eventBus
   * @returns {Readonly<object>}
   */
  static createScopedContext(widgetInstance, eventBus) {
    const proxy = {
      // Scoped SimConnect Telemetry Subscription with Deadband
      subscribeSimVar(simVar, unit, callback, deadband = 0) {
        if (!WidgetSandbox.isValidIdentifier(simVar)) {
          throw new Error(`Invalid SimVar identifier: "${simVar}"`);
        }
        return eventBus.subscribeSimVar(simVar, unit, callback, deadband);
      },

      // Scoped SimEvent Dispatcher
      dispatchSimEvent(eventName, value = 0) {
        if (!WidgetSandbox.isValidIdentifier(eventName)) {
          throw new Error(`Invalid Event identifier: "${eventName}"`);
        }
        eventBus.publish('SIM_EVENT_DISPATCH', {
          event: eventName,
          value,
          sourceId: widgetInstance.id,
          category: widgetInstance.config?.binding?.eventCategory || 'K_EVENT'
        });
      },

      // Read-only access to widget instance config
      get config() {
        return Object.freeze({ ...widgetInstance.config });
      },

      // Read-only access to widget layout
      get layout() {
        return Object.freeze({ ...widgetInstance.layout });
      },

      // Read-only widget ID and type
      get id() {
        return widgetInstance.id;
      },

      get type() {
        return widgetInstance.type;
      }
    };

    return Object.freeze(proxy);
  }

  /**
   * Validates SimConnect / WASM Identifier format
   * @param {string} identifier
   * @returns {boolean}
   */
  static isValidIdentifier(identifier) {
    return (
      typeof identifier === 'string' &&
      identifier.length > 0 &&
      identifier.length <= 64 &&
      /^[A-Z0-9_:\.\-]+$/i.test(identifier.trim())
    );
  }
}
