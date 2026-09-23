// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness } from './fixtures/appHarness.js';

let harness;
beforeEach(async () => { harness = await createAppHarness(); });
afterEach(() => harness.cleanup());

function createApp() {
  return new harness.FlightDeckApp();
}

describe('FlightDeckApp corner layout facade before extraction', () => {
  it('scales both corner layouts across mobile and tablet grids in both orientations', () => {
    const app = createApp();
    const cases = [
      ['portrait', 'mobile', 20, 3, 4, 5, 6, 15],
      ['landscape', 'mobile', 44, 3, 4, 5, 6, 39],
      ['portrait', 'tablet', 60, 9, 12, 15, 18, 43],
      ['landscape', 'tablet', 88, 6, 8, 10, 12, 77],
    ];

    for (const [orientation, tier, columns, menuVisible, menuTotal, profileVisible, profileTotal, profileCol] of cases) {
      app.isEditMode = true;
      app.activeProfile = { name: 'Test Profile' };
      const gridSpec = { columns, rows: 44, gap: 7 };
      const layouts = app.getCornerWidgetLayouts(orientation, tier, gridSpec);
      expect(layouts.menu).toEqual({
        id: '__corner_menu__', type: 'MenuToggleWidget',
        layout: { col: 1, row: 1, w: menuTotal, h: 2 },
        config: { removable: false, appEditMode: true, visibleCols: menuVisible, totalCols: menuTotal, gap: 7 },
      });
      expect(layouts.profile).toEqual({
        id: '__corner_profile__', type: 'AppProfileWidget',
        layout: { col: profileCol, row: 1, w: profileTotal, h: 2 },
        config: { removable: false, label: 'TEST PR', visibleCols: profileVisible, totalCols: profileTotal, gap: 7 },
      });
    }

    app.activeProfile = null;
    expect(app.getCornerWidgetLayouts('portrait', 'mobile', { columns: 20, gap: 3 }).profile.config.label).toBe('DEFAULT');
  });

  it('returns only the reserved id and layout pairs', () => {
    const app = createApp();
    const layoutSpy = vi.spyOn(app, 'getCornerWidgetLayouts');
    expect(app.getReservedCornerEntries('portrait', 'mobile', { columns: 20, gap: 3 })).toEqual([
      { id: '__corner_menu__', layout: { col: 1, row: 1, w: 4, h: 2 } },
      { id: '__corner_profile__', layout: { col: 15, row: 1, w: 6, h: 2 } },
    ]);
    expect(layoutSpy).toHaveBeenCalledWith('portrait', 'mobile', { columns: 20, gap: 3 });
  });

  it('pushes a real widget away from a reserved corner and strips reserved ids', () => {
    const app = createApp();
    const real = { id: 'radio', layout: { col: 1, row: 1, w: 4, h: 2 } };
    const reserved = app.getReservedCornerEntries('portrait', 'mobile', { columns: 20, gap: 3 });
    const result = app.resolveWithReservedCorners(real.id, real.layout, [real], reserved);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('radio');
    expect(result[0].layout).not.toEqual(real.layout);
    expect(result.some(({ id }) => id.startsWith('__corner_'))).toBe(false);
  });

  it('inserts list items in order before applying reserved-corner eviction', () => {
    const app = createApp();
    const items = [
      { id: 'first', layout: { col: 1, row: 1, w: 4, h: 2 } },
      { id: 'second', layout: { col: 1, row: 1, w: 4, h: 2 } },
    ];
    const reserved = app.getReservedCornerEntries('portrait', 'mobile', { columns: 20, gap: 3 });
    const result = app.resolveListWithReservedCorners(items, reserved);

    expect(result.map(({ id }) => id)).toEqual(['second', 'first']);
    expect(result.map(({ layout }) => layout)).toEqual([
      { col: 1, row: 3, x: 0, y: 2, w: 4, h: 2 },
      { col: 1, row: 5, x: 0, y: 4, w: 4, h: 2 },
    ]);
    expect(result.some(({ id }) => id.startsWith('__corner_'))).toBe(false);
  });

  it('rejects colliding drops when auto-reposition is disabled', () => {
    const app = createApp();
    app.autoRepositionEnabled = false;
    const widgets = [
      { id: 'moving', layout: { col: 10, row: 10, w: 2, h: 2 } },
      { id: 'obstacle', layout: { col: 1, row: 5, w: 2, h: 2 } },
    ];

    expect(app.resolveDropPlacement('moving', { col: 1, row: 5, w: 2, h: 2 }, widgets, { columns: 20, rows: 44 }, [])).toEqual({ ok: false });
  });

  it('uses LayoutEngine nudging for a free drop and passes reserved cells as obstacles', () => {
    const app = createApp();
    app.autoRepositionEnabled = true;
    const widget = { id: 'moving', layout: { col: 10, row: 10, w: 2, h: 2 } };
    const grid = { columns: 20, rows: 44 };
    const freeCandidate = { col: 8, row: 8, w: 2, h: 2 };
    const freeResult = app.layoutEngine.resolveSmartNudge('moving', freeCandidate, [widget], grid, []);
    expect(app.resolveDropPlacement('moving', freeCandidate, [widget], grid, [])).toEqual(freeResult);

    const reserved = [{ id: '__corner_menu__', layout: { col: 1, row: 1, w: 4, h: 2 } }];
    const nudge = vi.spyOn(app.layoutEngine, 'resolveSmartNudge');
    app.resolveDropPlacement('moving', { col: 2, row: 1, w: 2, h: 2 }, [widget], grid, reserved);
    expect(nudge).toHaveBeenLastCalledWith('moving', { col: 2, row: 1, w: 2, h: 2 }, [widget], grid, reserved);
  });
});
