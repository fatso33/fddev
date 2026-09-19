import { test, expect } from '@playwright/test';

/**
 * The Rotary's appearance in the PWA, against the PWA's own stylesheet
 * (css/widgets.css, hand-maintained and not synced from shared/): the Face sizing itself
 * to its layout box, the widget's light and dark theme, and the turning state under real
 * pointer events. Driven through the same harness as rotary-component.spec.js.
 */

const HARNESS = '/tests/e2e/rotary-harness.html';

const EVERYTHING = {
  min: 0, max: 100, degreesPerUnit: 3, sweepDegrees: 270, startAngle: -135,
  fillStyle: 'conic', faceColor: '#334155', faceColor2: '#e2e8f0', innerShadow: 5,
  rimColor: '#1e293b', knurlStyle: 'teeth', indicatorShape: 'triangle', indicatorColor: '#e2e8f0', indicatorGlow: 3,
  capDiameter: 26, capContent: 'label', capLabel: 'HDG',
  scaleMajorDivisions: 5, scaleLabels: true, scaleColor: '#94a3b8', dropShadow: 5
};

const def = (props, style = {}) => ({
  id: 'rot',
  type: 'core.rotary',
  layout: { col: 1, row: 1, w: 4, h: 4 },
  binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet', pollFrequencyHz: 1 },
  props,
  style
});

async function mount(page, definition, opts = {}) {
  await page.goto(HARNESS);
  await page.evaluate(([d, o]) => window.__mountRotary(d, o), [definition, opts]);
}

const groups = (page) => page.locator('[data-face-group]').evaluateAll((els) => els.map((el) => el.dataset.faceGroup));

test('every appearance group the Author configured is drawn', async ({ page }) => {
  await mount(page, def(EVERYTHING));
  expect(await groups(page)).toEqual(['depth', 'fill', 'inset', 'rim', 'knurling', 'scale', 'indicator', 'cap']);
  await expect(page.locator('[data-face-group="cap"] text')).toHaveText('HDG');
  await expect(page.locator('[data-face-group="scale"] text')).toHaveCount(6);
});

test('the Face stays square and tracks the shorter side of a layout box that is not', async ({ page }) => {
  await mount(page, def(EVERYTHING));
  for (const [width, height] of [[240, 240], [360, 200], [150, 320]]) {
    await page.evaluate(([w, h]) => {
      const box = document.getElementById('box');
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
    }, [width, height]);
    const face = await page.evaluate(() => window.__faceRect());
    expect(face.width).toBeCloseTo(face.height, 0);
    expect(face.width).toBeCloseTo(Math.min(width, height), 0);
  }
});

test('the Face carries no text that a drag can select', async ({ page }) => {
  await mount(page, def(EVERYTHING));
  const select = await page.locator('.fd-rotary-face').evaluate((el) => getComputedStyle(el).userSelect);
  expect(select).toBe('none');
});

test('turning a knob with a Cap and a scale still turns it, and leaves the scale and Cap where they are', async ({ page }) => {
  await mount(page, def(EVERYTHING));
  await page.evaluate(() => window.__pushTelemetry(20));
  const before = await page.evaluate(() => ({
    angle: window.__faceAngle(),
    scale: document.querySelector('[data-face-group="scale"]').outerHTML,
    cap: document.querySelector('[data-face-group="cap"]').outerHTML
  }));
  await page.evaluate(() => window.__pushTelemetry(70));
  const after = await page.evaluate(() => ({
    angle: window.__faceAngle(),
    scale: document.querySelector('[data-face-group="scale"]').outerHTML,
    cap: document.querySelector('[data-face-group="cap"]').outerHTML
  }));
  expect(after.angle).toBeGreaterThan(before.angle + 50);
  expect(after.scale).toBe(before.scale);
  expect(after.cap).toBe(before.cap);
});

test('a widget authored for dark is re-drawn in the light theme, colour by colour', async ({ page }) => {
  const colours = () => page.evaluate(() => ({
    rim: document.querySelector('[data-face-group="rim"]').getAttribute('stroke'),
    pointer: document.querySelector('[data-face-group="indicator"] > :last-child').getAttribute('fill'),
    scale: document.querySelector('[data-face-group="scale"] path').getAttribute('stroke'),
    fill: document.querySelector('[data-face-group="fill"] path').getAttribute('fill')
  }));

  await mount(page, def(EVERYTHING), { theme: 'dark' });
  const dark = await colours();
  expect(dark.rim).toBe('#1e293b');
  expect(dark.pointer).toBe('#e2e8f0');

  await mount(page, def(EVERYTHING), { theme: 'light' });
  const light = await colours();
  for (const key of Object.keys(dark)) expect(light[key], key).not.toBe(dark[key]);
});

test('an unstyled Rotary is legible on a light widget: its pointer is not the near-white it is on dark', async ({ page }) => {
  await mount(page, def({ min: 0, max: 100 }), { theme: 'dark' });
  const dark = await page.locator('[data-face-group="indicator"]').getAttribute('stroke');
  await mount(page, def({ min: 0, max: 100 }), { theme: 'light' });
  const light = await page.locator('[data-face-group="indicator"]').getAttribute('stroke');
  expect(light).not.toBe(dark);
});

test('the turning state is styled while a finger is on the knob and gone the moment it lifts', async ({ page }) => {
  await mount(page, def({ min: 0, max: 100, degreesPerUnit: 3 }, {
    states: { dragging: { border: { color: '#ff0000', width: 3, style: 'solid', glow: { color: '#00e5ff', blur: 8 } } } }
  }));
  const surface = () => page.locator('.fd-rotary-face').evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, width: s.borderTopWidth, shadow: s.boxShadow };
  });
  const before = await surface();
  expect(before.width).toBe('0px');
  expect(before.shadow).toBe('none');

  const box = await page.evaluate(() => window.__faceRect());
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + 30);
  const during = await surface();
  expect(during.border).toBe('rgb(255, 0, 0)');
  expect(during.width).toBe('3px');
  expect(during.shadow).toContain('rgb(0, 229, 255)');

  await page.mouse.up();
  const after = await surface();
  expect(after.width).toBe('0px');
  expect(after.shadow).toBe('none');
});
