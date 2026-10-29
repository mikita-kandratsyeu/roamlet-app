import { test, expect } from '@playwright/test';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

let forbiddenRequests: string[] = [];
test.beforeEach(async ({ page }) => {
  forbiddenRequests = [];
  await page.route('**/*.mapbox.com/**', (route) => route.abort());
  await page.route('https://api.openrouteservice.org/**', (route) => route.abort());
  await page.route('https://api.heigit.org/**', (route) => route.abort());
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
    if (
      url.hostname === 'api.openrouteservice.org' ||
      url.hostname === 'api.heigit.org' ||
      url.hostname === 'mapbox.com' ||
      url.hostname.endsWith('.mapbox.com')
    ) {
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
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`offline UX is usable at ${viewport.width}px in ${colorScheme} theme and recovers without changing GPX`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
      await page.getByLabel('Import GPX file').setInputFiles({
        name: 'preserved.gpx',
        mimeType: 'application/gpx+xml',
        buffer: Buffer.from(gpx),
      });
      await expect(page.getByRole('button', { name: 'Export GPX', exact: true })).toBeEnabled();
      await context.setOffline(true);
      try {
        await expect(page.getByText('No internet connection', { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Map unavailable offline' })).toBeVisible();
        await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
        await expect(page.getByRole('group', { name: 'Map controls' })).toHaveCount(0);
        await expect(page.locator('.configuration-note')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Edit waypoints' })).toBeDisabled();
        await expect(page.locator('#map-elevation-root')).toBeEmpty();
        await expect(page.locator('.planner .elevation-box')).toHaveCount(1);
        await page.screenshot({ path: test.info().outputPath('offline.png') });
        await page.getByRole('button', { name: 'Retry map', exact: true }).click();
        await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export GPX', exact: true }).click();
        const offlineXml = await readFile((await (await pending).path())!, 'utf8');
        expect(offlineXml.match(/<trkpt\s/g)).toHaveLength(2);
        await page
          .getByRole('region', { name: 'Interactive route map' })
          .getByRole('button', { name: 'My routes', exact: true })
          .click();
        await expect(
          page.getByRole('heading', { name: 'Saved routes', exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Back to map', exact: true }).click();
        await context.setOffline(false);
        await expect(page.getByRole('heading', { name: 'Map unavailable offline' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
        const reconnected = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export GPX', exact: true }).click();
        const onlineXml = await readFile((await (await reconnected).path())!, 'utf8');
        expect(onlineXml).toBe(offlineXml);
        await page.screenshot({ path: test.info().outputPath('reconnected.png') });
      } finally {
        await context.setOffline(false);
      }
    });
  }
}

test('missing routing key keeps the map usable but never substitutes a fake route', async ({
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
  await expect(page.getByRole('alert')).toContainText('VITE_ORS_API_KEY');
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
});
test('manual drawing calculates and exports offline without a routing key', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await context.setOffline(true);
  try {
    await page.getByRole('button', { name: 'Use manual drawing', exact: true }).click();
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
    expect(xml).not.toContain('Routing by openrouteservice');
  } finally {
    await context.setOffline(false);
  }
});

test('offline reload restores an unsaved draft and exposes library backup without network', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
  for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
    await page.getByRole('textbox', { name: 'Latitude, longitude' }).fill(value);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await page.waitForTimeout(1200);
  await context.setOffline(true);
  try {
    await page.unroute('**/*.openfreemap.org/**');
    await page.reload();
    await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export GPX', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save route', exact: true }).click();
    await page.getByRole('textbox', { name: 'Route name' }).fill('Offline draft');
    await page.getByRole('button', { name: 'Save to library', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
    await page.getByRole('banner').getByRole('button', { name: 'My routes', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export library', exact: true }).click();
    const json = await readFile((await (await pending).path())!, 'utf8');
    expect(JSON.parse(json).routes).toHaveLength(1);
    await page.getByLabel('Import library file').setInputFiles({
      name: 'offline-library.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    await page.getByRole('button', { name: 'Import routes', exact: true }).click();
    await expect(page.locator('.library-route')).toHaveCount(2);
  } finally {
    await context.setOffline(false);
  }
});

test('confirming a waiting update saves the current draft before reloading', async ({ page }) => {
  const workerName = `__update-test-${crypto.randomUUID()}.js`;
  const workerPath = resolve('dist', workerName);
  await writeFile(
    workerPath,
    `self.addEventListener('message', event => { if(event.data?.type === 'SKIP_WAITING') self.skipWaiting(); }); self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));`,
    { flag: 'wx' },
  );
  try {
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
    for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
      await page.getByRole('textbox', { name: 'Latitude, longitude' }).fill(value);
      await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
    }
    await page.evaluate(async (name) => {
      await navigator.serviceWorker.register(`/${name}`, { scope: '/' });
    }, workerName);
    await page.waitForFunction(async () =>
      Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
    );
    await page.getByRole('button', { name: 'Update app', exact: true }).click();
    const reloaded = page.waitForEvent('load');
    await page.getByRole('button', { name: 'Reload app', exact: true }).click();
    await reloaded;
    await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Manual drawing', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export GPX', exact: true }).click();
    const xml = await readFile((await (await pending).path())!, 'utf8');
    expect(xml.match(/<trkpt\s/g)).toHaveLength(2);
  } finally {
    await rm(workerPath, { force: true });
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
