import { test, expect } from '@playwright/test';

/**
 * core.rotary's rendered public behaviour (Rotary rebuild, ticket 02) — the confirmed
 * seam for this ticket: the events it emits, the value it writes, and what it does to
 * the pointer. Driven through /tests/e2e/rotary-harness.html, which mounts the real
 * renderer against a fake host and nothing else; see that file's header for why this
 * is a real browser rather than jsdom.
 *
 * The decision layer itself (ticket 01's rotaryEngine.js) is exhaustively unit-tested
 * in shared/rotaryEngine.test.js and is deliberately NOT re-tested here — these tests
 * only assert the Component's own job: wiring gestures in, and markup/events/writes out.
 */

const HARNESS = '/tests/e2e/rotary-harness.html';

// Mirrors the harness's #box: a 240x240 layout box at (50,50).
const BOX = { x: 50, y: 50, w: 240, h: 240 };
const CENTER = { x: BOX.x + BOX.w / 2, y: BOX.y + BOX.h / 2 };
const GRAB_RADIUS = 100;

/** min 0 / max 100 over a 270-degree sweep starting at -135 (mid-range points up). */
const DEF = {
  id: 'rot',
  type: 'core.rotary',
  layout: { col: 1, row: 1, w: 4, h: 4 },
  binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet', pollFrequencyHz: 1 },
  props: { min: 0, max: 100, degreesPerUnit: 3, sweepDegrees: 270, startAngle: -135 }
};

/** Visual rotation the Face should be at for a given bound value, per DEF. */
const rotationFor = (value) => -135 + (value / 100) * 270;

/** A point on the grab circle, `deg` clockwise from straight up. */
function pointAt(deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: CENTER.x + GRAB_RADIUS * Math.cos(rad), y: CENTER.y + GRAB_RADIUS * Math.sin(rad) };
}

/** Real pointer gesture: grab at `fromDeg` and sweep to `toDeg` in small steps. */
async function turn(page, fromDeg, toDeg, { release = true, steps = 12 } = {}) {
  const start = pointAt(fromDeg);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const p = pointAt(fromDeg + ((toDeg - fromDeg) * i) / steps);
    await page.mouse.move(p.x, p.y);
  }
  if (release) await page.mouse.up();
}

async function mount(page, def = DEF, opts = {}) {
  await page.goto(HARNESS);
  await page.evaluate(([d, o]) => window.__mountRotary(d, o), [def, opts]);
}

test('an End user turning the knob rotates it and writes the new value to its binding', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.__pushTelemetry(50));
  expect(await page.evaluate(() => window.__faceAngle())).toBeCloseTo(rotationFor(50), 0);

  await turn(page, 0, 90);

  const triggers = await page.evaluate(() => window.__triggers());
  expect(triggers[0]).toBe('turnStart');
  expect(triggers[triggers.length - 1]).toBe('turnEnd');
  expect(triggers.filter((t) => t === 'turn').length).toBeGreaterThan(0);

  // A 90-degree arc at 3 degrees-per-unit is +30 units from 50.
  const dispatched = await page.evaluate(() => window.__fd.dispatched);
  expect(dispatched.length).toBeGreaterThan(0);
  expect(dispatched.every((d) => d.event === 'apHdgSet')).toBe(true);
  const finalValue = dispatched[dispatched.length - 1].value;
  expect(finalValue).toBeGreaterThan(70);
  expect(finalValue).toBeLessThan(90);

  // ...and the knob visibly followed it.
  expect(await page.evaluate(() => window.__faceAngle())).toBeCloseTo(rotationFor(finalValue), 0);
});

test('every emitted payload carries a value key, so a dispatch action needs no special case', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.__pushTelemetry(50));
  await turn(page, 0, 45);

  const log = await page.evaluate(() => window.__fd.log);
  expect(log.length).toBeGreaterThanOrEqual(3);
  for (const entry of log) {
    expect(typeof entry.payload.value).toBe('number');
  }
  const turnEntry = log.find((e) => e.trigger === 'turn');
  expect(turnEntry.payload.direction).toBe('cw');
  expect(typeof turnEntry.payload.delta).toBe('number');
});

test('the knob reflects its bound value on first load, before any gesture', async ({ page }) => {
  await mount(page);
  // The old Component never reflected telemetry at all.
  await page.evaluate(() => window.__pushTelemetry(0));
  expect(await page.evaluate(() => window.__faceAngle())).toBeCloseTo(rotationFor(0), 0);
  await page.evaluate(() => window.__pushTelemetry(100));
  expect(await page.evaluate(() => window.__faceAngle())).toBeCloseTo(rotationFor(100), 0);
});

test('a released knob does not snap backwards to a stale reading, then follows telemetry again once reconciled', async ({ page }) => {
  await mount(page, DEF, { pollPeriodMs: 1000 });
  await page.evaluate(() => window.__pushTelemetry(50));
  await turn(page, 0, 90);
  const afterTurn = await page.evaluate(() => window.__faceAngle());

  // The stale pre-turn reading arriving late must NOT pull the knob back.
  await page.evaluate(() => window.__pushTelemetry(50));
  expect(await page.evaluate(() => window.__faceAngle())).toBeCloseTo(afterTurn, 0);

  // The sim echoing what was actually sent closes the window; telemetry is
  // authoritative again from there.
  const sent = await page.evaluate(() => window.__fd.dispatched.at(-1).value);
  await page.evaluate((v) => window.__pushTelemetry(v), sent);
  await page.evaluate(() => window.__pushTelemetry(10));
  expect(await page.evaluate(() => window.__faceAngle())).toBeCloseTo(rotationFor(10), 0);
});

test('a closed guard blocks turning, not just pressing', async ({ page }) => {
  const guarded = { ...DEF, layout: { ...DEF.layout, guard: { enabled: true } } };
  await mount(page, guarded);
  await page.evaluate(() => window.__pushTelemetry(50));
  const before = await page.evaluate(() => window.__faceAngle());

  await turn(page, 0, 90);

  // guardOpen/guardClose are the guard overlay's own business and may well fire —
  // what must not happen is the turn getting through it.
  const turnTriggers = (await page.evaluate(() => window.__triggers())).filter((t) => t.startsWith('turn'));
  expect(turnTriggers).toEqual([]);
  expect(await page.evaluate(() => window.__fd.dispatched)).toEqual([]);
  expect(await page.evaluate(() => window.__faceAngle())).toBeCloseTo(before, 0);
});

test('pointer capture is taken on grab and explicitly released on end, so the gesture survives leaving the bounds', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.__pushTelemetry(50));

  await turn(page, 0, 60, { release: false });
  expect(await page.evaluate(() => window.__fd.capture.taken.length)).toBe(1);
  expect(await page.evaluate(() => window.__fd.capture.released.length)).toBe(0);

  // Finger leaves the Component's bounds entirely, then releases out there.
  await page.mouse.move(5, 5);
  await page.mouse.up();

  expect(await page.evaluate(() => window.__fd.capture.released.length)).toBe(1);
  const triggers = await page.evaluate(() => window.__triggers());
  expect(triggers[triggers.length - 1]).toBe('turnEnd');
});

test('the gesture surface disables native touch behaviour so a turn is never stolen by page scroll', async ({ page }) => {
  await mount(page);
  const touchAction = await page.evaluate(() => getComputedStyle(document.querySelector('.fd-rotary-face')).touchAction);
  expect(touchAction).toBe('none');
});

test('the Component sizes to the layout space the Author gave it', async ({ page }) => {
  await mount(page);
  const [face, box] = await page.evaluate(() => [window.__faceRect(), window.__boxRect()]);
  // Square, and filling the box it was given — not the old fixed 56px knob.
  expect(face.width).toBeCloseTo(face.height, 0);
  expect(face.width).toBeGreaterThan(box.width * 0.9);
});

test('authored border, background and glow land on the visible knob, not an invisible wrapper', async ({ page }) => {
  const styled = {
    ...DEF,
    style: {
      border: { width: 4, color: '#ff8800', radius: 999, glow: { color: '#00e5ff', blur: 12 } },
      background: { type: 'color', color: '#101820' }
    }
  };
  await mount(page, styled);
  const result = await page.evaluate(() => {
    const outer = document.querySelector('.fd-comp-rotary');
    const face = document.querySelector('.fd-rotary-face');
    const cs = (el) => getComputedStyle(el);
    return {
      faceBorder: cs(face).borderTopWidth,
      faceShadow: cs(face).boxShadow,
      faceBg: cs(face).backgroundColor,
      outerBorder: cs(outer).borderTopWidth,
      outerShadow: cs(outer).boxShadow,
      outerBg: cs(outer).backgroundColor
    };
  });
  expect(result.faceBorder).toBe('4px');
  expect(result.faceBg).toBe('rgb(16, 24, 32)');
  expect(result.faceShadow).toContain('rgb(0, 229, 255)');
  // The stale-clear half of the surfaceTarget contract: nothing stranded on the wrapper.
  expect(result.outerBorder).toBe('0px');
  expect(result.outerShadow).toBe('none');
  expect(result.outerBg).toBe('rgba(0, 0, 0, 0)');
});

test('the Component supplies the engine with the host-reported poll period rather than a guess', async ({ page }) => {
  await mount(page, DEF, { pollPeriodMs: 40 });
  expect(await page.evaluate(() => window.__fd.renderer.resolvePollPeriodMs())).toBe(40);

  // The period is what the engine derives its Reconciliation timeout from, so the
  // observable difference is how long a released knob holds out against telemetry
  // that never echoes what was sent. On a fast-tier period, 400ms is well past it.
  await page.evaluate(() => window.__pushTelemetry(50));
  await turn(page, 0, 90);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__pushTelemetry(20));
  expect(await page.evaluate(() => window.__faceAngle())).toBeCloseTo(rotationFor(20), 0);

  // Same elapsed time, same gesture, normal-tier period (1Hz → a ~2s window): still
  // holding. A hardcoded timeout could not tell these two apart.
  await mount(page, DEF, { pollPeriodMs: 1000 });
  expect(await page.evaluate(() => window.__fd.renderer.resolvePollPeriodMs())).toBe(1000);
  await page.evaluate(() => window.__pushTelemetry(50));
  await turn(page, 0, 90);
  const held = await page.evaluate(() => window.__faceAngle());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__pushTelemetry(20));
  expect(await page.evaluate(() => window.__faceAngle())).toBeCloseTo(held, 0);
});

test('with no host poll-period method, the period falls back to the binding\'s own declared rate', async ({ page }) => {
  const fastBound = { ...DEF, binding: { ...DEF.binding, pollFrequencyHz: 20 } };
  await mount(page, fastBound, { omitHostExtras: true });
  expect(await page.evaluate(() => window.__fd.renderer.resolvePollPeriodMs())).toBe(50);
});

test('while engaged, the Component requests the fast poll tier for its own readable binding and releases it on end', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.__pushTelemetry(50));

  await turn(page, 0, 45, { release: false });
  expect(await page.evaluate(() => window.__fd.fastPollRequests)).toBe(1);
  expect(await page.evaluate(() => window.__fd.fastPollReleases)).toBe(0);

  await page.mouse.up();
  expect(await page.evaluate(() => window.__fd.fastPollReleases)).toBe(1);
});

test('a dispatch failure reverts the knob to telemetry instead of leaving a value that was never applied', async ({ page }) => {
  await mount(page, DEF, { dispatchOk: false });
  await page.evaluate(() => window.__pushTelemetry(50));
  await turn(page, 0, 90);
  await page.evaluate(() => window.__pushTelemetry(50));
  expect(await page.evaluate(() => window.__faceAngle())).toBeCloseTo(rotationFor(50), 0);
});

test('degrades on a host with no poll-period or fast-tier support (Widget Studio preview)', async ({ page }) => {
  await mount(page, DEF, { omitHostExtras: true });
  await page.evaluate(() => window.__pushTelemetry(50));
  const before = await page.evaluate(() => window.__faceAngle());

  await turn(page, 0, 90);

  expect(await page.evaluate(() => window.__faceAngle())).not.toBeCloseTo(before, 0);
  expect(await page.evaluate(() => window.__triggers())).toContain('turn');
});

test('a Rotary carrying only the deleted props still renders and turns, degrading to defaults', async ({ page }) => {
  // Regression guard for the two Widget Studio starter templates, which still declare
  // the old Rotary's props (reworking them is ticket 15). FDWS's rule is that an
  // unrecognised field degrades to prior/default behaviour rather than crashing.
  const legacy = {
    id: 'rot_hdg',
    type: 'core.rotary',
    layout: { col: 1, row: 1, w: 5, h: 3 },
    binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' },
    props: { coarseStep: 10, fineStep: 1, circular: true }
  };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await mount(page, legacy);
  // Defaults: 0..100 over a 270-degree sweep from -135, so an unbound knob rests at -135.
  expect(await page.evaluate(() => window.__faceAngle())).toBeCloseTo(-135, 0);

  await page.evaluate(() => window.__pushTelemetry(50));
  await turn(page, 0, 90);

  expect(await page.evaluate(() => window.__triggers())).toContain('turn');
  expect(errors).toEqual([]);
});

// Ticket 03 (Scrub and Tap gestures). The decision layer's per-gesture behaviour is
// exhaustively unit-tested in shared/rotaryEngine.test.js — these only confirm the
// Component wires REAL pointer events into it correctly and shows the right cursor
// affordance, same division of labour as the Arc tests above.

test('defaults to the Arc cursor affordance when props.gesture is unset', async ({ page }) => {
  await mount(page);
  const cursor = await page.evaluate(() => getComputedStyle(document.querySelector('.fd-rotary-face')).cursor);
  expect(cursor).toBe('grab');
  expect(await page.evaluate(() => document.querySelector('.fd-rotary-face').dataset.gesture)).toBe('arc');
});

test('Scrub: a vertical drag turns the knob like a wheel, and shows the scrub cursor affordance', async ({ page }) => {
  const scrubDef = { ...DEF, props: { ...DEF.props, gesture: 'scrub', degreesPerUnit: 2 } };
  await mount(page, scrubDef);
  await page.evaluate(() => window.__pushTelemetry(50));

  expect(await page.evaluate(() => document.querySelector('.fd-rotary-face').dataset.gesture)).toBe('scrub');
  const cursor = await page.evaluate(() => getComputedStyle(document.querySelector('.fd-rotary-face')).cursor);
  expect(cursor).toBe('ns-resize');

  // Drag straight up from center by 60px, at 2px/unit — the value should have
  // increased by roughly 30 units.
  await page.mouse.move(CENTER.x, CENTER.y);
  await page.mouse.down();
  for (const dy of [10, 20, 30, 40, 50, 60]) {
    await page.mouse.move(CENTER.x, CENTER.y - dy);
  }
  await page.mouse.up();

  const triggers = await page.evaluate(() => window.__triggers());
  expect(triggers[0]).toBe('turnStart');
  expect(triggers[triggers.length - 1]).toBe('turnEnd');
  expect(triggers.filter((t) => t === 'turn').length).toBeGreaterThan(0);

  const dispatched = await page.evaluate(() => window.__fd.dispatched);
  expect(dispatched.length).toBeGreaterThan(0);
  const finalValue = dispatched[dispatched.length - 1].value;
  expect(finalValue).toBeGreaterThan(65);
  expect(finalValue).toBeLessThan(95);
});

test('Tap: a tap with no drag changes the value by one step, in the direction of the tapped side', async ({ page }) => {
  const tapDef = { ...DEF, props: { ...DEF.props, gesture: 'tap', degreesPerUnit: 5 } };
  await mount(page, tapDef);
  await page.evaluate(() => window.__pushTelemetry(50));

  expect(await page.evaluate(() => document.querySelector('.fd-rotary-face').dataset.gesture)).toBe('tap');
  const cursor = await page.evaluate(() => getComputedStyle(document.querySelector('.fd-rotary-face')).cursor);
  expect(cursor).toBe('pointer');

  // Tap the right half of the knob (positive dx from center) — increment side.
  // No intermediate mouse.move between down and up: "no drag required".
  await page.mouse.move(CENTER.x + 60, CENTER.y);
  await page.mouse.down();
  await page.mouse.up();

  const triggers = await page.evaluate(() => window.__triggers());
  expect(triggers).toEqual(['turnStart', 'turn', 'turnEnd']);

  const dispatched = await page.evaluate(() => window.__fd.dispatched);
  expect(dispatched.length).toBeGreaterThan(0);
  expect(dispatched[dispatched.length - 1].value).toBe(55);
});

test('Tap: tapping the left half decrements instead', async ({ page }) => {
  const tapDef = { ...DEF, props: { ...DEF.props, gesture: 'tap', degreesPerUnit: 5 } };
  await mount(page, tapDef);
  await page.evaluate(() => window.__pushTelemetry(50));

  await page.mouse.move(CENTER.x - 60, CENTER.y);
  await page.mouse.down();
  await page.mouse.up();

  const dispatched = await page.evaluate(() => window.__fd.dispatched);
  expect(dispatched[dispatched.length - 1].value).toBe(45);
});

test('destroying the Component mid-turn releases its fast-tier hold', async ({ page }) => {
  // A widget removed (or re-rendered) while the knob is held would otherwise leave a
  // live subscription behind for the rest of the session, holding the SimVar on the
  // fast tier with a listener nothing will ever remove.
  await mount(page);
  await turn(page, 0, 45, { release: false });
  expect(await page.evaluate(() => window.__fd.fastPollRequests)).toBe(1);

  await page.evaluate(() => window.__fd.renderer.destroy());

  expect(await page.evaluate(() => window.__fd.fastPollReleases)).toBe(1);
});
