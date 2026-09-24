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

async function editAutopilot(page) {
  await isolateShell(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.flightDeck?.activeProfile)))
    .toBe(true);
  await page.evaluate(() => window.flightDeck.switchPage('page_autopilot'));
  await expect
    .poll(() => page.evaluate(() => window.flightDeck?.activeWidgetInstances?.length ?? 0))
    .toBeGreaterThan(1);
  await page.evaluate(() => window.flightDeck.toggleEditMode(true));
  // The edit toolbar shifts the grid while it animates in; measure after it settles.
  await expect
    .poll(() =>
      page.evaluate(() => document.getAnimations().some((a) => a instanceof CSSTransition)),
    )
    .toBe(false);
}

function currentLayouts(page) {
  return page.evaluate(() => {
    const app = window.flightDeck;
    return app.activeProfile
      .getPage(app.activePageId)
      .getWidgets(app.currentOrientation, app.currentDeviceTier)
      .map((w) => ({
        id: w.id,
        col: w.layout.col,
        row: w.layout.row,
        w: w.layout.w,
        h: w.layout.h,
      }));
  });
}

// Probes the rendered grid track for a cell, so the pointer lands where the
// real LayoutEngine.pixelToGridCell() resolves that column and row.
function cellCenter(page, col, row) {
  return page.evaluate(
    ([c, r]) => {
      const probe = document.createElement('div');
      probe.style.gridColumn = `${c} / span 1`;
      probe.style.gridRow = `${r} / span 1`;
      window.flightDeck.gridContainer.appendChild(probe);
      const rect = probe.getBoundingClientRect();
      probe.remove();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    },
    [col, row],
  );
}

async function widgetCenter(page, id) {
  const box = await page.locator(`.fd-page-grid [data-widget-id="${id}"]`).first().boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragTo(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

test('dragging a widget to a free cell commits the moved layout', async ({ page }) => {
  await editAutopilot(page);
  const target = await page.evaluate(() => {
    const app = window.flightDeck;
    const page = app.activeProfile.getPage(app.activePageId);
    const spec = page.getGrid(app.currentOrientation, app.currentDeviceTier);
    const widgets = page.getWidgets(app.currentOrientation, app.currentDeviceTier);
    const reserved = app.getReservedCornerEntries(
      app.currentOrientation,
      app.currentDeviceTier,
      spec,
    );
    const intersects = app.layoutEngine.constructor.boxesIntersect;
    // Rows past the rendered tracks are estimated, so the target stays inside them.
    const renderedRows = getComputedStyle(app.gridContainer).gridTemplateRows.split(' ').length;
    for (const moving of widgets) {
      const { w, h } = moving.layout;
      for (let row = 1; row <= renderedRows && row + h - 1 <= spec.rows; row++) {
        for (let col = 1; col + w - 1 <= spec.columns; col++) {
          if (col === moving.layout.col && row === moving.layout.row) continue;
          const candidate = { col, row, w, h };
          const blocked = [...widgets.filter((o) => o.id !== moving.id), ...reserved].some((o) =>
            intersects(candidate, o.layout),
          );
          if (!blocked) return { id: moving.id, col, row };
        }
      }
    }
    return null;
  });
  expect(target).not.toBeNull();
  await dragTo(
    page,
    await widgetCenter(page, target.id),
    await cellCenter(page, target.col, target.row),
  );
  await expect
    .poll(async () => (await currentLayouts(page)).find((w) => w.id === target.id))
    .toMatchObject({ col: target.col, row: target.row });
  expect(
    await page.evaluate(
      (id) => window.flightDeck.activeWidgetInstances.find((w) => w.id === id).layout.col,
      target.id,
    ),
  ).toBe(target.col);
});

test('a refused drop with auto-reposition off toasts and keeps the layout', async ({ page }) => {
  await editAutopilot(page);
  const before = await currentLayouts(page);
  const [moving, occupied] = before;
  await dragTo(
    page,
    await widgetCenter(page, moving.id),
    await cellCenter(page, occupied.col, occupied.row),
  );
  await expect(page.locator('#fd-global-toast')).toHaveText(
    'Auto-Reposition is off -- that spot is occupied.',
  );
  expect(await currentLayouts(page)).toEqual(before);
});

test('a steady long press on a widget opens the property inspector', async ({ page }) => {
  await editAutopilot(page);
  const [first] = await currentLayouts(page);
  const inspector = page.locator('.fd-inspector-overlay:has(#fd-insp-title)');
  await expect(inspector).toHaveClass(/hidden/);
  const center = await widgetCenter(page, first.id);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await expect(inspector).not.toHaveClass(/hidden/);
  await page.mouse.up();
  expect(await page.evaluate(() => window.flightDeck.draggedWidget)).toBeNull();
});
