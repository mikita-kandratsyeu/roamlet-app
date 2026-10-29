import { test, expect, type Page } from '@playwright/test';

async function addPoint(page: Page, coordinate: string) {
  const [latitude, longitude] = coordinate.split(',').map((part) => part.trim());
  await page.getByRole('textbox', { name: 'Latitude', exact: true }).fill(latitude);
  await page.getByRole('textbox', { name: 'Longitude', exact: true }).fill(longitude);
  await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
}
async function save(page: Page, name: string) {
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/__fixtures__/map-style.json', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#e8efe7' } },
        ],
      },
    }),
  );
  await page.route('**/api/route', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { summary: { distance: 1344, duration: 600 } },
            geometry: {
              type: 'LineString',
              coordinates: route
                .request()
                .postDataJSON()
                .coordinates.map((coordinate: number[], index: number) => [
                  ...coordinate,
                  100 + index * 50,
                ]),
            },
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await addPoint(page, '47.26, 11.4');
  await addPoint(page, '47.27, 11.41');
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
});

test('schedule edits persist and do not reroute; arrivals cross midnight', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/route') requests += 1;
  });
  const schedule = page.getByRole('region', { name: 'Route schedule', exact: true });
  const departure = schedule.getByLabel('Local departure date and time', { exact: true });
  await departure.fill('2026-10-29T23:59');
  await departure.press('Enter');
  const pause = schedule.getByLabel(/^Pause \(minutes\):/).first();
  await pause.fill('10');
  await pause.press('Tab');
  await expect(schedule.getByRole('listitem').first().locator('time').nth(1)).toHaveAttribute(
    'datetime',
    '2026-10-30T00:09',
  );
  await expect(schedule.locator('.route-schedule-finish time')).toHaveAttribute(
    'datetime',
    /^2026-10-30T/,
  );
  await save(page, 'Night ride');
  await page.getByRole('banner').getByRole('button', { name: 'My routes', exact: true }).click();
  await page.getByRole('button', { name: /^Night ride Cycling/ }).click();
  await expect(departure).toHaveValue('2026-10-29T23:59');
  await expect(pause).toHaveValue('10');
  await page.waitForTimeout(500);
  expect(requests).toBe(0);
});

test('comparison preserves editor and closes back to the selected library routes', async ({
  page,
}) => {
  await save(page, 'River');
  await page.getByRole('banner').getByRole('button', { name: 'My routes', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate River', exact: true }).click();
  const checks = page.getByRole('checkbox', { name: /^Select .* for comparison$/ });
  await expect(checks).toHaveCount(2);
  await checks.nth(0).check();
  await checks.nth(1).check();
  const compare = page.getByRole('button', { name: 'Compare routes', exact: true });
  await compare.click();
  const dialog = page.getByRole('dialog', { name: 'Compare saved routes', exact: true });
  await expect(dialog.getByRole('table', { name: 'Saved route comparison' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Fit route', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('group', { name: 'Map style', exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      dialog.locator('.comparison-map').evaluate((element) => {
        const frame = element.getBoundingClientRect();
        const canvas = element.querySelector('.maplibregl-canvas')!.getBoundingClientRect();
        return Math.max(
          Math.abs(frame.bottom - canvas.bottom),
          Math.abs(frame.width - canvas.width),
        );
      }),
    )
    .toBeLessThanOrEqual(2);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(compare).toBeFocused();
  await expect(checks.nth(0)).toBeChecked();
  await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
});

test('disclosure arrows align and mobile route actions have labels and 44px targets', async ({
  page,
}, testInfo) => {
  const climb = page.getByRole('region', { name: 'Climb analysis', exact: true });
  await climb.getByRole('button', { name: /^Climb 1/ }).click();
  await expect(climb.getByRole('button', { name: /^Climb 1/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('How time is estimated', { exact: true })).toBeVisible();
  await expect(page.getByText('How climbs are detected', { exact: true })).toBeVisible();
  expect(await page.locator('.time-explanation').getAttribute('open')).toBeNull();
  expect(await page.locator('.climb-analysis details').getAttribute('open')).toBeNull();
  if (testInfo.project.name !== 'mobile') return;
  const positions = await page
    .locator('#route-planner .planner-disclosure > summary .disclosure-toggle')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right));
  expect(positions.length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
  const actions = page.locator('.waypoint-tools');
  for (const name of ['Add a stop', 'Reverse', 'Clear stops']) {
    const button = actions.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  await expect(actions.locator('.reverse-stops span')).toBeVisible();
  await expect(actions.locator('.clear-stops-label')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
