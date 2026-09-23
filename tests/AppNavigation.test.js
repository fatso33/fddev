// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness } from './fixtures/appHarness.js';
import { Page } from '../js/models/Page.js';

let harness;
beforeEach(async () => { harness = await createAppHarness(); });
afterEach(() => harness.cleanup());

async function initializedApp() {
  const app = new harness.FlightDeckApp();
  await app.init();
  return app;
}

describe('FlightDeckApp navigation', () => {
  it('rebuilds custom page entries before Customize Dashboard and escapes their names', async () => {
    const app = await initializedApp();
    app.activeProfile.pages.push(
      new Page({ id: 'page_custom_first_0001', name: 'First custom page' }),
      new Page({ id: 'page_custom_hostile_0002', name: '<img src=x onerror=alert(1)>' }),
    );
    app.renderPageMenu();
    const entries = [...document.querySelectorAll('#menu-dropdown [data-custom-page]')];
    expect(entries.map((entry) => entry.dataset.customPage)).toEqual([
      'page_custom_first_0001', 'page_custom_hostile_0002',
    ]);
    expect(entries[1].querySelector('img')).toBeNull();
    expect(entries[1].textContent).toContain('<img src=x onerror=alert(1)>');
    expect(entries.at(-1).nextElementSibling.id).toBe('menu-edit-mode-btn');

    app.activeProfile.pages.splice(-2);
    app.activeProfile.pages.push({ id: 'page_custom_replacement_0003', name: 'Replacement' });
    app.renderPageMenu();
    expect(document.querySelectorAll('#menu-dropdown [data-custom-page]')).toHaveLength(1);
    expect(document.querySelector('[data-custom-page]').dataset.customPage).toBe('page_custom_replacement_0003');
  });

  it('uses Settings then the divider as insertion fallbacks and navigates/closes on custom click', async () => {
    const app = await initializedApp();
    app.activeProfile.pages.push(new Page({ id: 'page_custom_one_0001', name: 'Custom' }));
    const editButton = document.getElementById('menu-edit-mode-btn');
    const menu = document.getElementById('menu-dropdown');
    editButton.remove();
    app.renderPageMenu();
    const custom = menu.querySelector('[data-custom-page]');
    expect(custom.nextElementSibling.dataset.page).toBe('settings');

    const switchPage = vi.spyOn(app, 'switchPage');
    menu.classList.add('open');
    custom.click();
    expect(switchPage).toHaveBeenCalledWith('page_custom_one_0001');
    expect(menu.classList.contains('open')).toBe(false);

    custom.remove();
    const settings = menu.querySelector('[data-page="settings"]');
    settings.remove();
    app.renderPageMenu();
    expect(menu.querySelector('[data-custom-page]').nextElementSibling.className).toContain('menu-divider');
  });

  it('refreshes page management only on Settings and is a no-op without its menu or profile', async () => {
    const app = await initializedApp();
    app.activeProfile.pages.push(new Page({ id: 'page_custom_one_0001', name: 'Custom' }));
    const refresh = vi.spyOn(app.settingsView, 'refreshPagesList');
    app.activePageId = 'page_radios';
    app.renderPageMenu();
    expect(refresh).not.toHaveBeenCalled();
    app.activePageId = 'page_settings';
    app.renderPageMenu();
    expect(refresh).toHaveBeenCalledOnce();

    const defaults = vi.spyOn(app.storage, 'getDefaultProfiles');
    app.activeProfile = null;
    app.renderPageMenu();
    expect(defaults).not.toHaveBeenCalled();
    document.getElementById('menu-dropdown').remove();
    app.activeProfile = { pages: [] };
    app.renderPageMenu();
    expect(defaults).not.toHaveBeenCalled();
  });
});
