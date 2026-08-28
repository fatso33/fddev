/**
 * Page.js
 * Dual-Orientation Page Model (v2.3.0 Specification)
 * Manages discrete portrait & landscape layout coordinate matrices with live orientation sync
 */

import { LayoutEngine } from '../core/LayoutEngine.js';

export class Page {
  constructor(config = {}) {
    this.id = config.id || `page_${Date.now()}`;
    this.name = config.name || 'New Page';
    this.icon = config.icon || 'grid';

    // Optional hardware-orientation lock ('landscape' | 'portrait' | null).
    // When set, app.js blocks the widget grid behind a rotate-device prompt
    // and best-effort locks the screen via the Screen Orientation API until
    // the device's actual orientation matches. Introduced for the Virtual
    // Yoke page (page_yoke) — see docs/Virtual-Yoke-Page.md.
    this.orientationLock = config.orientationLock || null;

    // v2.5 Dual-Tier (mobile/tablet) x Dual-Orientation (portrait/landscape)
    // Layouts Container. Each (tier, orientation) combination is stored and
    // authored completely independently -- unlike portrait<->landscape,
    // there is no auto-scaling/mirroring across tiers. A profile authored
    // before tiers existed is treated as 'mobile' data with an empty
    // 'tablet' tier (see StorageManager's migration for stored profiles).
    this.layouts = {
      mobile: {
        portrait: { grid: LayoutEngine.getGridSpec('portrait', 'mobile'), widgets: [] },
        landscape: { grid: LayoutEngine.getGridSpec('landscape', 'mobile'), widgets: [] }
      },
      tablet: {
        portrait: { grid: LayoutEngine.getGridSpec('portrait', 'tablet'), widgets: [] },
        landscape: { grid: LayoutEngine.getGridSpec('landscape', 'tablet'), widgets: [] }
      }
    };

    const rawLayouts = config.layouts && typeof config.layouts === 'object' ? config.layouts : null;
    // Old (pre-tier) shape had {portrait, landscape} directly on `layouts`.
    // Treat that as the mobile tier's data.
    const isLegacyFlatShape = rawLayouts && !rawLayouts.mobile && !rawLayouts.tablet && (rawLayouts.portrait || rawLayouts.landscape);
    const tierSources = isLegacyFlatShape
      ? { mobile: rawLayouts, tablet: null }
      : rawLayouts
        ? { mobile: rawLayouts.mobile || null, tablet: rawLayouts.tablet || null }
        : null;

    if (tierSources) {
      ['mobile', 'tablet'].forEach((tier) => {
        const tierSource = tierSources[tier];
        if (!tierSource) return;
        ['portrait', 'landscape'].forEach((orientation) => {
          const orientationSource = tierSource[orientation];
          if (!orientationSource) return;
          const defaultGrid = LayoutEngine.getGridSpec(orientation, tier);
          this.layouts[tier][orientation] = {
            grid: {
              columns: orientationSource.grid?.columns || defaultGrid.columns,
              rows: orientationSource.grid?.rows || defaultGrid.rows,
              rowHeight: orientationSource.grid?.rowHeight || defaultGrid.rowHeight,
              gap: orientationSource.grid?.gap ?? defaultGrid.gap
            },
            widgets: (orientationSource.widgets || []).map((w) => Page.normalizeWidget(w, orientation))
          };
        });
      });
    } else if (Array.isArray(config.widgets)) {
      // Legacy v1/v2 schema migration: promote flat widgets array into the mobile tier's dual-orientation layouts
      const normalizedWidgets = config.widgets.map((w) => Page.normalizeWidget(w, 'portrait'));
      this.layouts.mobile.portrait.widgets = normalizedWidgets.map((w) => ({
        ...w,
        layout: Page.adaptLayoutForGrid(w.layout, 12, 20, 8, 44)
      }));

      // Generate initial landscape arrangement
      this.layouts.mobile.landscape.widgets = normalizedWidgets.map((w) => ({
        ...w,
        layout: Page.adaptLayoutForGrid(w.layout, 12, 44, 8, 20)
      }));
    }
  }

  /**
   * Normalizes widget layout coordinates ensuring both (col, row) and (x, y) interoperability
   * @param {object} widget
   * @param {string} orientation
   * @returns {object}
   */
  static normalizeWidget(widget, orientation = 'portrait') {
    const raw = JSON.parse(JSON.stringify(widget));
    const layout = raw.layout || {};

    let col = layout.col;
    let row = layout.row;
    let x = layout.x;
    let y = layout.y;
    let w = layout.w !== undefined ? layout.w : 5;
    let h = layout.h !== undefined ? layout.h : 2;

    if (x !== undefined && col === undefined) col = x + 1;
    if (y !== undefined && row === undefined) row = y + 1;
    if (col !== undefined && x === undefined) x = col - 1;
    if (row !== undefined && y === undefined) y = row - 1;

    col = Math.max(1, col || 1);
    row = Math.max(1, row || 1);
    x = Math.max(0, x !== undefined ? x : 0);
    y = Math.max(0, y !== undefined ? y : 0);
    w = Math.max(1, w || 1);
    h = Math.max(1, h || 1);

    return {
      ...raw,
      id: raw.id || `w_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      layout: { col, row, x, y, w, h }
    };
  }

  /**
   * Adapts layout coordinates from a source grid dimension to target grid dimension
   */
  static adaptLayoutForGrid(layout, srcCols, targetCols, srcRows, targetRows) {
    const scaleX = targetCols / srcCols;
    const origCol = layout.col !== undefined ? layout.col : (layout.x !== undefined ? layout.x + 1 : 1);
    const origRow = layout.row !== undefined ? layout.row : (layout.y !== undefined ? layout.y + 1 : 1);
    const origW = layout.w !== undefined ? layout.w : 5;
    const origH = layout.h !== undefined ? layout.h : 2;

    const newW = Math.max(1, Math.min(targetCols, Math.round(origW * scaleX)));
    const newCol = Math.max(1, Math.min(targetCols - newW + 1, Math.round((origCol - 1) * scaleX) + 1));
    const newRow = Math.max(1, origRow);
    const newH = Math.max(1, origH);

    return {
      col: newCol,
      row: newRow,
      x: newCol - 1,
      y: newRow - 1,
      w: newW,
      h: newH
    };
  }

  /**
   * Returns layout container for specified tier + orientation
   * @param {'portrait'|'landscape'} orientation
   * @param {'mobile'|'tablet'} tier
   * @returns {{grid: object, widgets: Array<object>}}
   */
  getLayout(orientation = 'portrait', tier = 'mobile') {
    const tierLayouts = this.layouts[tier] || this.layouts.mobile;
    return tierLayouts[orientation] || tierLayouts.portrait;
  }

  /**
   * Returns grid spec for specified tier + orientation
   * @param {'portrait'|'landscape'} orientation
   * @param {'mobile'|'tablet'} tier
   * @returns {{columns: number, rows: number, rowHeight: number, gap: number}}
   */
  getGrid(orientation = 'portrait', tier = 'mobile') {
    const defaultSpec = LayoutEngine.getGridSpec(orientation, tier);
    const layout = this.getLayout(orientation, tier);
    if (!layout || !layout.grid) return defaultSpec;

    return { ...defaultSpec, ...layout.grid };
  }

  /**
   * Sets grid spec for specified tier + orientation
   * @param {'portrait'|'landscape'} orientation
   * @param {'mobile'|'tablet'} tier
   * @param {object} grid
   */
  setGrid(orientation = 'portrait', tier = 'mobile', grid = {}) {
    const layoutObj = this.getLayout(orientation, tier);
    layoutObj.grid = { ...layoutObj.grid, ...grid };
  }

  /**
   * Returns list of widgets for specified tier + orientation
   * @param {'portrait'|'landscape'} orientation
   * @param {'mobile'|'tablet'} tier
   * @returns {Array<object>}
   */
  getWidgets(orientation = 'portrait', tier = 'mobile') {
    return this.getLayout(orientation, tier).widgets;
  }

  /**
   * Sets list of widgets for specified tier + orientation
   * @param {'portrait'|'landscape'} orientation
   * @param {'mobile'|'tablet'} tier
   * @param {Array<object>} widgets
   */
  setWidgets(orientation = 'portrait', tier = 'mobile', widgets = []) {
    const layoutObj = this.getLayout(orientation, tier);
    layoutObj.widgets = widgets.map((w) => Page.normalizeWidget(w, orientation));
  }

  /**
   * Backwards-compatible getter for default widget list (mobile/portrait)
   */
  get widgets() {
    return this.layouts.mobile.portrait.widgets;
  }

  set widgets(list) {
    this.layouts.mobile.portrait.widgets = (list || []).map((w) => Page.normalizeWidget(w, 'portrait'));
  }

  /**
   * Adds widget to the specified tier + orientation only. Each
   * (tier, orientation) combination is authored independently -- shipped
   * pages and future custom pages are hand-tailored per combination, so a
   * widget added here is NOT auto-mirrored anywhere else. Use the explicit
   * "Mirror Layout" action (LayoutEngine.mirrorLayout) to copy an entire
   * layout across as a one-time starting point instead.
   * @param {object} widgetConfig
   * @param {'portrait'|'landscape'} orientation
   * @param {'mobile'|'tablet'} tier
   */
  addWidget(widgetConfig, orientation = 'portrait', tier = 'mobile') {
    const normalized = Page.normalizeWidget(widgetConfig, orientation);
    const activeLayout = this.getLayout(orientation, tier);
    activeLayout.widgets.push(normalized);
  }

  /**
   * Removes widget by ID from specified orientation layout (or both
   * orientations) within a single tier -- never removes across tiers
   * @param {string} widgetId
   * @param {'portrait'|'landscape'|null} orientation
   * @param {'mobile'|'tablet'} tier
   */
  removeWidget(widgetId, orientation = null, tier = 'mobile') {
    const orientations = orientation ? [orientation] : ['portrait', 'landscape'];
    const tierLayouts = this.layouts[tier] || this.layouts.mobile;
    orientations.forEach((ori) => {
      if (tierLayouts[ori]) {
        const list = tierLayouts[ori].widgets;
        const idx = list.findIndex((w) => w.id === widgetId);
        // Defense-in-depth: a widget explicitly marked non-removable
        // (config.removable === false, e.g. the Virtual Yoke page's Center
        // / Detach controls) is silently kept even if REMOVE_WIDGET reaches
        // this far — the UI-level guards in BaseWidget/PropertyInspector
        // are the primary gate, this is the backstop against a spoofed or
        // replayed event.
        if (idx !== -1 && list[idx].config?.removable !== false) {
          list.splice(idx, 1);
        }
      }
    });
  }

  /**
   * Updates widget configuration and/or layout in specified tier + orientation
   * @param {string} widgetId
   * @param {object} partialConfig
   * @param {'portrait'|'landscape'} orientation
   * @param {boolean} syncOpposite
   * @param {'mobile'|'tablet'} tier
   */
  updateWidget(widgetId, partialConfig, orientation = 'portrait', syncOpposite = false, tier = 'mobile') {
    // 1. Update layout and config in active orientation
    const activeList = this.getWidgets(orientation, tier);
    const activeWidget = activeList.find((w) => w.id === widgetId);
    if (activeWidget) {
      if (partialConfig.layout) {
        const norm = Page.normalizeWidget({ ...activeWidget, layout: { ...activeWidget.layout, ...partialConfig.layout } }, orientation);
        activeWidget.layout = norm.layout;
      }
      if (partialConfig.config) {
        activeWidget.config = { ...activeWidget.config, ...partialConfig.config };
      }
      if (partialConfig.type) {
        activeWidget.type = partialConfig.type;
      }
    }

    // 2. Synchronize config & type changes across opposite orientation of the SAME tier ONLY if explicitly requested
    if (syncOpposite) {
      const oppositeKey = orientation === 'portrait' ? 'landscape' : 'portrait';
      const oppositeList = this.getWidgets(oppositeKey, tier);
      const oppositeWidget = oppositeList.find((w) => w.id === widgetId);
      if (oppositeWidget) {
        if (partialConfig.config) {
          oppositeWidget.config = { ...oppositeWidget.config, ...partialConfig.config };
        }
        if (partialConfig.type) {
          oppositeWidget.type = partialConfig.type;
        }
      }
    }
  }

  toJSON() {
    const serializeTier = (tier) => ({
      portrait: {
        grid: { ...this.layouts[tier].portrait.grid },
        widgets: this.layouts[tier].portrait.widgets.map((w) => JSON.parse(JSON.stringify(w)))
      },
      landscape: {
        grid: { ...this.layouts[tier].landscape.grid },
        widgets: this.layouts[tier].landscape.widgets.map((w) => JSON.parse(JSON.stringify(w)))
      }
    });

    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      orientationLock: this.orientationLock,
      layouts: {
        mobile: serializeTier('mobile'),
        tablet: serializeTier('tablet')
      }
    };
  }
}

