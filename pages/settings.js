import { send, safeStorageGetString, safeStorageSetString } from '../bridgeClient.js';

let navigatePageCallback = null;

export function setNavigateCallback(fn) {
  navigatePageCallback = fn;
}

export function renderSettingsPage() {
  const currentProfile = safeStorageGetString('flightdeck_profile', 'DEFAULT');

  return `
    <section class="garmin-card">
      <div class="section-title-center">AIRCRAFT PROFILES</div>
      <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
        <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Active Profile</div>
        <select id="settings-profile-select" style="
          background: var(--well-bg);
          border: 1px solid var(--btn-border);
          color: var(--accent-cyan);
          padding: 10px 12px;
          border-radius: 8px;
          font-family: 'Chakra Petch', monospace;
          font-size: 14px;
          font-weight: 700;
          outline: none;
        ">
          <option value="default_ga" selected>Default (Generic GA / MSFS 2024)</option>
        </select>
        <button id="settings-apply-profile-btn" class="btn-primary" style="padding: 10px; margin-top: 4px;">Apply Profile</button>
      </div>
    </section>

    <section class="garmin-card">
      <div class="section-title-center">SYSTEM STATUS</div>
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--well-border);">
          <span style="color: var(--text-dim);">Bridge Server</span>
          <span id="settings-bridge-status" style="color: var(--accent-green); font-weight: 700;">CONNECTED</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--well-border);">
          <span style="color: var(--text-dim);">Simulator Relay</span>
          <span style="color: var(--accent-cyan); font-weight: 700;">MSFS 2024 ACTIVE</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 6px 0;">
          <span style="color: var(--text-dim);">App Version</span>
          <span style="color: var(--text-white); font-family: monospace;">v2.2.0 PWA</span>
        </div>
      </div>
    </section>

    <section class="garmin-card">
      <div class="section-title-center">QUICK ACTIONS</div>
      <div class="ap-flex-row" style="gap: 8px; margin-top: 4px;">
        <button id="settings-back-radios" class="ap-mode-btn ap-flex-1">OPEN RADIOS</button>
        <button id="settings-back-ap" class="ap-mode-btn ap-flex-1">OPEN AUTOPILOT</button>
      </div>
    </section>
  `;
}

export function updateSettingsDisplays(data) {
  if (!data) return;
  const statusEl = document.getElementById('settings-bridge-status');
  if (statusEl && data.connected !== undefined) {
    statusEl.textContent = data.connected ? 'CONNECTED' : 'DISCONNECTED';
    statusEl.style.color = data.connected ? 'var(--accent-green)' : 'var(--accent-error)';
  }
}

export function initSettingsEvents(onNavigate) {
  if (typeof onNavigate === 'function') {
    navigatePageCallback = onNavigate;
  }

  const applyBtn = document.getElementById('settings-apply-profile-btn');
  const profileSelect = document.getElementById('settings-profile-select');

  if (applyBtn && profileSelect) {
    applyBtn.addEventListener('click', () => {
      const selectedId = profileSelect.value;
      const profileName = 'DEFAULT';
      safeStorageSetString('flightdeck_profile', profileName);

      const aircraftBadge = document.getElementById('aircraft-model');
      if (aircraftBadge) aircraftBadge.textContent = profileName;

      send({
        type: 'setProfile',
        profileId: selectedId
      });

      applyBtn.textContent = 'Saved!';
      setTimeout(() => {
        applyBtn.textContent = 'Apply Profile';
      }, 1500);
    });
  }

  const backRadios = document.getElementById('settings-back-radios');
  if (backRadios) {
    backRadios.addEventListener('click', () => {
      if (navigatePageCallback) navigatePageCallback('radios');
    });
  }

  const backAp = document.getElementById('settings-back-ap');
  if (backAp) {
    backAp.addEventListener('click', () => {
      if (navigatePageCallback) navigatePageCallback('autopilot');
    });
  }
}
