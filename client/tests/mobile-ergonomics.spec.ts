import { test, expect, type Locator, type Page } from '@playwright/test';

test.use({ hasTouch: true });

const routeFixture = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { summary: { distance: 640, duration: 240 } },
      geometry: {
        type: 'LineString',
        coordinates: [
          [11.4041, 47.2692, 600],
          [11.411, 47.271, 610],
        ],
      },
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4174') return route.abort();
    if (url.pathname === '/__fixtures__/map-style.json') {
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#e8efe7' } },
          ],
        },
      });
    }
    if (url.pathname === '/api/route') return route.fulfill({ json: routeFixture });
    return route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
});

async function expandPlanner(page: Page) {
  const toggle = page.locator('.mobile-sheet-toggle');
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

async function touchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function reachable(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport();
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit !== null && (element === hit || element.contains(hit));
      }),
    )
    .toBe(true);
}

async function addStops(page: Page) {
  for (const coordinates of ['47.2692, 11.4041', '47.271, 11.411']) {
    const latitude = page.getByRole('textbox', { name: 'Latitude', exact: true });
    await latitude.fill(coordinates);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await expect(page.locator('[data-stop-id]')).toHaveCount(2);
}

for (const viewport of [
  { width: 320, height: 360 },
  { width: 667, height: 375 },
]) {
  test(`short ${viewport.width}×${viewport.height} planner keeps inputs, footer and map reachable`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await expandPlanner(page);
    const scroll = page.locator('.planner-scroll');
    await expect
      .poll(() => scroll.evaluate((element) => element.clientHeight))
      .toBeGreaterThanOrEqual(44);
    expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    expect(await scroll.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await expect(scroll).toHaveCSS('overscroll-behavior-y', 'contain');
    await expect(scroll).not.toHaveCSS('touch-action', 'none');
    const latitude = page.getByRole('textbox', { name: 'Latitude', exact: true });
    await latitude.focus();
    await reachable(latitude);
    await expect(latitude).toBeFocused();
    await expect(latitude).toHaveCSS('font-size', '16px');
    await latitude.fill('47.2692, 11.4041');
    const add = page.getByRole('button', { name: 'Add coordinates', exact: true });
    await reachable(add);
    await touchTarget(add);
    await add.click();
    await expect(page.locator('[data-stop-id]')).toHaveCount(1);
    const importer = page
      .locator('.planner-footer')
      .getByRole('button', { name: 'Import GPX', exact: true });
    await reachable(importer);
    await touchTarget(importer);
    const toggle = page.locator('.mobile-sheet-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const mapTools = page.getByRole('button', { name: 'More map tools', exact: true });
    await reachable(mapTools);
    await mapTools.click();
    const tools = page.getByRole('dialog', { name: 'Map controls', exact: true });
    await expect(tools).toBeInViewport();
    await tools.getByRole('button', { name: 'Close map tools' }).click();
    await expect(mapTools).toBeFocused();
    await toggle.click();
    await expect(page.locator('[data-stop-id]')).toHaveCount(1);
  });
}

for (const width of [320, 844]) {
  test(`hidden drag handles retain touch-sized alternative reorder actions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await expandPlanner(page);
    await addStops(page);
    const stops = page.locator('[data-stop-id]');
    const initialOrder = await stops.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-stop-id')),
    );
    for (const stop of await stops.all()) {
      await expect(stop.locator('.stop-grip')).toHaveCount(0);
      const name = stop.locator('.stop-name');
      await expect(name).not.toHaveCSS('touch-action', 'none');
      const nameBox = (await name.boundingBox())!;
      const cardBox = (await stop.locator('.waypoint-card').boundingBox())!;
      expect(nameBox.width).toBeGreaterThan(cardBox.width / 2);
      for (const control of await stop.locator('.stop-controls button').all())
        await touchTarget(control);
      expect(await stop.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
    await expect(page.getByRole('button', { name: 'Move stop 1 up', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Move stop 2 down', exact: true }),
    ).toBeDisabled();
    const down = page.getByRole('button', { name: 'Move stop 1 down', exact: true });
    await reachable(down);
    await down.click();
    await expect(stops.first()).toHaveAttribute('data-stop-id', initialOrder[1]!);
    const up = page.getByRole('button', { name: 'Move stop 2 up', exact: true });
    await page.keyboard.press('Tab');
    await up.focus();
    await reachable(up);
    await expect(up).toBeFocused();
    expect(await up.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
    await expect(up).not.toHaveCSS('outline-style', 'none');
    expect(
      await up.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth)),
    ).toBeGreaterThanOrEqual(2);
    await up.press('Enter');
    await expect(stops.first()).toHaveAttribute('data-stop-id', initialOrder[0]!);
  });
}

test('stop content fills the card without reserving space for drag grips', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await addStops(page);
  const stops = page.locator('[data-stop-id]');
  await expect(stops.locator('.stop-grip')).toHaveCount(0);
  for (const card of await stops.locator('.waypoint-card').all()) {
    const bounds = (await card.boundingBox())!;
    const badge = (await card.locator('.stop-badge').boundingBox())!;
    const name = (await card.locator('.stop-name').boundingBox())!;
    expect(badge.x - bounds.x).toBeCloseTo(9, 1);
    expect(name.x - (badge.x + badge.width)).toBeCloseTo(12, 1);
    await expect(card.locator('.stop-name')).toHaveCSS('flex-grow', '1');
  }
});

for (const viewport of [
  { width: 320, height: 360 },
  { width: 844, height: 390 },
]) {
  test(`save dialog fields and actions scroll accessibly at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await expandPlanner(page);
    await addStops(page);
    const save = page.getByRole('button', { name: 'Save route', exact: true });
    await expect(save).toBeEnabled();
    await reachable(save);
    await save.click();
    const dialog = page.getByRole('dialog', { name: 'Save route', exact: true });
    await expect(dialog).toBeInViewport();
    const name = dialog.getByRole('textbox', { name: 'Route name', exact: true });
    await expect(name).toBeFocused();
    await reachable(name);
    await expect(name).toHaveCSS('font-size', '16px');
    await name.fill('Short viewport route');
    const description = dialog.getByRole('textbox', { name: /^Description/ });
    await description.focus();
    await reachable(description);
    await description.fill('Editable without hiding the actions.');
    await expect(description).toHaveCSS('font-size', '16px');
    await expect(description).toHaveCSS('outline-width', '2px');
    const submit = dialog.getByRole('button', { name: 'Save to library', exact: true });
    await reachable(submit);
    await touchTarget(submit);
    await expect(submit).toBeEnabled();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    await reachable(cancel);
    await touchTarget(cancel);
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(save).toBeFocused();
  });
}
