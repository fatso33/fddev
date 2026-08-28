/**
 * WakeLockManager.js
 * Keeps the device screen from timing out/sleeping while the app is active,
 * via the Screen Wake Lock API. Purely a UX convenience — no FDWS/telemetry
 * involvement — so it fails silently on browsers/contexts that don't support
 * it (e.g. non-HTTPS origins, older Safari) rather than surfacing an error.
 *
 * The browser auto-releases a wake lock whenever the document goes hidden
 * (tab switch, screen locked, app backgrounded) — that's spec behavior, not
 * something to work around — so this re-requests the lock on every
 * `visibilitychange` back to visible, as long as the user hasn't disabled it.
 */

const STORAGE_KEY = 'flightdeck_wakelock_enabled';

export class WakeLockManager {
  constructor() {
    this.sentinel = null;
    this.enabled = localStorage.getItem(STORAGE_KEY) !== 'false'; // default on
    this.supported = 'wakeLock' in navigator;

    if (this.supported) {
      document.addEventListener('visibilitychange', () => {
        if (this.enabled && document.visibilityState === 'visible') {
          this.acquire();
        }
      });
    }
  }

  async acquire() {
    if (!this.supported || !this.enabled || this.sentinel) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
    } catch (_) {
      // Denied (e.g. low battery on some platforms) or unsupported context —
      // silently no-op, screen will time out normally.
      this.sentinel = null;
    }
  }

  async release() {
    if (this.sentinel) {
      await this.sentinel.release().catch(() => {});
      this.sentinel = null;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem(STORAGE_KEY, String(enabled));
    if (enabled) {
      this.acquire();
    } else {
      this.release();
    }
  }

  /**
   * Wires an existing checkbox input to this manager's enabled state.
   * @param {HTMLInputElement} checkbox
   */
  bindToggle(checkbox) {
    if (!checkbox) return;
    checkbox.checked = this.enabled;
    checkbox.disabled = !this.supported;
    if (!this.supported) {
      checkbox.title = 'Screen Wake Lock is not supported in this browser';
    }
    checkbox.addEventListener('change', () => {
      this.setEnabled(checkbox.checked);
    });
  }
}
