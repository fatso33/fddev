import { sendSimCommand } from '../bridgeClient.js';

let lightsState = {
  landingLightState: false,
  taxiLightState: false,
  navLightState: true,
  beaconLightState: true,
  strobeLightState: false,
  logoLightState: false,
  wingLightState: false,
  cabinLightState: true,
  panelFloodState: true
};

export function renderLightsPage() {
  return `
    <section class="garmin-card">
      <div class="section-title-center">EXTERNAL LIGHTING</div>
      <div class="ap-grid-2x2" style="gap: 8px; margin-top: 4px;">
        <button id="light-btn-landing" class="ap-mode-btn ${lightsState.landingLightState ? 'active' : ''}">LANDING</button>
        <button id="light-btn-taxi" class="ap-mode-btn ${lightsState.taxiLightState ? 'active' : ''}">TAXI</button>
        <button id="light-btn-nav" class="ap-mode-btn ${lightsState.navLightState ? 'active' : ''}">NAV / POS</button>
        <button id="light-btn-strobe" class="ap-mode-btn ${lightsState.strobeLightState ? 'active' : ''}">STROBE</button>
      </div>
      <div class="ap-grid-2x2" style="gap: 8px; margin-top: 4px;">
        <button id="light-btn-beacon" class="ap-mode-btn ${lightsState.beaconLightState ? 'active' : ''}">BEACON</button>
        <button id="light-btn-logo" class="ap-mode-btn ${lightsState.logoLightState ? 'active' : ''}">LOGO</button>
        <button id="light-btn-wing" class="ap-mode-btn ${lightsState.wingLightState ? 'active' : ''}">WING / ICE</button>
        <button id="light-btn-all" class="ap-mode-btn" style="color: var(--accent-cyan);">ALL EXT</button>
      </div>
    </section>

    <section class="garmin-card">
      <div class="section-title-center">COCKPIT & CABIN LIGHTS</div>
      <div class="ap-grid-2x2" style="gap: 8px; margin-top: 4px;">
        <button id="light-btn-panel" class="ap-mode-btn ${lightsState.panelFloodState ? 'active' : ''}">PANEL FLOOD</button>
        <button id="light-btn-cabin" class="ap-mode-btn ${lightsState.cabinLightState ? 'active' : ''}">CABIN</button>
      </div>
    </section>
  `;
}

export function updateLightsDisplays(data) {
  if (!data) return;
  const lightMap = {
    'light-btn-landing': 'landingLightState',
    'light-btn-taxi': 'taxiLightState',
    'light-btn-nav': 'navLightState',
    'light-btn-strobe': 'strobeLightState',
    'light-btn-beacon': 'beaconLightState',
    'light-btn-logo': 'logoLightState',
    'light-btn-wing': 'wingLightState',
    'light-btn-panel': 'panelFloodState',
    'light-btn-cabin': 'cabinLightState'
  };

  Object.entries(lightMap).forEach(([btnId, stateKey]) => {
    if (data[stateKey] !== undefined) {
      lightsState[stateKey] = !!data[stateKey];
      const btn = document.getElementById(btnId);
      if (btn) btn.classList.toggle('active', lightsState[stateKey]);
    }
  });
}

export function initLightsEvents() {
  const lightKeys = [
    { id: 'light-btn-landing', key: 'landingLightState', event: 'landingLightsToggle' },
    { id: 'light-btn-taxi', key: 'taxiLightState', event: 'taxiLightsToggle' },
    { id: 'light-btn-nav', key: 'navLightState', event: 'navLightsToggle' },
    { id: 'light-btn-strobe', key: 'strobeLightState', event: 'strobeLightsToggle' },
    { id: 'light-btn-beacon', key: 'beaconLightState', event: 'beaconLightsToggle' },
    { id: 'light-btn-logo', key: 'logoLightState', event: 'logoLightsToggle' },
    { id: 'light-btn-wing', key: 'wingLightState', event: 'wingLightsToggle' },
    { id: 'light-btn-panel', key: 'panelFloodState', event: 'panelLightsToggle' },
    { id: 'light-btn-cabin', key: 'cabinLightState', event: 'cabinLightsToggle' }
  ];

  lightKeys.forEach(({ id, key, event }) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        lightsState[key] = !lightsState[key];
        btn.classList.toggle('active', lightsState[key]);
        sendSimCommand('LIGHTS', event, lightsState[key] ? 1 : 0);
      });
    }
  });

  const allBtn = document.getElementById('light-btn-all');
  if (allBtn) {
    // DOM id suffix ('landing') and lightsState/Deck-Event key ('landingLightState')
    // diverged once Deck Event names were renamed — paired explicitly here since
    // the DOM ids themselves (light-btn-landing etc.) didn't change.
    const extLights = [
      { idSuffix: 'landing', key: 'landingLightState' },
      { idSuffix: 'taxi', key: 'taxiLightState' },
      { idSuffix: 'nav', key: 'navLightState' },
      { idSuffix: 'strobe', key: 'strobeLightState' },
      { idSuffix: 'beacon', key: 'beaconLightState' }
    ];
    allBtn.addEventListener('click', () => {
      const anyOff = extLights.some(({ key }) => !lightsState[key]);
      extLights.forEach(({ idSuffix, key }) => {
        lightsState[key] = anyOff;
        const b = document.getElementById(`light-btn-${idSuffix}`);
        if (b) b.classList.toggle('active', anyOff);
      });
      sendSimCommand('LIGHTS', 'allLightsToggle', anyOff ? 1 : 0);
    });
  }
}
