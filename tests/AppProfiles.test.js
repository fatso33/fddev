// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness } from './fixtures/appHarness.js';
import { Profile } from '../js/models/Profile.js';
import { Page } from '../js/models/Page.js';

let harness;
let app;
beforeEach(async () => {
  harness = await createAppHarness();
  app = new harness.FlightDeckApp();
  app.storage.initFallback();
  app.activeProfile = await app.activateProfile(await app.storage.getProfile('default_ga'));
});
afterEach(() => harness.cleanup());

function track(target, method, events, label = method) {
  const original = target[method];
  return vi.spyOn(target, method).mockImplementation(function (...args) {
    events.push([label, ...args]);
    return original.apply(this, args);
  });
}

describe('FlightDeckApp profile coordination', () => {
  it('activates fresh profiles and hydrates only an available parent', async () => {
    const base = await app.storage.getProfile('default_ga');
    const raw = { id: 'fork', name: 'Fork', parentProfileId: 'default_ga', pages: [] };
    const result = await app.activateProfile(raw);
    expect(result).toBeInstanceOf(Profile);
    expect(result.pages.map((p) => p.id)).toEqual(base.pages.map((p) => p.id));
    expect(result.toJSON().pages).toEqual([]);
    const missing = await app.activateProfile({ ...raw, parentProfileId: 'missing' });
    expect(missing.pages).toEqual([]);
    expect(missing).not.toBe(result);
  });

  it('forks a default with exact raw fields and persists before switching UI', async () => {
    const events = [];
    const originalPage = app.activeProfile.getPage('page_radios');
    originalPage.name = 'Edited radios';
    for (const [target, method, label] of [
      [app.storage, 'saveProfile', 'save'], [app.storage, 'setActiveProfileId', 'set-active'],
      [app, 'activateProfile', 'activate'],
    ]) track(target, method, events, label);
    app.profileSelector = { refreshList: () => events.push(['selector']) };
    app.appProfileWidget = { setLabel: (label) => events.push(['badge', label]) };
    app.storage.memoryCache.set('other', { id: 'other', name: 'Custom' });
    app.storage.memoryCache.set('other2', { id: 'other2', name: 'Custom (2)' });
    await app.ensureEditableProfile();
    expect(events.map(([name]) => name)).toEqual(['save', 'set-active', 'activate', 'selector', 'badge']);
    expect(events[0][1]).toMatchObject({
      id: 'custom_default_ga', profileId: 'custom_default_ga', name: 'Custom (3)',
      aircraft: 'Custom (3)', parentProfileId: 'default_ga',
      description: 'Custom App Profile forked from Default',
      aircraftCategory: 'General Aviation', version: '2.5.0',
      pages: [{ id: 'page_radios', name: 'Edited radios' }],
    });
    expect(events[0][1].pages).toHaveLength(1);
    expect(events[1][1]).toBe('custom_default_ga');
    expect(events[4][1]).toBe('CUSTOM ');
    expect(app.activeProfile.hasOwnPage('page_radios')).toBe(true);
    originalPage.name = 'Changed after fork';
    expect(app.activeProfile.getPage('page_radios').name).toBe('Edited radios');
    expect((await app.storage.getProfile('default_ga')).name).toBe('Default');
  });

  it('reuses a saved fork and promotes an inherited page without another fork', async () => {
    await app.forkFromDefault();
    const fork = app.activeProfile;
    expect(fork.toJSON().pages).toEqual([]);
    expect(fork.hasOwnPage('page_radios')).toBe(false);
    await app.ensureEditableProfile();
    expect(app.activeProfile).toBe(fork);
    expect(fork.hasOwnPage('page_radios')).toBe(true);
    expect(fork.toJSON().pages).toHaveLength(1);
    app.activeProfile = await app.activateProfile(await app.storage.getProfile('default_ga'));
    const save = vi.spyOn(app.storage, 'saveProfile');
    await app.forkFromDefault(new Page({ id: 'page_lights', name: 'Changed lights' }));
    expect(app.activeProfile.name).toBe('Custom');
    expect(app.activeProfile.toJSON().pages.map((p) => p.id)).toEqual(['page_lights']);
    expect(save).toHaveBeenCalledTimes(1);
    app.activeProfile = new Profile({ id: 'standalone', name: 'Standalone', pages: [{ id: 'own', name: 'Own' }] });
    await app.ensureEditableProfile();
    expect(app.activeProfile.id).toBe('standalone');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('adds a named page with slug and suffix after a default fork, then navigates', async () => {
    const events = [];
    track(app.storage, 'saveProfile', events, 'save');
    track(app, 'forkFromDefault', events, 'fork');
    vi.spyOn(app, 'renderPageMenu').mockImplementation(() => events.push(['menu']));
    vi.spyOn(app, 'switchPage').mockImplementation((id) => events.push(['switch', id]));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    globalThis.prompt.mockReturnValueOnce(null).mockReturnValueOnce('  ').mockReturnValueOnce('  Nav & Com!  ');
    await app.handleAddCustomPage();
    await app.handleAddCustomPage();
    expect(events).toEqual([]);
    await app.handleAddCustomPage();
    const id = `page_custom_nav_com_${(0.5).toString(36).slice(2, 6)}`;
    expect(events.map(([name]) => name)).toEqual(['fork', 'save', 'save', 'menu', 'switch']);
    expect(events[4][1]).toBe(id);
    expect(app.activeProfile.getPage(id)).toMatchObject({ id, name: 'Nav & Com!', icon: 'grid' });
    expect(app.activeProfile.toJSON().pages.map((p) => p.id)).toEqual([id]);
  });

  it('filters custom pages and deletes only them with a no-render fallback', async () => {
    expect(app.getCustomPages()).toEqual([]);
    const events = [];
    track(app.storage, 'saveProfile', events, 'save');
    vi.spyOn(app, 'renderPageMenu').mockImplementation(() => events.push(['menu']));
    vi.spyOn(app, 'renderActivePage').mockImplementation(() => events.push(['render']));
    vi.spyOn(app, 'showToast').mockImplementation((message) => events.push(['toast', message]));
    await app.handleDeleteCustomPage('page_radios');
    expect(events).toEqual([]);
    app.activeProfile.addPage(new Page({ id: 'page_custom_one', name: 'One' }));
    expect(app.getCustomPages()).toEqual([{ id: 'page_custom_one', name: 'One' }]);
    app.activePageId = 'page_custom_one';
    await app.handleDeleteCustomPage('page_custom_one');
    expect(events.map(([name]) => name)).toEqual(['save', 'menu', 'toast']);
    expect(events[2][1]).toBe('Page deleted.');
    expect(app.activePageId).toBe('page_radios');
    expect(app.getCustomPages()).toEqual([]);
    app.activeProfile = null;
    expect(app.getCustomPages()).toEqual([]);
    await app.handleDeleteCustomPage('page_custom_one');
    expect(events).toHaveLength(3);
  });

  it('refuses invalid reverts, then removes one override before save and render', async () => {
    const events = [];
    vi.spyOn(app, 'showToast').mockImplementation((message) => events.push(['toast', message]));
    await app.handleRevertPageToDefault('page_radios');
    await app.forkFromDefault();
    await app.handleRevertPageToDefault('page_radios');
    expect(events).toEqual([
      ['toast', 'This page has no default version to revert to.'],
      ['toast', 'This page has no custom changes to revert.'],
    ]);
    app.activeProfile.promoteToOwnPage('page_radios');
    app.activeProfile.getPage('page_radios').name = 'Edited';
    app.activeProfile.promoteToOwnPage('page_lights');
    track(app.storage, 'getProfile', events, 'parent');
    track(app.storage, 'saveProfile', events, 'save');
    vi.spyOn(app, 'renderActivePage').mockImplementation(() => events.push(['render']));
    await app.handleRevertPageToDefault('page_radios');
    expect(events.slice(2).map(([name]) => name)).toEqual(['parent', 'save', 'render', 'toast']);
    expect(events.at(-1)[1]).toBe('Page reverted to default.');
    expect(app.activeProfile.getPage('page_radios').name).toBe('Radios');
    expect(app.activeProfile.toJSON().pages.map((p) => p.id)).toEqual(['page_lights']);
  });
});
