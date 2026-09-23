import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function isolateShell(page) {
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (
      url.port === '8080' ||
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com'
    ) {
      return route.abort();
    }
    return route.continue();
  });
}

test('the real shell boots and navigates while all bridge traffic is intercepted', async ({
  page,
}) => {
  const bridgeAttempts = [];
  await page.routeWebSocket('**/*', (socket) => {
    bridgeAttempts.push(socket.url());
    socket.close();
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.port === '8080') {
      bridgeAttempts.push(url.href);
      return route.abort();
    }
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      return route.abort();
    }
    return route.continue();
  });

  await page.goto('/index.html');
  const overlay = page.locator('#content-area > .fd-corner-overlay');
  await expect(overlay.locator('[data-widget-id="__corner_menu__"]')).toHaveCount(1);
  await expect(overlay.locator('[data-widget-id="__corner_profile__"]')).toHaveCount(1);
  await expect(page.locator('#content-area .fd-page-grid')).toHaveCount(1);
  expect(await page.evaluate(() => window.flightDeck.activePageId)).toBe('page_radios');

  for (const [pageKey, content] of [
    ['autopilot', '.fd-page-grid'],
    ['settings', '#fd-settings-page'],
    ['lights', '.fd-page-grid'],
    ['radios', '.fd-page-grid'],
  ]) {
    await overlay.locator('[data-widget-id="__corner_menu__"]').click();
    await page.locator(`.menu-item-btn[data-page="${pageKey}"]`).click();
    await expect(page.locator(`.menu-item-btn[data-page="${pageKey}"].active`)).toHaveCount(1);
    await expect(page.locator(`#content-area ${content}`)).toHaveCount(1);
    await expect(page.locator('#content-area > .fd-corner-overlay')).toHaveCount(1);
  }
  expect(bridgeAttempts.length).toBeGreaterThan(0);
  expect(bridgeAttempts.every((url) => new URL(url).port === '8080')).toBe(true);
});

test('corner menu anchors to its live rect and badge requires a long press', async ({ page }) => {
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (
      url.port === '8080' ||
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com'
    ) {
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/index.html');
  const menu = page.locator('[data-widget-id="__corner_menu__"]');
  const badge = page.locator('[data-widget-id="__corner_profile__"]');
  const dropdown = page.locator('#menu-dropdown');
  await expect(menu).toHaveCount(1);
  const menuRect = await menu.boundingBox();
  await menu.click();
  await expect(dropdown).toHaveClass(/open/);
  expect(await dropdown.evaluate((el) => el.style.left)).toBe(`${Math.round(menuRect.x)}px`);

  const selector = page.locator('.fd-profile-modal-overlay');
  const badgeRect = await badge.boundingBox();
  const x = badgeRect.x + badgeRect.width / 2;
  const y = badgeRect.y + badgeRect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(selector).toHaveClass(/hidden/);
  await page.mouse.down();
  await page.waitForTimeout(550);
  await expect(selector).not.toHaveClass(/hidden/);
  await page.mouse.up();
});

test('height-only resize keeps mounted widget identity and refreshes its square grid', async ({
  page,
}) => {
  await isolateShell(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await expect.poll(() => page.evaluate(() => Boolean(window.flightDeck?.activeProfile))).toBe(true);
  await page.evaluate(() => window.flightDeck.switchPage('page_autopilot'));
  await expect.poll(() => page.evaluate(() => window.flightDeck.activeWidgetInstances.length)).toBeGreaterThan(0);
  await expect(page.locator('#content-area .fd-page-grid')).toHaveCount(1);
  const before = await page.evaluate(() => {
    const app = window.flightDeck;
    window.__pageResizeWidget = app.activeWidgetInstances[0].element;
    window.__pageResizeWidget.dataset.resizePin = 'kept';
    return app.gridContainer.style.gridAutoRows;
  });
  await page.setViewportSize({ width: 390, height: 744 });
  await expect.poll(() => page.evaluate(() => window.flightDeck.currentDeviceTier)).toBe('mobile');
  await page.waitForTimeout(120);
  expect(
    await page.evaluate(
      () => window.flightDeck.activeWidgetInstances[0].element === window.__pageResizeWidget,
    ),
  ).toBe(true);
  await expect(page.locator('[data-resize-pin="kept"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.flightDeck.gridContainer.style.gridAutoRows)).toBe(
    before,
  );
});

test('orientation change rebuilds the page and changes reserved corner spans', async ({ page }) => {
  await isolateShell(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await expect(page.locator('#content-area .fd-page-grid')).toHaveCount(1);
  const portraitSpan = await page
    .locator('.fd-reserved-corner-indicator')
    .last()
    .evaluate((el) => el.style.gridColumn);
  await page.evaluate(() => {
    window.__portraitGrid = window.flightDeck.gridContainer;
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect
    .poll(() => page.evaluate(() => window.flightDeck.currentOrientation))
    .toBe('landscape');
  expect(await page.evaluate(() => window.flightDeck.gridContainer === window.__portraitGrid)).toBe(
    false,
  );
  expect(
    await page
      .locator('.fd-reserved-corner-indicator')
      .last()
      .evaluate((el) => el.style.gridColumn),
  ).not.toBe(portraitSpan);
});

test('portrait Yoke keeps the grid unmounted behind its rotate prompt', async ({ page }) => {
  await isolateShell(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await expect.poll(() => page.evaluate(() => Boolean(window.flightDeck?.activeProfile))).toBe(true);
  await page.evaluate(() => window.flightDeck.switchPage('page_yoke'));
  await expect(page.locator('.fd-rotate-prompt')).toBeVisible();
  await expect(page.locator('#content-area .fd-page-grid')).toHaveCount(0);
  await expect(page.locator('#content-area > .fd-corner-overlay')).toHaveCount(1);
});
