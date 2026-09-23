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
