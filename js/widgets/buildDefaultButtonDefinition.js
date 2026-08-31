/**
 * buildDefaultButtonDefinition.js
 * Builds the per-instance FDWS composite definition for the built-in
 * "Switch / Push Button" widget (catalog type 'ButtonWidget') -- a single
 * core.button component filling the widget's own internal grid. Used both
 * for the catalog's defaultConfig (WidgetRegistry.js) and to migrate the
 * shipped default-profile seed instances (StorageManager.js), so both stay
 * in sync with the same shape ButtonConfigPopover.js reads/writes.
 */
import { STYLE_PRESETS } from './StylePresets.js';

const INTERNAL_GRID = 10;

export function buildDefaultButtonDefinition({
  label = 'BUTTON',
  variant = 'toggle',
  hasLed = false,
  presetId = 'cockpit-glass',
  readSimVar = '',
  writeEvent = ''
} = {}) {
  const preset = STYLE_PRESETS.find((p) => p.id === presetId) || STYLE_PRESETS[0];
  return {
    fdws: '1.2',
    schemaVersion: '1.2.0',
    id: 'ButtonWidget',
    kind: 'widget',
    meta: { name: 'Switch / Push Button', category: 'Controls' },
    layout: { defaultW: 3, defaultH: 3, minW: 2, minH: 2, grid: { columns: INTERNAL_GRID, rows: INTERNAL_GRID } },
    components: [
      {
        id: 'btn_main',
        type: 'core.button',
        layout: { col: 1, row: 1, w: INTERNAL_GRID, h: INTERNAL_GRID },
        props: { variant, label, hasLed },
        binding: { readSimVar, writeEvent },
        style: JSON.parse(JSON.stringify(preset.style)),
        interactions: [
          { trigger: 'tap', action: { type: 'core.dispatchEvent', value: 1 } }
        ]
      }
    ]
  };
}

// So ButtonConfigPopover.js can offer the same preset list without a second import path.
export { STYLE_PRESETS };
