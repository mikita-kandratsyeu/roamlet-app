import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

let forbiddenRequests: string[] = [];
test.beforeEach(async ({ page }) => {
  forbiddenRequests = [];
  await page.route('**/*.mapbox.com/**', (route) => route.abort());
  await page.route('**/*.openfreemap.org/**', (route) =>
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
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'mapbox.com' || url.hostname.endsWith('.mapbox.com')) {
      forbiddenRequests.push(url.hostname);
    } else if (url.pathname.startsWith('/api/')) {
      forbiddenRequests.push(url.pathname);
    }
  });
});
test.afterEach(() => {
  expect(forbiddenRequests).toEqual([]);
});

const gpx =
  '<gpx version="1.1" creator="Roamlet test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Offline escape</name><trkseg><trkpt lat="47.2692" lon="11.4041"><ele>600</ele></trkpt><trkpt lat="47.271" lon="11.411"><ele>630</ele></trkpt></trkseg></trk></gpx>';
test('production shell keeps saved routes and GPX export available offline, without caching maps', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'offline.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('button', { name: 'Save to library' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => {
    if (request.url().includes('/assets/'))
      errors.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  await context.setOffline(true);
  await page.unroute('**/*.openfreemap.org/**');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'New route', exact: true }),
    JSON.stringify(errors),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes' }).click();
  await page.getByRole('button', { name: /Offline escape Hiking/ }).click();
  await expect(page.getByRole('heading', { name: 'Offline escape' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GPX' }).click();
  const text = await readFile((await (await downloaded).path())!, 'utf8');
  expect(text.match(/<trkpt\s/g)).toHaveLength(2);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls: string[] = [];
    for (const key of keys) {
      const cache = await caches.open(key);
      urls.push(...(await cache.keys()).map((request) => request.url));
    }
    return urls;
  });
  expect(cached.some((url) => url.includes('/assets/'))).toBe(true);
  expect(cached.some((url) => url.endsWith('.woff2'))).toBe(true);
  expect(errors).toEqual([]);
  await expect(
    page.getByRole('region', { name: 'Interactive route map' }).getByRole('status'),
  ).toContainText('No offline map is stored');
  expect(cached.every((url) => url.startsWith('http://127.0.0.1:4175/'))).toBe(true);
  await context.setOffline(false);
});
test('missing routing token keeps the map usable but never substitutes a fake route', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
  await expect(
    page.getByRole('region', { name: 'Interactive route map' }).getByRole('status'),
  ).toHaveCount(0);
  for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
    await page.getByRole('textbox', { name: 'Latitude, longitude' }).fill(value);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await expect(page.getByRole('alert')).toContainText('VITE_MAPBOX_ACCESS_TOKEN');
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
});
test('manual drawing calculates and exports offline without a routing token', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await context.setOffline(true);
  try {
    await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
    for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
      await page.getByRole('textbox', { name: 'Latitude, longitude' }).fill(value);
      await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: 'Export GPX', exact: true })).toBeEnabled();
    await expect(page.locator('.configuration-note')).toHaveCount(0);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export GPX', exact: true }).click();
    const xml = await readFile((await (await downloaded).path())!, 'utf8');
    expect(xml.match(/<trkpt\s/g)).toHaveLength(2);
    expect(xml).not.toContain('Routing by Mapbox');
  } finally {
    await context.setOffline(false);
  }
});

test('waypoint-only GPX remains usable and cannot crash route conversion', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'waypoint.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><wpt lat="47.2692" lon="11.4041"><name>Meeting point</name></wpt></gpx>',
    ),
  });
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
  await page.getByRole('button', { name: 'Edit waypoints', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('isolated points');
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
});
