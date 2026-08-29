/**
 * CompositeWidget.js
 * Polymorphic FDWS v1.2 Composite Widget Runtime Engine
 * Renders declarative component trees with layer stacking, local state, and dynamic sim bindings.
 */

import { BaseWidget } from './BaseWidget.js';
import { ComponentRegistry } from './components/ComponentRegistry.js';
import { SecurityValidator } from '../core/SecurityValidator.js';
import { WidgetRegistry } from './WidgetRegistry.js';
import { openWidgetPopover } from './components/WidgetPopoverModal.js';
import { readStateRef } from './utils/StateRefPath.js';
import { runInteraction } from './components/InteractionDispatcher.js';
import { notifyBindingDependents } from './components/BindingReactivity.js';
import { resolveThemedColor, resolveThemedBackground } from './components/ThemeColor.js';

export class CompositeWidget extends BaseWidget {
  constructor(instanceConfig, eventBus) {
    super(instanceConfig, eventBus);

    // Resolve FDWS definition from catalog or inline config
    this.definition = this.resolveDefinition(instanceConfig);
    this.localState = new Map();
    this.componentRenderers = new Map();
    this.assetUrlCache = new Map();

    // FDWS v1.3: for a popover instance, WidgetPopoverModal.js passes the
    // resolved read-only $context snapshot in via config (not assigned after
    // construction) — must be set before initLocalState() runs so FDWS v1.12
    // §1.1's state[].seedFromContext can see it.
    this.popoverContext = instanceConfig.config?.popoverContext || null;

    // Initialize Local State from definition schema and instance overrides
    this.initLocalState();
  }

  /**
   * Resolves FDWS widget definition
   * @param {object} instanceConfig
   * @returns {object}
   */
  resolveDefinition(instanceConfig) {
    if (instanceConfig.config?.definition) {
      return instanceConfig.config.definition;
    }
    const defId = instanceConfig.config?.fdwsDefinitionId || instanceConfig.type;
    const catalogDef = WidgetRegistry.getDefinition?.(defId);
    if (catalogDef) {
      return catalogDef;
    }

    // Default fallback minimal definition
    return {
      fdws: '1.2',
      schemaVersion: '1.2.0',
      id: instanceConfig.type || 'unknown.widget',
      meta: { name: instanceConfig.config?.label || 'Composite Widget', category: 'Avionics' },
      layout: { defaultW: 8, defaultH: 4, grid: { columns: 12, rows: 6 } },
      components: []
    };
  }

  /**
   * Initializes Local State variables
   */
  initLocalState() {
    this.localState.clear();
    const stateDeclarations = this.definition?.state || [];
    
    // 1. Set defaults from definition
    stateDeclarations.forEach((entry) => {
      let initialVal = entry.default;
      // FDWS v1.2 §3.2: 'array'-typed state (plus the pre-existing 'list' type) deep-clones
      // its default so instances don't share a mutable reference.
      if ((entry.type === 'array' || entry.type === 'list') && Array.isArray(entry.default)) {
        initialVal = JSON.parse(JSON.stringify(entry.default));
      }
      if (entry.type === 'array' && entry.default === undefined) {
        initialVal = [];
      }
      // FDWS v1.12 §1.1: on a popover instance, a state var can request its
      // initial value come from the host's Context Map instead of `default` —
      // e.g. a scratch edit field pre-filled with the preset's current label,
      // so Cancel (which never writes back) can still mean a true discard,
      // unlike binding a component directly to `$context.*.value` (which
      // would need a live commit-on-change, no discard). No-ops safely on a
      // non-popover instance (this.popoverContext is null) or when the named
      // context key wasn't declared by the host.
      if (entry.seedFromContext && this.popoverContext?.[entry.seedFromContext]) {
        initialVal = this.popoverContext[entry.seedFromContext].value;
      }
      // FDWS v1.2 §3.2 (loosened by v1.21, extended by v1.22): persist
      // (true or "session") is disallowed on array-typed state only when
      // it's ALSO live-synced (syncFrom set) — that combination is still
      // nonsensical (a live feed like a flight plan or message queue is
      // always re-synced fresh; a persisted local copy would just go stale
      // and could conflict with the next sync). A plain local-only array
      // (no syncFrom) is free to persist — durably (true) or for the
      // current app session only (v1.22's "session") — like any scalar.
      if (entry.type === 'array' && entry.persist && entry.persist !== false && entry.syncFrom) {
        console.warn(`[CompositeWidget] State "${entry.name}" declares type:"array" with persist:${JSON.stringify(entry.persist)} AND syncFrom — persist is ignored for a live-synced array per FDWS v1.2 §3.2/v1.21.`);
      }
      this.localState.set(entry.name, initialVal);
    });

    // 2. Apply persisted state overrides from instance config
    if (this.config.state && typeof this.config.state === 'object') {
      Object.entries(this.config.state).forEach(([key, val]) => {
        this.localState.set(key, val);
      });
    }
  }

  /**
   * Resolves asset identifier to data URL or cached object URL
   * @param {string} assetId
   * @returns {string|null}
   */
  resolveAssetUrl(assetId) {
    if (!assetId) return null;
    const cleanId = assetId.replace(/^asset:\/\//, '');

    if (this.assetUrlCache.has(cleanId)) {
      return this.assetUrlCache.get(cleanId);
    }

    const assets = this.definition?.assets || [];
    const asset = assets.find((a) => a.id === cleanId);
    if (!asset || !asset.data) return null;

    const dataUrl = `data:${asset.mimeType || 'image/png'};base64,${asset.data}`;
    this.assetUrlCache.set(cleanId, dataUrl);
    return dataUrl;
  }

  /**
   * FDWS v1.20 §2: decoded SVG source text for an svg+xml asset, or null for any
   * other mimeType (or a missing asset) — used by ImageComponent's
   * `props.renderMode: "inline"` so an SVG can be injected as live markup instead
   * of an opaque `<img>`, letting `fill="currentColor"`/`stroke="currentColor"`
   * inside it follow this.element.style.color (BaseComponent.applyStyles()'s
   * already fully theme-resolved output for style.typography.color).
   * @param {string} assetId
   * @returns {string|null}
   */
  resolveAssetSvgText(assetId) {
    if (!assetId) return null;
    const cleanId = assetId.replace(/^asset:\/\//, '');
    const assets = this.definition?.assets || [];
    const asset = assets.find((a) => a.id === cleanId);
    if (!asset || !asset.data || asset.mimeType !== 'image/svg+xml') return null;
    try {
      return atob(asset.data);
    } catch (_) {
      return null;
    }
  }

  /**
   * BaseComponent.applyStyles() calls this to theme-adjust every authored color —
   * the PWA has one global theme (the topbar's dark/light toggle), so this just
   * mirrors whatever it last set on <html data-theme>, same source main.css's own
   * [data-theme] tokens already read.
   * @returns {'dark'|'light'}
   */
  getPreviewTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  /**
   * FDWS v1.18: which theme this widget's `style.*` was authored for, and
   * whether the other theme is auto-derived or manually overridden via
   * `style.themeOverride`. Read straight from the definition — every widget
   * predating v1.18 has neither field, which resolves to the pre-v1.18
   * default (dark-authored, always auto-derive) exactly as before.
   * @returns {{baseTheme: 'dark'|'light', themeMode: 'auto'|'manual'}}
   */
  getThemeConfig() {
    return {
      baseTheme: this.definition?.baseTheme === 'light' ? 'light' : 'dark',
      themeMode: this.definition?.themeMode === 'manual' ? 'manual' : 'auto'
    };
  }

  /**
   * Instantiates a renderer for a nested child component definition (used by
   * core.container, core.list itemTemplate, and core.ref) and tracks it alongside
   * top-level renderers so destroy() tears it down too.
   * @param {object} childDef
   * @returns {import('./components/BaseComponent.js').BaseComponent}
   */
  createComponentRenderer(childDef) {
    const RendererClass = ComponentRegistry.getRenderer(childDef.type);
    const renderer = new RendererClass(childDef, this);
    this.componentRenderers.set(childDef.id, renderer);
    return renderer;
  }

  /**
   * FDWS v1.2 §3.3 (core.ref): resolves a packaged component-library definition by id
   * through the same WidgetRegistry catalog used for widget definitions themselves.
   * @param {string} libraryId
   * @returns {object|null}
   */
  resolveComponentLibrary(libraryId) {
    if (!libraryId) return null;
    return WidgetRegistry.getDefinition?.(libraryId) || null;
  }

  /**
   * Renders the FDWS component tree inside Shadow DOM / renderRoot
   */
  render() {
    if (!this.renderRoot) return;
    this.renderRoot.innerHTML = '';
    this.componentRenderers.clear();

    const gridConfig = this.definition?.layout?.grid || { columns: 12, rows: 6 };
    const cols = gridConfig.columns || 12;
    const rows = gridConfig.rows || 6;

    // Outer widget container
    const outerContainer = document.createElement('div');
    outerContainer.className = `fd-composite-widget-root fd-widget-${this.definition.id?.replace(/[^a-zA-Z0-9-]/g, '_')}`;
    outerContainer.style.position = 'relative';
    outerContainer.style.width = '100%';
    outerContainer.style.height = '100%';
    outerContainer.style.display = 'grid';
    // minmax(0,1fr) not bare 1fr on both axes: a bare flex value is implicitly
    // minmax(auto,1fr), letting one row/column grow past its even share to
    // fit a component's intrinsic content size (at other tracks' expense).
    // minmax(0,1fr) forces strict, deterministic even subdivision so Widget
    // Studio's preview (same fix applied there) computes identical cell
    // sizes for the same widget.
    outerContainer.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    outerContainer.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    outerContainer.style.gap = '4px';
    outerContainer.style.padding = '4px';
    outerContainer.style.boxSizing = 'border-box';
    outerContainer.style.borderRadius = '8px';
    // --panel-bg was never actually defined anywhere in main.css (checked
    // 2026-08-27) — every widget with no authored root style.background fell
    // through to this literal dark fallback forever, in both themes. --card-bg
    // is main.css's real token for exactly this surface (already redefined per
    // [data-theme], and what StudioDeviceView.js's own equivalent fallback uses).
    outerContainer.style.backgroundColor = 'var(--card-bg, #10141c)';
    outerContainer.style.border = '1px solid var(--btn-border, #1f2937)';
    outerContainer.style.overflow = 'hidden';

    // Apply widget-level styles if declared
    this.applyWidgetLevelStyles(outerContainer);

    // Resolve v1.1 Stacking and Layer Order (§5.2.2 & §5.2.3)
    const layerGroupsMap = new Map();
    (this.definition.layerGroups || []).forEach((lg) => {
      layerGroupsMap.set(lg.id, lg.z || 0);
    });

    const rawComponents = this.definition.components || [];
    const decoratedComponents = rawComponents.map((comp, originalIdx) => {
      const groupZ = comp.layer?.group ? (layerGroupsMap.get(comp.layer.group) ?? 0) : 0;
      const compZ = comp.layer?.z ?? 0;
      const effectiveZ = groupZ + compZ;
      return { ...comp, _effectiveZ: effectiveZ, _originalIdx: originalIdx };
    });

    // Stable sort by effectiveZ ascending, then by original array index
    decoratedComponents.sort((a, b) => {
      if (a._effectiveZ !== b._effectiveZ) {
        return a._effectiveZ - b._effectiveZ;
      }
      return a._originalIdx - b._originalIdx;
    });

    // Mount components in sorted order
    decoratedComponents.forEach((compDef) => {
      const RendererClass = ComponentRegistry.getRenderer(compDef.type);
      const renderer = new RendererClass(compDef, this);
      const compElement = renderer.render();
      outerContainer.appendChild(compElement);

      this.componentRenderers.set(compDef.id, renderer);

      // Initialize initial bound value. FDWS v1.11 §1.2: binding.stateRef
      // (a nested/indexed path) is resolved the same way subsequent
      // setLocalState() broadcasts resolve it — see readStateRef() there.
      if (compDef.binding?.stateVar) {
        const stateVal = this.getLocalState(compDef.binding.stateVar);
        renderer.update(stateVal, this.getAllStateObject());
      } else if (compDef.binding?.stateRef) {
        renderer.update(readStateRef(this, compDef.binding.stateRef), this.getAllStateObject());
      } else {
        renderer.update(undefined, this.getAllStateObject());
      }
    });

    this.renderRoot.appendChild(outerContainer);
  }

  /**
   * Applies top-level widget styling and background
   * @param {HTMLElement} container
   */
  applyWidgetLevelStyles(container) {
    const style = this.definition?.style || {};
    const theme = this.getPreviewTheme();
    const themeConfig = this.getThemeConfig();
    // The widget's own outer bezel — always the true background layer, regardless
    // of componentType (there isn't one at this level).
    const colorCtx = { componentType: 'widget-root', layerGroup: 'background' };
    const themeOverride = style.themeOverride || {};
    if (style.border) {
      if (style.border.width !== undefined) container.style.borderWidth = `${style.border.width}px`;
      if (style.border.color) {
        container.style.borderColor = resolveThemedColor(
          style.border.color, themeOverride.border?.color, { ...colorCtx, colorKind: 'border' },
          theme, themeConfig.baseTheme, themeConfig.themeMode
        );
      }
      if (style.border.radius !== undefined) container.style.borderRadius = `${style.border.radius}px`;
    }

    const bg = resolveThemedBackground(style.background, themeOverride.background, colorCtx, theme, themeConfig.baseTheme, themeConfig.themeMode);
    if (bg) {
      if (bg.type === 'color' && bg.color) {
        container.style.backgroundColor = bg.color;
      } else if (bg.type === 'gradient' && bg.gradient) {
        container.style.background = bg.gradient;
      } else if (bg.type === 'image' && bg.image) {
        const url = this.resolveAssetUrl(bg.image.assetId);
        if (url) {
          container.style.backgroundImage = `url("${url}")`;
          container.style.backgroundSize = bg.image.fit || 'cover';
          container.style.backgroundPosition = bg.image.position || 'center';
        }
      }
    }
  }

  /**
   * FDWS v1.2 §1.6: substitutes the {index} template token in a binding identifier
   * string using the Widget Instance's instanceParams.index (falling back to a
   * per-component instanceParams.index override, if declared). Strings without an
   * {index} token pass through unchanged.
   * @param {string} identifier
   * @returns {string}
   */
  applyInstanceParams(identifier, compInstanceParams) {
    if (typeof identifier !== 'string' || identifier.indexOf('{index}') === -1) {
      return identifier;
    }
    const index = compInstanceParams?.index ?? this.config?.instanceParams?.index;
    if (index === undefined || index === null) return identifier;
    return identifier.replace(/\{index\}/g, String(index));
  }

  /**
   * Registers dynamic SimVars and writeEvents for all child components
   */
  registerDynamicBindings() {
    this.cleanupBindings();
    const components = this.definition?.components || [];

    components.forEach((comp) => {
      const { binding } = comp;
      if (!binding) return;

      // 1. SimVar Read Subscriptions
      if (binding.readSimVar) {
        const templatedVar = this.applyInstanceParams(binding.readSimVar, comp.instanceParams);
        const cleanVar = SecurityValidator.sanitizeSimVar(templatedVar);
        if (cleanVar) {
          const unsub = this.eventBus.subscribeSimVar(
            cleanVar,
            binding.unit || 'Number',
            (val) => {
              this.onComponentTelemetry(comp.id, cleanVar, val);
            },
            binding.deadband || 0,
            binding.pollFrequencyHz || 1
          );
          this.unsubscribers.push(unsub);
        }
      }

      // 2. Pre-register Write Events
      const writeEvent = this.applyInstanceParams(
        binding.writeEvent || binding.ackEvent || binding.pushEvent,
        comp.instanceParams
      );
      if (writeEvent) {
        const cleanEvent = SecurityValidator.sanitizeEventName(writeEvent);
        if (cleanEvent) {
          const unreg = this.eventBus.registerDynamicSimEvent({
            eventName: cleanEvent,
            category: binding.eventCategory || 'K_EVENT',
            description: `${this.definition.meta?.name || 'Widget'} - ${comp.label || comp.id}`
          });
          this.unsubscribers.push(unreg);
        }
      }
    });

    // Also register syncFrom bindings for state variables
    (this.definition?.state || []).forEach((st) => {
      if (!st.syncFrom) return;

      // FDWS v1.2 §3.2/§3.1a: array-typed state syncs from a structured PC Bridge
      // data source (FLIGHTPLAN, CAS_MESSAGES, NEAREST_AIRPORTS) over the
      // SUBSCRIBE_ARRAY_DATA/ARRAY_DATA_UPDATE channel, not the scalar SimVar cache.
      if (st.type === 'array') {
        const unsub = this.eventBus.subscribeArrayData(st.syncFrom, (items) => {
          this.setLocalState(st.name, items, false);
        });
        this.unsubscribers.push(unsub);
        return;
      }

      const cleanVar = SecurityValidator.sanitizeSimVar(st.syncFrom);
      if (cleanVar) {
        const unsub = this.eventBus.subscribeSimVar(
          cleanVar,
          'Number',
          (val) => {
            this.setLocalState(st.name, val, false); // sync without loop
          },
          st.deadband || 0,
          st.pollFrequencyHz || 1
        );
        this.unsubscribers.push(unsub);
      }
    });
  }

  /**
   * Distributes telemetry update to subscribed components
   * @param {string} compId
   * @param {string} simVar
   * @param {any} val
   */
  onComponentTelemetry(compId, simVar, val) {
    const renderer = this.componentRenderers.get(compId);
    if (renderer) {
      renderer.update(val, this.getAllStateObject());
    }
  }

  /**
   * Global telemetry update fan-out
   * @param {string} simVar
   * @param {any} val
   */
  onTelemetryUpdate(simVar, val) {
    (this.definition?.components || []).forEach((comp) => {
      const templatedVar = this.applyInstanceParams(comp.binding?.readSimVar, comp.instanceParams);
      if (templatedVar === simVar) {
        const renderer = this.componentRenderers.get(comp.id);
        if (renderer) {
          renderer.update(val, this.getAllStateObject());
        }
      }
    });
  }

  /**
   * Interaction Runner: Resolves declarative interactions to state changes & sim events
   * @param {object} compDef - Component definition
   * @param {string} trigger - Trigger type ('tap', 'longpress', 'change', etc.)
   * @param {object} eventData - Interaction payload
   */
  handleInteraction(compDef, trigger, eventData = {}) {
    // Widget Studio 2.0, Phase 0: the actual action switch (dispatchEvent,
    // setLocalState, applyPresetToField, popover actions, …) now lives once in
    // InteractionDispatcher.js, shared with Studio's MockWidgetHost.js and
    // StudioCanvas.js simulators instead of being hand-duplicated three times.
    // This adapter just wires that shared function to this instance's own state/
    // popover/eventBus plumbing.
    runInteraction({
      dispatchSimEvent: (event, val) => this.dispatchSimEvent(event, val),
      getLocalState: (name) => this.getLocalState(name),
      setLocalState: (name, val) => this.setLocalState(name, val),
      swapLocalState: (f1, f2) => this.swapLocalState(f1, f2),
      getAllStateObject: () => this.getAllStateObject(),
      getRenderer: (id) => this.componentRenderers.get(id),
      flushPendingEdits: () => this.flushPendingEdits(),
      playFeedback: (feedback) => { if (feedback) this.playFeedback(feedback); },
      openPropertyInspector: () => this.eventBus.publish('OPEN_PROPERTY_INSPECTOR', { widgetId: this.id }),
      // FDWS v1.3 Widget Popovers: opens a `kind:"popover"` widget definition in a
      // modal, feeding it a read-only $context snapshot resolved from this (host)
      // widget's own state via action.context's stateRef paths.
      openWidgetPopover: ({ hostWidget, popoverWidgetId, contextDecl }) => openWidgetPopover({
        hostWidget, popoverWidgetId, contextDecl, eventBus: this.eventBus
      }),
      // FDWS v1.3: only meaningful when WidgetPopoverModal has set these on a
      // popover-instance host — read fresh on every call (not cached) since they're
      // assigned post-construction, after this adapter object could otherwise be built.
      onCommitToHost: this.onCommitToHost ? (key, val) => this.onCommitToHost(key, val) : undefined,
      onClosePopover: this.onClosePopover ? () => this.onClosePopover() : undefined,
      onUnhandledActionType: (type) => console.warn(`[CompositeWidget] Unhandled action type: ${type}`)
    }, compDef, trigger, eventData);
  }

  /**
   * Forces any `core.input` renderer with a pending (typed-but-uncommitted) edit to
   * commit right now, ahead of a 'tap'/'longpress' action elsewhere in this widget
   * (see InteractionDispatcher.js's `runInteraction` doc comment for the bug this
   * closes). Iterates all mounted renderers rather than tracking "the" focused one
   * since this widget could in principle have more than one core.input, though only
   * the actually-focused, actually-dirty one (if any) ever does real work here —
   * InputComponent.flushPendingEdit() itself no-ops otherwise.
   */
  flushPendingEdits() {
    this.componentRenderers.forEach((renderer) => {
      renderer.flushPendingEdit?.();
    });
  }

  /**
   * FDWS v1.2 §4.1: fires optional declarative audio/haptic feedback on an interaction.
   * Silently no-ops on hosts without haptic/audio support, per the spec's graceful
   * degradation philosophy.
   * @param {{sound?: string, haptic?: 'light'|'medium'|'heavy'}} feedback
   */
  playFeedback(feedback) {
    try {
      if (feedback.haptic && navigator.vibrate) {
        const durations = { light: 10, medium: 25, heavy: 50 };
        navigator.vibrate(durations[feedback.haptic] || durations.light);
      }
    } catch (_) { /* no-op: haptics unsupported */ }

    try {
      if (feedback.sound) {
        const url = this.resolveAssetUrl(feedback.sound);
        if (url) new Audio(url).play().catch(() => {});
      }
    } catch (_) { /* no-op: audio unsupported */ }
  }

  /**
   * Gets a Local State variable. FDWS v1.3: a name prefixed "$context." (e.g.
   * "$context.currentLabel.value") resolves against this.popoverContext instead —
   * the read-only snapshot a popover instance receives from its host widget.
   * @param {string} name
   * @returns {any}
   */
  getLocalState(name) {
    if (typeof name === 'string' && name.startsWith('$context.')) {
      const [, key, field] = name.split('.');
      const entry = this.popoverContext?.[key];
      if (!entry) return undefined;
      return field ? entry[field] : entry;
    }
    return this.localState.get(name);
  }

  /**
   * Sets a Local State variable and updates reactive components. FDWS v1.3: a
   * "$context." name is rejected — the only legitimate way for a popover to write
   * back to its host is the core.commitToHost action, not a direct state set.
   * @param {string} name
   * @param {any} value
   * @param {boolean} [persist=true]
   */
  setLocalState(name, value, persist = true) {
    if (typeof name === 'string' && name.startsWith('$context.')) {
      console.warn(`[CompositeWidget] Rejected direct write to "${name}" — use core.commitToHost instead.`);
      return;
    }
    this.localState.set(name, value);

    // FDWS v1.22: state[].persist is true | false | "session" (previously
    // boolean-only). A live-synced array (type:"array" with syncFrom) never
    // persists in either form — §3.2/v1.21, see initLocalState()'s fuller
    // comment — but a local-only array persists the same as any scalar.
    //
    // Both true and "session" write into this.config.state (so a widget
    // instance destroyed and rebuilt via page.updateWidget() — e.g.
    // switching pages away and back within the running app — sees the value
    // again, since that config object lives on the in-memory Page/Profile,
    // not on this doomed widget instance). They differ only in whether the
    // WIDGET_CONFIG_CHANGED event asks app.js to also write that config to
    // IndexedDB: true does (durable across a full app relaunch/next day),
    // "session" doesn't (in-memory only — gone the next time the app's JS
    // context actually reloads, exactly the "different presets per flight,
    // don't want yesterday's still there tomorrow" case this was added for).
    const stateDecl = this.definition?.state?.find((s) => s.name === name);
    const persistMode = stateDecl?.persist;
    const isLiveSyncedArray = stateDecl?.type === 'array' && stateDecl?.syncFrom;
    if (persist && persistMode && persistMode !== false && !isLiveSyncedArray) {
      if (!this.config.state) this.config.state = {};
      this.config.state[name] = value;
      this.eventBus.publish('WIDGET_CONFIG_CHANGED', {
        widgetId: this.id,
        config: this.config,
        sessionOnly: persistMode === 'session'
      });
    }

    // Reactive update to all components bound to this state variable — either
    // as their primary binding (comp.binding.stateVar) or, per FDWS v1.5,
    // as a core.gauge's secondary compose transform (comp.props.compose.stateVar).
    // A gauge whose PRIMARY binding is a SimVar (e.g. attBankDeg, shared by
    // attitude_sphere and fd_pitch_bar) but whose compose is driven by a
    // DIFFERENT syncFrom'd state var (e.g. attFdPitchCmd) previously fell
    // through to the visibility-only branch here and never got told to
    // re-render when that compose value changed on its own — it only picked
    // up a fresh value incidentally, whenever its primary binding's own
    // SimVar happened to tick. Reproduced 2026-08-24: the flight director
    // pitch bar appeared to track the aircraft's current pitch instead of
    // its own commanded target, since its compose value (attFdPitchCmd) was
    // effectively rendered from a stale/lagging snapshot rather than the
    // fresh value this very call just set into localState.
    notifyBindingDependents({
      getLocalState: (n) => this.getLocalState(n),
      getAllStateObject: () => this.getAllStateObject(),
      getRenderer: (id) => this.componentRenderers.get(id)
    }, this.definition?.components, name, value);
  }

  /**
   * Swaps two local state fields (e.g. active & standby frequencies)
   * @param {string} field1
   * @param {string} field2
   */
  swapLocalState(field1, field2) {
    const val1 = this.getLocalState(field1);
    const val2 = this.getLocalState(field2);
    this.setLocalState(field1, val2);
    this.setLocalState(field2, val1);
  }

  /**
   * Returns all current state entries as a plain object
   * @returns {object}
   */
  getAllStateObject() {
    const obj = {};
    this.localState.forEach((val, key) => {
      obj[key] = val;
    });
    return obj;
  }

  destroy() {
    this.componentRenderers.forEach((r) => r.destroy());
    this.componentRenderers.clear();
    this.assetUrlCache.clear();
    super.destroy();
  }
}
