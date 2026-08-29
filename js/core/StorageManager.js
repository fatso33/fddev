/**
 * StorageManager.js
 * ACID-compliant IndexedDB Profile Store with JSON Import/Export & Fallbacks
 */

import { SecurityValidator } from './SecurityValidator.js';
import { SAMPLE_FDWS_WIDGETS } from '../widgets/definitions/sampleWidgets.js';

const DB_NAME = 'flightdeck_db_v2';
const DB_VERSION = 2;
const STORE_PROFILES = 'profiles';
const STORE_SETTINGS = 'settings';
const STORE_WIDGET_DEFINITIONS = 'widgetDefinitions';

const EMPTY_TABLET_TIER = {
  portrait: { grid: { columns: 60, rows: 88, rowHeight: 16, gap: 3 }, widgets: [] },
  landscape: { grid: { columns: 88, rows: 60, rowHeight: 18, gap: 3 }, widgets: [] }
};

/**
 * Wraps a page's flat pre-tier {portrait, landscape} layouts as the
 * 'mobile' tier and adds an empty 'tablet' tier (authored separately --
 * never auto-scaled/mirrored from mobile). No-op if already tiered.
 */
function wrapPageLayoutsWithTiers(page) {
  if (!page.layouts || page.layouts.mobile || page.layouts.tablet) return;
  const { portrait, landscape } = page.layouts;
  page.layouts = {
    mobile: { portrait, landscape },
    tablet: JSON.parse(JSON.stringify(EMPTY_TABLET_TIER))
  };
}

export class StorageManager {
  constructor() {
    this.db = null;
    this.memoryCache = new Map();
    this.widgetDefCache = new Map();
    this.activeProfileId = 'default_ga';
  }

  /**
   * Initializes IndexedDB database and seeds default aircraft profiles if empty
   */
  async init() {
    try {
      this.db = await this.openDatabase();
      await this.ensureDefaultProfiles();
      await this.ensureDefaultDefinitions();
    } catch (err) {
      console.warn('[StorageManager] IndexedDB init failed, falling back to localStorage/memory:', err);
      this.initFallback();
    }
  }

  openDatabase() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB not supported'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_PROFILES)) {
          db.createObjectStore(STORE_PROFILES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_WIDGET_DEFINITIONS)) {
          db.createObjectStore(STORE_WIDGET_DEFINITIONS, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * Generates default aircraft profiles matching v2.3 Dual-Orientation specification
   * (raw pre-tier shape; use getDefaultProfiles() for the tiered version actually consumed)
   */
  getRawDefaultProfiles() {
    return [
      {
        $schema: 'https://flightdeck.local/schemas/profile.v2.3.json',
        id: 'default_ga',
        profileId: 'default_ga',
        name: 'Default',
        aircraft: 'Default',
        version: '2.5.0',
        description: 'Default General Aviation / MSFS 2024 Profile',
        aircraftCategory: 'General Aviation',
        pages: [
          {
            id: 'page_radios',
            name: 'Radios',
            icon: 'radio',
            layouts: {
              portrait: {
                grid: { columns: 20, rows: 44, rowHeight: 16, gap: 3 },
                // RadioWidget (native, non-FDWS) removed — page_radios ships with no
                // widgets until seeded with real FDWS composite radio widgets.
                widgets: []
              },
              landscape: {
                grid: { columns: 44, rows: 20, rowHeight: 18, gap: 3 },
                widgets: []
              }
            }
          },
          {
            id: 'page_autopilot',
            name: 'Autopilot',
            icon: 'plane',
            layouts: {
              portrait: {
                grid: { columns: 20, rows: 44, rowHeight: 16, gap: 3 },
                widgets: [
                  {
                    id: 'w_ga_ap',
                    type: 'ButtonWidget',
                    layout: { col: 1, row: 1, x: 0, y: 0, w: 12, h: 8 },
                    config: {
                      label: 'AP MASTER',
                      shortLabel: 'AP',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'apMasterState', writeEvent: 'apMaster' }
                    }
                  },
                  {
                    id: 'w_ga_fd',
                    type: 'ButtonWidget',
                    layout: { col: 13, row: 1, x: 12, y: 0, w: 8, h: 8 },
                    config: {
                      label: 'FLIGHT DIRECTOR',
                      shortLabel: 'FD',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'apFdState', writeEvent: 'apFdToggle' }
                    }
                  },
                  {
                    id: 'w_ga_hdg_disp',
                    type: 'DisplayWidget',
                    layout: { col: 1, row: 9, x: 0, y: 8, w: 12, h: 8 },
                    config: {
                      label: 'HEADING',
                      prefix: 'HDG',
                      suffix: '°',
                      format: 'DEGREE_3',
                      min: 0,
                      max: 359,
                      step: 1,
                      binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' }
                    }
                  },
                  {
                    id: 'w_ga_hdg_mode',
                    type: 'ButtonWidget',
                    layout: { col: 13, row: 9, x: 12, y: 8, w: 8, h: 8 },
                    config: {
                      label: 'HDG HOLD',
                      shortLabel: 'HDG MODE',
                      variant: 'toggle',
                      binding: { readSimVar: 'apHdgModeState', writeEvent: 'apHdgHoldToggle' }
                    }
                  }
                ]
              },
              landscape: {
                grid: { columns: 44, rows: 20, rowHeight: 18, gap: 3 },
                widgets: [
                  {
                    id: 'w_ga_ap',
                    type: 'ButtonWidget',
                    layout: { col: 1, row: 1, x: 0, y: 0, w: 10, h: 8 },
                    config: {
                      label: 'AP MASTER',
                      shortLabel: 'AP',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'apMasterState', writeEvent: 'apMaster' }
                    }
                  },
                  {
                    id: 'w_ga_fd',
                    type: 'ButtonWidget',
                    layout: { col: 11, row: 1, x: 10, y: 0, w: 10, h: 8 },
                    config: {
                      label: 'FLIGHT DIRECTOR',
                      shortLabel: 'FD',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'apFdState', writeEvent: 'apFdToggle' }
                    }
                  },
                  {
                    id: 'w_ga_hdg_disp',
                    type: 'DisplayWidget',
                    layout: { col: 21, row: 1, x: 20, y: 0, w: 12, h: 8 },
                    config: {
                      label: 'HEADING',
                      prefix: 'HDG',
                      suffix: '°',
                      format: 'DEGREE_3',
                      min: 0,
                      max: 359,
                      step: 1,
                      binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' }
                    }
                  },
                  {
                    id: 'w_ga_hdg_mode',
                    type: 'ButtonWidget',
                    layout: { col: 33, row: 1, x: 32, y: 0, w: 10, h: 8 },
                    config: {
                      label: 'HDG HOLD',
                      shortLabel: 'HDG MODE',
                      variant: 'toggle',
                      binding: { readSimVar: 'apHdgModeState', writeEvent: 'apHdgHoldToggle' }
                    }
                  }
                ]
              }
            }
          },
          {
            id: 'page_lights',
            name: 'Lights',
            icon: 'sun',
            layouts: {
              portrait: {
                grid: { columns: 20, rows: 44, rowHeight: 16, gap: 3 },
                widgets: [
                  {
                    id: 'w_ga_lnd',
                    type: 'ButtonWidget',
                    layout: { col: 1, row: 1, x: 0, y: 0, w: 20, h: 8 },
                    config: {
                      label: 'LANDING',
                      shortLabel: 'LANDING',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'landingLightState', writeEvent: 'landingLightsToggle' }
                    }
                  },
                  {
                    id: 'w_ga_taxi',
                    type: 'ButtonWidget',
                    layout: { col: 1, row: 9, x: 0, y: 8, w: 20, h: 8 },
                    config: {
                      label: 'TAXI',
                      shortLabel: 'TAXI',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'taxiLightState', writeEvent: 'taxiLightsToggle' }
                    }
                  },
                  {
                    id: 'w_ga_nav',
                    type: 'ButtonWidget',
                    layout: { col: 1, row: 17, x: 0, y: 16, w: 20, h: 8 },
                    config: {
                      label: 'NAV',
                      shortLabel: 'NAV',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'navLightState', writeEvent: 'navLightsToggle' }
                    }
                  },
                  {
                    id: 'w_ga_strobe',
                    type: 'ButtonWidget',
                    layout: { col: 1, row: 25, x: 0, y: 24, w: 20, h: 8 },
                    config: {
                      label: 'STROBE',
                      shortLabel: 'STROBE',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'strobeLightState', writeEvent: 'strobeLightsToggle' }
                    }
                  }
                ]
              },
              landscape: {
                grid: { columns: 44, rows: 20, rowHeight: 18, gap: 3 },
                widgets: [
                  {
                    id: 'w_ga_lnd',
                    type: 'ButtonWidget',
                    layout: { col: 1, row: 1, x: 0, y: 0, w: 20, h: 8 },
                    config: {
                      label: 'LANDING',
                      shortLabel: 'LANDING',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'landingLightState', writeEvent: 'landingLightsToggle' }
                    }
                  },
                  {
                    id: 'w_ga_taxi',
                    type: 'ButtonWidget',
                    layout: { col: 23, row: 1, x: 22, y: 0, w: 20, h: 8 },
                    config: {
                      label: 'TAXI',
                      shortLabel: 'TAXI',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'taxiLightState', writeEvent: 'taxiLightsToggle' }
                    }
                  },
                  {
                    id: 'w_ga_nav',
                    type: 'ButtonWidget',
                    layout: { col: 1, row: 9, x: 0, y: 8, w: 20, h: 8 },
                    config: {
                      label: 'NAV',
                      shortLabel: 'NAV',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'navLightState', writeEvent: 'navLightsToggle' }
                    }
                  },
                  {
                    id: 'w_ga_strobe',
                    type: 'ButtonWidget',
                    layout: { col: 23, row: 9, x: 22, y: 8, w: 20, h: 8 },
                    config: {
                      label: 'STROBE',
                      shortLabel: 'STROBE',
                      variant: 'toggle',
                      hasLed: true,
                      binding: { readSimVar: 'strobeLightState', writeEvent: 'strobeLightsToggle' }
                    }
                  }
                ]
              }
            }
          },
          {
            id: 'page_yoke',
            name: 'Virtual Yoke',
            icon: 'yoke',
            // Landscape-only: app.js blocks the grid behind a rotate-device
            // prompt while the device is in portrait. See
            // docs/Virtual-Yoke-Page.md.
            orientationLock: 'landscape',
            layouts: {
              portrait: {
                grid: { columns: 20, rows: 44, rowHeight: 16, gap: 3 },
                widgets: [
                  {
                    id: 'w_ga_yoke_center',
                    type: 'VirtualYokeCenterWidget',
                    layout: { col: 1, row: 1, x: 0, y: 0, w: 20, h: 6 },
                    config: { label: 'CENTER', removable: false }
                  },
                  {
                    id: 'w_ga_yoke_detach',
                    type: 'VirtualYokeDetachWidget',
                    layout: { col: 1, row: 7, x: 0, y: 6, w: 20, h: 6 },
                    config: { label: 'DETACH', detachedLabel: 'ATTACH', removable: false }
                  }
                ]
              },
              landscape: {
                grid: { columns: 44, rows: 20, rowHeight: 18, gap: 3 },
                widgets: [
                  {
                    id: 'w_ga_yoke_center',
                    type: 'VirtualYokeCenterWidget',
                    layout: { col: 1, row: 1, x: 0, y: 0, w: 12, h: 8 },
                    config: { label: 'CENTER', removable: false }
                  },
                  {
                    id: 'w_ga_yoke_detach',
                    type: 'VirtualYokeDetachWidget',
                    layout: { col: 1, row: 9, x: 0, y: 8, w: 12, h: 8 },
                    config: { label: 'DETACH', detachedLabel: 'ATTACH', removable: false }
                  }
                ]
              }
            }
          }
        ]
      }
    ];
  }

  /**
   * Generates default aircraft profiles, wrapping each page's flat
   * portrait/landscape layouts as the mobile tier and seeding an empty
   * tablet/desktop tier (see wrapPageLayoutsWithTiers above).
   */
  getDefaultProfiles() {
    const profiles = this.getRawDefaultProfiles();
    profiles.forEach((profile) => profile.pages.forEach((page) => wrapPageLayoutsWithTiers(page)));
    return profiles;
  }

  async ensureDefaultProfiles() {
    // Clean up legacy A220 test profile if found
    try {
      if (this.db) {
        const tx = this.db.transaction([STORE_PROFILES], 'readwrite');
        tx.objectStore(STORE_PROFILES).delete('profile_1787179665085');
      }
      this.memoryCache.delete('profile_1787179665085');
      if (localStorage.getItem('flightdeck_active_profile_id') === 'profile_1787179665085') {
        localStorage.setItem('flightdeck_active_profile_id', 'default_ga');
      }
    } catch (_) {}

    const existing = await this.getAllProfiles();
    if (existing.length === 0) {
      const defaults = this.getDefaultProfiles();
      for (const p of defaults) {
        await this.saveProfile(p);
      }
    } else {
      const defaults = this.getDefaultProfiles();
      const defaultIds = new Set(defaults.map((d) => d.id));

      for (const p of existing) {
        const isBuiltinDefault = defaultIds.has(p.id);
        if (isBuiltinDefault && (!p.version || p.version < '2.5.0')) {
          const fresh = defaults.find((d) => d.id === p.id);
          if (fresh) {
            await this.saveProfile(fresh);
            continue;
          }
        }

        const needsUpgrade = !p.version || p.version < '2.3.1' || p.pages?.some((pg) => {
          return !pg.layouts || (pg.layouts.portrait?.grid?.columns && pg.layouts.portrait.grid.columns < 10);
        });

        if (needsUpgrade) {
          if (p.pages) {
            p.pages.forEach((pg) => {
              if (pg.layouts) {
                ['portrait', 'landscape'].forEach((ori) => {
                  const targetGrid = ori === 'portrait'
                    ? { columns: 10, rows: 22, rowHeight: 32, gap: 6 }
                    : { columns: 22, rows: 10, rowHeight: 36, gap: 6 };

                  if (pg.layouts[ori]) {
                    pg.layouts[ori].grid = targetGrid;
                    if (Array.isArray(pg.layouts[ori].widgets)) {
                      pg.layouts[ori].widgets.forEach((w) => {
                        if (w.layout && !w.layout.upgraded2x) {
                          w.layout.w = (w.layout.w || 4) * 2;
                          w.layout.h = (w.layout.h || 2) * 2;
                          const oldCol = w.layout.col || (w.layout.x !== undefined ? w.layout.x + 1 : 1);
                          const oldRow = w.layout.row || (w.layout.y !== undefined ? w.layout.y + 1 : 1);
                          w.layout.col = (oldCol - 1) * 2 + 1;
                          w.layout.row = (oldRow - 1) * 2 + 1;
                          w.layout.x = w.layout.col - 1;
                          w.layout.y = w.layout.row - 1;
                          w.layout.upgraded2x = true;
                        }
                      });
                    }
                  }
                });
              }
            });
          }
          p.version = '2.3.1';
          await this.saveProfile(p);
        }

        // v2.4.0: double the compact grid resolution again (10x22/22x10 -> 20x44/44x20)
        // so finer-grained widget placement is available on every device tier.
        const needsGridDoubling = !p.version || p.version < '2.4.0' || p.pages?.some((pg) => {
          return pg.layouts?.portrait?.grid?.columns && pg.layouts.portrait.grid.columns < 20;
        });

        if (needsGridDoubling) {
          if (p.pages) {
            p.pages.forEach((pg) => {
              if (pg.layouts) {
                ['portrait', 'landscape'].forEach((ori) => {
                  const targetGrid = ori === 'portrait'
                    ? { columns: 20, rows: 44, rowHeight: 16, gap: 3 }
                    : { columns: 44, rows: 20, rowHeight: 18, gap: 3 };

                  if (pg.layouts[ori]) {
                    pg.layouts[ori].grid = targetGrid;
                    if (Array.isArray(pg.layouts[ori].widgets)) {
                      pg.layouts[ori].widgets.forEach((w) => {
                        if (w.layout && !w.layout.upgraded4x) {
                          w.layout.w = (w.layout.w || 5) * 2;
                          w.layout.h = (w.layout.h || 2) * 2;
                          const oldCol = w.layout.col || (w.layout.x !== undefined ? w.layout.x + 1 : 1);
                          const oldRow = w.layout.row || (w.layout.y !== undefined ? w.layout.y + 1 : 1);
                          w.layout.col = (oldCol - 1) * 2 + 1;
                          w.layout.row = (oldRow - 1) * 2 + 1;
                          w.layout.x = w.layout.col - 1;
                          w.layout.y = w.layout.row - 1;
                          w.layout.upgraded4x = true;
                        }
                      });
                    }
                  }
                });
              }
            });
          }
          p.version = '2.4.0';
          await this.saveProfile(p);
        }

        // v2.5.0: introduce the mobile/tablet device-tier grid axis. Existing
        // flat portrait/landscape data becomes the 'mobile' tier; a page's
        // 'tablet' tier starts empty and is authored separately -- it is
        // never auto-scaled/mirrored from mobile's layout.
        const needsTiering = !p.version || p.version < '2.5.0' || p.pages?.some((pg) => {
          return pg.layouts && !pg.layouts.mobile && !pg.layouts.tablet && (pg.layouts.portrait || pg.layouts.landscape);
        });

        if (needsTiering) {
          if (p.pages) {
            p.pages.forEach((pg) => wrapPageLayoutsWithTiers(pg));
          }
          p.version = '2.5.0';
          await this.saveProfile(p);
        }
      }
    }
  }

  initFallback() {
    const defaults = this.getDefaultProfiles();
    defaults.forEach((p) => {
      this.memoryCache.set(p.id, p);
    });
    try {
      const raw = localStorage.getItem('flightdeck_profiles_fallback');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((p) => this.memoryCache.set(p.id, p));
        }
      }
    } catch (_) {}
  }

  async getAllProfiles() {
    if (!this.db) {
      return Array.from(this.memoryCache.values());
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_PROFILES], 'readonly');
      const store = transaction.objectStore(STORE_PROFILES);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async getProfile(id) {
    if (!this.db) {
      return this.memoryCache.get(id) || null;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_PROFILES], 'readonly');
      const store = transaction.objectStore(STORE_PROFILES);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  setSimBridge(simBridge) {
    this.simBridge = simBridge;
  }

  isDefaultProfile(id) {
    return id === 'default_ga';
  }

  isDefaultWidget(id) {
    return [
      'ButtonWidget',
      'DisplayWidget',
      'RotaryWidget',
      'AnnunciatorWidget',
      'com.example.nav1radio',
      'com.example.layeredswitch'
    ].includes(id);
  }

  isDefaultComponent(type) {
    return [
      'core.label',
      'core.display',
      'core.input',
      'core.button',
      'core.indicator',
      'core.stepper',
      'core.rotary',
      'core.container',
      'core.image'
    ].includes(type);
  }

  async getNonDefaultProfiles() {
    const all = await this.getAllProfiles();
    return all.filter(p => !this.isDefaultProfile(p.id));
  }

  async getNonDefaultWidgets() {
    const all = await this.getAllWidgetDefinitions();
    return all.filter(w => !this.isDefaultWidget(w.id));
  }

  getNonDefaultComponents() {
    return [];
  }

  async generateSyncManifest() {
    const nonDefaultProfs = await this.getNonDefaultProfiles();
    const nonDefaultWids = await this.getNonDefaultWidgets();
    const nonDefaultComps = this.getNonDefaultComponents();

    return {
      profiles: nonDefaultProfs.map(p => ({
        id: p.id,
        name: p.name,
        version: p.version || '2.3.1',
        updatedAt: p.updatedAt || 0
      })),
      widgets: nonDefaultWids.map(w => ({
        id: w.id,
        name: w.meta?.name || w.id,
        revision: w.revision || 1,
        updatedAt: w.updatedAt || 0
      })),
      components: nonDefaultComps.map(c => ({
        id: c.id || c.type,
        version: c.version || '1.0.0',
        updatedAt: c.updatedAt || 0
      }))
    };
  }

  /**
   * Applies non-default presets, widgets, and components fetched from PC Bridge to mobile storage/cache
   * @param {object} payload
   * @param {Array<object>} [payload.profiles]
   * @param {Array<object>} [payload.widgets]
   * @param {Array<object>} [payload.components]
   * @returns {Promise<{updatedProfiles: number, updatedWidgets: number, updatedComponents: number, total: number}>}
   */
  async applyRemotePresets({ profiles = [], widgets = [], components = [] }) {
    let updatedProfiles = 0;
    let updatedWidgets = 0;
    let updatedComponents = 0;

    // Apply Profiles
    if (Array.isArray(profiles)) {
      for (const prof of profiles) {
        if (!prof || !prof.id || this.isDefaultProfile(prof.id)) continue;
        try {
          const validation = SecurityValidator.validateProfile(prof);
          if (validation.valid) {
            await this.saveProfile(prof, false); // false = do not loop push back to PC
            updatedProfiles++;
          }
        } catch (err) {
          console.warn('[StorageManager] Could not apply remote profile:', prof.id, err);
        }
      }
    }

    // Apply Custom Widget Definitions
    if (Array.isArray(widgets)) {
      for (const wid of widgets) {
        if (!wid || !wid.id || this.isDefaultWidget(wid.id)) continue;
        try {
          const validation = SecurityValidator.validateFDWSDefinition(wid);
          if (validation.valid) {
            const sanitized = validation.sanitizedDefinition;
            await this.saveWidgetDefinition(sanitized, false); // false = do not loop push back
            updatedWidgets++;
          }
        } catch (err) {
          console.warn('[StorageManager] Could not apply remote widget definition:', wid.id, err);
        }
      }
    }

    return {
      updatedProfiles,
      updatedWidgets,
      updatedComponents,
      total: updatedProfiles + updatedWidgets + updatedComponents
    };
  }

  /**
   * Pushes local non-default profiles/widgets up to PC Bridge that the PC is missing
   * or has an older revision of. This is the counterpart to applyRemotePresets(): that
   * pulls down what the client is missing, this pushes up what the PC is missing —
   * together they make reconnect-time sync fully bidirectional. Without this, an item
   * saved locally while saveProfile/saveWidgetDefinition's immediate push-on-save
   * didn't land (bridge offline, or a connect-timing race) would be stranded in local
   * storage forever, since the immediate push only ever fires once, at save time.
   * @param {object} serverManifest - manifest field from SYNC_MANIFEST_RESPONSE
   * @returns {Promise<{pushedProfiles: number, pushedWidgets: number}>}
   */
  async reconcilePushUp(serverManifest = {}) {
    let pushedProfiles = 0;
    let pushedWidgets = 0;
    if (!this.simBridge || !this.simBridge.connected) {
      return { pushedProfiles, pushedWidgets };
    }

    const serverProfiles = new Map((serverManifest.profiles || []).map(p => [p.id, p]));
    const serverWidgets = new Map((serverManifest.widgets || []).map(w => [w.id, w]));

    const localProfiles = await this.getNonDefaultProfiles();
    for (const p of localProfiles) {
      const remote = serverProfiles.get(p.id);
      if (!remote || (p.updatedAt && remote.updatedAt && p.updatedAt > remote.updatedAt)) {
        const result = await this.simBridge.saveUserPreset('profile', p);
        if (result && result.status === 'SUCCESS') pushedProfiles++;
      }
    }

    const localWidgets = await this.getNonDefaultWidgets();
    for (const w of localWidgets) {
      const remote = serverWidgets.get(w.id);
      if (!remote || (w.revision && remote.revision && w.revision > remote.revision) || (w.updatedAt && remote.updatedAt && w.updatedAt > remote.updatedAt)) {
        const result = await this.simBridge.saveUserPreset('widget', w);
        if (result && result.status === 'SUCCESS') pushedWidgets++;
      }
    }

    return { pushedProfiles, pushedWidgets };
  }

  async saveProfile(profile, pushToPC = true) {
    const validation = SecurityValidator.validateProfile(profile);
    if (!validation.valid) {
      throw new Error(`Profile validation failed: ${validation.errors.join(', ')}`);
    }

    if (!profile.updatedAt) {
      profile.updatedAt = Date.now();
    }

    if (!this.db) {
      this.memoryCache.set(profile.id, profile);
      try {
        localStorage.setItem('flightdeck_profiles_fallback', JSON.stringify(Array.from(this.memoryCache.values())));
      } catch (_) {}
    } else {
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_PROFILES], 'readwrite');
        const store = transaction.objectStore(STORE_PROFILES);
        const request = store.put(profile);

        request.onsuccess = () => {
          resolve(profile);
        };
        request.onerror = () => {
          reject(request.error);
        };
      });
    }

    // Automatically sync non-default profile to PC Bridge storage if connected
    if (pushToPC && !this.isDefaultProfile(profile.id) && this.simBridge && this.simBridge.connected) {
      this.simBridge.saveUserPreset('profile', profile);
    }

    return profile;
  }

  async deleteProfile(id, syncToPC = true) {
    if (!this.db) {
      this.memoryCache.delete(id);
    } else {
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_PROFILES], 'readwrite');
        const store = transaction.objectStore(STORE_PROFILES);
        const request = store.delete(id);

        request.onsuccess = () => {
          resolve(true);
        };
        request.onerror = () => {
          reject(request.error);
        };
      });
    }

    // Automatically sync non-default profile deletion to PC Bridge storage if connected
    if (syncToPC && !this.isDefaultProfile(id) && this.simBridge && this.simBridge.connected) {
      this.simBridge.deleteUserPreset('profile', id);
    }

    return true;
  }

  async getActiveProfileId() {
    try {
      const localId = localStorage.getItem('flightdeck_active_profile_id');
      if (localId) {
        if (localId === 'profile_1787179665085') {
          localStorage.setItem('flightdeck_active_profile_id', 'default_ga');
          return 'default_ga';
        }
        return localId;
      }
    } catch (_) {}
    return this.activeProfileId;
  }

  async setActiveProfileId(id) {
    this.activeProfileId = id;
    try {
      localStorage.setItem('flightdeck_active_profile_id', id);
    } catch (_) {}
  }

  /**
   * Exports profile as JSON file blob
   * @param {string} profileId
   * @returns {Promise<string>} JSON string
   */
  async exportProfileJSON(profileId) {
    const profile = await this.getProfile(profileId);
    if (!profile) throw new Error(`Profile ${profileId} not found`);
    return JSON.stringify(profile, null, 2);
  }

  /**
   * Imports profile from JSON string with validation
   * @param {string} jsonString
   * @returns {Promise<object>} Saved profile
   */
  async importProfileJSON(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (err) {
      throw new Error(`Invalid JSON syntax: ${err.message}`);
    }

    // Assign new unique ID to avoid overwriting existing unless user intends
    if (!parsed.id) {
      parsed.id = `profile_${Date.now()}`;
    }

    const validation = SecurityValidator.validateProfile(parsed);
    if (!validation.valid) {
      throw new Error(`Invalid Flight Deck Profile: ${validation.errors.join('; ')}`);
    }

    await this.saveProfile(parsed);
    return parsed;
  }

  /**
   * Seeds default reference FDWS v1.1 definitions if store is empty
   */
  async ensureDefaultDefinitions() {
    try {
      const existing = await this.getAllWidgetDefinitions();
      if (!existing || existing.length === 0) {
        for (const sample of SAMPLE_FDWS_WIDGETS) {
          await this.saveWidgetDefinition(sample);
        }
      }
    } catch (err) {
      console.warn('[StorageManager] Could not seed default definitions:', err);
    }
  }

  /**
   * Retrieves all installed FDWS widget definitions
   * @returns {Promise<Array<object>>}
   */
  async getAllWidgetDefinitions() {
    if (!this.db) {
      try {
        const stored = localStorage.getItem('flightdeck_widget_definitions_fallback');
        if (stored) return JSON.parse(stored);
      } catch (_) {}
      return Array.from(this.widgetDefCache.values());
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([STORE_WIDGET_DEFINITIONS], 'readonly');
        const store = transaction.objectStore(STORE_WIDGET_DEFINITIONS);
        const request = store.getAll();

        request.onsuccess = () => {
          resolve(request.result || []);
        };
        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        resolve(Array.from(this.widgetDefCache.values()));
      }
    });
  }

  /**
   * Retrieves a single FDWS widget definition by ID
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async getWidgetDefinition(id) {
    if (!id) return null;
    if (!this.db) {
      return this.widgetDefCache.get(id) || null;
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([STORE_WIDGET_DEFINITIONS], 'readonly');
        const store = transaction.objectStore(STORE_WIDGET_DEFINITIONS);
        const request = store.get(id);

        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        resolve(this.widgetDefCache.get(id) || null);
      }
    });
  }

  /**
   * Persists an FDWS widget definition
   * @param {object} def
   * @param {boolean} [pushToPC=true]
   * @returns {Promise<object>}
   */
  async saveWidgetDefinition(def, pushToPC = true) {
    if (!def || !def.id) {
      throw new Error('Widget definition must contain a valid id');
    }

    if (!def.updatedAt) {
      def.updatedAt = Date.now();
    }

    this.widgetDefCache.set(def.id, def);

    if (!this.db) {
      try {
        localStorage.setItem(
          'flightdeck_widget_definitions_fallback',
          JSON.stringify(Array.from(this.widgetDefCache.values()))
        );
      } catch (_) {}
    } else {
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_WIDGET_DEFINITIONS], 'readwrite');
        const store = transaction.objectStore(STORE_WIDGET_DEFINITIONS);
        const request = store.put(def);

        request.onsuccess = () => {
          resolve(def);
        };
        request.onerror = () => {
          reject(request.error);
        };
      });
    }

    // Automatically sync non-default widget definition to PC Bridge storage if connected
    if (pushToPC && !this.isDefaultWidget(def.id) && this.simBridge && this.simBridge.connected) {
      this.simBridge.saveUserPreset('widget', def);
    }

    return def;
  }

  /**
   * Deletes an installed FDWS widget definition by ID
   * @param {string} id
   * @param {boolean} [syncToPC=true]
   * @returns {Promise<boolean>}
   */
  async deleteWidgetDefinition(id, syncToPC = true) {
    this.widgetDefCache.delete(id);

    if (!this.db) {
      try {
        localStorage.setItem(
          'flightdeck_widget_definitions_fallback',
          JSON.stringify(Array.from(this.widgetDefCache.values()))
        );
      } catch (_) {}
    } else {
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_WIDGET_DEFINITIONS], 'readwrite');
        const store = transaction.objectStore(STORE_WIDGET_DEFINITIONS);
        const request = store.delete(id);

        request.onsuccess = () => {
          resolve(true);
        };
        request.onerror = () => {
          reject(request.error);
        };
      });
    }

    // Automatically sync non-default widget deletion to PC Bridge storage if connected
    if (syncToPC && !this.isDefaultWidget(id) && this.simBridge && this.simBridge.connected) {
      this.simBridge.deleteUserPreset('widget', id);
    }

    return true;
  }

  /**
   * Collects the unique popoverWidgetId values a widget definition's own
   * interactions reference via core.openWidgetPopover (FDWS v1.19 §1.5).
   * @param {object} def
   * @returns {string[]}
   */
  collectReferencedPopoverIds(def) {
    const ids = new Set();
    (def.components || []).forEach((comp) => {
      (comp.interactions || []).forEach((inter) => {
        if (inter.action?.type === 'core.openWidgetPopover' && inter.action.popoverWidgetId) {
          ids.add(inter.action.popoverWidgetId);
        }
      });
    });
    return [...ids];
  }

  /**
   * Exports an FDWS widget definition as a single-file .fdwidget JSON string (§9.2).
   * FDWS v1.19 §1.5: any popover(s) the widget's own interactions reference
   * are looked up from local storage and inlined into a "popovers" array, so
   * the exported file is self-contained. A referenced popover that isn't
   * installed locally is silently left out (same limitation as before this
   * feature existed — nothing to bundle if it was never installed here).
   * @param {string} definitionId
   * @returns {Promise<string>}
   */
  async exportWidgetDefinitionJSON(definitionId) {
    const def = await this.getWidgetDefinition(definitionId);
    if (!def) throw new Error(`Widget Definition "${definitionId}" not found`);

    const exportDef = JSON.parse(JSON.stringify(def));
    const popoverIds = this.collectReferencedPopoverIds(exportDef);
    if (popoverIds.length > 0) {
      const popovers = [];
      for (const id of popoverIds) {
        const popoverDef = await this.getWidgetDefinition(id);
        if (popoverDef) popovers.push(popoverDef);
      }
      if (popovers.length > 0) exportDef.popovers = popovers;
    }

    return JSON.stringify(exportDef, null, 2);
  }

  /**
   * Imports and validates a .fdwidget single-file package (§11). FDWS v1.19
   * §1.5: any embedded "popovers" (already validated/sanitized by
   * validateFDWSDefinition) are saved individually first, exactly as if each
   * had been imported on its own, then stripped from the host definition
   * before it's persisted.
   * @param {string} jsonString
   * @returns {Promise<{saved: object, warnings: string[]}>}
   */
  async importWidgetDefinitionJSON(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (err) {
      throw new Error(`Invalid JSON syntax: ${err.message}`);
    }

    const validation = SecurityValidator.validateFDWSDefinition(parsed);
    if (!validation.valid) {
      throw new Error(`Invalid FDWS Widget Definition: ${validation.errors.join('; ')}`);
    }

    const sanitized = validation.sanitizedDefinition;
    const warnings = [...validation.warnings];

    if (Array.isArray(sanitized.popovers) && sanitized.popovers.length > 0) {
      for (const popoverDef of sanitized.popovers) {
        await this.saveWidgetDefinition(popoverDef);
      }
    }
    delete sanitized.popovers;

    await this.saveWidgetDefinition(sanitized);
    return { saved: sanitized, warnings };
  }
}
