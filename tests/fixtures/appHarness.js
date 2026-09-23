/**
 * @module appHarness
 * Loads the real app shell in jsdom while recording external browser and widget
 * boundaries. Each test owns the returned cleanup function and local storage.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { BaseWidget } from '../../js/widgets/BaseWidget.js';
import { WidgetRegistry } from '../../js/widgets/WidgetRegistry.js';
import { LayoutEngine } from '../../js/core/LayoutEngine.js';
import { VirtualYokeEngine } from '../../js/core/VirtualYokeEngine.js';
import { SettingsView } from '../../js/ui/SettingsView.js';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

/**
 * Installs isolated DOM and browser substitutes, then imports the unchanged app.
 * Returns the class, recorded widgets/frames/network attempts, and cleanup.
 * No socket connects, fetches escape, IndexedDB opens, or user storage is used.
 */
export async function createAppHarness() {
  const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const heightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const orientationDescriptor = Object.getOwnPropertyDescriptor(window.screen, 'orientation');
  const timers = new Set();
  const globalListeners = [];
  const nativeSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    const timer = nativeSetTimeout(callback, delay, ...args);
    timers.add(timer);
    return timer;
  });
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type, callback, options) => {
      globalListeners.push([target, type, callback, options]);
      return add(type, callback, options);
    });
  }
  localStorage.clear();
  window.flightDeck = undefined;
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const frames = new Map();
  const sockets = [];
  const fetches = [];
  const widgets = [];
  let nextFrame = 1;
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      sockets.push(this);
    }
    send() {}
    close() { this.readyState = 3; }
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    fetches.push(String(url));
    return { ok: true, json: async () => ({ primaryIp: '127.0.0.1', port: 8080, addresses: [] }), text: async () => '' };
  }));
  vi.stubGlobal('prompt', vi.fn(() => null));
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { lock: vi.fn(async () => {}), unlock: vi.fn() } });
  vi.spyOn(BaseWidget, 'preloadStyles').mockResolvedValue();
  vi.spyOn(LayoutEngine.prototype, 'initOrientationWatcher').mockImplementation(() => vi.fn());
  vi.spyOn(VirtualYokeEngine.prototype, 'start').mockImplementation(() => {});
  vi.spyOn(VirtualYokeEngine.prototype, 'stop').mockImplementation(() => {});
  const settingsMount = vi.spyOn(SettingsView.prototype, 'mount');
  vi.spyOn(SettingsView.prototype, 'render').mockImplementation(function () {
    this.container.textContent = 'Settings';
  });
  vi.spyOn(WidgetRegistry, 'createWidget').mockImplementation((config) => {
    const widget = {
      id: config.id,
      layout: config.layout,
      element: document.createElement('div'),
      mount: vi.fn((parent) => parent.appendChild(widget.element)),
      destroy: vi.fn(() => widget.element.remove()),
      setEditMode: vi.fn(),
      applyLayoutStyles: vi.fn(),
      updateConfig: vi.fn(),
      setConnectionStatus: vi.fn(),
      setAppEditMode: vi.fn(),
      setLabel: vi.fn(),
    };
    widget.element.dataset.widgetId = widget.id;
    widgets.push(widget);
    return widget;
  });
  // app.js registers an import-time bootstrap. A sentinel suppresses it while
  // the test obtains the public class without changing production source.
  const sentinel = {};
  window.flightDeck = sentinel;
  const exports = await import('../../js/app.js');
  return {
    FlightDeckApp: exports.FlightDeckApp,
    exportNames: Object.keys(exports),
    sentinel,
    sockets,
    fetches,
    frames,
    widgets,
    settingsMount,
    cleanup() {
      for (const timer of timers) clearTimeout(timer);
      for (const [target, type, callback, options] of globalListeners) target.removeEventListener(type, callback, options);
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      frames.clear();
      localStorage.clear();
      document.body.innerHTML = '';
      Object.defineProperty(window, 'innerWidth', widthDescriptor);
      Object.defineProperty(window, 'innerHeight', heightDescriptor);
      if (orientationDescriptor) Object.defineProperty(window.screen, 'orientation', orientationDescriptor);
      else Reflect.deleteProperty(window.screen, 'orientation');
      window.flightDeck = undefined;
    },
  };
}
