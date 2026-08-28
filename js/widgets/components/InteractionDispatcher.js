/**
 * InteractionDispatcher.js
 * FDWS interaction-action runner — the ONE implementation of `handleInteraction()`'s
 * action switch, shared by every place that resolves a widget's declarative
 * `interactions[].action` to real effects (sim events, local-state writes, popovers).
 *
 * Widget Studio 2.0, Phase 0: previously this switch was hand-duplicated three times —
 * flight-deck-pwa's real CompositeWidget.js, Studio's MockWidgetHost.js (Device View /
 * popover simulator), and Studio's StudioCanvas.js (Interactive Sim). Every new action
 * or action option (`fromStateRef`, `commitToHost.field`, …) had to be added to all
 * three by hand, and they had already started drifting (StudioCanvas's `core.toggleLocalState`
 * lacked a null-check the other two had). This file is the single source; callers supply
 * a small `host` adapter instead of reimplementing the switch.
 *
 * Lives under shared/widgets/components/ so it is synced into both
 * flight-deck-pwa/js/widgets/components/ and widget-studio/widgets/components/ by
 * scripts/sync-shared.mjs, and can be imported via a `./InteractionDispatcher.js` or
 * `../utils/StateRefPath.js`-relative path identically from every consumer.
 *
 * @typedef {object} InteractionHost
 * @property {(event: string, val: any) => void} dispatchSimEvent
 * @property {(name: string) => any} getLocalState
 * @property {(name: string, val: any) => void} setLocalState
 * @property {(f1: string, f2: string) => void} swapLocalState
 * @property {() => object} getAllStateObject
 * @property {(componentId: string) => {update: (val: any, allState: object) => void}|undefined} getRenderer
 * @property {(feedback: any) => void} [playFeedback] - CompositeWidget-only; no-op elsewhere.
 * @property {(opts: {hostWidget: object, popoverWidgetId: string, contextDecl: object}) => void} [openWidgetPopover]
 *   - present on hosts that can actually open a popover modal (CompositeWidget, MockWidgetHost).
 * @property {() => void} [openPropertyInspector] - CompositeWidget-only (`core.openPopover`).
 * @property {(contextKey: string, value: any) => void} [onCommitToHost] - set on popover-instance hosts only.
 * @property {() => void} [onClosePopover] - set on popover-instance hosts only.
 * @property {(actionType: string) => void} [onUnsupportedAction] - called instead of
 *   `openWidgetPopover`/`openPropertyInspector`/`onCommitToHost`/`onClosePopover` when a
 *   host doesn't implement that action's real effect (e.g. StudioCanvas's lightweight
 *   Interactive Sim, which has no modal layer) — lets each host log/no-op its own way
 *   without the dispatcher needing to know which hosts support what.
 * @property {(actionType: string) => void} [onUnhandledActionType] - called for a
 *   genuinely unrecognized `action.type`. Defaults to a console.warn if omitted.
 */

import { readStateRef } from '../utils/StateRefPath.js';

/**
 * Resolves `interactions[]` entries matching `trigger` on `compDef` and runs each one's
 * `action` against `host`. Mirrors CompositeWidget.js's original `handleInteraction()`
 * exactly — same trigger-matching, same per-action-type behavior, same fallback rules.
 *
 * @param {InteractionHost} host
 * @param {object} compDef - component definition (needs `.id`, `.binding`, `.interactions`)
 * @param {string} trigger - 'tap' | 'longpress' | 'change' | 'focus' | 'blur' | …
 * @param {object} [eventData]
 */
export function runInteraction(host, compDef, trigger, eventData = {}) {
  const interactions = compDef.interactions || [];
  const matching = interactions.filter((i) => i.trigger === trigger);

  matching.forEach((interaction) => {
    host.playFeedback?.(interaction.feedback);

    const action = interaction.action;
    if (!action || !action.type) return;

    switch (action.type) {
      case 'core.dispatchEvent': {
        const eventName = action.event || compDef.binding?.writeEvent;
        // action.fromStateRef (optional): reads a value via the "name[index].field"
        // stateRef grammar popovers use (StateRefPath.js), e.g. "presets[0].freq" —
        // lets a tap dispatch a value pulled from an array-indexed local state entry,
        // not just a static literal or whatever eventData.value the triggering event
        // happens to carry (a button's own tap never carries one).
        const val = action.fromStateRef !== undefined
          ? readStateRef(host, action.fromStateRef)
          : (action.value !== undefined ? action.value : (eventData.value !== undefined ? eventData.value : 0));
        if (eventName) {
          host.dispatchSimEvent(eventName, val);
        }
        break;
      }

      case 'core.setLocalState': {
        const field = action.field || action.stateVar || action.name;
        const val = action.fromStateRef !== undefined
          ? readStateRef(host, action.fromStateRef)
          : (action.value !== undefined ? action.value : eventData.value);
        if (field) {
          host.setLocalState(field, val);
        }
        break;
      }

      case 'core.swapLocalState': {
        const [f1, f2] = action.fields || ['actFreq', 'stbyFreq'];
        if (f1 && f2) {
          host.swapLocalState(f1, f2);
        }
        break;
      }

      case 'core.toggleLocalState': {
        const field = action.field || compDef.binding?.stateVar;
        if (field) {
          const current = Boolean(host.getLocalState(field));
          host.setLocalState(field, !current);
        }
        break;
      }

      case 'core.ackIndicator': {
        const ackEv = action.event || compDef.binding?.ackEvent;
        if (ackEv) {
          host.dispatchSimEvent(ackEv, 0);
        }
        const renderer = host.getRenderer(compDef.id);
        if (renderer) {
          renderer.update(false, host.getAllStateObject());
        }
        break;
      }

      case 'core.openPopover': {
        if (host.openPropertyInspector) {
          host.openPropertyInspector();
        } else {
          host.onUnsupportedAction?.(action.type);
        }
        break;
      }

      // FDWS v1.3 Widget Popovers: opens a `kind:"popover"` widget definition in a
      // modal, feeding it a read-only $context snapshot resolved from the host
      // widget's own state via action.context's stateRef paths.
      case 'core.openWidgetPopover': {
        if (action.popoverWidgetId && host.openWidgetPopover) {
          host.openWidgetPopover({
            hostWidget: host,
            popoverWidgetId: action.popoverWidgetId,
            contextDecl: action.context
          });
        } else if (action.popoverWidgetId) {
          host.onUnsupportedAction?.(action.type);
        }
        break;
      }

      // FDWS v1.3: fired by a component *inside* a popover instance. Only meaningful
      // when host.onCommitToHost is set (i.e. host IS a popover instance) — the
      // host-declared writable/contextKey enforcement lives with whoever set that.
      // action.field (optional): commits a NAMED local state var instead of
      // eventData.value — lets a "Save" button (whose own tap carries no value at
      // all) commit a value some other component wrote earlier via
      // core.setLocalState, e.g. staging edits in local scratch state and only
      // committing them to the host when the user explicitly presses Save.
      case 'core.commitToHost': {
        if (action.contextKey) {
          if (host.onCommitToHost) {
            const val = action.field !== undefined ? host.getLocalState(action.field) : eventData.value;
            host.onCommitToHost(action.contextKey, val);
          } else {
            host.onUnsupportedAction?.(action.type);
          }
        }
        break;
      }

      // FDWS v1.3: fired by a component inside a popover instance to close it.
      case 'core.closePopover': {
        if (host.onClosePopover) {
          host.onClosePopover();
        } else {
          host.onUnsupportedAction?.(action.type);
        }
        break;
      }

      default:
        if (host.onUnhandledActionType) {
          host.onUnhandledActionType(action.type);
        } else {
          console.warn(`[InteractionDispatcher] Unhandled action type: ${action.type}`);
        }
        break;
    }
  });
}
