/**
 * EventBus.js
 * Reactive SimData Event Bus with Ref-Counted Subscriptions & Dead-Band Throttling
 */

import { SecurityValidator } from './SecurityValidator.js';

export class EventBus {
  constructor() {
    // Topic subscriptions: Map<topic, Set<callback>>
    this.topics = new Map();

    // SimVar subscriptions: Map<simVarName, { refCount: number, unit: string, listeners: Map<callback, { deadband: number, lastVal: any }> }>
    this.simVarSubscriptions = new Map();

    // Dynamic SimEvent registry: Map<eventName, { category: string, refCount: number, registeredWithBridge: boolean }>
    this.dynamicEvents = new Map();

    // FDWS v1.2 §3.1a: structured array-data subscriptions: Map<source, Set<callback>>
    this.arrayDataSubscriptions = new Map();

    // Outbound bridge adapter hook
    this.bridgeClient = null;

    // RAF batch scheduler for telemetry dispatch
    this.pendingTelemetryQueue = new Map();
    this.rafScheduled = false;
  }

  /**
   * Links EventBus to Bridge transport
   * @param {object} bridgeClient
   */
  setBridgeClient(bridgeClient) {
    this.bridgeClient = bridgeClient;
  }

  /**
   * Generic Pub/Sub subscribe
   * @param {string} topic
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  subscribe(topic, callback) {
    if (!this.topics.has(topic)) {
      this.topics.set(topic, new Set());
    }
    this.topics.get(topic).add(callback);

    return () => {
      const listeners = this.topics.get(topic);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.topics.delete(topic);
        }
      }
    };
  }

  /**
   * Publishes message to topic subscribers
   * @param {string} topic
   * @param {any} data
   */
  publish(topic, data) {
    const listeners = this.topics.get(topic);
    if (listeners) {
      listeners.forEach((cb) => {
        try {
          cb(data);
        } catch (err) {
          console.error(`[EventBus] Error in listener for topic "${topic}":`, err);
        }
      });
    }

    // Auto-forward SimEvent dispatch to bridge
    if (topic === 'SIM_EVENT_DISPATCH' && this.bridgeClient && data) {
      const sanitizedEvent = SecurityValidator.sanitizeEventName(data.event || data.name);
      if (sanitizedEvent) {
        this.bridgeClient.sendEvent(sanitizedEvent, data.value, data.category);
      }
    }
  }

  /**
   * Subscribes to dynamic SimVar updates with dead-band filtering
   * @param {string} simVarName
   * @param {string} unit
   * @param {Function} callback
   * @param {number} deadband
   * @param {number} [pollFrequencyHz] - FDWS v1.7: requested update rate hint
   *   (see `SimBridge.subscribeSimVar()`'s doc comment for what this actually
   *   controls server-side). The *first* subscriber to a given simVar always
   *   notifies the bridge; a *later* subscriber (a second widget, mounted
   *   after the first) also notifies the bridge again, but only if it asks
   *   for a higher rate than the entry's current max — PC Bridge's own
   *   `subscribeDynamicSimVar()` promotes an already-normal-tier var to fast
   *   tier on exactly that kind of re-subscribe (see its doc comment), so
   *   this is what actually triggers that promotion; a later subscriber
   *   asking for the *same or lower* rate than what's already been sent
   *   doesn't re-notify, since PC Bridge already has what it needs and there
   *   is no demotion. `entry.pollFrequencyHz` tracks the max across all
   *   current listeners either way, so a reconnect resync
   *   (`getActiveSchemaManifest()`) always requests the fastest tier any
   *   current listener needs, even after listeners have come and gone.
   * @param {string} [groupKey] - FDWS v1.26 §1: which PC Bridge polling
   *   chunk this SimVar should join — see `SimBridge.subscribeSimVar()`'s
   *   doc comment. Only the *first* subscriber's groupKey is ever sent
   *   (recorded once on `entry.groupKey`, same "first subscriber wins"
   *   rule the polling-investigation discussion settled on) — a later
   *   subscriber's groupKey is ignored, since PC Bridge already placed the
   *   var by the time a second widget references it.
   * @returns {Function} Unsubscribe function
   */
  subscribeSimVar(simVarName, unit = 'Number', callback, deadband = 0, pollFrequencyHz = 1, groupKey) {
    const cleanVar = SecurityValidator.sanitizeSimVar(simVarName) || simVarName;
    const isNew = !this.simVarSubscriptions.has(cleanVar);
    if (isNew) {
      this.simVarSubscriptions.set(cleanVar, {
        refCount: 0,
        unit: unit || 'Number',
        pollFrequencyHz: 1,
        groupKey: groupKey || undefined,
        listeners: new Map()
      });
    }

    const entry = this.simVarSubscriptions.get(cleanVar);
    const requestedHz = Number(pollFrequencyHz) || 1;
    const isPromotion = !isNew && requestedHz > entry.pollFrequencyHz;
    entry.pollFrequencyHz = Math.max(entry.pollFrequencyHz, requestedHz);

    // Notify the bridge on the first subscriber, and again on any later
    // subscriber requesting a faster rate than it already knows about (see
    // this method's doc comment) — otherwise a widget that needs fast-tier
    // updates but mounts *after* a normal-tier one already subscribed the
    // same simVar would silently never get promoted.
    if ((isNew || isPromotion) && this.bridgeClient) {
      this.bridgeClient.subscribeSimVar(cleanVar, unit, deadband, entry.pollFrequencyHz, entry.groupKey);
    }

    entry.refCount++;
    entry.listeners.set(callback, { deadband: Number(deadband) || 0, lastVal: undefined });

    return () => {
      this.unsubscribeSimVar(cleanVar, callback);
    };
  }

  /**
   * FDWS v1.2 §3.1a: subscribes to a structured array-data feed (flight plan, CAS
   * messages, nearest airports) — the array-typed counterpart to subscribeSimVar(),
   * sourced from PC Bridge's SUBSCRIBE_ARRAY_DATA/ARRAY_DATA_UPDATE channel.
   * @param {string} source - e.g. "FLIGHTPLAN", "CAS_MESSAGES", "NEAREST_AIRPORTS"
   * @param {Function} callback - (items: object[]) => void
   * @returns {Function} Unsubscribe function
   */
  subscribeArrayData(source, callback) {
    if (!this.arrayDataSubscriptions.has(source)) {
      this.arrayDataSubscriptions.set(source, new Set());
      if (this.bridgeClient?.subscribeArrayData) {
        this.bridgeClient.subscribeArrayData(source);
      }
    }
    this.arrayDataSubscriptions.get(source).add(callback);

    return () => {
      const listeners = this.arrayDataSubscriptions.get(source);
      if (!listeners) return;
      listeners.delete(callback);
      if (listeners.size === 0) this.arrayDataSubscriptions.delete(source);
    };
  }

  /**
   * Fans out an incoming ARRAY_DATA_UPDATE broadcast to subscribed callbacks.
   * @param {string} source
   * @param {object[]} items
   */
  ingestArrayData(source, items) {
    const listeners = this.arrayDataSubscriptions.get(source);
    if (!listeners) return;
    listeners.forEach((cb) => {
      try {
        cb(Array.isArray(items) ? items : []);
      } catch (err) {
        console.error(`[EventBus] Error in array-data listener for source "${source}":`, err);
      }
    });
  }

  /**
   * Decrements SimVar subscription ref-count
   * @param {string} simVarName
   * @param {Function} callback
   */
  unsubscribeSimVar(simVarName, callback) {
    const entry = this.simVarSubscriptions.get(simVarName);
    if (!entry) return;

    if (entry.listeners.has(callback)) {
      entry.listeners.delete(callback);
      entry.refCount = Math.max(0, entry.refCount - 1);
    }

    if (entry.refCount === 0 || entry.listeners.size === 0) {
      this.simVarSubscriptions.delete(simVarName);
      if (this.bridgeClient) {
        this.bridgeClient.unregisterSimVar(simVarName);
      }
    }
  }

  /**
   * Registers a dynamic SimEvent with ref-counting
   * @param {{eventName: string, category?: string, description?: string}} config
   * @returns {Function} Unregister function
   */
  registerDynamicSimEvent({ eventName, category = 'K_EVENT', description = '' }) {
    const cleanEvent = SecurityValidator.sanitizeEventName(eventName);
    if (!cleanEvent) return () => {};

    if (!this.dynamicEvents.has(cleanEvent)) {
      this.dynamicEvents.set(cleanEvent, {
        category,
        description,
        refCount: 0,
        registeredWithBridge: false
      });

      if (this.bridgeClient) {
        this.bridgeClient.registerDynamicEvent(cleanEvent, category, description);
      }
    }

    const record = this.dynamicEvents.get(cleanEvent);
    record.refCount++;

    return () => {
      record.refCount = Math.max(0, record.refCount - 1);
      if (record.refCount === 0) {
        this.dynamicEvents.delete(cleanEvent);
      }
    };
  }

  /**
   * Ingests incoming telemetry frame from Bridge
   * @param {object} telemetryMap Key-value pairs of SimVars or status
   */
  ingestTelemetry(telemetryMap) {
    if (!telemetryMap || typeof telemetryMap !== 'object') return;

    // Queue telemetry updates
    Object.entries(telemetryMap).forEach(([key, val]) => {
      this.pendingTelemetryQueue.set(key, val);
    });

    if (!this.rafScheduled) {
      this.rafScheduled = true;
      requestAnimationFrame(() => {
        this.flushTelemetry();
      });
    }
  }

  /**
   * Flushes queued telemetry with dead-band evaluation
   */
  flushTelemetry() {
    this.rafScheduled = false;
    const updates = new Map(this.pendingTelemetryQueue);
    this.pendingTelemetryQueue.clear();

    // Broadcast full telemetry state object
    const snapshot = Object.fromEntries(updates);
    this.publish('TELEMETRY_STREAM', snapshot);

    // Notify individual SimVar listeners
    updates.forEach((val, simVarName) => {
      const entry = this.simVarSubscriptions.get(simVarName);
      if (entry) {
        entry.listeners.forEach((meta, cb) => {
          const { deadband, lastVal } = meta;
          let shouldTrigger = false;

          if (lastVal === undefined) {
            shouldTrigger = true;
          } else if (typeof val === 'number' && typeof lastVal === 'number') {
            shouldTrigger = Math.abs(val - lastVal) >= deadband;
          } else {
            shouldTrigger = val !== lastVal;
          }

          if (shouldTrigger) {
            meta.lastVal = val;
            try {
              cb(val);
            } catch (err) {
              console.error(`[EventBus] Error in SimVar listener for ${simVarName}:`, err);
            }
          }
        });
      }
    });
  }

  /**
   * Returns active subscription manifest for Bridge reconnection resync
   * @returns {{simVars: Array<{simVar: string, unit: string}>, events: Array<{eventName: string, category: string}>}}
   */
  getActiveSchemaManifest() {
    const simVars = [];
    this.simVarSubscriptions.forEach((entry, simVar) => {
      simVars.push({ simVar, unit: entry.unit, pollFrequencyHz: entry.pollFrequencyHz, pollGroup: entry.groupKey });
    });

    const events = [];
    this.dynamicEvents.forEach((entry, eventName) => {
      events.push({ eventName, category: entry.category });
    });

    return { simVars, events };
  }
}
