/**
 * VirtualYokeEngine.js
 * Owns the Virtual Yoke page's device-motion → elevator/aileron-axis
 * pipeline: DeviceOrientation permission/listening, reference ("center")
 * capture, attach/detach gating, and throttled dead-banded axis dispatch
 * to PC Bridge via the shared EventBus (see docs/Virtual-Yoke-Page.md).
 * Pitch (forward/back tilt) drives the elevator axis; roll (left/right
 * tilt) drives the aileron axis — both share one reference capture and one
 * attach/detach state, since they're one physical yoke gesture.
 *
 * Deliberately NOT a widget — the Center and Detach buttons are just UI
 * (VirtualYokeCenterWidget / VirtualYokeDetachWidget) that request actions
 * on this engine over the EventBus ('VYOKE_REQUEST_CENTER' /
 * 'VYOKE_REQUEST_TOGGLE_ATTACH') and re-render from its broadcast state
 * ('VYOKE_STATE_CHANGED'). Keeping the sensor/state logic off the widget
 * instances means it survives widget mount/unmount (e.g. a layout edit)
 * and isn't duplicated if a user places more than one Center/Detach
 * instance during layout editing.
 */

export class VirtualYokeEngine {
  // MSFS AXIS_ELEVATOR_SET (and most default AXIS_*_SET events) take a
  // signed 16-bit-range value: -16383 (full one way) .. +16383 (full the
  // other way), 0 = centered. See shared/deckEvents.js's "yokeElevatorAxis"
  // and pc-bridge/profileManager.js's DEFAULT_WRITE_TARGETS mapping.
  static AXIS_MIN = -16383;
  static AXIS_MAX = 16383;

  // Degrees of physical tilt (relative to the captured reference) that map
  // to full control deflection, per axis. Smaller = more sensitive (less
  // rotation needed to reach the limit) — resolution isn't a casualty of
  // tightening this: the output is always 16383 discrete steps regardless
  // of the degree range, and device orientation sensors are stable well
  // under 0.1°, so a smaller range only means more axis counts per degree
  // of real rotation, not coarser control.
  //
  // User-adjustable from the Settings page (Virtual Yoke Sensitivity card);
  // these are just the factory defaults and the "Reset to Default" targets.
  // ROLL_SENSITIVITY_DEG=35 was the original, shared value for both axes.
  static DEFAULT_PITCH_SENSITIVITY_DEG = 20;
  static DEFAULT_ROLL_SENSITIVITY_DEG = 35;

  // Sane bounds for the Settings page's inputs — below MIN the response
  // gets uncontrollably twitchy, above MAX a full-range tilt stops being
  // physically comfortable to hold.
  static SENSITIVITY_MIN_DEG = 5;
  static SENSITIVITY_MAX_DEG = 85;

  static PITCH_STORAGE_KEY = 'flightdeck_yoke_pitch_sensitivity_deg';
  static ROLL_STORAGE_KEY = 'flightdeck_yoke_roll_sensitivity_deg';

  // Minimum axis-value delta between two consecutive dispatches — avoids
  // flooding PC Bridge's WebSocket with near-duplicate values on every
  // ~16ms deviceorientation tick (EventBus's SIM_EVENT_DISPATCH path has
  // no throttling of its own; see docs/Virtual-Yoke-Page.md).
  static DEAD_BAND = 40;

  // 'freehand' (default — held in the hand, no mechanical centering) or
  // 'mounted' (phone seated in a self-centering rig, e.g. a 3D-printed
  // yoke mount) — picks which EXPO_K_* below _applyResponseCurve() uses.
  // User-selectable from the Settings page (Virtual Yoke card); see
  // setMountMode().
  static MOUNT_MODE_FREEHAND = 'freehand';
  static MOUNT_MODE_MOUNTED = 'mounted';
  static MOUNT_MODE_STORAGE_KEY = 'flightdeck_yoke_mount_mode';

  // Classic RC-transmitter expo coefficient: y = k*x^3 + (1-k)*x, x/y in
  // -1..1, k in 0..1 (k=0 is linear). Freehand needs real softening near
  // center — bare-hand tilt has no spring return, so ordinary hand tremor
  // would otherwise ride straight through as control input — hence a
  // pronounced k. A mounted rig's own spring centering already does that
  // job mechanically, so its k is just a light touch, not a replacement for
  // one; a rig with a genuine hard end-stop could reasonably run k=0
  // (fully linear) instead, since the physical stop itself is what makes a
  // real yoke's last few degrees controllable, not a software curve — see
  // docs/Virtual-Yoke-Page.md's Response curve section for the fuller
  // reasoning and the plotted comparison this was chosen from.
  static EXPO_K_FREEHAND = 0.5;
  static EXPO_K_MOUNTED = 0.15;

  constructor(eventBus) {
    this.eventBus = eventBus;

    this.listening = false;
    this.attached = true;
    this.hasReference = false;

    // Full 3x3 rotation matrices (device-frame → device-frame-at-sample-
    // time), not raw angles — see the class doc comment and
    // docs/Virtual-Yoke-Page.md's "Gimbal lock" section for why. _lastMatrix
    // is refreshed on every orientation sample regardless of hasReference,
    // so center()/toggleAttach() always have a current one to capture.
    this._lastMatrix = null;
    this._referenceMatrix = null;

    // 'unknown' | 'granted' | 'denied' | 'unsupported' | 'insecure-context'
    this.permissionState = 'unknown';

    this.pitchSensitivityDeg = VirtualYokeEngine._loadSensitivity(
      VirtualYokeEngine.PITCH_STORAGE_KEY, VirtualYokeEngine.DEFAULT_PITCH_SENSITIVITY_DEG
    );
    this.rollSensitivityDeg = VirtualYokeEngine._loadSensitivity(
      VirtualYokeEngine.ROLL_STORAGE_KEY, VirtualYokeEngine.DEFAULT_ROLL_SENSITIVITY_DEG
    );
    this.mountMode = VirtualYokeEngine._loadMountMode();

    // Current commanded deflection, normalized to -1..1 per axis (shaped by
    // the response curve, same value the axis dispatch is derived from) —
    // this is what the Yoke Deflection Indicator widget renders. Unlike
    // _pendingPitch/_pendingRoll below, this isn't dead-banded: it's a local
    // display concern, not a value going over the wire to PC Bridge, so it
    // updates on every orientation sample for smooth motion.
    this.pitchNorm = 0;
    this.rollNorm = 0;

    this._onOrientation = this._onOrientation.bind(this);
    this._pendingPitch = null;
    this._pendingRoll = null;
    this._lastSentPitch = null;
    this._lastSentRoll = null;
    this._rafId = null;
  }

  /**
   * Begins listening to hardware orientation events. Safe to call
   * repeatedly. Does not by itself start sending axis values — that only
   * happens once a reference has been captured via center() and the engine
   * is attached.
   */
  start() {
    if (this.listening) return;
    if (typeof window === 'undefined' || typeof window.DeviceOrientationEvent === 'undefined') {
      this.permissionState = 'unsupported';
      this._emitState();
      return;
    }
    this.listening = true;
    window.addEventListener('deviceorientation', this._onOrientation);
    this._emitState();
  }

  /**
   * Stops listening to hardware orientation events (e.g. the Virtual Yoke
   * page is no longer visible, or the device rotated back to portrait).
   * Reference position and attach state are preserved so resuming later
   * doesn't require re-centering.
   */
  stop() {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('deviceorientation', this._onOrientation);
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._pendingPitch = null;
    this._pendingRoll = null;
    this._emitState();
  }

  /**
   * Requests DeviceOrientation permission. Must be called from within a
   * user-gesture handler (a click) on iOS 13+ — Safari's
   * DeviceOrientationEvent.requestPermission() throws/rejects outside one.
   * Browsers without that gate (most of Android Chrome) resolve this
   * immediately as granted — PROVIDED the page is a secure context (https:,
   * or http://localhost). Motion/orientation sensors are unavailable on a
   * plain http:// origin (e.g. reached over the LAN by IP, as PC Bridge's
   * built-in static server normally serves this app) on both Android
   * Chrome and iOS Safari; there Chrome auto-denies (often without ever
   * showing a prompt or a per-site toggle at all — see 'insecure-context'
   * below) rather than falling through to the "no gate, just works" path
   * above. See docs/Virtual-Yoke-Page.md's "HTTPS requirement" section.
   * @returns {Promise<boolean>}
   */
  async requestPermission() {
    if (typeof window === 'undefined' || typeof window.DeviceOrientationEvent === 'undefined') {
      this.permissionState = 'unsupported';
      this._emitState();
      return false;
    }

    if (typeof window.isSecureContext !== 'undefined' && !window.isSecureContext) {
      this.permissionState = 'insecure-context';
      this._emitState();
      return false;
    }

    if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const result = await window.DeviceOrientationEvent.requestPermission();
        this.permissionState = result === 'granted' ? 'granted' : 'denied';
      } catch (err) {
        this.permissionState = 'denied';
      }
    } else {
      this.permissionState = 'granted';
    }

    this._emitState();
    return this.permissionState === 'granted';
  }

  /**
   * Captures the phone's current tilt as the new zero reference ("Center"
   * button). Requests motion permission first if it hasn't been granted
   * yet. Also re-attaches, since centering a detached yoke with intent to
   * fly again is the expected behavior.
   * @returns {Promise<boolean>} whether centering succeeded
   */
  async center() {
    if (this.permissionState !== 'granted') {
      const granted = await this.requestPermission();
      if (!granted) return false;
    }
    if (!this.listening) this.start();

    this._referenceMatrix = this._lastMatrix || VirtualYokeEngine._buildRotationMatrix(0, 0, 0);
    this.hasReference = true;
    this.attached = true;
    this._lastSentPitch = null;
    this._lastSentRoll = null;
    this.pitchNorm = 0;
    this.rollNorm = 0;
    this._emitState();
    this._emitDeflection();
    return true;
  }

  /**
   * Toggles attach/detach ("Detach" button). While detached, incoming
   * orientation samples keep refreshing _lastMatrix (so re-attaching or
   * re-centering reads a fresh value) but no axis events are dispatched —
   * the yoke holds its last commanded position, letting the user set the
   * phone down without disturbing the sim.
   */
  toggleAttach() {
    if (!this.hasReference) return;
    this.attached = !this.attached;
    if (this.attached) {
      // Re-center on re-attach so picking the phone back up doesn't snap
      // the yoke to wherever it happens to be resting.
      this._referenceMatrix = this._lastMatrix || this._referenceMatrix;
      this._lastSentPitch = null;
      this._lastSentRoll = null;
      this.pitchNorm = 0;
      this.rollNorm = 0;
      this._emitDeflection();
    }
    this._emitState();
  }

  _onOrientation(event) {
    // alpha (compass heading, rotation about the device's screen-normal
    // axis) can be null on devices/browsers without a magnetometer fusion
    // reading. Its *absolute* accuracy doesn't matter here — this engine
    // only ever uses relative rotation from a captured reference, and a
    // device that reports null just gets treated as a constant 0, which is
    // self-consistent for that purpose. beta/gamma are required; without
    // them there's no tilt data at all.
    if (event.beta === null || event.beta === undefined || event.gamma === null || event.gamma === undefined) return;
    const alphaDeg = (event.alpha === null || event.alpha === undefined) ? 0 : event.alpha;

    this._lastMatrix = VirtualYokeEngine._buildRotationMatrix(alphaDeg, event.beta, event.gamma);

    if (!this.hasReference || !this.attached || !this._referenceMatrix) return;

    // Rotation *from* the reference orientation *to* the current one,
    // expressed in the reference's own device frame — see the class doc
    // comment and docs/Virtual-Yoke-Page.md for why this (rather than
    // reading beta/gamma directly) avoids gimbal-lock artifacts when the
    // phone is held near-vertical, as it normally is for this page.
    const delta = VirtualYokeEngine._transposeMultiply(this._referenceMatrix, this._lastMatrix);
    const euler = VirtualYokeEngine._decompose(delta);

    // Landscape-yoke-hold mapping (device screen facing the user, held
    // with both hands): rotating the device about its own long axis
    // (decomposed as delta's "gamma") is the push/pull motion — pitch.
    // Rotating it about its own screen-normal axis (decomposed as delta's
    // "alpha") is the bank motion — roll. The third component
    // (delta's "beta", rotation about the device's short axis — a yaw-like
    // wrist twist when held this way) isn't a yoke input and is ignored.
    // Sign is empirically tuned; flip either line's leading minus if a
    // device reports that axis inverted.
    //
    // Landscape-primary vs. landscape-secondary hold flips pitch, not roll:
    // "pitch" is a rotation about the device's own long (body) axis, and
    // that axis physically reverses direction between the two landscape
    // holds (the edge that's "up" swaps sides), even though the real-world
    // nose-up/nose-down motion the pilot is making is identical either way.
    // "Roll" is a rotation about the screen-normal axis, which points out of
    // the screen toward the user in *both* holds, so it needs no
    // correction — this matches the reported bug exactly (pitch inverted in
    // one landscape orientation, roll fine in both). screen.orientation.lock
    // ('landscape') permits either hold with no further signal from the
    // OS, so this has to be corrected here rather than upstream.
    const pitchSign = VirtualYokeEngine._getScreenOrientationAngle() === 270 ? -1 : 1;
    const pitchDeg = pitchSign * euler.gamma;
    const rollDeg = euler.alpha;

    const expoK = this.mountMode === VirtualYokeEngine.MOUNT_MODE_MOUNTED
      ? VirtualYokeEngine.EXPO_K_MOUNTED
      : VirtualYokeEngine.EXPO_K_FREEHAND;
    this.pitchNorm = VirtualYokeEngine._toNorm(pitchDeg, this.pitchSensitivityDeg, expoK);
    this.rollNorm = VirtualYokeEngine._toNorm(rollDeg, this.rollSensitivityDeg, expoK);
    this._emitDeflection();

    this._pendingPitch = Math.round(this.pitchNorm * VirtualYokeEngine.AXIS_MAX);
    this._pendingRoll = Math.round(this.rollNorm * VirtualYokeEngine.AXIS_MAX);
    if (this._rafId === null) {
      this._rafId = requestAnimationFrame(() => this._flush());
    }
  }

  /**
   * Current screen rotation, in the Screen Orientation API's own convention
   * (degrees clockwise from the device's natural/portrait orientation):
   * 90 = landscape-primary (device rotated counterclockwise from portrait),
   * 270 = landscape-secondary (rotated clockwise). Falls back to 90 — the
   * orientation this engine's pitch sign was originally tuned against —
   * on a browser without the API, so behavior there is unchanged from
   * before this correction existed.
   * @returns {number}
   */
  static _getScreenOrientationAngle() {
    if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
      return screen.orientation.angle;
    }
    if (typeof window !== 'undefined' && typeof window.orientation === 'number') {
      // Legacy iOS Safari API: -90/0/90/180, not clamped to 0-359.
      return ((window.orientation % 360) + 360) % 360;
    }
    return 90;
  }

  /**
   * Normalizes a physical tilt to -1..1 relative to an axis's sensitivity
   * range, shaped by the response curve — the value both the dispatched
   * axis value and the Yoke Deflection Indicator widget are derived from.
   * @param {number} deltaDeg physical tilt in degrees, relative to reference
   * @param {number} sensitivityDeg degrees of tilt that map to full deflection for this axis
   * @param {number} expoK see _applyResponseCurve()
   * @returns {number} -1..1
   */
  static _toNorm(deltaDeg, sensitivityDeg, expoK) {
    const clamped = Math.max(-sensitivityDeg, Math.min(sensitivityDeg, deltaDeg));
    const norm = clamped / sensitivityDeg; // -1 .. 1, linear
    return VirtualYokeEngine._applyResponseCurve(norm, expoK);
  }

  /**
   * Classic RC-transmitter expo curve: y = k*x^3 + (1-k)*x. k=0 is exactly
   * linear; increasing k softens the slope near center (where an unaided
   * hand's own tremor/imprecision is worst, without a real yoke's spring
   * return to damp it) while the curve still passes through exactly (±1,
   * ±1), so full physical tilt always reaches full deflection regardless of
   * k. See docs/Virtual-Yoke-Page.md's Response curve section for the
   * reasoning behind EXPO_K_FREEHAND vs EXPO_K_MOUNTED specifically, and
   * why this replaced the previous knee-based ease-near-the-limit curve.
   * @param {number} norm -1..1
   * @param {number} k 0..1
   * @returns {number} -1..1
   */
  static _applyResponseCurve(norm, k) {
    return k * norm * norm * norm + (1 - k) * norm;
  }

  _flush() {
    this._rafId = null;
    const pitch = this._pendingPitch;
    const roll = this._pendingRoll;
    this._pendingPitch = null;
    this._pendingRoll = null;

    if (pitch !== null && this._shouldSend(pitch, this._lastSentPitch)) {
      this._lastSentPitch = pitch;
      this.eventBus.publish('SIM_EVENT_DISPATCH', {
        event: 'yokeElevatorAxis',
        value: pitch,
        sourceId: 'virtual-yoke-engine',
        category: 'K_EVENT'
      });
    }

    if (roll !== null && this._shouldSend(roll, this._lastSentRoll)) {
      this._lastSentRoll = roll;
      this.eventBus.publish('SIM_EVENT_DISPATCH', {
        event: 'yokeAileronAxis',
        value: roll,
        sourceId: 'virtual-yoke-engine',
        category: 'K_EVENT'
      });
    }
  }

  _shouldSend(value, lastSent) {
    if (lastSent === null) return true;
    if (value === 0 && lastSent !== 0) return true;
    return Math.abs(value - lastSent) >= VirtualYokeEngine.DEAD_BAND;
  }

  /**
   * Builds the standard device→earth-frame rotation matrix from a
   * deviceorientation sample's (alpha, beta, gamma), all in degrees. This
   * is the canonical W3C DeviceOrientation intrinsic Z-X'-Y'' Tait-Bryan
   * construction — the same relationship the browser itself uses to
   * derive alpha/beta/gamma from its internal sensor fusion, just run
   * forward instead of inverted.
   * @param {number} alphaDeg
   * @param {number} betaDeg
   * @param {number} gammaDeg
   * @returns {number[][]} 3x3 matrix
   */
  static _buildRotationMatrix(alphaDeg, betaDeg, gammaDeg) {
    const a = alphaDeg * Math.PI / 180;
    const b = betaDeg * Math.PI / 180;
    const g = gammaDeg * Math.PI / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const cb = Math.cos(b), sb = Math.sin(b);
    const cg = Math.cos(g), sg = Math.sin(g);
    return [
      [ca * cg - sa * sb * sg, -cb * sa, ca * sg + cg * sa * sb],
      [cg * sa + ca * sb * sg, ca * cb, sa * sg - ca * cg * sb],
      [-cb * sg, sb, cb * cg]
    ];
  }

  /**
   * Computes A^T × B for two 3x3 matrices — used to get the rotation
   * *from* orientation A *to* orientation B, expressed in A's own frame.
   * @param {number[][]} A
   * @param {number[][]} B
   * @returns {number[][]}
   */
  static _transposeMultiply(A, B) {
    const result = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) sum += A[k][i] * B[k][j];
        result[i][j] = sum;
      }
    }
    return result;
  }

  /**
   * Inverse of _buildRotationMatrix: decomposes a rotation matrix back into
   * (alpha, beta, gamma)-shaped degrees. Applied to a *delta* matrix
   * (rotation from a captured reference to the current sample, always near
   * identity for a modest physical tilt) rather than to the device's raw
   * absolute orientation, this is what actually fixes the gimbal-lock bug:
   * the naive approach of reading beta/gamma straight off the raw sensor
   * event is singular exactly when the device is held near-vertical
   * (beta ≈ ±90°) — precisely the normal holding posture for this page
   * (landscape, screen facing the user, like a real yoke) — which is why
   * pushing pitch further caused roll to snap to a random extreme. Delta-
   * from-reference is never near that singularity for any tilt within
   * this engine's clamped ±PITCH_SENSITIVITY_DEG/±ROLL_SENSITIVITY_DEG
   * range, regardless of how the phone is being held. See
   * docs/Virtual-Yoke-Page.md's "Gimbal lock"
   * section.
   * @param {number[][]} M
   * @returns {{alpha: number, beta: number, gamma: number}} degrees
   */
  static _decompose(M) {
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const beta = Math.asin(clamp(M[2][1]));
    const cb = Math.cos(beta);
    let alpha = 0;
    let gamma = 0;
    if (Math.abs(cb) > 1e-6) {
      gamma = Math.atan2(-M[2][0], M[2][2]);
      alpha = Math.atan2(-M[0][1], M[1][1]);
    }
    return {
      alpha: alpha * 180 / Math.PI,
      beta: beta * 180 / Math.PI,
      gamma: gamma * 180 / Math.PI
    };
  }

  getState() {
    return {
      listening: this.listening,
      attached: this.attached,
      hasReference: this.hasReference,
      permissionState: this.permissionState,
      pitchSensitivityDeg: this.pitchSensitivityDeg,
      rollSensitivityDeg: this.rollSensitivityDeg,
      mountMode: this.mountMode
    };
  }

  _emitState() {
    this.eventBus.publish('VYOKE_STATE_CHANGED', this.getState());
  }

  /**
   * Broadcasts the current normalized deflection (Yoke Deflection Indicator
   * widget's live feed). Separate from _emitState() because this fires on
   * every orientation sample while attached — far more often than the
   * discrete lifecycle events VYOKE_STATE_CHANGED represents.
   */
  _emitDeflection() {
    this.eventBus.publish('VYOKE_DEFLECTION_CHANGED', {
      pitchNorm: this.pitchNorm,
      rollNorm: this.rollNorm
    });
  }

  /**
   * Sets and persists the pitch (forward/back) axis's degrees-to-full-
   * deflection sensitivity ("Virtual Yoke Sensitivity" card, Settings page).
   * Clamped to [SENSITIVITY_MIN_DEG, SENSITIVITY_MAX_DEG]. Takes effect on
   * the very next orientation sample — no re-centering needed.
   * @param {number} deg
   */
  setPitchSensitivity(deg) {
    this.pitchSensitivityDeg = VirtualYokeEngine._clampSensitivity(deg, VirtualYokeEngine.DEFAULT_PITCH_SENSITIVITY_DEG);
    VirtualYokeEngine._saveSensitivity(VirtualYokeEngine.PITCH_STORAGE_KEY, this.pitchSensitivityDeg);
    this._emitState();
  }

  /**
   * Sets and persists the roll (left/right) axis's degrees-to-full-
   * deflection sensitivity. See setPitchSensitivity().
   * @param {number} deg
   */
  setRollSensitivity(deg) {
    this.rollSensitivityDeg = VirtualYokeEngine._clampSensitivity(deg, VirtualYokeEngine.DEFAULT_ROLL_SENSITIVITY_DEG);
    VirtualYokeEngine._saveSensitivity(VirtualYokeEngine.ROLL_STORAGE_KEY, this.rollSensitivityDeg);
    this._emitState();
  }

  /**
   * Sets and persists whether the phone is being held freehand or seated in
   * a self-centering mount ("Virtual Yoke" card, Settings page) — picks
   * EXPO_K_FREEHAND vs EXPO_K_MOUNTED in _applyResponseCurve(). Invalid
   * input falls back to MOUNT_MODE_FREEHAND. Takes effect on the very next
   * orientation sample.
   * @param {string} mode MOUNT_MODE_FREEHAND | MOUNT_MODE_MOUNTED
   */
  setMountMode(mode) {
    this.mountMode = mode === VirtualYokeEngine.MOUNT_MODE_MOUNTED
      ? VirtualYokeEngine.MOUNT_MODE_MOUNTED
      : VirtualYokeEngine.MOUNT_MODE_FREEHAND;
    VirtualYokeEngine._saveMountMode(this.mountMode);
    this._emitState();
  }

  /**
   * @returns {string} MOUNT_MODE_FREEHAND | MOUNT_MODE_MOUNTED
   */
  static _loadMountMode() {
    if (typeof localStorage === 'undefined') return VirtualYokeEngine.MOUNT_MODE_FREEHAND;
    try {
      const raw = localStorage.getItem(VirtualYokeEngine.MOUNT_MODE_STORAGE_KEY);
      return raw === VirtualYokeEngine.MOUNT_MODE_MOUNTED
        ? VirtualYokeEngine.MOUNT_MODE_MOUNTED
        : VirtualYokeEngine.MOUNT_MODE_FREEHAND;
    } catch (_) {
      return VirtualYokeEngine.MOUNT_MODE_FREEHAND;
    }
  }

  /**
   * @param {string} mode
   */
  static _saveMountMode(mode) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(VirtualYokeEngine.MOUNT_MODE_STORAGE_KEY, mode);
    } catch (_) {}
  }

  /**
   * @param {number} deg
   * @param {number} fallback used when deg isn't a finite number
   * @returns {number}
   */
  static _clampSensitivity(deg, fallback) {
    const n = Number(deg);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(VirtualYokeEngine.SENSITIVITY_MIN_DEG, Math.min(VirtualYokeEngine.SENSITIVITY_MAX_DEG, n));
  }

  /**
   * @param {string} key localStorage key
   * @param {number} fallback factory default, used when unset/invalid/unavailable
   * @returns {number}
   */
  static _loadSensitivity(key, fallback) {
    if (typeof localStorage === 'undefined') return fallback;
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return VirtualYokeEngine._clampSensitivity(parseFloat(raw), fallback);
    } catch (_) {
      return fallback;
    }
  }

  /**
   * @param {string} key
   * @param {number} value
   */
  static _saveSensitivity(key, value) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, String(value));
    } catch (_) {}
  }
}
