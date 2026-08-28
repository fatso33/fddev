/**
 * PwaInstallManager.js
 * Cross-platform "Install App" support for the Settings page.
 *
 * Android/Chromium browsers fire `beforeinstallprompt`, which this class
 * captures immediately (module load time, not just app-init time, since the
 * event can fire before the rest of the app has finished booting) and holds
 * onto so a Settings-page button can trigger the native install prompt on
 * demand via promptInstall().
 *
 * iOS Safari never fires `beforeinstallprompt` and has no programmatic
 * install API at all -- "Add to Home Screen" is a manual Share-sheet action
 * only the user can take. For that platform this class just reports
 * `platform: 'ios'` so the UI can render instructions instead of a button.
 */
export class PwaInstallManager {
  constructor() {
    this.deferredPrompt = null;
    this.installed = this.detectStandalone();
    this.onStateChange = null;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.notify();
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.installed = true;
      this.notify();
    });

    // Some browsers update display-mode without firing 'appinstalled'
    // (e.g. after being launched from the home screen icon for the first
    // time) -- keep this in sync too.
    try {
      const mq = window.matchMedia('(display-mode: standalone)');
      if (mq && typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', (evt) => {
          if (evt.matches) {
            this.installed = true;
            this.notify();
          }
        });
      }
    } catch (_) {}
  }

  detectStandalone() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      // iOS Safari's own (non-standard) flag for home-screen launches
      if (window.navigator && window.navigator.standalone === true) return true;
    } catch (_) {}
    return false;
  }

  isIOS() {
    const ua = window.navigator.userAgent || '';
    const isIDevice = /iPad|iPhone|iPod/.test(ua);
    // iPadOS 13+ reports as "Macintosh" but exposes multi-touch, unlike a
    // real Mac.
    const isIPadOS13Plus = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    return isIDevice || isIPadOS13Plus;
  }

  /**
   * @returns {'installed'|'insecure-context'|'promptable'|'ios-manual'|'unsupported'}
   */
  getState() {
    if (this.installed) return 'installed';
    // Service workers (and 'beforeinstallprompt') only run in a secure
    // context -- HTTPS, or the special localhost exception, which only
    // applies when the browser itself is hitting localhost/127.0.0.1, not
    // when a phone reaches a dev machine's plain-http LAN address. That's
    // the single most common reason this card would otherwise show the
    // generic "unsupported" message during local network testing, so it
    // gets its own distinct state/message instead of being lumped in there.
    if (!window.isSecureContext) return 'insecure-context';
    if (this.deferredPrompt) return 'promptable';
    if (this.isIOS()) return 'ios-manual';
    return 'unsupported';
  }

  /**
   * Triggers the native Android/Chromium install prompt. Resolves to the
   * user's choice outcome ('accepted'|'dismissed'), or null if no deferred
   * prompt is currently held.
   */
  async promptInstall() {
    if (!this.deferredPrompt) return null;
    const promptEvent = this.deferredPrompt;
    this.deferredPrompt = null;
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    this.notify();
    return choice.outcome;
  }

  notify() {
    if (typeof this.onStateChange === 'function') this.onStateChange(this.getState());
  }
}
