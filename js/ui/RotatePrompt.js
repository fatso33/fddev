/**
 * RotatePrompt.js
 * Full-screen "rotate your device" overlay shown when the active page
 * declares Page.orientationLock === 'landscape' (currently only page_yoke)
 * but the device is still in portrait. screen.orientation.lock() is
 * attempted best-effort by app.js alongside this (see
 * FlightDeckApp.tryLockOrientation), but it silently no-ops on iOS Safari
 * and in several other contexts — this overlay is the actual cross-browser
 * enforcement mechanism: it blocks the page's widget grid from rendering
 * at all until the device's real orientation is landscape.
 */

export class RotatePrompt {
  constructor() {
    this.element = null;
  }

  mount(container) {
    this.element = document.createElement('div');
    this.element.className = 'fd-rotate-prompt hidden';
    this.element.innerHTML = `
      <div class="fd-rotate-prompt-inner">
        <svg class="fd-rotate-icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <rect x="7" y="2" width="10" height="16" rx="2"/>
          <path d="M11 18h2"/>
          <path d="M21 12a9 9 0 1 1-3.5-7.1"/>
          <path d="M21 3v5h-5"/>
        </svg>
        <div class="fd-rotate-title">Rotate Your Device</div>
        <div class="fd-rotate-sub">The Virtual Yoke requires landscape orientation to display.</div>
      </div>
    `;
    container.appendChild(this.element);
  }

  show() {
    if (this.element) this.element.classList.remove('hidden');
  }

  hide() {
    if (this.element) this.element.classList.add('hidden');
  }
}
