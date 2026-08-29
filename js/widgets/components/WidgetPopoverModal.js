/**
 * WidgetPopoverModal.js
 * FDWS v1.3: mounts a `kind: "popover"` widget definition inside a modal overlay,
 * opened from a host widget's `core.openWidgetPopover` interaction.
 *
 * Security model: the popover instance only ever sees a resolved, read-only
 * `$context` snapshot (value/writable/applyOn) built from the HOST's own
 * self-authored `stateRef` paths. The popover itself never specifies or sees a
 * raw path — it can only reference a symbolic `contextKey` via `core.commitToHost`,
 * and the write is rejected unless that key was declared `writable: true` by the host.
 *
 * Note: this module and CompositeWidget.js import each other (CompositeWidget's
 * core.openWidgetPopover case calls into here; here we construct a CompositeWidget
 * for the popover definition). This is safe because `CompositeWidget` is only
 * referenced inside openWidgetPopover()'s function body, called well after both
 * modules have finished evaluating — never at module-load time.
 */

import { CompositeWidget } from '../CompositeWidget.js';
import { WidgetRegistry } from '../WidgetRegistry.js';
import { readStateRef, writeStateRef } from '../utils/StateRefPath.js';

let activePopover = null;

/**
 * @param {object} opts
 * @param {import('../CompositeWidget.js').CompositeWidget} opts.hostWidget
 * @param {string} opts.popoverWidgetId
 * @param {object} opts.contextDecl - the host action's `context` map
 * @param {object} opts.eventBus
 */
export function openWidgetPopover({ hostWidget, popoverWidgetId, contextDecl, eventBus }) {
  const popoverDef = WidgetRegistry.getDefinition(popoverWidgetId);
  if (!popoverDef) {
    console.warn(`[WidgetPopoverModal] Unknown popover widget id: ${popoverWidgetId}`);
    return;
  }
  if (popoverDef.kind !== 'popover') {
    console.warn(`[WidgetPopoverModal] Widget "${popoverWidgetId}" is not kind:"popover" — refusing to open as a modal.`);
    return;
  }

  // Resolve host-declared context entries to live values. The raw stateRef path is
  // kept only in this closure (contextSnapshot) — never handed to the popover instance.
  const contextSnapshot = {};
  Object.entries(contextDecl || {}).forEach(([key, entry]) => {
    if (!entry || typeof entry !== 'object') return;
    const stateRef = entry.value?.stateRef;
    contextSnapshot[key] = {
      value: stateRef ? readStateRef(hostWidget, stateRef) : entry.value,
      writable: Boolean(entry.writable),
      applyOn: entry.applyOn || 'immediate',
      stateRef
    };
  });

  closeWidgetPopover();

  const overlay = document.createElement('div');
  overlay.id = 'fd-widget-popover-modal';
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(4, 7, 13, 0.85);
    backdrop-filter: blur(6px);
    z-index: 999998;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Chakra Petch', sans-serif;
  `;

  // Theme-aware via CSS custom properties (main.css redefines these per
  // [data-theme], same tokens CompositeWidget.js's own outer-container
  // fallback uses) rather than literal hex — this chrome belongs to the
  // modal itself, not the popover definition, so it has no style.* of its
  // own to derive from and previously stayed hardcoded dark in light mode.
  const card = document.createElement('div');
  card.style.cssText = `
    background: var(--card-bg, #0d131f);
    border: 1px solid var(--accent-cyan, #22d3ee);
    box-shadow: 0 0 25px color-mix(in srgb, var(--accent-cyan, #22d3ee) 25%, transparent), 0 20px 40px rgba(0,0,0,0.8);
    border-radius: 12px;
    min-width: 320px;
    max-width: 92vw;
    max-height: 88vh;
    padding: 16px;
    overflow: auto;
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // FDWS v1.12: popoverContext is passed in via config (not assigned after
  // construction) so CompositeWidget's constructor has it available BEFORE
  // initLocalState() runs — required for state[].seedFromContext (§1.1) to
  // resolve a seeded initial value instead of always falling back to default.
  const popoverInstance = new CompositeWidget(
    { id: `${popoverWidgetId}__popover`, type: popoverWidgetId, config: { definition: popoverDef, popoverContext: contextSnapshot } },
    eventBus
  );
  popoverInstance.onCommitToHost = (contextKey, value) => {
    const entry = contextSnapshot[contextKey];
    if (!entry || !entry.writable) {
      console.warn(`[WidgetPopoverModal] Rejected commitToHost for undeclared/non-writable contextKey "${contextKey}"`);
      return;
    }
    writeStateRef(hostWidget, entry.stateRef, value);
  };

  const close = () => {
    popoverInstance.destroy();
    overlay.remove();
    activePopover = null;
    document.removeEventListener('keydown', onKeyDown);
  };
  popoverInstance.onClosePopover = close;

  function onKeyDown(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeyDown);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  popoverInstance.mount(card);
  activePopover = { overlay, instance: popoverInstance };
}

export function closeWidgetPopover() {
  document.getElementById('fd-widget-popover-modal')?.remove();
  if (activePopover) {
    try { activePopover.instance.destroy(); } catch (_) { /* already torn down */ }
    activePopover = null;
  }
}
