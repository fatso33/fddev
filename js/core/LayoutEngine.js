/**
 * LayoutEngine.js
 * Declarative N×M Dual-Orientation Grid Engine (v2.3 Specification)
 * Features Dynamic Computed-Track Resolution, Push-Down Cascade Reordering, 
 * Orientation Watcher, Device Classification Matrix, and Intelligent Aspect Ratio Mirror Tool
 */

export class LayoutEngine {
  constructor({ gridCols = 20, defaultRowHeight = 16, gap = 3 } = {}) {
    this.gridCols = gridCols;
    this.defaultRowHeight = defaultRowHeight;
    this.gap = gap;
    this.currentOrientation = this.getOrientation();
    this.orientationWatcherUnsub = null;
  }

  /**
   * Evaluates current viewport orientation
   * @param {number} width
   * @param {number} height
   * @returns {'portrait'|'landscape'}
   */
  getOrientation(width = typeof window !== 'undefined' ? window.innerWidth : 1024, height = typeof window !== 'undefined' ? window.innerHeight : 768) {
    if (typeof window !== 'undefined') {
      const w = width !== undefined ? width : window.innerWidth;
      const h = height !== undefined ? height : window.innerHeight;
      return h >= w ? 'portrait' : 'landscape';
    }
    return 'portrait';
  }

  /**
   * Device Classification Matrix based on minimum viewport dimension
   * @param {number} width
   * @param {number} height
   * @returns {'mobile'|'tablet'}
   */
  static getDeviceTier(width = typeof window !== 'undefined' ? window.innerWidth : 1024, height = typeof window !== 'undefined' ? window.innerHeight : 768) {
    const minDim = Math.min(width, height);
    if (minDim < 600) return 'mobile';
    return 'tablet';
  }

  /**
   * Retrieves default grid specification based on orientation and device tier
   * Mobile   - Portrait: 20 columns x 44 rows / Landscape: 44 columns x 20 rows
   * Tablet   - Portrait: 60 columns x 88 rows / Landscape: 88 columns x 60 rows
   * (device tier from getDeviceTier(); 'tablet' covers tablet AND desktop viewports)
   * @param {'portrait'|'landscape'} orientation
   * @param {'mobile'|'tablet'} tier
   * @returns {{columns: number, rows: number, rowHeight: number, gap: number}}
   */
  static getGridSpec(orientation = 'portrait', tier = 'mobile') {
    const TIER_GRIDS = {
      mobile: {
        portrait: { columns: 20, rows: 44, rowHeight: 16, gap: 3 },
        landscape: { columns: 44, rows: 20, rowHeight: 18, gap: 3 }
      },
      tablet: {
        portrait: { columns: 60, rows: 88, rowHeight: 16, gap: 3 },
        landscape: { columns: 88, rows: 60, rowHeight: 18, gap: 3 }
      }
    };
    const tierGrids = TIER_GRIDS[tier] || TIER_GRIDS.mobile;
    return tierGrids[orientation] || tierGrids.portrait;
  }

  /**
   * Configures CSS Grid parameters on the DOM container
   * @param {HTMLElement} container
   * @param {{columns: number, rows?: number, rowHeight: number, gap: number}} gridSpec
   */
  applyGridToContainer(container, gridSpec) {
    if (!container || !gridSpec) return;
    this.gridCols = gridSpec.columns || this.gridCols;
    this.defaultRowHeight = gridSpec.rowHeight || this.defaultRowHeight;
    this.gap = gridSpec.gap !== undefined ? gridSpec.gap : this.gap;

    // minmax(0,1fr) not bare 1fr, and a fixed px row height not minmax(N,auto):
    // a widget's declared W x H must be an exact pixel contract, not a minimum
    // that content can silently grow past. See grid.css's .fd-page-grid for
    // the fuller rationale (same fix, same reasoning, kept in sync here).
    container.style.gridTemplateColumns = `repeat(${this.gridCols}, minmax(0, 1fr))`;
    container.style.gridAutoRows = `${this.defaultRowHeight}px`;
    container.style.gap = `${this.gap}px`;
    container.style.setProperty('--grid-cols', this.gridCols);
    container.style.setProperty('--row-height', `${this.defaultRowHeight}px`);
    container.style.setProperty('--grid-gap', `${this.gap}px`);
  }

  /**
   * Initializes hardware orientation listener and window resize watcher
   * @param {Function} onChangeCallback
   * @returns {Function} Unsubscribe cleanup function
   */
  initOrientationWatcher(onChangeCallback) {
    if (typeof window === 'undefined') return () => {};

    const mediaQuery = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
    let lastOrientation = this.getOrientation();
    let lastWidth = window.innerWidth;
    let lastHeight = window.innerHeight;

    const checkChange = () => {
      const currentWidth = window.innerWidth;
      const currentHeight = window.innerHeight;
      const newOrientation = this.getOrientation(currentWidth, currentHeight);

      if (newOrientation !== lastOrientation || Math.abs(currentWidth - lastWidth) > 5 || Math.abs(currentHeight - lastHeight) > 5) {
        lastOrientation = newOrientation;
        lastWidth = currentWidth;
        lastHeight = currentHeight;
        this.currentOrientation = newOrientation;
        if (onChangeCallback) {
          onChangeCallback(newOrientation, true);
        }
      }
    };

    let resizeTimer = null;
    const handleResizeDebounced = () => {
      checkChange();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(checkChange, 80);
    };

    if (mediaQuery) {
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleResizeDebounced);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(handleResizeDebounced);
      }
    }

    window.addEventListener('resize', handleResizeDebounced);

    // Also attach ResizeObserver to documentElement for instant preview resizing
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && document.documentElement) {
      resizeObserver = new ResizeObserver(() => {
        handleResizeDebounced();
      });
      resizeObserver.observe(document.documentElement);
    }

    return () => {
      if (mediaQuery) {
        if (mediaQuery.removeEventListener) {
          mediaQuery.removeEventListener('change', handleResizeDebounced);
        } else if (mediaQuery.removeListener) {
          mediaQuery.removeListener(handleResizeDebounced);
        }
      }
      window.removeEventListener('resize', handleResizeDebounced);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }

  /**
   * Intelligent Aspect Ratio Mirror Tool
   * Maps X <-> Y coordinates, scales/fits tiles into target grid bounds, and resolves overlaps
   * @param {Array<object>} sourceWidgets
   * @param {{columns: number, rows: number}} sourceGrid
   * @param {{columns: number, rows: number}} targetGrid
   * @returns {Array<object>} Mirrored widgets with valid coordinates
   */
  mirrorLayout(sourceWidgets = [], sourceGrid = { columns: 20, rows: 44 }, targetGrid = { columns: 44, rows: 20 }) {
    const scaleX = targetGrid.columns / sourceGrid.columns;
    const scaleY = targetGrid.rows / sourceGrid.rows;

    const mirrored = sourceWidgets.map((w) => {
      const origCol = w.layout.col !== undefined ? w.layout.col : (w.layout.x !== undefined ? w.layout.x + 1 : 1);
      const origRow = w.layout.row !== undefined ? w.layout.row : (w.layout.y !== undefined ? w.layout.y + 1 : 1);
      const origW = w.layout.w || 8;
      const origH = w.layout.h || 4;

      const newW = Math.max(1, Math.min(targetGrid.columns, Math.round(origW * scaleX)));
      const newH = Math.max(1, Math.min(targetGrid.rows, Math.round(origH * scaleY) || origH));
      const newCol = Math.max(1, Math.min(targetGrid.columns - newW + 1, Math.round((origCol - 1) * scaleX) + 1));
      const newRow = Math.max(1, Math.round((origRow - 1) * scaleY) + 1);

      return {
        ...JSON.parse(JSON.stringify(w)),
        layout: {
          col: newCol,
          row: newRow,
          x: newCol - 1,
          y: newRow - 1,
          w: newW,
          h: newH
        }
      };
    });

    // Save previous gridCols and temporarily set to targetGrid.columns
    const prevCols = this.gridCols;
    this.gridCols = targetGrid.columns;

    // Resolve any overlap collisions and vertically compact
    let resolvedList = [];
    for (const item of mirrored) {
      resolvedList = this.resolveLayoutWithPushDown(item.id, item.layout, [...resolvedList, item]);
    }
    const finalCompacted = this.compactLayout(resolvedList);

    this.gridCols = prevCols;
    return finalCompacted;
  }

  /**
   * Evaluates if two rectangular widget bounding boxes collide
   * @param {{col: number, row: number, w: number, h: number}} boxA
   * @param {{col: number, row: number, w: number, h: number}} boxB
   * @returns {boolean}
   */
  static boxesIntersect(boxA, boxB) {
    if (!boxA || !boxB) return false;
    const aCol = boxA.col !== undefined ? boxA.col : (boxA.x !== undefined ? boxA.x + 1 : 1);
    const aRow = boxA.row !== undefined ? boxA.row : (boxA.y !== undefined ? boxA.y + 1 : 1);
    const aW = boxA.w || 1;
    const aH = boxA.h || 1;

    const bCol = boxB.col !== undefined ? boxB.col : (boxB.x !== undefined ? boxB.x + 1 : 1);
    const bRow = boxB.row !== undefined ? boxB.row : (boxB.y !== undefined ? boxB.y + 1 : 1);
    const bW = boxB.w || 1;
    const bH = boxB.h || 1;

    const aLeft = aCol;
    const aRight = aCol + aW;
    const aTop = aRow;
    const aBottom = aRow + aH;

    const bLeft = bCol;
    const bRight = bCol + bW;
    const bTop = bRow;
    const bBottom = bRow + bH;

    return !(aRight <= bLeft || aLeft >= bRight || aBottom <= bTop || aTop >= bBottom);
  }

  /**
   * Checks if candidate position collides with any other widget in the layout
   * @param {{col: number, row: number, w: number, h: number}} candidate
   * @param {string} ignoreWidgetId
   * @param {Array<object>} widgetList
   * @returns {boolean} True if collision detected
   */
  hasCollision(candidate, ignoreWidgetId, widgetList = []) {
    const col = candidate.col !== undefined ? candidate.col : (candidate.x !== undefined ? candidate.x + 1 : 1);
    const row = candidate.row !== undefined ? candidate.row : (candidate.y !== undefined ? candidate.y + 1 : 1);
    const w = candidate.w || 1;

    // Check boundary limits
    if (col < 1 || (col + w - 1) > this.gridCols || row < 1) {
      return true;
    }

    for (const item of widgetList) {
      if (item.id === ignoreWidgetId) continue;
      if (LayoutEngine.boxesIntersect(candidate, item.layout)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Normalizes a widget list's layout objects (fills in whichever of
   * col/row/x/y is missing from the other, defaults missing w/h) and sorts
   * top-to-bottom/left-to-right, WITHOUT moving anything vertically. This is
   * the part of the old always-on `compactLayout()` that's still needed on
   * every render/edit (old saved data may only have x/y or only col/row) —
   * split out so a widget's row can be normalized without also being pulled
   * up over an intentional gap the user left above it. See `compactLayout()`
   * for the opt-in version that actually closes gaps.
   * @param {Array<object>} widgetList
   * @returns {Array<object>}
   */
  normalizeLayout(widgetList = []) {
    const list = widgetList.map((w) => ({
      ...w,
      layout: {
        col: w.layout.col !== undefined ? w.layout.col : (w.layout.x !== undefined ? w.layout.x + 1 : 1),
        row: w.layout.row !== undefined ? w.layout.row : (w.layout.y !== undefined ? w.layout.y + 1 : 1),
        x: w.layout.x !== undefined ? w.layout.x : (w.layout.col !== undefined ? w.layout.col - 1 : 0),
        y: w.layout.y !== undefined ? w.layout.y : (w.layout.row !== undefined ? w.layout.row - 1 : 0),
        w: w.layout.w !== undefined ? w.layout.w : 5,
        h: w.layout.h !== undefined ? w.layout.h : 2
      }
    }));

    return list.sort((a, b) => {
      if (a.layout.row !== b.layout.row) return a.layout.row - b.layout.row;
      return a.layout.col - b.layout.col;
    });
  }

  /**
   * Compacts layout vertically so there are no empty phantom rows between
   * widgets. Only ever run on explicit user request (the edit toolbar's
   * "Compact" action) — normal render/add/remove/move paths use
   * `normalizeLayout()` instead, so a deliberately-left gap above a widget
   * survives every edit except this one.
   * @param {Array<object>} widgetList
   * @returns {Array<object>}
   */
  compactLayout(widgetList = []) {
    const sorted = this.normalizeLayout(widgetList);

    for (const item of sorted) {
      while (item.layout.row > 1) {
        const candidate = { ...item.layout, row: item.layout.row - 1, y: item.layout.row - 2 };
        let collides = false;
        for (const other of sorted) {
          if (other.id === item.id) continue;
          if (LayoutEngine.boxesIntersect(candidate, other.layout)) {
            collides = true;
            break;
          }
        }
        if (!collides) {
          item.layout.row = candidate.row;
          item.layout.y = candidate.y;
        } else {
          break;
        }
      }
    }

    return sorted;
  }

  /**
   * Moves a widget to targetLayout and shifts any colliding widgets downwards.
   * Strictly preserves custom widget dimensions (w, h).
   * @param {string} movingWidgetId
   * @param {{col: number, row: number, w: number, h: number}} targetLayout
   * @param {Array<object>} widgetList
   * @returns {Array<object>} Updated list of widgets with non-colliding layouts
   */
  resolveLayoutWithPushDown(movingWidgetId, targetLayout, widgetList = []) {
    const list = widgetList.map((w) => ({
      ...w,
      layout: {
        col: w.layout.col !== undefined ? w.layout.col : (w.layout.x !== undefined ? w.layout.x + 1 : 1),
        row: w.layout.row !== undefined ? w.layout.row : (w.layout.y !== undefined ? w.layout.y + 1 : 1),
        x: w.layout.x !== undefined ? w.layout.x : (w.layout.col !== undefined ? w.layout.col - 1 : 0),
        y: w.layout.y !== undefined ? w.layout.y : (w.layout.row !== undefined ? w.layout.row - 1 : 0),
        w: w.layout.w !== undefined ? w.layout.w : 5,
        h: w.layout.h !== undefined ? w.layout.h : 2
      }
    }));

    const moving = list.find((w) => w.id === movingWidgetId);
    if (!moving) return this.normalizeLayout(list);

    // Keep exact moving widget dimensions, only clamp col and row within the grid boundary
    const movingW = targetLayout.w !== undefined ? targetLayout.w : moving.layout.w;
    const movingH = targetLayout.h !== undefined ? targetLayout.h : moving.layout.h;
    const rawTargetCol = targetLayout.col !== undefined ? targetLayout.col : (targetLayout.x !== undefined ? targetLayout.x + 1 : 1);
    const rawTargetRow = targetLayout.row !== undefined ? targetLayout.row : (targetLayout.y !== undefined ? targetLayout.y + 1 : 1);
    const clampedCol = Math.min(Math.max(1, rawTargetCol), Math.max(1, this.gridCols - movingW + 1));
    const clampedRow = Math.max(1, rawTargetRow);

    moving.layout = {
      col: clampedCol,
      row: clampedRow,
      x: clampedCol - 1,
      y: clampedRow - 1,
      w: movingW,
      h: movingH
    };

    // Iteratively push down any intersecting widgets
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 40) {
      changed = false;
      iterations++;

      for (const other of list) {
        if (other.id === movingWidgetId) continue;
        if (LayoutEngine.boxesIntersect(moving.layout, other.layout)) {
          other.layout.row = moving.layout.row + moving.layout.h;
          other.layout.y = other.layout.row - 1;
          changed = true;
        }
      }

      // Re-check inter-widget collisions among non-moving widgets
      for (let i = 0; i < list.length; i++) {
        for (let j = 0; j < list.length; j++) {
          if (i === j) continue;
          const wA = list[i];
          const wB = list[j];
          if (LayoutEngine.boxesIntersect(wA.layout, wB.layout)) {
            if (wA.id === movingWidgetId) {
              wB.layout.row = wA.layout.row + wA.layout.h;
              wB.layout.y = wB.layout.row - 1;
            } else if (wB.id === movingWidgetId) {
              wA.layout.row = wB.layout.row + wB.layout.h;
              wA.layout.y = wA.layout.row - 1;
            } else {
              if (wA.layout.row <= wB.layout.row) {
                wB.layout.row = wA.layout.row + wA.layout.h;
                wB.layout.y = wB.layout.row - 1;
              } else {
                wA.layout.row = wB.layout.row + wB.layout.h;
                wA.layout.y = wA.layout.row - 1;
              }
            }
            changed = true;
          }
        }
      }
    }

    // Positions are final after push-down resolution — just normalize/sort,
    // don't pull any other widget up into a gap it wasn't dragged into.
    return this.normalizeLayout(list);
  }

  /**
   * Finds the next free coordinate slot that can accommodate a widget of size (w, h)
   * @param {number} w
   * @param {number} h
   * @param {Array<object>} widgetList
   * @returns {{col: number, row: number, x: number, y: number, w: number, h: number}}
   */
  findNextFreeSlot(w, h, widgetList = []) {
    const width = Math.min(Math.max(1, w), this.gridCols);
    const height = Math.max(1, h);

    // Normalize (not compact) so an existing gap the user left above a
    // widget still reads as free space a new widget can drop into, instead
    // of everything getting pulled up first.
    const normalized = this.normalizeLayout(widgetList);

    let row = 1;
    while (row < 200) {
      for (let col = 1; col <= this.gridCols - width + 1; col++) {
        const candidate = { col, row, x: col - 1, y: row - 1, w: width, h: height };
        if (!this.hasCollision(candidate, null, normalized)) {
          return candidate;
        }
      }
      row++;
    }

    return { col: 1, row: 1, x: 0, y: 0, w: width, h: height };
  }

  /**
   * Clamps layout coordinate within valid grid bounds
   * @param {{col?: number, row?: number, x?: number, y?: number, w?: number, h?: number}} layout
   * @returns {{col: number, row: number, x: number, y: number, w: number, h: number}}
   */
  clampToBounds(layout) {
    const w = Math.min(Math.max(1, layout.w || 1), this.gridCols);
    const h = Math.max(1, layout.h || 1);
    const rawCol = layout.col !== undefined ? layout.col : (layout.x !== undefined ? layout.x + 1 : 1);
    const rawRow = layout.row !== undefined ? layout.row : (layout.y !== undefined ? layout.y + 1 : 1);

    const col = Math.min(Math.max(1, rawCol), this.gridCols - w + 1);
    const row = Math.max(1, rawRow);

    return { col, row, x: col - 1, y: row - 1, w, h };
  }

  /**
   * Computes CSS Grid style rules for a widget instance
   * @param {{col: number, row: number, w: number, h: number}} layout
   * @returns {object}
   */
  computeGridStyles(layout) {
    const { col, row, w, h } = this.clampToBounds(layout);
    return {
      gridColumn: `${col} / span ${w}`,
      gridRow: `${row} / span ${h}`
    };
  }

  /**
   * Converts viewport client coordinates to grid cell indices (1-based),
   * dynamically evaluating computed row track heights to prevent offset distortion.
   * @param {number} clientX
   * @param {number} clientY
   * @param {HTMLElement|DOMRect} containerOrRect
   * @returns {{col: number, row: number}}
   */
  pixelToGridCell(clientX, clientY, containerOrRect) {
    let containerRect;
    let gridContainer = null;

    if (containerOrRect instanceof HTMLElement) {
      gridContainer = containerOrRect;
      containerRect = gridContainer.getBoundingClientRect();
    } else {
      containerRect = containerOrRect;
      gridContainer = document.querySelector('.fd-page-grid');
    }

    if (!containerRect) {
      return { col: 1, row: 1 };
    }

    const relX = Math.max(0, Math.min(containerRect.width, clientX - containerRect.left));
    const relY = Math.max(0, clientY - containerRect.top);

    // Calculate Column (1-based)
    const colWidth = (containerRect.width - (this.gridCols - 1) * this.gap) / this.gridCols;
    const col = Math.max(1, Math.min(this.gridCols, Math.floor(relX / (colWidth + this.gap)) + 1));

    // Calculate Row (1-based) using rendered computed tracks
    if (gridContainer) {
      try {
        const computedStyle = window.getComputedStyle(gridContainer);
        const rowTracksStr = computedStyle.gridTemplateRows || '';
        const rowTracks = rowTracksStr.split(/\s+/).filter(Boolean);

        if (rowTracks.length > 0) {
          let accumulatedY = 0;
          for (let r = 0; r < rowTracks.length; r++) {
            const trackPx = parseFloat(rowTracks[r]) || this.defaultRowHeight;
            const trackTop = accumulatedY;
            const trackBottom = trackTop + trackPx;

            if (relY <= trackBottom + this.gap / 2) {
              return { col, row: r + 1 };
            }
            accumulatedY = trackBottom + this.gap;
          }

          // If relY is beyond rendered tracks, estimate next rows
          const extraY = Math.max(0, relY - accumulatedY);
          const extraRows = Math.floor(extraY / (this.defaultRowHeight + this.gap));
          return { col, row: rowTracks.length + 1 + extraRows };
        }
      } catch (_) {}
    }

    // Default fallback
    const rowHeight = this.defaultRowHeight + this.gap;
    const row = Math.max(1, Math.floor(relY / rowHeight) + 1);

    return { col, row };
  }
}

