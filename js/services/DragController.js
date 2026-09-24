/**
 * @module DragController
 * Owns edit-mode widget drag, drop and long-press gestures, plus the generic
 * long-press binder used by the App Profile badge. State storage stays on the
 * live app: drag reads isEditMode, activeProfile, activePageId,
 * currentOrientation, currentDeviceTier, gridContainer, layoutEngine,
 * autoRepositionEnabled, propertyInspector and activeWidgetInstances at event
 * time, and is the sole writer of draggedWidget, dragStartLayout and
 * dragStartPointer. At drag start it sets layoutEngine.gridCols and
 * defaultRowHeight to the rendered grid. It calls the app's
 * getReservedCornerEntries, resolveDropPlacement, saveHistorySnapshot and
 * showToast facades. A drop commit writes the active page and mounted
 * instance layouts in memory only; explicit save persists it.
 *
 * Resources: each attached element keeps one pointerdown listener for its
 * lifetime. Each gesture owns three capture-phase window listeners, pointer
 * capture, at most one queued animation frame, a 500 ms long-press timer, a
 * 1000 ms nudge-preview timer, and drop-ghost/nudge-preview DOM. pointerup and
 * pointercancel share one cleanup-and-drop path that releases all of them, so a
 * moved gesture ending in pointercancel still resolves a drop at that position.
 * A fired long press clears the drag visuals first and its release commits nothing.
 */

import { LayoutEngine } from '../core/LayoutEngine.js';

/**
 * Binds a long press (500 ms, cancelled by pointer movement over 8 px or an
 * early release) to an element, so a stray tap does not open its target.
 * Every press adds three capture-phase window listeners, removed when the
 * press fires, moves too far, ends or is cancelled. Vibrates for 40 ms first
 * where supported; vibration errors are ignored.
 * @param {HTMLElement} el - Element receiving the pointerdown listener.
 * @param {() => void} onLongPress - Called once per completed long press; its errors propagate
 *   from the timer callback.
 * @returns {void}
 */
export function attachLongPressOpen(el, onLongPress) {
  const LONG_PRESS_MS = 500;
  const MOVE_TOLERANCE = 8;
  let timer = null;
  let startX = 0;
  let startY = 0;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    window.removeEventListener('pointermove', onMove, { capture: true });
    window.removeEventListener('pointerup', onUp, { capture: true });
    window.removeEventListener('pointercancel', onUp, { capture: true });
  };

  const onMove = (moveEvent) => {
    const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
    if (dist > MOVE_TOLERANCE) clear();
  };

  const onUp = () => clear();

  el.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    timer = setTimeout(() => {
      clear();
      if (navigator.vibrate) {
        try {
          navigator.vibrate(40);
        } catch (_) {}
      }
      onLongPress();
    }, LONG_PRESS_MS);

    window.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onUp, { capture: true });
  });
}

/**
 * Attaches the edit-mode drag gesture to a mounted widget element. Outside
 * edit mode, or on the widget's edit/delete buttons, pointerdown is ignored.
 * A steady 500 ms hold opens the property inspector for the current
 * orientation and tier instead of dragging. Otherwise a release after more
 * than 8 px of movement resolves the pointer's grid cell as the widget's new
 * top-left, keeping its width and height. With an active page, a refused
 * placement shows a toast and leaves the layout unchanged; an accepted one
 * snapshots history once, writes the page's current tier/orientation widgets,
 * and updates instance layouts without re-rendering. No-op when the instance
 * has no element.
 * @param {import('../app.js').FlightDeckApp} app - Live app state and facades.
 * @param {object} widgetInstance - Mounted widget with id, layout, element and
 *   applyLayoutStyles(); its layout is replaced only on an accepted drop.
 * @returns {void} Collaborator errors propagate from the event callbacks.
 */
export function attachDragHandlers(app, widgetInstance) {
  const el = widgetInstance.element;
  if (!el) return;

  el.addEventListener('pointerdown', (e) => {
    if (!app.isEditMode) return;
    if (e.target.closest('.widget-edit-btn') || e.target.closest('.widget-delete-btn')) return;

    // Prevent native touch gestures (like scroll/pull-to-refresh) from canceling drag
    if (e.cancelable) e.preventDefault();

    let longPressTimer = null;
    let longPressFired = false;
    let isMoved = false;

    const startX = e.clientX;
    const startY = e.clientY;

    app.draggedWidget = widgetInstance;
    app.dragStartLayout = { ...widgetInstance.layout };
    app.dragStartPointer = { x: e.clientX, y: e.clientY };

    // Page/gridSpec/reserved-corners don't change mid-drag (a single drag
    // gesture never spans a page switch or orientation change) -- computed
    // once here and reused by both the live nudge preview below and the
    // actual drop commit in endDrag(), instead of recomputing per call.
    const dragPage = app.activeProfile.getPage(app.activePageId);
    const dragGridSpec = {
      ...(dragPage
        ? dragPage.getGrid(app.currentOrientation, app.currentDeviceTier) ||
          LayoutEngine.getGridSpec(app.currentOrientation, app.currentDeviceTier)
        : LayoutEngine.getGridSpec(app.currentOrientation, app.currentDeviceTier)),
    };
    // Keep drag/nudge pixel math (pixelToGridCell's fallback path)
    // consistent with what's actually rendered (square-cell live row
    // height), not the tier's static default -- set explicitly rather
    // than relying on the last renderActivePage() call having left it
    // correct, matching the existing gridCols assignment below.
    const dragLiveColWidth = app.layoutEngine.measureColumnWidth(app.gridContainer, dragGridSpec);
    if (dragLiveColWidth) {
      dragGridSpec.rowHeight = dragLiveColWidth;
      app.layoutEngine.defaultRowHeight = dragLiveColWidth;
    }
    if (dragGridSpec?.columns) {
      app.layoutEngine.gridCols = dragGridSpec.columns;
    }
    const dragReserved = app.getReservedCornerEntries(
      app.currentOrientation,
      app.currentDeviceTier,
      dragGridSpec,
    );

    // Long press detection timer (500ms threshold)
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      if (el.classList.contains('is-dragging')) {
        el.classList.remove('is-dragging');
      }
      el.style.transform = '';

      const existingGhost = app.gridContainer.querySelector('.fd-drop-ghost');
      if (existingGhost) existingGhost.remove();
      clearNudgePreview();

      app.draggedWidget = null;

      // Trigger subtle tactile haptic if supported
      if (navigator.vibrate) {
        try {
          navigator.vibrate(40);
        } catch (_) {}
      }

      // Open widget inspector popup for the current orientation layout
      app.propertyInspector.inspect(widgetInstance, app.currentOrientation, app.currentDeviceTier);
    }, 500);

    el.classList.add('is-dragging');

    try {
      el.setPointerCapture(e.pointerId);
    } catch (_) {
      // Pointer capture is best effort; window listeners still track the gesture.
    }

    // Create live drop preview ghost
    let dropGhost = app.gridContainer.querySelector('.fd-drop-ghost');
    if (!dropGhost) {
      dropGhost = document.createElement('div');
      dropGhost.className = 'fd-drop-ghost';
      app.gridContainer.appendChild(dropGhost);
    }
    dropGhost.style.gridColumn = `${app.dragStartLayout.col} / span ${app.dragStartLayout.w}`;
    dropGhost.style.gridRow = `${app.dragStartLayout.row} / span ${app.dragStartLayout.h}`;
    dropGhost.style.display = 'block';

    // Preview of what a drop would do to the widget(s) it currently
    // overlaps -- LayoutEngine.resolveSmartNudge() run speculatively
    // (never persisted) once the candidate cell has been held steady for
    // 1s, so idle dragging-around doesn't constantly recompute/redraw
    // this. Only showing is gated behind the delay; clearing (once the
    // candidate cell changes, or the drag ends) is instant. All state is
    // local to this drag gesture, same as dropGhost/rafId.
    let nudgePreviewTimer = null;
    let nudgePreviewKey = null;
    let nudgePreviewEls = [];

    const clearNudgePreview = () => {
      if (nudgePreviewTimer) {
        clearTimeout(nudgePreviewTimer);
        nudgePreviewTimer = null;
      }
      for (const ghostEl of nudgePreviewEls) ghostEl.remove();
      nudgePreviewEls = [];
      if (dropGhost) dropGhost.classList.remove('is-blocked');
    };

    const showNudgePreview = (candidate) => {
      const currentWidgets = dragPage
        ? dragPage.getWidgets(app.currentOrientation, app.currentDeviceTier)
        : [];
      const result = app.resolveDropPlacement(
        widgetInstance.id,
        candidate,
        currentWidgets,
        dragGridSpec,
        dragReserved,
      );

      if (!result.ok) {
        if (dropGhost) dropGhost.classList.add('is-blocked');
        return;
      }

      for (const w of result.widgets) {
        if (w.id === widgetInstance.id) continue;
        const original = currentWidgets.find((ow) => ow.id === w.id);
        if (
          !original ||
          (original.layout.col === w.layout.col && original.layout.row === w.layout.row)
        )
          continue;
        const ghostEl = document.createElement('div');
        ghostEl.className = 'fd-nudge-preview';
        ghostEl.style.gridColumn = `${w.layout.col} / span ${w.layout.w}`;
        ghostEl.style.gridRow = `${w.layout.row} / span ${w.layout.h}`;
        app.gridContainer.appendChild(ghostEl);
        nudgePreviewEls.push(ghostEl);
      }
    };

    let rafId = null;
    let lastClientX = e.clientX;
    let lastClientY = e.clientY;

    const updateDragVisuals = () => {
      if (!app.draggedWidget || longPressFired) return;
      const dx = lastClientX - app.dragStartPointer.x;
      const dy = lastClientY - app.dragStartPointer.y;
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;

      // Update live drop ghost coordinates
      const targetCell = app.layoutEngine.pixelToGridCell(
        lastClientX,
        lastClientY,
        app.gridContainer,
      );
      const maxCol =
        app.layoutEngine.gridCols ||
        LayoutEngine.getGridSpec(app.currentOrientation, app.currentDeviceTier).columns;
      const clampedCol = Math.max(1, Math.min(maxCol - app.dragStartLayout.w + 1, targetCell.col));
      const clampedRow = Math.max(1, targetCell.row);

      if (dropGhost) {
        dropGhost.style.gridColumn = `${clampedCol} / span ${app.dragStartLayout.w}`;
        dropGhost.style.gridRow = `${clampedRow} / span ${app.dragStartLayout.h}`;
      }

      const candidate = {
        col: clampedCol,
        row: clampedRow,
        w: app.dragStartLayout.w,
        h: app.dragStartLayout.h,
      };
      const key = `${clampedCol}:${clampedRow}`;
      if (key !== nudgePreviewKey) {
        nudgePreviewKey = key;
        clearNudgePreview();
        const currentWidgets = dragPage
          ? dragPage.getWidgets(app.currentOrientation, app.currentDeviceTier)
          : [];
        const overlapsSomething = app.layoutEngine.hasCollision(candidate, widgetInstance.id, [
          ...currentWidgets,
          ...dragReserved,
        ]);
        if (overlapsSomething) {
          nudgePreviewTimer = setTimeout(() => showNudgePreview(candidate), 1000);
        }
      }

      rafId = null;
    };

    const onPointerMove = (moveEvent) => {
      if (longPressFired) return;
      const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (dist > 8) {
        isMoved = true;
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }

      if (!app.draggedWidget) return;
      if (moveEvent.cancelable) moveEvent.preventDefault();
      lastClientX = moveEvent.clientX;
      lastClientY = moveEvent.clientY;

      if (!rafId) {
        rafId = requestAnimationFrame(updateDragVisuals);
      }
    };

    const endDrag = (upEvent) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', endDrag, { capture: true });
      window.removeEventListener('pointercancel', endDrag, { capture: true });

      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      try {
        if (el.hasPointerCapture?.(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
      } catch (_) {
        // Capture may already be gone with a removed or detached element.
      }

      el.classList.remove('is-dragging');
      el.style.transform = '';

      if (dropGhost) {
        dropGhost.remove();
      }
      clearNudgePreview();

      if (longPressFired) {
        app.draggedWidget = null;
        return;
      }

      if (app.draggedWidget && isMoved) {
        const finalX = upEvent ? upEvent.clientX : lastClientX;
        const finalY = upEvent ? upEvent.clientY : lastClientY;

        const targetCell = app.layoutEngine.pixelToGridCell(finalX, finalY, app.gridContainer);

        // Strictly preserve exact widget width and height during drag
        const candidate = {
          col: targetCell.col,
          row: targetCell.row,
          w: app.dragStartLayout.w,
          h: app.dragStartLayout.h,
        };

        if (dragPage) {
          // Auto-Reposition on: nudges each overlapped widget out of the
          // way (LayoutEngine.resolveSmartNudge()), or rejects the whole
          // drop if any of them has nowhere valid to go. Off: any overlap
          // at all is rejected outright. Either way, a reserved corner
          // cell can never be the drop target -- see resolveDropPlacement().
          const currentWidgets = dragPage.getWidgets(app.currentOrientation, app.currentDeviceTier);
          const result = app.resolveDropPlacement(
            widgetInstance.id,
            candidate,
            currentWidgets,
            dragGridSpec,
            dragReserved,
          );

          if (!result.ok) {
            app.showToast(
              app.autoRepositionEnabled
                ? "Can't place there -- no room to move the widget in the way."
                : 'Auto-Reposition is off -- that spot is occupied.',
            );
            // No commit: the dragged widget's own layout was never
            // mutated during drag (only a CSS transform, already cleared
            // above), so it's already back at its original position.
          } else {
            app.saveHistorySnapshot();
            dragPage.setWidgets(app.currentOrientation, app.currentDeviceTier, result.widgets);

            // Sync all DOM widget positions
            for (const inst of app.activeWidgetInstances) {
              const matching = result.widgets.find((w) => w.id === inst.id);
              if (matching) {
                inst.layout = { ...matching.layout };
                inst.applyLayoutStyles();
              }
            }
          }
        }
      }

      app.draggedWidget = null;
    };

    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', endDrag, { capture: true });
    window.addEventListener('pointercancel', endDrag, { capture: true });
  });
}
