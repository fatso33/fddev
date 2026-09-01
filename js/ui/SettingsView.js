/**
 * SettingsView.js
 * Static Avionics System Configuration, PC Bridge Network Manager & Asset Persistence Sync
 */

import { loadImportedPacks, removePack, parsePackFile, importPack, buildPackFromCustomEvents } from '../core/deckEventPacks.js';
import { extractCustomDeckEvents } from '../core/widgetVarExtractor.js';
import { DECK_EVENT_NAMES } from '../core/deckEvents.js';
import { VirtualYokeEngine } from '../core/VirtualYokeEngine.js';
import { SecurityValidator } from '../core/SecurityValidator.js';

export class SettingsView {
  constructor({ eventBus, simBridge, virtualYoke, pwaInstall, onAddPage, onDeletePage, getCustomPages }) {
    this.eventBus = eventBus;
    this.simBridge = simBridge;
    this.virtualYoke = virtualYoke;
    this.pwaInstall = pwaInstall;
    this.onAddPage = onAddPage;
    this.onDeletePage = onDeletePage;
    this.getCustomPages = getCustomPages || (() => []);
    this.container = null;
    this.networkInfo = null;
    this.unsubscribeStatus = null;
    this.unsubscribeSync = null;
  }

  /**
   * Mounts the Settings View into the specified container element
   * @param {HTMLElement} parentEl
   */
  async mount(parentEl) {
    this.destroy();

    this.container = document.createElement('div');
    this.container.className = 'fd-settings-view';
    this.container.id = 'fd-settings-page';
    parentEl.appendChild(this.container);

    // Initial render
    this.render();

    // Fetch live backend bridge network info
    await this.fetchNetworkInfo();

    // Subscribe to live bridge status updates
    this.unsubscribeStatus = this.eventBus.subscribe('BRIDGE_STATUS', (status) => {
      this.updateConnectionStatus(status);
    });

    // Subscribe to live sync updates
    this.unsubscribeSync = this.eventBus.subscribe('USER_PRESETS_SYNCED', (data) => {
      this.updateSyncDisplay(data);
    });
  }

  /**
   * Fetches local LAN IP and network interfaces from server
   */
  async fetchNetworkInfo() {
    try {
      // The bridge is a separate process/port from whatever serves this page
      // (see SimBridge.getResolvedUrl) — fetch from its resolved HTTP origin,
      // not the page's own origin, or this always 404s off-PC.
      const wsUrl = this.simBridge ? this.simBridge.getResolvedUrl() : null;
      // wss:// now a real possibility (PC Bridge serves TLS — see
      // certManager.js) — a bare /^ws/ replace turns "wss://" into the
      // invalid "httpss://" (only the "ws" prefix matches, "s" is left
      // behind), so the scheme's trailing "s" has to be preserved/dropped
      // explicitly rather than assumed away.
      const httpOrigin = wsUrl ? wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:') : '';
      const res = await fetch(`${httpOrigin}/api/bridge-info`);
      if (res.ok) {
        this.networkInfo = await res.json();
        this.updateNetworkDisplay();
      }
    } catch (err) {
      console.warn('[SettingsView] Could not fetch network info:', err);
    }
  }

  /**
   * Renders the Settings UI
   */
  async render() {
    const isConnected = this.simBridge ? this.simBridge.connected : false;
    const currentWsUrl = this.simBridge ? this.simBridge.getResolvedUrl() : 'ws://localhost:3000';
    const currentHost = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
    const currentHostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const currentPort = typeof window !== 'undefined' ? (window.location.port || '3000') : '3000';
    const customUrl = typeof localStorage !== 'undefined' ? (localStorage.getItem('flightdeck_bridge_custom_url') || '') : '';

    let nonDefaultProfilesCount = 0;
    let nonDefaultWidgetsCount = 0;
    if (this.simBridge && this.simBridge.storageManager) {
      try {
        const pList = await this.simBridge.storageManager.getNonDefaultProfiles();
        const wList = await this.simBridge.storageManager.getNonDefaultWidgets();
        nonDefaultProfilesCount = pList.length;
        nonDefaultWidgetsCount = wList.length;
      } catch (_) {}
    }

    const lastSyncTimeStr = this.simBridge?.lastSyncTime
      ? new Date(this.simBridge.lastSyncTime).toLocaleTimeString()
      : 'On Connection';

    this.container.innerHTML = `
      <div class="settings-header" id="settings-view-header">
        <div class="settings-eyebrow">SYSTEM CONFIGURATION</div>
        <h1 class="settings-title">Settings</h1>
      </div>

      <!-- Install App Card (hidden entirely once already installed) -->
      <div id="settings-install-card-slot">${this.renderInstallCardHTML()}</div>

      <!-- Manage Pages Card -->
      <section class="settings-card" id="settings-pages-card">
        <div class="settings-card-header">
          <div class="settings-card-header-left">
            <div class="settings-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>
              </svg>
            </div>
            <div>
              <h2 class="settings-card-title">Manage Pages</h2>
              <p class="settings-card-desc">Add or remove custom pages from the navigation menu</p>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-label">Custom Pages</div>
          <div id="settings-pages-list" style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
            ${this.renderPagesListHTML()}
          </div>
        </div>

        <div class="settings-section">
          <button id="btn-add-page" class="btn-primary" style="display: inline-flex; align-items: center; gap: 8px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14"/><path d="M5 12h14"/>
            </svg>
            <span>Add Page</span>
          </button>
        </div>
      </section>

      <!-- PC Bridge Connection Card -->
      <section class="settings-card" id="settings-pc-bridge-card">
        <div class="settings-card-header">
          <div class="settings-card-header-left">
            <div class="settings-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                <line x1="12" y1="20" x2="12.01" y2="20"></line>
              </svg>
            </div>
            <div>
              <h2 class="settings-card-title">PC Bridge Connection</h2>
              <p class="settings-card-desc">WebSocket link for SimConnect telemetry & cockpit events</p>
            </div>
          </div>

          <div id="settings-status-pill" class="settings-status-badge ${isConnected ? 'connected' : 'disconnected'}">
            <span class="status-dot"></span>
            <span id="settings-status-text">${isConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
          </div>
        </div>

        <!-- Primary IP Address Display -->
        <div class="settings-section">
          <div class="settings-label">PC Bridge IP Address / Host</div>
          <div class="settings-ip-display-box" id="settings-ip-box">
            <div class="settings-ip-main">
              <span class="settings-ip-value" id="settings-primary-ip-text">${currentHostname}</span>
              <span class="settings-ip-port" id="settings-port-text">:${currentPort}</span>
            </div>
            <button id="btn-copy-ip" class="settings-btn-icon" title="Copy IP Address" aria-label="Copy IP Address">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span id="copy-btn-label">Copy IP</span>
            </button>
          </div>
          <p class="settings-hint">Enter this IP address on your tablet or mobile browser to connect directly over local Wi-Fi.</p>
        </div>

        <!-- Full WebSocket Endpoint -->
        <div class="settings-section">
          <div class="settings-label">Active Connection Endpoint</div>
          <div class="settings-endpoint-box">
            <code class="settings-endpoint-code" id="settings-ws-endpoint-text">${currentWsUrl}</code>
            <button id="btn-test-reconnect" class="settings-btn-secondary" title="Test & Reconnect">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
              </svg>
              Reconnect
            </button>
          </div>
        </div>

        <!-- Detected Network Interfaces (LAN IP List) -->
        <div class="settings-section" id="settings-lan-interfaces-section">
          <div class="settings-label">Detected Local Network Interfaces</div>
          <div class="settings-interfaces-list" id="settings-interfaces-container">
            <div class="settings-interface-item">
              <span class="interface-name">Host URL</span>
              <span class="interface-addr">${currentHost}</span>
            </div>
          </div>
        </div>

        <!-- Custom Bridge URL Override (for Remote Tablet Setup) -->
        <div class="settings-section">
          <div class="settings-label">Target PC Bridge Host / IP (Override)</div>
          <div class="settings-custom-ip-row">
            <input 
              type="text" 
              id="input-custom-bridge-url" 
              class="settings-input" 
              placeholder="e.g. 192.168.1.100:3000 or localhost:3000"
              value="${customUrl}"
              autocomplete="off"
              spellcheck="false"
            />
            <button id="btn-save-bridge-url" class="btn-primary" style="white-space: nowrap;">
              Save & Connect
            </button>
            ${customUrl ? `<button id="btn-reset-bridge-url" class="btn-secondary" title="Reset to auto-detect">Auto</button>` : ''}
          </div>
          <div id="settings-feedback-msg" class="settings-feedback"></div>
          ${currentWsUrl.startsWith('wss:') ? `
          <div class="settings-hint" style="margin-top: 8px;">
            PC Bridge uses a self-signed certificate for this secure (<code>wss://</code>) connection —
            a browser can't accept it during a WebSocket handshake, so the first time you connect from
            this device, open the trust page below and accept the "connection isn't private" warning once.
            <br/>
            <a href="${currentWsUrl.replace(/^wss:/, 'https:')}/api/health" target="_blank" rel="noopener" class="btn-secondary" style="display: inline-block; margin-top: 6px; text-decoration: none;">
              Open Trust Page
            </a>
          </div>` : ''}
        </div>
      </section>

      <!-- Virtual Yoke Sensitivity Card -->
      <section class="settings-card" id="settings-yoke-sensitivity-card">
        <div class="settings-card-header">
          <div class="settings-card-header-left">
            <div class="settings-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9"/><path d="M3 12h5"/><path d="M16 12h5"/><path d="M12 12v7"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>
              </svg>
            </div>
            <div>
              <h2 class="settings-card-title">Virtual Yoke</h2>
              <p class="settings-card-desc">Mount type and degrees of phone tilt (from center) that reach full control deflection</p>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-label">Mount type</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button id="btn-yoke-mode-freehand" class="settings-btn-secondary${(!this.virtualYoke || this.virtualYoke.mountMode !== VirtualYokeEngine.MOUNT_MODE_MOUNTED) ? ' active' : ''}">Freehand</button>
            <button id="btn-yoke-mode-mounted" class="settings-btn-secondary${(this.virtualYoke && this.virtualYoke.mountMode === VirtualYokeEngine.MOUNT_MODE_MOUNTED) ? ' active' : ''}">Mounted rig</button>
          </div>
          <p class="settings-hint">Freehand (default): held in the hand, no mechanical centering — the response curve softens near center on its own to damp ordinary hand tremor. Mounted rig: phone seated in a self-centering mount (e.g. a 3D-printed yoke rig) — the mount's own spring already does that job, so the curve only needs a light touch.</p>
        </div>

        <div class="settings-section">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;">
            <div>
              <div class="settings-label">Pitch (forward / back) — degrees</div>
              <div class="settings-custom-ip-row">
                <input
                  type="number"
                  id="input-yoke-pitch-sensitivity"
                  class="settings-input"
                  min="${VirtualYokeEngine.SENSITIVITY_MIN_DEG}"
                  max="${VirtualYokeEngine.SENSITIVITY_MAX_DEG}"
                  step="1"
                  value="${this.virtualYoke ? this.virtualYoke.pitchSensitivityDeg : VirtualYokeEngine.DEFAULT_PITCH_SENSITIVITY_DEG}"
                />
              </div>
            </div>
            <div>
              <div class="settings-label">Roll (left / right) — degrees</div>
              <div class="settings-custom-ip-row">
                <input
                  type="number"
                  id="input-yoke-roll-sensitivity"
                  class="settings-input"
                  min="${VirtualYokeEngine.SENSITIVITY_MIN_DEG}"
                  max="${VirtualYokeEngine.SENSITIVITY_MAX_DEG}"
                  step="1"
                  value="${this.virtualYoke ? this.virtualYoke.rollSensitivityDeg : VirtualYokeEngine.DEFAULT_ROLL_SENSITIVITY_DEG}"
                />
              </div>
            </div>
          </div>
          <p class="settings-hint">Lower = more sensitive (less tilt needed for full deflection). Range: ${VirtualYokeEngine.SENSITIVITY_MIN_DEG}&ndash;${VirtualYokeEngine.SENSITIVITY_MAX_DEG}&deg;. Factory default: ${VirtualYokeEngine.DEFAULT_PITCH_SENSITIVITY_DEG}&deg; pitch / ${VirtualYokeEngine.DEFAULT_ROLL_SENSITIVITY_DEG}&deg; roll. Takes effect immediately, no re-centering needed.</p>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 10px;">
            <button id="btn-reset-yoke-sensitivity" class="settings-btn-secondary">Reset to Default</button>
            <div id="yoke-sensitivity-feedback" class="settings-feedback"></div>
          </div>
        </div>
      </section>

      <!-- PC Bridge Asset Persistence & Synchronization Card -->
      <section class="settings-card" id="settings-persistence-sync-card">
        <div class="settings-card-header">
          <div class="settings-card-header-left">
            <div class="settings-card-icon" style="color: var(--accent-cyan);">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </div>
            <div>
              <h2 class="settings-card-title">PC Persistence & Asset Sync</h2>
              <p class="settings-card-desc">Persistent storage of non-default presets, custom widgets & components</p>
            </div>
          </div>

          <div id="settings-sync-status-pill" class="settings-status-badge ${isConnected ? 'connected' : 'disconnected'}">
            <span class="status-dot"></span>
            <span id="settings-sync-status-text">${isConnected ? 'SYNC READY' : 'OFFLINE'}</span>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-guide-box" style="margin-top: 0; background: var(--bg-surface-2);">
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-muted);">
              <strong>Automatic Cache Persistence:</strong> The Flight Deck mobile app always bundles default presets, widgets, and components. Any non-default assets (created in Widget Studio or customized on your PC) are stored on the PC Bridge and automatically synchronized to this device's cache on load. If you clear your browser cache, the app will automatically restore your custom presets from your PC.
            </p>
          </div>
        </div>

        <div class="settings-section">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 14px;">
            <div style="background: var(--bg-surface-2); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px;">
              <div style="font-size: 11px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px;">Custom Presets Cached</div>
              <div id="sync-cached-profiles-count" style="font-size: 22px; font-weight: 800; color: var(--accent-cyan); font-family: var(--font-mono); margin-top: 4px;">${nonDefaultProfilesCount}</div>
            </div>

            <div style="background: var(--bg-surface-2); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px;">
              <div style="font-size: 11px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px;">Custom FDWS Widgets</div>
              <div id="sync-cached-widgets-count" style="font-size: 22px; font-weight: 800; color: var(--accent-cyan); font-family: var(--font-mono); margin-top: 4px;">${nonDefaultWidgetsCount}</div>
            </div>

            <div style="background: var(--bg-surface-2); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px;">
              <div style="font-size: 11px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px;">Last Synced</div>
              <div id="sync-last-time" style="font-size: 14px; font-weight: 600; color: var(--text-main); font-family: var(--font-mono); margin-top: 6px;">${lastSyncTimeStr}</div>
            </div>
          </div>

          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button id="btn-manual-sync-now" class="btn-primary" style="display: inline-flex; align-items: center; gap: 8px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
              </svg>
              <span>Sync with PC Bridge Now</span>
            </button>
            <button id="btn-pull-all-presets" class="btn-secondary" style="display: inline-flex; align-items: center; gap: 8px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>Restore All from PC</span>
            </button>
            <div id="sync-action-feedback" style="font-size: 12px; color: var(--accent-cyan); font-weight: 600;"></div>
          </div>
        </div>
      </section>

      <!-- Community Deck Events Packs -->
      <section class="settings-card" id="settings-deck-packs-card">
        <div class="settings-card-header">
          <div class="settings-card-header-left">
            <div class="settings-card-icon" style="color: var(--accent-cyan);">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                <line x1="7" y1="7" x2="7.01" y2="7"/>
              </svg>
            </div>
            <div>
              <h2 class="settings-card-title">Community Deck Events Packs</h2>
              <p class="settings-card-desc">Extra logical binding-name suggestions shared by other widget authors</p>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-guide-box" style="margin-top: 0; background: var(--bg-surface-2);">
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-muted);">
              A pack only suggests names in Widget Studio's/this app's binding pickers — it never changes what a widget actually does. Bare logical names are host-defined (FDWS v1.4 §1.2); PC Bridge auto-registers any name a widget uses as an unmapped placeholder the moment it's installed, whether or not a pack ever suggested it.
            </p>
          </div>
        </div>

        <div class="settings-section">
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <label class="btn-secondary" style="cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
              <span>Import Pack…</span>
              <input type="file" id="fd-pack-import-input" accept=".json,application/json" style="display: none;" />
            </label>
            <button id="btn-export-deck-pack" class="btn-secondary">Export My Custom Names…</button>
          </div>
          <div id="deck-pack-feedback" class="settings-feedback"></div>
        </div>

        <div class="settings-section" id="deck-packs-list-section">
          <div class="settings-label">Imported Packs</div>
          <div id="deck-packs-list" style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;"></div>
        </div>
      </section>

      <!-- Instructions Guide -->
      <section class="settings-card">
        <div class="settings-guide-box" style="margin: 0;">
          <div class="settings-guide-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            Mobile & Tablet Setup Instructions
          </div>
          <ol class="settings-guide-steps">
            <li>Ensure the Flight Deck PC Bridge application or server is running on your simulator PC.</li>
            <li>Connect your tablet/phone to the <strong>same Wi-Fi network</strong> as your PC.</li>
            <li>Open Safari or Chrome on your tablet and navigate to <code>http://<span id="guide-ip-text">${currentHostname}</span>:${currentPort}</code>.</li>
            <li>Tap the browser <strong>Share</strong> button and choose <strong>Add to Home Screen</strong> for full-screen companion mode.</li>
          </ol>
        </div>
      </section>
    `;

    this.bindEvents();
    this.renderDeckPacksList();
  }

  /**
   * Builds the Install App card markup based on the current
   * PwaInstallManager state. Returns an empty string once the app is
   * already running as an installed/standalone PWA -- there's nothing left
   * to offer at that point.
   * @returns {string}
   */
  renderInstallCardHTML() {
    if (!this.pwaInstall) return '';
    const state = this.pwaInstall.getState();
    if (state === 'installed') return '';

    let body;
    if (state === 'insecure-context') {
      body = `
        <div class="settings-guide-box" style="margin-top: 0; background: var(--bg-surface-2);">
          <p style="margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-muted);">
            <strong>Install requires a secure connection (HTTPS).</strong> This page was loaded over a plain, unencrypted address, so the browser won't allow app installation here — this is a testing-only limitation, not a bug. It will work normally once Flight Deck is hosted on GitHub Pages (which serves everything over HTTPS automatically). To test installability sooner, use an HTTPS tunnel (e.g. ngrok) or, on Android, <code>adb reverse</code> so your phone can reach the dev server at a real <code>localhost</code> address.
          </p>
        </div>
      `;
    } else if (state === 'ios-manual') {
      body = `
        <div class="settings-guide-box" style="margin-top: 0; background: var(--bg-surface-2);">
          <p style="margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-muted);">
            iOS doesn't allow apps to trigger installation directly. Tap the <strong>Share</strong> button in Safari's toolbar, then choose <strong>Add to Home Screen</strong> to install Flight Deck.
          </p>
        </div>
      `;
    } else {
      body = `
        <div class="settings-section" style="margin: 0;">
          <button id="btn-install-app" class="btn-primary" style="display: inline-flex; align-items: center; gap: 8px;" ${state === 'promptable' ? '' : 'disabled'}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>Install App</span>
          </button>
          ${state === 'unsupported' ? '<p class="settings-hint" style="margin-top: 8px;">This browser doesn\'t support one-tap install. Look for an "Install" or "Add to Home Screen" option in its menu.</p>' : ''}
        </div>
      `;
    }

    return `
      <section class="settings-card" id="settings-install-card">
        <div class="settings-card-header">
          <div class="settings-card-header-left">
            <div class="settings-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>
              </svg>
            </div>
            <div>
              <h2 class="settings-card-title">Install App</h2>
              <p class="settings-card-desc">Add Flight Deck to your home screen for full-screen, offline-ready access</p>
            </div>
          </div>
        </div>
        ${body}
      </section>
    `;
  }

  /**
   * Re-renders just the Install App card in place (or removes it) without
   * touching the rest of the Settings page -- called whenever
   * PwaInstallManager's state changes (the deferred prompt becomes
   * available, or the app gets installed).
   */
  refreshInstallCard() {
    const slot = this.container?.querySelector('#settings-install-card-slot');
    if (!slot) return;
    slot.innerHTML = this.renderInstallCardHTML();
    this.bindInstallButton();
  }

  bindInstallButton() {
    const installBtn = this.container?.querySelector('#btn-install-app');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!this.pwaInstall) return;
        installBtn.disabled = true;
        await this.pwaInstall.promptInstall();
        this.refreshInstallCard();
      });
    }
  }

  /**
   * Builds the custom-pages list markup for the Manage Pages card.
   * @returns {string}
   */
  renderPagesListHTML() {
    const pages = this.getCustomPages();
    if (pages.length === 0) {
      return `<div style="font-size: 12px; color: var(--text-dim); font-style: italic;">No custom pages yet.</div>`;
    }
    return pages.map((page) => `
      <div class="settings-interface-item" data-page-id="${SecurityValidator.escapeHTML(page.id)}">
        <span class="interface-name">${SecurityValidator.escapeHTML(page.name)}</span>
        <button class="settings-btn-icon btn-delete-page" title="Delete Page" aria-label="Delete Page" data-page-id="${SecurityValidator.escapeHTML(page.id)}">✕</button>
      </div>
    `).join('');
  }

  /**
   * Re-renders just the custom-pages list in place -- called after adding
   * or deleting a page (from FlightDeckApp.renderPageMenu()), so the
   * Settings page stays in sync without a disruptive full re-render.
   */
  refreshPagesList() {
    const listEl = this.container?.querySelector('#settings-pages-list');
    if (!listEl) return;
    listEl.innerHTML = this.renderPagesListHTML();
    this.bindPagesListButtons();
  }

  bindPagesListButtons() {
    this.container?.querySelectorAll('.btn-delete-page').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pageId = btn.dataset.pageId;
        const pageName = btn.closest('.settings-interface-item')?.querySelector('.interface-name')?.textContent || 'this page';
        if (confirm(`Delete page "${pageName}"? This cannot be undone.`)) {
          if (this.onDeletePage) this.onDeletePage(pageId);
        }
      });
    });
  }

  /**
   * Populates the "Imported Packs" list in the Community Deck Events Packs
   * card. Called on initial render and again after any import/remove so the
   * list stays in sync without a full re-render (which would lose focus on
   * the file input mid-interaction).
   */
  renderDeckPacksList() {
    const listEl = this.container?.querySelector('#deck-packs-list');
    if (!listEl) return;

    const packs = loadImportedPacks();
    if (packs.length === 0) {
      listEl.innerHTML = `<div style="font-size: 12px; color: var(--text-dim); font-style: italic;">No packs imported yet.</div>`;
      return;
    }

    listEl.innerHTML = packs.map((pack) => `
      <div class="settings-interface-item" data-pack-id="${pack.id}">
        <span class="interface-name">${pack.name} <span style="color: var(--text-dim); font-weight: 400;">(${pack.events.length} events, by ${pack.author || 'Unknown'})</span></span>
        <button class="settings-btn-icon btn-remove-pack" title="Remove Pack" aria-label="Remove Pack" data-pack-id="${pack.id}">✕</button>
      </div>
    `).join('');

    listEl.querySelectorAll('.btn-remove-pack').forEach((btn) => {
      btn.addEventListener('click', () => {
        removePack(btn.dataset.packId);
        this.renderDeckPacksList();
      });
    });
  }

  handlePackFileImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const feedbackEl = this.container?.querySelector('#deck-pack-feedback');

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result);
        const pack = parsePackFile(raw);
        importPack(pack);
        if (feedbackEl) {
          feedbackEl.textContent = `Imported "${pack.name}" (${pack.events.length} events).`;
          feedbackEl.className = 'settings-feedback success';
          setTimeout(() => { if (feedbackEl) feedbackEl.textContent = ''; }, 4000);
        }
        this.renderDeckPacksList();
      } catch (err) {
        if (feedbackEl) {
          feedbackEl.textContent = `Import failed: ${err.message}`;
          feedbackEl.className = 'settings-feedback error';
        }
      }
    };
    reader.readAsText(file);
  }

  async handlePackExport() {
    const feedbackEl = this.container?.querySelector('#deck-pack-feedback');
    const storageManager = this.simBridge?.storageManager;

    let widgetDefs = [];
    if (storageManager && typeof storageManager.getAllWidgetDefinitions === 'function') {
      try {
        widgetDefs = await storageManager.getAllWidgetDefinitions();
      } catch (_) {}
    }

    const customEvents = extractCustomDeckEvents(widgetDefs, DECK_EVENT_NAMES);
    if (customEvents.length === 0) {
      if (feedbackEl) {
        feedbackEl.textContent = 'None of your installed widgets use a custom logical binding name yet — nothing to export.';
        feedbackEl.className = 'settings-feedback error';
      }
      return;
    }

    const pack = buildPackFromCustomEvents(customEvents, { name: 'My Custom Deck Events' });
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pack.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (feedbackEl) {
      feedbackEl.textContent = `Exported ${customEvents.length} custom name(s) — share the downloaded file with the community.`;
      feedbackEl.className = 'settings-feedback success';
      setTimeout(() => { if (feedbackEl) feedbackEl.textContent = ''; }, 4000);
    }
  }

  /**
   * Binds interaction handlers
   */
  bindEvents() {
    // Install App card
    this.bindInstallButton();

    // Manage Pages card
    this.bindPagesListButtons();
    const addPageBtn = this.container.querySelector('#btn-add-page');
    if (addPageBtn) {
      addPageBtn.addEventListener('click', () => {
        if (this.onAddPage) this.onAddPage();
      });
    }

    // Copy IP button
    const copyBtn = this.container.querySelector('#btn-copy-ip');
    const copyBtnLabel = this.container.querySelector('#copy-btn-label');
    const ipText = this.container.querySelector('#settings-primary-ip-text');
    const portText = this.container.querySelector('#settings-port-text');

    if (copyBtn && ipText) {
      copyBtn.addEventListener('click', async () => {
        const fullAddr = `${ipText.textContent}${portText ? portText.textContent : ''}`;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(fullAddr);
          } else {
            const temp = document.createElement('textarea');
            temp.value = fullAddr;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            temp.remove();
          }
          if (copyBtnLabel) copyBtnLabel.textContent = 'Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            if (copyBtnLabel) copyBtnLabel.textContent = 'Copy IP';
            copyBtn.classList.remove('copied');
          }, 2000);
        } catch (err) {
          console.warn('[SettingsView] Copy failed:', err);
        }
      });
    }

    // Reconnect / Test button
    const reconnectBtn = this.container.querySelector('#btn-test-reconnect');
    if (reconnectBtn) {
      reconnectBtn.addEventListener('click', () => {
        reconnectBtn.classList.add('spinning');
        if (this.simBridge) {
          this.simBridge.connect();
        }
        setTimeout(() => {
          reconnectBtn.classList.remove('spinning');
        }, 1000);
      });
    }

    // Save Custom Bridge URL button
    const saveBtn = this.container.querySelector('#btn-save-bridge-url');
    const inputUrl = this.container.querySelector('#input-custom-bridge-url');
    const feedbackEl = this.container.querySelector('#settings-feedback-msg');

    if (saveBtn && inputUrl) {
      saveBtn.addEventListener('click', () => {
        const val = inputUrl.value.trim();
        if (this.simBridge) {
          this.simBridge.setServerUrl(val);
          if (feedbackEl) {
            feedbackEl.textContent = val ? `Connecting to ${val}...` : 'Reset to auto connection URL.';
            feedbackEl.className = 'settings-feedback success';
            setTimeout(() => {
              if (feedbackEl) feedbackEl.textContent = '';
            }, 3000);
          }
        }
        this.render();
      });
    }

    // Reset button
    const resetBtn = this.container.querySelector('#btn-reset-bridge-url');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (this.simBridge) {
          this.simBridge.setServerUrl(null);
        }
        this.render();
      });
    }

    // Manual Sync Button
    const syncBtn = this.container.querySelector('#btn-manual-sync-now');
    const pullAllBtn = this.container.querySelector('#btn-pull-all-presets');
    const syncFeedback = this.container.querySelector('#sync-action-feedback');

    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        if (!this.simBridge || !this.simBridge.connected) {
          if (syncFeedback) {
            syncFeedback.textContent = 'PC Bridge is offline. Please check connection.';
            syncFeedback.style.color = 'var(--accent-amber)';
          }
          return;
        }

        syncBtn.classList.add('spinning');
        if (syncFeedback) syncFeedback.textContent = 'Checking PC Bridge manifest...';

        await this.simBridge.checkAndSyncPresets();
        syncBtn.classList.remove('spinning');
        if (syncFeedback) {
          syncFeedback.textContent = 'Sync completed!';
          syncFeedback.style.color = 'var(--accent-cyan)';
          setTimeout(() => { if (syncFeedback) syncFeedback.textContent = ''; }, 3000);
        }
        this.refreshStatsDisplay();
      });
    }

    if (pullAllBtn) {
      pullAllBtn.addEventListener('click', async () => {
        if (!this.simBridge || !this.simBridge.connected) {
          if (syncFeedback) {
            syncFeedback.textContent = 'PC Bridge is offline. Please check connection.';
            syncFeedback.style.color = 'var(--accent-amber)';
          }
          return;
        }

        pullAllBtn.classList.add('spinning');
        if (syncFeedback) syncFeedback.textContent = 'Fetching all presets from PC...';

        await this.simBridge.fetchAllUserPresets();
        pullAllBtn.classList.remove('spinning');
        if (syncFeedback) {
          syncFeedback.textContent = 'Restored all presets from PC!';
          syncFeedback.style.color = 'var(--accent-cyan)';
          setTimeout(() => { if (syncFeedback) syncFeedback.textContent = ''; }, 3000);
        }
        this.refreshStatsDisplay();
      });
    }

    // Virtual Yoke Mount Type
    const freehandBtn = this.container.querySelector('#btn-yoke-mode-freehand');
    const mountedBtn = this.container.querySelector('#btn-yoke-mode-mounted');
    const setMountMode = (mode) => {
      if (!this.virtualYoke) return;
      this.virtualYoke.setMountMode(mode);
      if (freehandBtn) freehandBtn.classList.toggle('active', mode !== VirtualYokeEngine.MOUNT_MODE_MOUNTED);
      if (mountedBtn) mountedBtn.classList.toggle('active', mode === VirtualYokeEngine.MOUNT_MODE_MOUNTED);
    };
    if (freehandBtn) freehandBtn.addEventListener('click', () => setMountMode(VirtualYokeEngine.MOUNT_MODE_FREEHAND));
    if (mountedBtn) mountedBtn.addEventListener('click', () => setMountMode(VirtualYokeEngine.MOUNT_MODE_MOUNTED));

    // Virtual Yoke Sensitivity
    const pitchInput = this.container.querySelector('#input-yoke-pitch-sensitivity');
    const rollInput = this.container.querySelector('#input-yoke-roll-sensitivity');
    const yokeFeedback = this.container.querySelector('#yoke-sensitivity-feedback');
    const resetYokeBtn = this.container.querySelector('#btn-reset-yoke-sensitivity');

    const showYokeFeedback = (msg) => {
      if (!yokeFeedback) return;
      yokeFeedback.textContent = msg;
      yokeFeedback.className = 'settings-feedback success';
      setTimeout(() => { if (yokeFeedback) yokeFeedback.textContent = ''; }, 2500);
    };

    if (pitchInput) {
      pitchInput.addEventListener('change', () => {
        if (!this.virtualYoke) return;
        this.virtualYoke.setPitchSensitivity(parseFloat(pitchInput.value));
        pitchInput.value = this.virtualYoke.pitchSensitivityDeg;
        showYokeFeedback('Pitch sensitivity saved.');
      });
    }

    if (rollInput) {
      rollInput.addEventListener('change', () => {
        if (!this.virtualYoke) return;
        this.virtualYoke.setRollSensitivity(parseFloat(rollInput.value));
        rollInput.value = this.virtualYoke.rollSensitivityDeg;
        showYokeFeedback('Roll sensitivity saved.');
      });
    }

    if (resetYokeBtn) {
      resetYokeBtn.addEventListener('click', () => {
        if (!this.virtualYoke) return;
        this.virtualYoke.setPitchSensitivity(VirtualYokeEngine.DEFAULT_PITCH_SENSITIVITY_DEG);
        this.virtualYoke.setRollSensitivity(VirtualYokeEngine.DEFAULT_ROLL_SENSITIVITY_DEG);
        if (pitchInput) pitchInput.value = this.virtualYoke.pitchSensitivityDeg;
        if (rollInput) rollInput.value = this.virtualYoke.rollSensitivityDeg;
        showYokeFeedback('Reset to default.');
      });
    }

    // Community Deck Events Packs
    const packImportInput = this.container.querySelector('#fd-pack-import-input');
    if (packImportInput) {
      packImportInput.addEventListener('change', (e) => this.handlePackFileImport(e));
    }
    const packExportBtn = this.container.querySelector('#btn-export-deck-pack');
    if (packExportBtn) {
      packExportBtn.addEventListener('click', () => this.handlePackExport());
    }
  }

  async refreshStatsDisplay() {
    if (!this.container || !this.simBridge?.storageManager) return;
    try {
      const pList = await this.simBridge.storageManager.getNonDefaultProfiles();
      const wList = await this.simBridge.storageManager.getNonDefaultWidgets();
      const pEl = this.container.querySelector('#sync-cached-profiles-count');
      const wEl = this.container.querySelector('#sync-cached-widgets-count');
      const tEl = this.container.querySelector('#sync-last-time');

      if (pEl) pEl.textContent = pList.length;
      if (wEl) wEl.textContent = wList.length;
      if (tEl && this.simBridge.lastSyncTime) {
        tEl.textContent = new Date(this.simBridge.lastSyncTime).toLocaleTimeString();
      }
    } catch (_) {}
  }

  /**
   * Updates sync display upon receiving sync broadcast
   */
  updateSyncDisplay() {
    this.refreshStatsDisplay();
  }

  /**
   * Updates the UI when network info is fetched from the server
   */
  updateNetworkDisplay() {
    if (!this.networkInfo || !this.container) return;

    const primaryIpEl = this.container.querySelector('#settings-primary-ip-text');
    const portEl = this.container.querySelector('#settings-port-text');
    const guideIpEl = this.container.querySelector('#guide-ip-text');
    const interfacesList = this.container.querySelector('#settings-interfaces-container');

    if (this.networkInfo.primaryIp && primaryIpEl) {
      primaryIpEl.textContent = this.networkInfo.primaryIp;
    }
    if (this.networkInfo.port && portEl) {
      portEl.textContent = `:${this.networkInfo.port}`;
    }
    if (this.networkInfo.primaryIp && guideIpEl) {
      guideIpEl.textContent = this.networkInfo.primaryIp;
    }

    if (interfacesList && Array.isArray(this.networkInfo.addresses) && this.networkInfo.addresses.length > 0) {
      interfacesList.innerHTML = this.networkInfo.addresses.map((net) => `
        <div class="settings-interface-item">
          <span class="interface-name">${net.interface.toUpperCase()}</span>
          <span class="interface-addr">${net.address}:${this.networkInfo.port}</span>
        </div>
      `).join('');
    }
  }

  /**
   * Updates connection status badge dynamically
   * @param {{connected: boolean, url?: string}} status
   */
  updateConnectionStatus(status) {
    if (!this.container) return;

    const pill = this.container.querySelector('#settings-status-pill');
    const statusText = this.container.querySelector('#settings-status-text');
    const endpointText = this.container.querySelector('#settings-ws-endpoint-text');
    const syncPill = this.container.querySelector('#settings-sync-status-pill');
    const syncStatusText = this.container.querySelector('#settings-sync-status-text');

    const isConnected = !!status.connected;

    if (pill) {
      pill.className = `settings-status-badge ${isConnected ? 'connected' : 'disconnected'}`;
    }
    if (statusText) {
      statusText.textContent = isConnected ? 'CONNECTED' : 'DISCONNECTED';
    }
    if (syncPill) {
      syncPill.className = `settings-status-badge ${isConnected ? 'connected' : 'disconnected'}`;
    }
    if (syncStatusText) {
      syncStatusText.textContent = isConnected ? 'SYNC READY' : 'OFFLINE';
    }
    if (status.url && endpointText) {
      endpointText.textContent = status.url;
    }
  }

  /**
   * Destroys the view and cleans up subscriptions
   */
  destroy() {
    if (this.unsubscribeStatus) {
      this.unsubscribeStatus();
      this.unsubscribeStatus = null;
    }
    if (this.unsubscribeSync) {
      this.unsubscribeSync();
      this.unsubscribeSync = null;
    }
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}
