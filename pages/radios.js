import { sendSimCommand, safeStorageGet, safeStorageSet } from '../bridgeClient.js';

// Top-level telemetry cache so displays retain live data across page navigations
export var currentLiveRadioState = {
  com1ActFreq: '122.800',
  com1StbyFreq: '121.500',
  com2ActFreq: '118.700',
  com2StbyFreq: '119.100',
  nav1ActFreq: '110.30',
  nav1StbyFreq: '113.70',
  nav2ActFreq: '108.00',
  nav2StbyFreq: '117.20',
  xpndrCode: '1200'
};

const presets = {
  COMM: safeStorageGet('msfs_comm_presets', [null, null, null, null]),
  NAV: safeStorageGet('msfs_nav_presets', [null, null, null, null])
};

let editingPresetIndex = null;
let editingPresetCategory = null;

const lastValidFreqs = {
  'com1-stby': '121.500',
  'com2-stby': '119.100',
  'nav1-stby': '113.70',
  'nav2-stby': '117.20',
  'xpndr-code': '1200'
};

const errorTimeouts = {};
let identTimer = null;
let modalInputAttached = false;
let modalButtonsAttached = false;

export function renderRadiosPage() {
  return `
    <!-- COM RADIOS SECTION -->
    <section class="garmin-card" id="com-radios-card">
      <div class="section-header-row">
        <div class="unit-label">COM 1</div>
        <div class="section-title-center">COM RADIOS</div>
        <div class="header-spacer"></div>
      </div>

      <!-- COM 1 ROW -->
      <div class="radio-sub-unit">
        <div class="radio-row-container">
          <div class="freq-block">
            <span class="field-label">ACTIVE</span>
            <input type="text" class="freq-value active" id="com1-act" value="${formatCom(currentLiveRadioState.com1ActFreq)}" readonly />
          </div>
          <button class="swap-action-btn" id="com1-swap" aria-label="Swap COM1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m16 3 4 4-4 4"></path>
              <path d="M20 7H4"></path>
              <path d="m8 21-4-4 4-4"></path>
              <path d="M4 17h16"></path>
            </svg>
          </button>
          <div class="freq-block">
            <span class="field-label">STBY</span>
            <input type="text" inputmode="numeric" enterkeyhint="done" class="freq-value stby-box" id="com1-stby" value="${formatCom(currentLiveRadioState.com1StbyFreq)}" />
          </div>
        </div>
      </div>

      <!-- COM 2 ROW -->
      <div class="radio-sub-unit">
        <div class="unit-label">COM 2</div>
        <div class="radio-row-container">
          <div class="freq-block">
            <span class="field-label">ACTIVE</span>
            <input type="text" class="freq-value active" id="com2-act" value="${formatCom(currentLiveRadioState.com2ActFreq)}" readonly />
          </div>
          <button class="swap-action-btn" id="com2-swap" aria-label="Swap COM2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m16 3 4 4-4 4"></path>
              <path d="M20 7H4"></path>
              <path d="m8 21-4-4 4-4"></path>
              <path d="M4 17h16"></path>
            </svg>
          </button>
          <div class="freq-block">
            <span class="field-label">STBY</span>
            <input type="text" inputmode="numeric" enterkeyhint="done" class="freq-value stby-box" id="com2-stby" value="${formatCom(currentLiveRadioState.com2StbyFreq)}" />
          </div>
        </div>
      </div>

      <!-- COM Presets Row Container -->
      <div id="presets-row-comm">
        ${renderPresetsRow('COMM', 'com1')}
      </div>
    </section>

    <!-- NAV RADIOS SECTION -->
    <section class="garmin-card" id="nav-radios-card">
      <div class="section-header-row">
        <div class="unit-label">NAV 1</div>
        <div class="section-title-center">NAV RADIOS</div>
        <div class="header-spacer"></div>
      </div>

      <!-- NAV 1 ROW -->
      <div class="radio-sub-unit">
        <div class="radio-row-container">
          <div class="freq-block">
            <span class="field-label">ACTIVE</span>
            <input type="text" class="freq-value active" id="nav1-act" value="${formatNav(currentLiveRadioState.nav1ActFreq)}" readonly />
          </div>
          <button class="swap-action-btn" id="nav1-swap" aria-label="Swap NAV1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m16 3 4 4-4 4"></path>
              <path d="M20 7H4"></path>
              <path d="m8 21-4-4 4-4"></path>
              <path d="M4 17h16"></path>
            </svg>
          </button>
          <div class="freq-block">
            <span class="field-label">STBY</span>
            <input type="text" inputmode="numeric" enterkeyhint="done" class="freq-value stby-box" id="nav1-stby" value="${formatNav(currentLiveRadioState.nav1StbyFreq)}" />
          </div>
        </div>
      </div>

      <!-- NAV 2 ROW -->
      <div class="radio-sub-unit">
        <div class="unit-label">NAV 2</div>
        <div class="radio-row-container">
          <div class="freq-block">
            <span class="field-label">ACTIVE</span>
            <input type="text" class="freq-value active" id="nav2-act" value="${formatNav(currentLiveRadioState.nav2ActFreq)}" readonly />
          </div>
          <button class="swap-action-btn" id="nav2-swap" aria-label="Swap NAV2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m16 3 4 4-4 4"></path>
              <path d="M20 7H4"></path>
              <path d="m8 21-4-4 4-4"></path>
              <path d="M4 17h16"></path>
            </svg>
          </button>
          <div class="freq-block">
            <span class="field-label">STBY</span>
            <input type="text" inputmode="numeric" enterkeyhint="done" class="freq-value stby-box" id="nav2-stby" value="${formatNav(currentLiveRadioState.nav2StbyFreq)}" />
          </div>
        </div>
      </div>

      <!-- NAV Presets Row Container -->
      <div id="presets-row-nav">
        ${renderPresetsRow('NAV', 'nav1')}
      </div>
    </section>

    <!-- TRANSPONDER SECTION -->
    <section class="garmin-card">
      <div class="section-title-center" style="margin-bottom: 2px;">TRANSPONDER</div>
      <div class="xpndr-grid">
        <div class="xpndr-box">
          <span class="field-label">SQUAWK</span>
          <span id="xpndr-ident-tag" class="ident-active-tag hidden">IDENT</span>
          <input type="text" inputmode="numeric" enterkeyhint="done" id="xpndr-code" class="xpndr-input" maxlength="4" value="${currentLiveRadioState.xpndrCode || '1200'}" />
        </div>
        <div class="xpndr-actions">
          <button id="xpndr-vfr-btn" class="xpndr-btn ${currentLiveRadioState.xpndrCode === '1200' ? 'vfr-active' : ''}">VFR</button>
          <button id="xpndr-ident" class="xpndr-btn">IDENT</button>
        </div>
      </div>
    </section>
  `;
}

function renderPresetsRow(category, targetRadio) {
  const catPresets = presets[category] || [null, null, null, null];
  const isCom = category === 'COMM';
  return `
    <div class="presets-sub-row">
      ${[0, 1, 2, 3].map(i => {
        const item = catPresets[i];
        const hasData = item && item.freq;
        const displayFreq = hasData ? (isCom ? formatCom(item.freq) : formatNav(item.freq)) : '---';
        const displayLabel = (hasData && item.label) ? item.label : '&nbsp;';
        return `
          <div class="preset-wrapper">
            <span class="preset-top-label">${displayLabel}</span>
            <div class="preset-chip" data-category="${category}" data-index="${i}" data-target="${targetRadio}">
              <span class="preset-val">${displayFreq}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export function formatCom(val) {
  if (val === null || val === undefined || val === '') return '';
  const num = parseFloat(val);
  if (isNaN(num)) return '';
  return num.toFixed(3);
}

export function formatNav(val) {
  if (val === null || val === undefined || val === '') return '';
  const num = parseFloat(val);
  if (isNaN(num)) return '';
  return num.toFixed(2);
}

function isValidComFreq(val) {
  const num = parseFloat(val);
  if (isNaN(num) || num < 118.0 || num > 136.975) return false;

  const parts = num.toFixed(3).split('.');
  if (parts.length < 2) return true;
  const dec3 = parts[1];
  const suffix2 = dec3.slice(1);
  if (['20', '45', '70', '95'].includes(suffix2)) {
    return false;
  }
  return true;
}

function isValidNavFreq(val) {
  const num = parseFloat(val);
  if (isNaN(num) || num < 108.0 || num > 117.975) return false;
  return true;
}

function updateVfrButtonState(code) {
  const vfrBtn = document.getElementById('xpndr-vfr-btn');
  if (vfrBtn) {
    if (String(code).trim() === '1200') {
      vfrBtn.classList.add('vfr-active');
    } else {
      vfrBtn.classList.remove('vfr-active');
    }
  }
}

// Live update handler from Bridge telemetry
export function updateRadioDisplays(data) {
  if (!data) return;
  if (!currentLiveRadioState) {
    currentLiveRadioState = {
      com1ActFreq: '122.800',
      com1StbyFreq: '121.500',
      com2ActFreq: '118.700',
      com2StbyFreq: '119.100',
      nav1ActFreq: '110.30',
      nav1StbyFreq: '113.70',
      nav2ActFreq: '108.00',
      nav2StbyFreq: '117.20',
      xpndrCode: '1200'
    };
  }
  const isInputFocused = (id) => document.activeElement === document.getElementById(id);

  // Update internal cache
  if (data.com1ActFreq !== undefined) currentLiveRadioState.com1ActFreq = data.com1ActFreq;
  if (data.com1StbyFreq !== undefined) currentLiveRadioState.com1StbyFreq = data.com1StbyFreq;
  if (data.com2ActFreq !== undefined) currentLiveRadioState.com2ActFreq = data.com2ActFreq;
  if (data.com2StbyFreq !== undefined) currentLiveRadioState.com2StbyFreq = data.com2StbyFreq;
  if (data.nav1ActFreq !== undefined) currentLiveRadioState.nav1ActFreq = data.nav1ActFreq;
  if (data.nav1StbyFreq !== undefined) currentLiveRadioState.nav1StbyFreq = data.nav1StbyFreq;
  if (data.nav2ActFreq !== undefined) currentLiveRadioState.nav2ActFreq = data.nav2ActFreq;
  if (data.nav2StbyFreq !== undefined) currentLiveRadioState.nav2StbyFreq = data.nav2StbyFreq;
  if (data.xpndrCode !== undefined) currentLiveRadioState.xpndrCode = data.xpndrCode;

  const c1Act = document.getElementById('com1-act');
  const c1Stby = document.getElementById('com1-stby');
  const c2Act = document.getElementById('com2-act');
  const c2Stby = document.getElementById('com2-stby');

  if (c1Act && data.com1ActFreq !== undefined) c1Act.value = formatCom(data.com1ActFreq);
  if (c1Stby && data.com1StbyFreq !== undefined && !isInputFocused('com1-stby')) {
    c1Stby.value = formatCom(data.com1StbyFreq);
    lastValidFreqs['com1-stby'] = c1Stby.value;
  }
  if (c2Act && data.com2ActFreq !== undefined) c2Act.value = formatCom(data.com2ActFreq);
  if (c2Stby && data.com2StbyFreq !== undefined && !isInputFocused('com2-stby')) {
    c2Stby.value = formatCom(data.com2StbyFreq);
    lastValidFreqs['com2-stby'] = c2Stby.value;
  }

  const n1Act = document.getElementById('nav1-act');
  const n1Stby = document.getElementById('nav1-stby');
  const n2Act = document.getElementById('nav2-act');
  const n2Stby = document.getElementById('nav2-stby');

  if (n1Act && data.nav1ActFreq !== undefined) n1Act.value = formatNav(data.nav1ActFreq);
  if (n1Stby && data.nav1StbyFreq !== undefined && !isInputFocused('nav1-stby')) {
    n1Stby.value = formatNav(data.nav1StbyFreq);
    lastValidFreqs['nav1-stby'] = n1Stby.value;
  }
  if (n2Act && data.nav2ActFreq !== undefined) n2Act.value = formatNav(data.nav2ActFreq);
  if (n2Stby && data.nav2StbyFreq !== undefined && !isInputFocused('nav2-stby')) {
    n2Stby.value = formatNav(data.nav2StbyFreq);
    lastValidFreqs['nav2-stby'] = n2Stby.value;
  }

  const xpndr = document.getElementById('xpndr-code');
  if (xpndr && data.xpndrCode !== undefined && !isInputFocused('xpndr-code')) {
    xpndr.value = data.xpndrCode;
    lastValidFreqs['xpndr-code'] = data.xpndrCode;
    updateVfrButtonState(data.xpndrCode);
  }
}

function bindPresetChipEvents(container) {
  const chips = container ? container.querySelectorAll('.preset-chip') : document.querySelectorAll('.preset-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const idx = parseInt(chip.dataset.index, 10);
      const cat = chip.dataset.category;
      const target = (chip.dataset.target || '').toLowerCase();
      const presetData = presets[cat] ? presets[cat][idx] : null;

      if (!presetData || !presetData.freq) {
        openPresetModal(cat, idx);
      } else {
        const stbyInput = document.getElementById(`${target}-stby`);
        const isCom = cat === 'COMM';
        if (stbyInput) {
          stbyInput.value = isCom ? formatCom(presetData.freq) : formatNav(presetData.freq);
          lastValidFreqs[`${target}-stby`] = stbyInput.value;
          const actionKey = target.startsWith('com') ? (target === 'com1' ? 'com1StbySet' : 'com2StbySet') : (target === 'nav1' ? 'nav1StbySet' : 'nav2StbySet');
          sendSimCommand('RADIO', actionKey, parseFloat(presetData.freq));
        }
      }
    });

    let pressTimer;
    chip.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => {
        openPresetModal(chip.dataset.category, parseInt(chip.dataset.index, 10));
      }, 650);
    });
    chip.addEventListener('touchend', () => clearTimeout(pressTimer));
  });
}

function refreshPresetsRowDOM(category) {
  const isCom = category === 'COMM';
  const containerId = isCom ? 'presets-row-comm' : 'presets-row-nav';
  const targetRadio = isCom ? 'com1' : 'nav1';
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = renderPresetsRow(category, targetRadio);
    bindPresetChipEvents(container);
  }
}

export function initRadiosEvents() {
  attachSwapListener('com1-swap', 'RADIO', 'com1Swap');
  attachSwapListener('com2-swap', 'RADIO', 'com2Swap');
  attachSwapListener('nav1-swap', 'RADIO', 'nav1Swap');
  attachSwapListener('nav2-swap', 'RADIO', 'nav2Swap');

  attachSmartFreqListener('com1-stby', 'RADIO', 'com1StbySet', true);
  attachSmartFreqListener('com2-stby', 'RADIO', 'com2StbySet', true);
  attachSmartFreqListener('nav1-stby', 'RADIO', 'nav1StbySet', false);
  attachSmartFreqListener('nav2-stby', 'RADIO', 'nav2StbySet', false);

  initModalSmartInput();
  initModalActionButtons();
  bindPresetChipEvents();

  const identBtn = document.getElementById('xpndr-ident');
  const identTag = document.getElementById('xpndr-ident-tag');
  if (identBtn) {
    identBtn.addEventListener('click', () => {
      sendSimCommand('ATC', 'xpndrIdent', 1);

      if (identTag) {
        identTag.classList.remove('hidden');
        if (identTimer) clearTimeout(identTimer);
        identTimer = setTimeout(() => {
          identTag.classList.add('hidden');
        }, 5000);
      }
    });
  }

  const vfrBtn = document.getElementById('xpndr-vfr-btn');
  if (vfrBtn) {
    vfrBtn.addEventListener('click', () => {
      const input = document.getElementById('xpndr-code');
      if (input) {
        input.value = '1200';
        lastValidFreqs['xpndr-code'] = '1200';
        currentLiveRadioState.xpndrCode = '1200';
        updateVfrButtonState('1200');
      }
      sendSimCommand('ATC', 'xpndrSet', '1200');
    });
  }

  const xpndrInput = document.getElementById('xpndr-code');
  if (xpndrInput) {
    updateVfrButtonState(xpndrInput.value);

    xpndrInput.addEventListener('focus', () => {
      xpndrInput.select();
    });

    xpndrInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        xpndrInput.blur();
      }
    });

    xpndrInput.addEventListener('change', () => {
      let val = xpndrInput.value.replace(/[^0-7]/g, '').slice(0, 4);
      if (val.length < 4) val = val.padStart(4, '0');
      xpndrInput.value = val;
      lastValidFreqs['xpndr-code'] = val;
      currentLiveRadioState.xpndrCode = val;
      updateVfrButtonState(val);
      sendSimCommand('ATC', 'xpndrSet', val);
    });
  }
}

function attachSwapListener(btnId, category, eventName) {
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.addEventListener('click', () => {
      sendSimCommand(category, eventName, 0);
    });
  }
}

function attachSmartFreqListener(inputId, category, eventName, isComRadio) {
  const el = document.getElementById(inputId);
  if (!el) return;

  lastValidFreqs[inputId] = el.value;

  el.addEventListener('focus', () => {
    if (errorTimeouts[inputId]) {
      clearTimeout(errorTimeouts[inputId]);
      el.classList.remove('input-error');
    }
    el.value = '1';
  });

  el.addEventListener('input', () => {
    let rawDigits = el.value.replace(/\D/g, '');

    if (!rawDigits.startsWith('1')) {
      rawDigits = '1' + rawDigits;
    }

    const maxDigits = isComRadio ? 6 : 5;
    rawDigits = rawDigits.slice(0, maxDigits);

    if (rawDigits.length <= 3) {
      el.value = rawDigits;
    } else {
      el.value = rawDigits.slice(0, 3) + '.' + rawDigits.slice(3);
    }
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    }
  });

  el.addEventListener('blur', () => {
    const rawVal = el.value.trim();

    if (!rawVal || rawVal === '1') {
      el.value = lastValidFreqs[inputId];
      return;
    }

    const isValid = isComRadio ? isValidComFreq(rawVal) : isValidNavFreq(rawVal);

    if (isValid) {
      const formatted = isComRadio ? formatCom(rawVal) : formatNav(rawVal);
      el.value = formatted;
      lastValidFreqs[inputId] = formatted;
      el.classList.remove('input-error');
      if (category && eventName) {
        sendSimCommand(category, eventName, parseFloat(formatted));
      }
    } else {
      el.classList.add('input-error');
      errorTimeouts[inputId] = setTimeout(() => {
        el.classList.remove('input-error');
        el.value = lastValidFreqs[inputId];
      }, 1000);
    }
  });
}

function initModalActionButtons() {
  if (modalButtonsAttached) return;
  modalButtonsAttached = true;

  const cancelBtn = document.getElementById('modal-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      const modal = document.getElementById('preset-modal');
      if (modal) modal.classList.add('hidden');
    });
  }

  const doneBtn = document.getElementById('modal-done-btn');
  if (doneBtn) {
    doneBtn.addEventListener('click', () => {
      const isCom = editingPresetCategory === 'COMM';
      const labelInput = document.getElementById('modal-label-input');
      const freqInput = document.getElementById('modal-freq-input');
      const errorText = document.getElementById('modal-error-text');

      const label = labelInput ? labelInput.value.trim().toUpperCase() : '';
      const rawVal = freqInput ? freqInput.value.trim() : '';

      const isValid = isCom ? isValidComFreq(rawVal) : isValidNavFreq(rawVal);

      if (isValid) {
        const formatted = isCom ? formatCom(rawVal) : formatNav(rawVal);
        if (!presets[editingPresetCategory]) {
          presets[editingPresetCategory] = [null, null, null, null];
        }
        presets[editingPresetCategory][editingPresetIndex] = { label: label || 'PRE', freq: formatted };
        safeStorageSet(`msfs_${editingPresetCategory.toLowerCase()}_presets`, presets[editingPresetCategory]);

        const modal = document.getElementById('preset-modal');
        if (modal) modal.classList.add('hidden');
        
        // Refresh preset row DOM
        refreshPresetsRowDOM(editingPresetCategory);
      } else {
        if (freqInput) freqInput.classList.add('input-error');
        if (errorText) {
          errorText.textContent = isCom 
            ? 'Please enter a valid COM frequency (118.000 - 136.975)' 
            : 'Please enter a valid NAV frequency (108.00 - 117.975)';
          errorText.classList.add('visible');
        }
      }
    });
  }
}

function initModalSmartInput() {
  if (modalInputAttached) return;
  const el = document.getElementById('modal-freq-input');
  const errorText = document.getElementById('modal-error-text');
  if (!el) return;

  modalInputAttached = true;

  el.addEventListener('focus', () => {
    el.classList.remove('input-error');
    if (errorText) errorText.classList.remove('visible');
    if (!el.value) {
      el.value = '1';
    }
  });

  el.addEventListener('input', () => {
    el.classList.remove('input-error');
    if (errorText) errorText.classList.remove('visible');

    const isCom = editingPresetCategory === 'COMM';
    let rawDigits = el.value.replace(/\D/g, '');

    if (rawDigits.length > 0 && !rawDigits.startsWith('1')) {
      rawDigits = '1' + rawDigits;
    }

    const maxDigits = isCom ? 6 : 5;
    rawDigits = rawDigits.slice(0, maxDigits);

    if (rawDigits.length <= 3) {
      el.value = rawDigits;
    } else {
      el.value = rawDigits.slice(0, 3) + '.' + rawDigits.slice(3);
    }
  });

  el.addEventListener('blur', () => {
    const rawVal = el.value.trim();
    if (!rawVal || rawVal === '1') {
      el.value = '';
      return;
    }

    const isCom = editingPresetCategory === 'COMM';
    const isValid = isCom ? isValidComFreq(rawVal) : isValidNavFreq(rawVal);

    if (isValid) {
      el.value = isCom ? formatCom(rawVal) : formatNav(rawVal);
      el.classList.remove('input-error');
      if (errorText) errorText.classList.remove('visible');
    } else {
      el.classList.add('input-error');
      if (errorText) {
        errorText.textContent = isCom 
          ? 'Invalid COM frequency (118.000 - 136.975)' 
          : 'Invalid NAV frequency (108.00 - 117.975)';
        errorText.classList.add('visible');
      }
    }
  });
}

function openPresetModal(category, index) {
  editingPresetCategory = category;
  editingPresetIndex = index;
  const isCom = category === 'COMM';

  const modalTitle = document.getElementById('modal-title');
  if (modalTitle) modalTitle.textContent = `Configure ${category} Preset`;
  
  const labelInput = document.getElementById('modal-label-input');
  const freqInput = document.getElementById('modal-freq-input');
  const errorText = document.getElementById('modal-error-text');

  if (labelInput) labelInput.value = '';
  if (freqInput) {
    freqInput.placeholder = isCom ? '121.500' : '110.30';
    freqInput.value = '';
    freqInput.classList.remove('input-error');
  }
  if (errorText) {
    errorText.classList.remove('visible');
  }

  const modal = document.getElementById('preset-modal');
  if (modal) modal.classList.remove('hidden');
}
