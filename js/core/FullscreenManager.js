/**
 * FullscreenManager.js
 * Optional "hide the mobile status bar" toggle via the standard Fullscreen
 * API (requestFullscreen()/exitFullscreen()) — deliberately NOT the
 * manifest's display:"fullscreen"/display_override mode. That route goes
 * through Android's WebAPK-generation-time manifest translation, the same
 * layer that had a real cross-Chrome-version bug for the "orientation"
 * field (see docs/... rotation-lock writeup); this API hides the status
 * bar at runtime instead, works in both an installed PWA and a plain
 * browser tab, and is reversible without reinstalling anything.
 *
 * Browsers only grant fullscreen from within a real user gesture, and never
 * resume it automatically on page load/reload even if it was left enabled
 * last session — see _armResumeOnNextGesture().
 */

const STORAGE_KEY = 'flightdeck_fullscreen_enabled';

export class FullscreenManager {
  /**
   * @param {{ onEnter?: () => void }} [options] onEnter fires every time
   *   fullscreen is actually entered (including the auto-resume-on-next-
   *   gesture path) -- used to show our own instructions, since Android's
   *   own "press Back to exit full screen" system toast is inaccurate here
   *   (there's no in-app Back target) and can't be suppressed or edited
   *   from the page itself.
   */
  constructor({ onEnter } = {}) {
    this.enabled = localStorage.getItem(STORAGE_KEY) === 'true'; // default off
    this.supported = !!(document.documentElement.requestFullscreen && document.exitFullscreen);
    this.onEnter = onEnter;
    this._checkbox = null;
    this._resumeArmed = false;

    if (this.supported) {
      // Keep the checkbox in sync if fullscreen was exited some way other
      // than our own toggle (Android back gesture, browser Escape, etc.).
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && this._checkbox) {
          this._checkbox.checked = false;
        }
      });

      if (this.enabled) {
        this._armResumeOnNextGesture();
      }
    }
  }

  async enter() {
    if (!this.supported || document.fullscreenElement) return;
    try {
      await document.documentElement.requestFullscreen();
      this.onEnter?.();
    } catch (_) {
      // Not called from within a user gesture, or denied — silently no-op;
      // _armResumeOnNextGesture() catches the next real tap instead.
    }
  }

  async exit() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem(STORAGE_KEY, String(enabled));
    if (enabled) {
      this.enter();
    } else {
      this.exit();
    }
  }

  /**
   * A page load/reload never resumes fullscreen by itself, even if the
   * user had it enabled — so if it was left on, request it again on
   * whichever comes first after load: the user's very next tap anywhere.
   */
  _armResumeOnNextGesture() {
    if (this._resumeArmed) return;
    this._resumeArmed = true;
    const resume = () => {
      document.removeEventListener('pointerdown', resume, true);
      if (this.enabled && !document.fullscreenElement) {
        this.enter();
      }
    };
    document.addEventListener('pointerdown', resume, true);
  }

  /**
   * Wires an existing checkbox input to this manager's enabled state.
   * @param {HTMLInputElement} checkbox
   */
  bindToggle(checkbox) {
    if (!checkbox) return;
    this._checkbox = checkbox;
    checkbox.checked = this.enabled;
    checkbox.disabled = !this.supported;
    if (!this.supported) {
      checkbox.title = 'Fullscreen is not supported in this browser';
    }
    checkbox.addEventListener('change', () => {
      this.setEnabled(checkbox.checked);
    });
  }
}
