// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness } from './fixtures/appHarness.js';
import { WidgetRegistry } from '../js/widgets/WidgetRegistry.js';

let harness;
beforeEach(async () => { harness = await createAppHarness(); });
afterEach(() => { vi.useRealTimers(); harness.cleanup(); });

async function initializedApp() {
  const app = new harness.FlightDeckApp();
  await app.init();
  return app;
}

describe('FlightDeckApp corner overlay before extraction', () => {
  it('mounts and measures the overlay before indicators and widgets, retaining live status', () => {
    const app = new harness.FlightDeckApp();
    app.activeProfile = { name: 'Test Profile' };
    app.bridgeConnected = true;
    app.simConnected = false;
    app.isEditMode = true;
    const trace = [];
    vi.spyOn(app.layoutEngine, 'measureColumnWidth').mockImplementation((el) => {
      expect(el.parentElement).toBe(app.contentArea);
      trace.push('measure');
      return 23;
    });
    vi.spyOn(app.layoutEngine, 'applyGridToContainer').mockImplementation((el, spec) => {
      expect(el.parentElement).toBe(app.contentArea);
      expect(spec.rowHeight).toBe(23);
      trace.push('grid');
    });
    const create = vi.mocked(WidgetRegistry.createWidget).getMockImplementation();
    vi.spyOn(WidgetRegistry, 'createWidget').mockImplementation((config, bus) => {
      expect(app.cornerOverlayEl.children).toHaveLength(config.id === '__corner_menu__' ? 2 : 3);
      trace.push(config.id);
      return create(config, bus);
    });
    const status = vi.spyOn(app, 'updateMenuButtonStatus');
    const wire = vi.spyOn(app, 'wireCornerInteractions');
    app.mountCornerWidgets('portrait', 'mobile', { columns: 20, rows: 40, gap: 3 });
    expect(trace).toEqual(['measure', 'grid', '__corner_menu__', '__corner_profile__']);
    expect(app.contentArea.lastElementChild).toBe(app.cornerOverlayEl);
    expect(app.cornerOverlayEl.classList.contains('edit-mode-active')).toBe(true);
    expect([...app.cornerOverlayEl.children].map((el) => el.className)).toEqual([
      'fd-reserved-corner-indicator', 'fd-reserved-corner-indicator', '', '',
    ]);
    const [menu, profile] = app.cornerWidgetInstances.slice(-2);
    expect(menu).toBe(app.menuToggleWidget);
    expect(profile).toBe(app.appProfileWidget);
    expect([menu.element.style.pointerEvents, profile.element.style.pointerEvents]).toEqual(['auto', 'auto']);
    expect(menu.setConnectionStatus).toHaveBeenLastCalledWith({ bridgeConnected: true, simConnected: false });
    expect(status).toHaveBeenCalledOnce();
    expect(wire).toHaveBeenCalledOnce();
    expect(app.cornerOverlayEl.children[0].style.gridColumn).toBe('1 / span 4');
    expect(app.cornerOverlayEl.children[1].style.gridColumn).toBe('15 / span 6');
    expect(app.cornerOverlayEl.children[0].style.gridRow).toBe('1 / span 2');
  });

  it('opens the anchored menu, preserves it on document click, and uses toolbar only in edit mode', async () => {
    const app = await initializedApp();
    const button = app.menuToggleWidget.element;
    const dropdown = document.getElementById('menu-dropdown');
    button.getBoundingClientRect = () => ({ left: 42.6 });
    button.click();
    expect(dropdown.classList.contains('open')).toBe(true);
    expect(dropdown.style.left).toBe('43px');
    dropdown.style.left = '9px';
    button.click();
    expect(dropdown.classList.contains('open')).toBe(false);
    expect(dropdown.style.left).toBe('9px');
    button.click();
    expect(dropdown.classList.contains('open')).toBe(true);
    app.isEditMode = true;
    const toggle = vi.spyOn(app, 'toggleEditToolbarVisibility').mockImplementation(() => {});
    button.click();
    expect(toggle).toHaveBeenCalledOnce();
    expect(dropdown.classList.contains('open')).toBe(true);
    app.isEditMode = false;
    app.activePageId = 'page_settings';
    button.click();
    expect(document.getElementById('menu-edit-mode-btn').style.display).toBe('none');
  });

  it('opens the profile selector after 500 ms, but cancels on early release or movement over 8 px', async () => {
    const app = await initializedApp();
    const badge = app.appProfileWidget.element;
    const open = vi.spyOn(app.profileSelector, 'open').mockImplementation(() => {});
    vi.useFakeTimers();
    const down = () => badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    down();
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(500);
    expect(open).not.toHaveBeenCalled();
    down();
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 19, clientY: 10 }));
    vi.advanceTimersByTime(500);
    expect(open).not.toHaveBeenCalled();
    down();
    vi.advanceTimersByTime(499);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledOnce();
  });

  it('destroys old corners and clears all four fields before clearing content on every render branch', async () => {
    const app = await initializedApp();
    const branches = ['page_settings', 'page_yoke', 'page_radios', 'page_unknown'];
    for (const branch of branches) {
      if (branch === 'page_unknown') app.activeProfile = { name: 'Empty', getPage: () => null, pages: [] };
      app.activePageId = branch;
      const old = [...app.cornerWidgetInstances];
      const original = app.mountCornerWidgets;
      const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
      let cleared = false;
      Object.defineProperty(app.contentArea, 'innerHTML', {
        configurable: true,
        get() { return innerHTML.get.call(this); },
        set(value) {
          if (value === '') {
            cleared = true;
            for (const widget of old) expect(widget.destroy).toHaveBeenCalledOnce();
            expect(app.cornerWidgetInstances).toEqual([]);
            expect([app.menuToggleWidget, app.appProfileWidget, app.cornerOverlayEl]).toEqual([null, null, null]);
          }
          innerHTML.set.call(this, value);
        },
      });
      vi.spyOn(app, 'mountCornerWidgets').mockImplementation(function (...args) {
        for (const widget of old) expect(widget.destroy).toHaveBeenCalledOnce();
        expect(this.cornerWidgetInstances).toEqual([]);
        expect([this.menuToggleWidget, this.appProfileWidget, this.cornerOverlayEl]).toEqual([null, null, null]);
        expect(this.contentArea.children).toHaveLength(0);
        return original.apply(this, args);
      });
      app.renderActivePage();
      vi.mocked(app.mountCornerWidgets).mockRestore();
      Reflect.deleteProperty(app.contentArea, 'innerHTML');
      expect(cleared).toBe(true);
      expect(app.contentArea.firstElementChild).toBe(app.cornerOverlayEl);
    }
  });
});
