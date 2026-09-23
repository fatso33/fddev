/**
 * @module CornerLayout
 * Pure reserved-corner layout calculations for the PWA. The caller supplies
 * live app state and its LayoutEngine; this module owns no DOM, storage,
 * timers, listeners, cached state or other resources.
 */

/**
 * Computes the fixed menu and App Profile layouts from the current grid width.
 * The declared widths retain the same proportional scaling as ordinary
 * widget layouts; each footprint reserves one margin column toward the edge
 * so a rounded screen corner cannot clip the visible control.
 * @param {'portrait'|'landscape'} orientation - Grid orientation.
 * @param {'mobile'|'tablet'} deviceTier - Retained facade input; scaling follows columns.
 * @param {{columns:number, gap:number}} gridSpec - Active grid dimensions.
 * @param {boolean} isEditMode - Live edit-mode value for the menu widget.
 * @param {{name:string}|null} activeProfile - Live profile used for the badge label.
 * @returns {{menu:object, profile:object}} The two virtual widget configurations.
 */
export function getCornerWidgetLayouts(orientation, deviceTier, gridSpec, isEditMode, activeProfile) {
  const declaredForCols = orientation === 'landscape' ? 44 : 20;
  const scale = (declaredW) => Math.max(1, Math.min(gridSpec.columns, Math.round((declaredW / declaredForCols) * gridSpec.columns)));
  // Each widget's grid footprint is 1 column wider than its visible
  // button/badge (3->4 for the menu, 5->6 for the App Profile badge) --
  // permanent, always-reserved padding toward the true screen edge, not
  // conditional on Fullscreen mode. A static grid-space margin accounts for
  // varied device corner curvature without needing device-specific geometry.
  // The visible and total widths let each widget inner-align its control via
  // nested CSS Grid using the same column-width math as the outer grid.
  const menuVisibleW = scale(3);
  const menuTotalW = scale(4);
  const profileVisibleW = scale(5);
  const profileTotalW = scale(6);
  return {
    menu: {
      id: '__corner_menu__',
      type: 'MenuToggleWidget',
      layout: { col: 1, row: 1, w: menuTotalW, h: 2 },
      config: {
        removable: false,
        appEditMode: isEditMode,
        visibleCols: menuVisibleW,
        totalCols: menuTotalW,
        gap: gridSpec.gap
      }
    },
    profile: {
      id: '__corner_profile__',
      type: 'AppProfileWidget',
      layout: { col: Math.max(1, gridSpec.columns - profileTotalW + 1), row: 1, w: profileTotalW, h: 2 },
      config: {
        removable: false,
        label: activeProfile ? activeProfile.name.toUpperCase().slice(0, 7) : 'DEFAULT',
        visibleCols: profileVisibleW,
        totalCols: profileTotalW,
        gap: gridSpec.gap
      }
    }
  };
}

/**
 * Returns virtual corner obstacles in the compact shape used by LayoutEngine.
 * Reserved entries participate in placement but are stripped before page data
 * is persisted, keeping the app-global controls out of profile layouts.
 * @param {{menu:{id:string, layout:object}, profile:{id:string, layout:object}}} layouts - Current facade corner layouts.
 * @returns {Array<{id:string, layout:object}>} The two reserved obstacles.
 */
export function getReservedCornerEntries(layouts) {
  const { menu, profile } = layouts;
  return [
    { id: menu.id, layout: menu.layout },
    { id: profile.id, layout: profile.layout }
  ];
}

/**
 * Resolves a moving widget, then treats each fixed corner as authoritative so
 * real widgets move away from reserved cells. The reserved entries never leave
 * this calculation in its returned page-widget list.
 * @param {import('../core/LayoutEngine.js').LayoutEngine} layoutEngine - Grid push-down engine.
 * @param {string} movingId - Real widget being placed.
 * @param {object} targetLayout - Requested widget layout.
 * @param {Array<object>} widgetList - Real widgets only.
 * @param {Array<{id:string, layout:object}>} reserved - Entries from getReservedCornerEntries().
 * @returns {Array<object>} Resolved real widgets with corners kept clear.
 */
export function resolveWithReservedCorners(layoutEngine, movingId, targetLayout, widgetList, reserved) {
  let list = layoutEngine.resolveLayoutWithPushDown(movingId, targetLayout, widgetList);
  for (const r of reserved) {
    list = layoutEngine.resolveLayoutWithPushDown(r.id, r.layout, [...list, r]);
  }
  return list.filter((w) => !reserved.some((res) => res.id === w.id));
}

/**
 * Resolves a drag candidate against real widgets and fixed corner obstacles.
 * A collision is rejected when auto-reposition is off; otherwise the grid
 * engine performs the existing smart nudge (which is a no-op for free cells).
 * @param {import('../core/LayoutEngine.js').LayoutEngine} layoutEngine - Grid collision engine.
 * @param {boolean} autoRepositionEnabled - Current nudge setting.
 * @param {string} movingWidgetId - Real widget being moved.
 * @param {{col:number,row:number,w:number,h:number}} candidate - Requested layout.
 * @param {Array<object>} widgetList - Real widgets only.
 * @param {object} gridSpec - Active grid bounds.
 * @param {Array<{id:string, layout:object}>} reserved - Fixed corner obstacles.
 * @returns {{ok:true, widgets:Array<object>}|{ok:false}} Placement result from LayoutEngine.
 */
export function resolveDropPlacement(layoutEngine, autoRepositionEnabled, movingWidgetId, candidate, widgetList, gridSpec, reserved) {
  const wouldCollide = layoutEngine.hasCollision(candidate, movingWidgetId, [...widgetList, ...reserved]);
  if (wouldCollide && !autoRepositionEnabled) return { ok: false };
  return layoutEngine.resolveSmartNudge(movingWidgetId, candidate, widgetList, gridSpec, reserved);
}

/**
 * Builds a full layout by inserting each item in sequence, then moves real
 * items clear of each fixed corner. The insertion order is meaningful because
 * each later insertion is authoritative and can push earlier items downward.
 * @param {import('../core/LayoutEngine.js').LayoutEngine} layoutEngine - Grid push-down engine.
 * @param {Array<object>} items - Real widgets in insertion order.
 * @param {Array<{id:string, layout:object}>} reserved - Fixed corner entries.
 * @returns {Array<object>} Resolved real widgets only.
 */
export function resolveListWithReservedCorners(layoutEngine, items, reserved) {
  let list = [];
  for (const item of items) {
    list = layoutEngine.resolveLayoutWithPushDown(item.id, item.layout, [...list, item]);
  }
  for (const r of reserved) {
    list = layoutEngine.resolveLayoutWithPushDown(r.id, r.layout, [...list, r]);
  }
  return list.filter((w) => !reserved.some((res) => res.id === w.id));
}
