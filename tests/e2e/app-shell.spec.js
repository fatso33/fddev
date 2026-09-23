import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('the real shell boots and navigates while all bridge traffic is intercepted', async ({ page }) => {
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
    if (url.port === '8080' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
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
