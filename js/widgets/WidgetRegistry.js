/**
 * WidgetRegistry.js
 * Component Catalog & Dynamic Polymorphic Instantiation Factory
 * Supports native built-in avionics classes and declarative FDWS v1.1 composite definitions.
 */

import { ButtonWidget } from './ButtonWidget.js';
import { DisplayWidget } from './DisplayWidget.js';
import { RotaryWidget } from './RotaryWidget.js';
import { AnnunciatorWidget } from './AnnunciatorWidget.js';
import { CompositeWidget } from './CompositeWidget.js';
import { VirtualYokeCenterWidget } from './VirtualYokeCenterWidget.js';
import { VirtualYokeDetachWidget } from './VirtualYokeDetachWidget.js';
import { VirtualYokeDeflectionWidget } from './VirtualYokeDeflectionWidget.js';
import { SecurityValidator } from '../core/SecurityValidator.js';

export class WidgetRegistry {
  static catalog = new Map([
    [
      'ButtonWidget',
      {
        type: 'ButtonWidget',
        name: 'Switch / Push Button',
        category: 'Controls',
        description: 'Momentary or toggle switch with LED status and tactile active glow',
        defaultLayout: { w: 10, h: 4 },
        defaultConfig: {
          label: 'BUTTON',
          shortLabel: 'BTN',
          variant: 'toggle',
          hasLed: true,
          color: 'cyan',
          binding: { readSimVar: '', writeEvent: '' }
        },
        classRef: ButtonWidget,
        isCustom: false
      }
    ],
    [
      'DisplayWidget',
      {
        type: 'DisplayWidget',
        name: 'Avionics Readout',
        category: 'Gauges',
        description: 'Formatted numeric readout with interactive step controls (ALT, HDG, SPD, VS)',
        defaultLayout: { w: 20, h: 8 },
        defaultConfig: {
          label: 'ALTITUDE',
          prefix: 'ALT',
          suffix: 'FT',
          format: 'ALTITUDE',
          min: 0,
          max: 50000,
          step: 100,
          binding: { readSimVar: '', writeEvent: '' }
        },
        classRef: DisplayWidget,
        isCustom: false
      }
    ],
    [
      'RotaryWidget',
      {
        type: 'RotaryWidget',
        name: 'Concentric Rotary Dial',
        category: 'Controls',
        description: 'Dual-ring concentric knob with coarse/fine step tuning and push-to-sync',
        defaultLayout: { w: 10, h: 12 },
        defaultConfig: {
          label: 'HEADING BUG',
          coarseStep: 10,
          fineStep: 1,
          centerButtonLabel: 'SYNC',
          binding: { readSimVar: '', writeEvent: '' }
        },
        classRef: RotaryWidget,
        isCustom: false
      }
    ],
    [
      'AnnunciatorWidget',
      {
        type: 'AnnunciatorWidget',
        name: 'Annunciator Indicator',
        category: 'Alerts',
        description: 'Warning, caution, or advisory indicator flag with reactive trigger states',
        defaultLayout: { w: 10, h: 4 },
        defaultConfig: {
          label: 'MASTER CAUTION',
          sublabel: 'SYSTEM CHECK',
          severity: 'caution',
          binding: { readSimVar: '', ackEvent: '' }
        },
        classRef: AnnunciatorWidget,
        isCustom: false
      }
    ],
    [
      'VirtualYokeCenterWidget',
      {
        type: 'VirtualYokeCenterWidget',
        name: 'Virtual Yoke — Center',
        category: 'Controls',
        description: 'Captures the phone\'s current orientation as the Virtual Yoke zero reference. Built into the Virtual Yoke page and cannot be removed.',
        // 'system': ships pre-placed on its host page, excluded from the
        // Add Widget drawer, and never user-removable (config.removable
        // below) — see docs/Virtual-Yoke-Page.md.
        kind: 'system',
        defaultLayout: { w: 10, h: 6 },
        defaultConfig: { label: 'CENTER', removable: false },
        classRef: VirtualYokeCenterWidget,
        isCustom: false
      }
    ],
    [
      'VirtualYokeDetachWidget',
      {
        type: 'VirtualYokeDetachWidget',
        name: 'Virtual Yoke — Detach',
        category: 'Controls',
        description: 'Disengages phone motion from the Virtual Yoke so it can be set down without moving the controls. Built into the Virtual Yoke page and cannot be removed.',
        kind: 'system',
        defaultLayout: { w: 10, h: 6 },
        defaultConfig: { label: 'DETACH', detachedLabel: 'ATTACH', removable: false },
        classRef: VirtualYokeDetachWidget,
        isCustom: false
      }
    ],
    [
      'VirtualYokeDeflectionWidget',
      {
        type: 'VirtualYokeDeflectionWidget',
        name: 'Yoke Deflection Indicator',
        category: 'Gauges',
        description: 'Static pitch/roll cross with a live ball indicator showing current Virtual Yoke deflection',
        defaultLayout: { w: 6, h: 6 },
        defaultConfig: { label: '', invertPitch: false, invertRoll: false },
        classRef: VirtualYokeDeflectionWidget,
        isCustom: false
      }
    ]
  ]);

  static definitions = new Map();

  /**
   * Instantiates a widget instance based on configuration
   * @param {object} instanceConfig
   * @param {object} eventBus
   * @returns {BaseWidget}
   */
  static createWidget(instanceConfig, eventBus) {
    const descriptor = this.catalog.get(instanceConfig.type);
    if (!descriptor) {
      // Check if it's an installed FDWS definition
      if (this.definitions.has(instanceConfig.type)) {
        return new CompositeWidget(instanceConfig, eventBus);
      }
      console.warn(`[WidgetRegistry] Unknown widget type: ${instanceConfig.type}, falling back to ButtonWidget`);
      return new ButtonWidget(instanceConfig, eventBus);
    }
    return new descriptor.classRef(instanceConfig, eventBus);
  }

  /**
   * Installs an FDWS Widget Definition into the registry and persists it (§10.3)
   * @param {object} fdwsJson
   * @param {import('../core/StorageManager.js').StorageManager} [storageManager]
   * @returns {Promise<{descriptor: object, warnings: string[], installedPopovers: object[]}>}
   */
  static async installDefinition(fdwsJson, storageManager) {
    const validation = SecurityValidator.validateFDWSDefinition(fdwsJson);
    if (!validation.valid) {
      throw new Error(`Cannot install invalid FDWS widget: ${validation.errors.join('; ')}`);
    }

    const def = validation.sanitizedDefinition;
    const warnings = [...validation.warnings];

    // FDWS v1.19 §1.5: a widget can bundle the popover(s) its own
    // core.openWidgetPopover interactions reference in a "popovers" array
    // (already validated/sanitized above). Install each one exactly as if
    // it had been imported on its own — same registry entry, same
    // storage/PC-Bridge push — then strip the array off the host definition
    // so it isn't persisted twice.
    const installedPopovers = [];
    if (Array.isArray(def.popovers) && def.popovers.length > 0) {
      for (const popoverDef of def.popovers) {
        const popoverResult = await this.installDefinition(popoverDef, storageManager);
        installedPopovers.push(popoverResult.descriptor);
        warnings.push(...popoverResult.warnings);
      }
    }
    delete def.popovers;

    this.definitions.set(def.id, def);

    const descriptor = {
      type: def.id,
      name: def.meta?.name || def.id,
      shortName: def.meta?.shortName,
      category: def.meta?.category || 'Avionics',
      description: def.meta?.description || 'Custom FDWS Widget',
      // FDWS v1.3: 'widget' (default) is placeable on a page layout; 'popover' is
      // opened only via core.openWidgetPopover and should be excluded from "place on
      // page" pickers by callers that care (e.g. Widget Studio's gallery).
      kind: def.kind || 'widget',
      defaultLayout: {
        w: def.layout?.defaultW || 16,
        h: def.layout?.defaultH || 8,
        minW: def.layout?.minW,
        minH: def.layout?.minH,
        maxW: def.layout?.maxW,
        maxH: def.layout?.maxH
      },
      defaultConfig: {
        label: def.meta?.name || def.id,
        fdwsDefinitionId: def.id,
        fdwsRevision: def.revision || 1
      },
      classRef: CompositeWidget,
      isCustom: true,
      definition: def
    };

    this.catalog.set(def.id, descriptor);

    if (storageManager) {
      await storageManager.saveWidgetDefinition(def);
    }

    return { descriptor, warnings, installedPopovers };
  }

  /**
   * Uninstalls an FDWS Widget Definition by ID
   * @param {string} id
   * @param {import('../core/StorageManager.js').StorageManager} [storageManager]
   */
  static async uninstallDefinition(id, storageManager) {
    this.catalog.delete(id);
    this.definitions.delete(id);
    if (storageManager) {
      await storageManager.deleteWidgetDefinition(id);
    }
  }

  /**
   * Loads all installed widget definitions from storage on app init
   * @param {import('../core/StorageManager.js').StorageManager} storageManager
   */
  static async loadInstalledDefinitions(storageManager) {
    if (!storageManager) return;
    try {
      const defs = await storageManager.getAllWidgetDefinitions();
      for (const def of defs) {
        try {
          const validation = SecurityValidator.validateFDWSDefinition(def);
          if (validation.valid) {
            const sanitized = validation.sanitizedDefinition;
            this.definitions.set(sanitized.id, sanitized);
            this.catalog.set(sanitized.id, {
              type: sanitized.id,
              name: sanitized.meta?.name || sanitized.id,
              shortName: sanitized.meta?.shortName,
              category: sanitized.meta?.category || 'Avionics',
              description: sanitized.meta?.description || 'Custom FDWS Widget',
              kind: sanitized.kind || 'widget',
              defaultLayout: {
                w: sanitized.layout?.defaultW || 16,
                h: sanitized.layout?.defaultH || 8,
                minW: sanitized.layout?.minW,
                minH: sanitized.layout?.minH,
                maxW: sanitized.layout?.maxW,
                maxH: sanitized.layout?.maxH
              },
              defaultConfig: {
                label: sanitized.meta?.name || sanitized.id,
                fdwsDefinitionId: sanitized.id,
                fdwsRevision: sanitized.revision || 1
              },
              classRef: CompositeWidget,
              isCustom: true,
              definition: sanitized
            });
          }
        } catch (err) {
          console.warn('[WidgetRegistry] Error loading widget definition:', def.id, err);
        }
      }
    } catch (err) {
      console.warn('[WidgetRegistry] Could not load installed definitions:', err);
    }
  }

  /**
   * Returns list of all available widget descriptors in catalog
   * @returns {Array<object>}
   */
  static getCatalog() {
    return Array.from(this.catalog.values());
  }

  /**
   * Returns descriptor for a specific type
   * @param {string} type
   * @returns {object|null}
   */
  static getDescriptor(type) {
    return this.catalog.get(type) || null;
  }

  /**
   * Returns installed FDWS definition for a given ID
   * @param {string} id
   * @returns {object|null}
   */
  static getDefinition(id) {
    return this.definitions.get(id) || null;
  }

  /**
   * Returns all installed FDWS definitions
   * @returns {Array<object>}
   */
  static getInstalledDefinitions() {
    return Array.from(this.definitions.values());
  }
}
