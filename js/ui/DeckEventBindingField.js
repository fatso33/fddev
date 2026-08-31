/**
 * DeckEventBindingField.js
 * Shared "pick a Deck Event, or type a custom one" form-field pattern —
 * extracted out of PropertyInspector.js so ButtonConfigPopover.js can reuse
 * the exact same dropdown+custom-select+freeform-input behavior (including
 * scanning installed widgets/packs for known custom events) instead of a
 * second, drifting copy. Every function takes the root element the markup
 * was rendered into plus the `prefix` used in that markup's element ids, so
 * two different panels can each own their own DOM without colliding.
 *
 * Expected markup per kind (see bindingFieldHTML()):
 *   #{prefix}-select-{kind}                default select + trailing "Custom…"
 *   #{prefix}-custom-{kind}-block           wrapper, toggled hidden/visible
 *   #{prefix}-select-custom-{kind}          known-custom-event select
 *   #{prefix}-input-custom-{kind}           freeform text input (source of truth in custom mode)
 */
import { getDeckEventsByKind, DECK_EVENT_NAMES } from '../core/deckEvents.js';
import { extractCustomDeckEvents } from '../core/widgetVarExtractor.js';
import { getPackSuggestedEvents } from '../core/deckEventPacks.js';

export const CUSTOM_OPTION_VALUE = '__custom__';

/**
 * Renders the markup for one binding kind ('event' write / 'simvar' read).
 * @param {{prefix:string, kind:'event'|'simvar', label:string, customHint:string, placeholder:string}} opts
 */
export function bindingFieldHTML({ prefix, kind, label, customHint, placeholder }) {
  return `
    <div class="fd-insp-field">
      <label for="${prefix}-select-${kind}">${label}</label>
      <select id="${prefix}-select-${kind}"></select>
    </div>
    <div class="fd-insp-field fd-insp-custom-block hidden" id="${prefix}-custom-${kind}-block">
      <label for="${prefix}-select-custom-${kind}">Custom Deck Event (used by another installed widget)</label>
      <select id="${prefix}-select-custom-${kind}"></select>
      <label for="${prefix}-input-custom-${kind}">${customHint}</label>
      <input type="text" id="${prefix}-input-custom-${kind}" placeholder="${placeholder}" />
    </div>
  `;
}

/** Fills the default (non-custom) <select> for one kind from shared/deckEvents.js. */
export function populateDefaultSelect(root, prefix, kind, deckEventKind) {
  const selectEl = root.querySelector(`#${prefix}-select-${kind}`);
  if (!selectEl) return;
  selectEl.innerHTML = '';
  for (const deckEvent of getDeckEventsByKind(deckEventKind)) {
    const opt = document.createElement('option');
    opt.value = deckEvent.name;
    opt.textContent = deckEvent.label;
    selectEl.appendChild(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = CUSTOM_OPTION_VALUE;
  customOpt.textContent = 'Custom…';
  selectEl.appendChild(customOpt);
}

/** Wires show/hide + value-forwarding for one kind's control pair. */
export function wireBindingControls(root, prefix, kind) {
  const defaultSelect = root.querySelector(`#${prefix}-select-${kind}`);
  const customBlock = root.querySelector(`#${prefix}-custom-${kind}-block`);
  const customSelect = root.querySelector(`#${prefix}-select-custom-${kind}`);
  const customInput = root.querySelector(`#${prefix}-input-custom-${kind}`);
  if (!defaultSelect) return;

  defaultSelect.addEventListener('change', () => {
    const isCustom = defaultSelect.value === CUSTOM_OPTION_VALUE;
    customBlock.classList.toggle('hidden', !isCustom);
  });

  customSelect.addEventListener('change', () => {
    if (customSelect.value) customInput.value = customSelect.value;
  });
}

export function fillCustomSelect(root, prefix, kind, entries) {
  const selectEl = root.querySelector(`#${prefix}-select-custom-${kind}`);
  if (!selectEl) return;
  selectEl.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = entries.length > 0 ? '— select or type below —' : '(no custom Deck Events in use yet — try importing a Community Pack in Settings)';
  selectEl.appendChild(placeholder);

  for (const entry of entries) {
    const opt = document.createElement('option');
    opt.value = entry.name;
    opt.textContent = entry.source ? `${entry.name} (${entry.source})` : entry.name;
    selectEl.appendChild(opt);
  }
}

/**
 * Rescans installed widgets + imported Community Packs for non-default
 * Deck Events and repopulates both kinds' custom dropdowns.
 * @returns {Promise<{customReadEvents: object[], customWriteEvents: object[]}>}
 */
export async function refreshCustomDeckEvents(root, prefix, storageManager) {
  let widgetDefs = [];
  if (storageManager && typeof storageManager.getAllWidgetDefinitions === 'function') {
    try {
      widgetDefs = await storageManager.getAllWidgetDefinitions();
    } catch (err) {
      console.warn('[DeckEventBindingField] Could not scan widgets for custom Deck Events:', err);
    }
  }

  const fromWidgets = extractCustomDeckEvents(widgetDefs, DECK_EVENT_NAMES).map((e) => ({
    ...e,
    source: e.widgetIds.length ? `used by ${e.widgetIds.join(', ')}` : ''
  }));
  const fromPacks = getPackSuggestedEvents()
    .filter((e) => !fromWidgets.some((w) => w.name === e.name))
    .map((e) => ({ name: e.name, kind: e.kind, source: `from pack: ${e.fromPack}` }));
  const merged = [...fromWidgets, ...fromPacks];

  const customReadEvents = merged.filter((e) => e.kind === 'read');
  const customWriteEvents = merged.filter((e) => e.kind === 'write');

  fillCustomSelect(root, prefix, 'event', customWriteEvents);
  fillCustomSelect(root, prefix, 'simvar', customReadEvents);

  return { customReadEvents, customWriteEvents };
}

/** Pre-selects a control pair to reflect a current binding value (may be ''). */
export function setBindingControlValue(root, prefix, kind, value) {
  const defaultSelect = root.querySelector(`#${prefix}-select-${kind}`);
  const customBlock = root.querySelector(`#${prefix}-custom-${kind}-block`);
  const customSelect = root.querySelector(`#${prefix}-select-custom-${kind}`);
  const customInput = root.querySelector(`#${prefix}-input-custom-${kind}`);
  if (!defaultSelect) return;

  const isKnownDefault = value && [...defaultSelect.options].some((o) => o.value === value && o.value !== CUSTOM_OPTION_VALUE);

  if (isKnownDefault) {
    defaultSelect.value = value;
    customBlock.classList.add('hidden');
    customSelect.value = '';
    customInput.value = '';
    return;
  }

  defaultSelect.value = CUSTOM_OPTION_VALUE;
  customBlock.classList.remove('hidden');

  const isKnownCustom = value && [...customSelect.options].some((o) => o.value === value);
  if (isKnownCustom) {
    customSelect.value = value;
    customInput.value = value;
  } else {
    customSelect.value = '';
    customInput.value = value || '';
  }
}

/** Reads back the effective value for one control pair. */
export function getBindingControlValue(root, prefix, kind) {
  const defaultSelect = root.querySelector(`#${prefix}-select-${kind}`);
  if (!defaultSelect || defaultSelect.value !== CUSTOM_OPTION_VALUE) return defaultSelect ? defaultSelect.value : '';
  const customInput = root.querySelector(`#${prefix}-input-custom-${kind}`);
  return customInput.value.trim();
}
