import { clickMapTool, mapTool } from './mapControls';
import { test, expect } from '@playwright/test';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

let forbiddenRequests: string[] = [];
let allowUnavailableRoutingRequest = false;
test.beforeEach(async ({ page }) => {
  forbiddenRequests = [];
  allowUnavailableRoutingRequest = false;
  await page.route('**/*.mapbox.com/**', (route) => route.abort());
  await page.route('https://api.openrouteservice.org/**', (route) => route.abort());
  await page.route('https://api.heigit.org/**', (route) => route.abort());
  const mapStyle = {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8efe7' } }],
  };
  await page.route('**/osm-standard.json', (route) => route.fulfill({ json: mapStyle }));
  await page.route('**/*.openfreemap.org/**', (route) => route.fulfill({ json: mapStyle }));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com' ||
      url.hostname === 'api.openrouteservice.org' ||
      url.hostname === 'api.heigit.org' ||
      url.hostname === 'mapbox.com' ||
      url.hostname.endsWith('.mapbox.com')
    ) {
      forbiddenRequests.push(url.hostname);
    } else if (
      url.pathname.startsWith('/api/') &&
      url.pathname !== '/api/routing-config' &&
      !(allowUnavailableRoutingRequest && url.pathname === '/api/route')
    ) {
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
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
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
  await page.getByRole('button', { name: 'Export' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export route', exact: true });
  await exportDialog.getByRole('radio', { name: 'For social media' }).click();
  await expect(exportDialog.getByRole('img', { name: 'Generated route image' })).toHaveCount(0);
  await exportDialog.getByRole('button', { name: 'Create preview' }).click();
  const image = exportDialog.getByRole('img', { name: 'Generated route image' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1080);
  const pngDownload = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Download PNG' }).click();
  const png = await readFile((await (await pngDownload).path())!);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await exportDialog.getByRole('radio', { name: 'GPX', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Download GPX', exact: true }).click();
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
  expect(
    cached.some((url) => url.includes('manrope-latin-wght-normal') && url.endsWith('.woff2')),
  ).toBe(true);
  expect(
    cached.some((url) => url.includes('manrope-cyrillic-wght-normal') && url.endsWith('.woff2')),
  ).toBe(true);
  const fontStatuses = await page.evaluate(async () =>
    (await document.fonts.load('400 16px "Manrope Variable"', 'Маршрут Route')).map(
      (face) => face.status,
    ),
  );
  expect(fontStatuses.length).toBeGreaterThanOrEqual(2);
  expect(fontStatuses.every((status) => status === 'loaded')).toBe(true);
  await expect(page.locator('body')).toHaveCSS('font-family', /Manrope Variable/);
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
      await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
      await context.setOffline(true);
      try {
        await expect(page.getByText('No internet connection', { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Map unavailable offline' })).toBeVisible();
        await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
        await expect(page.getByRole('group', { name: 'Map controls' })).toHaveCount(0);
        await expect(page.locator('.configuration-note')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Edit waypoints' })).toBeDisabled();
        await expect(page.locator('#map-elevation-root')).toHaveCount(0);
        await expect(page.locator('.planner .elevation-box')).toHaveCount(1);
        await page.screenshot({ path: test.info().outputPath('offline.png') });
        await page.getByRole('button', { name: 'Retry map', exact: true }).click();
        await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'Export route', exact: true })
          .getByRole('button', { name: 'Download GPX', exact: true })
          .click();
        const offlineXml = await readFile((await (await pending).path())!, 'utf8');
        expect(offlineXml.match(/<trkpt\s/g)).toHaveLength(2);
        await page
          .getByRole('region', { name: 'Interactive route map' })
          .getByRole('button', { name: 'My routes', exact: true })
          .click();
        await expect(
          page.getByRole('heading', { name: 'Saved routes', exact: true }),
        ).toBeVisible();
        await page
          .getByRole('region', { name: 'Saved routes', exact: true })
          .getByRole('button', { name: 'Back to map', exact: true })
          .click();
        await context.setOffline(false);
        await expect(page.getByRole('heading', { name: 'Map unavailable offline' })).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: 'Use my location', exact: true }),
        ).toBeEnabled();
        const reconnected = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'Export route', exact: true })
          .getByRole('button', { name: 'Download GPX', exact: true })
          .click();
        const onlineXml = await readFile((await (await reconnected).path())!, 'utf8');
        expect(onlineXml).toBe(offlineXml);
        await page.screenshot({ path: test.info().outputPath('reconnected.png') });
      } finally {
        await context.setOffline(false);
      }
    });
  }
}

test('an unopened elevation chart loads on its first offline expansion', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'lazy-profile.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  const profile = page.locator('.planner .elevation-box');
  await expect(profile).toBeVisible();
  await expect(profile).not.toHaveAttribute('open');
  await expect(profile.locator('.elevation-chart')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((entry) => /\/assets\/ElevationChart-[^/]+\.js/.test(entry.name)),
    ),
  ).toBe(false);
  await context.setOffline(true);
  try {
    await profile.locator('summary').click();
    await expect(profile.locator('.elevation-chart .recharts-surface')).toBeVisible();
    await expect(page.getByTestId('panel-loader')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  } finally {
    await context.setOffline(false);
  }
});

for (const language of ['en', 'ru'] as const) {
  test(`GPX worker imports exact segments on its first offline use (${language})`, async ({
    page,
    context,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('roamlet-language', value), language);
    if (language === 'ru') await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const workers = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        urls.push(...(await cache.keys()).map((request) => request.url));
      }
      return urls.filter((url) => /gpxImport\.worker-[^/]+\.js$/.test(url));
    });
    expect(workers).toHaveLength(1);
    expect(page.workers().filter((worker) => /gpxImport\.worker-/.test(worker.url()))).toHaveLength(
      0,
    );
    await context.setOffline(true);
    try {
      await page.reload();
      const xml =
        '<gpx><wpt lat="47" lon="11"/><trk><trkseg><trkpt lat="47" lon="11"><ele>100</ele></trkpt><trkpt lat="47.01" lon="11.01"><ele>120</ele></trkpt></trkseg><trkseg><trkpt lat="48" lon="12"/><trkpt lat="48.01" lon="12.01"><ele>90</ele></trkpt></trkseg></trk></gpx>';
      const started = page.waitForEvent('worker', {
        predicate: (worker) => /gpxImport\.worker-/.test(worker.url()),
      });
      await page
        .getByLabel(language === 'ru' ? 'Импорт файла GPX' : 'Import GPX file')
        .setInputFiles({
          name: 'first-offline.gpx 2',
          mimeType: 'application/octet-stream',
          buffer: Buffer.from(xml),
        });
      expect((await started).url()).toMatch(/gpxImport\.worker-/);
      const title =
        language === 'ru'
          ? page.getByRole('button', { name: /^Импортированный маршрут/ })
          : page.getByRole('heading', { name: 'Imported route', exact: true });
      await expect(title).toBeVisible();
      const pending = page.waitForEvent('download');
      await page
        .getByRole('button', { name: language === 'ru' ? 'Экспорт' : 'Export', exact: true })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', {
          name: language === 'ru' ? 'Скачать GPX' : 'Download GPX',
          exact: true,
        })
        .click();
      const exported = await readFile((await (await pending).path())!, 'utf8');
      expect(exported.match(/<trkseg>/g)).toHaveLength(2);
      expect(exported.match(/<trkpt\s/g)).toHaveLength(4);
      expect(exported.match(/<ele>/g)).toHaveLength(3);
      expect(exported).toMatch(/<trkpt lat="48" lon="12">\s*<\/trkpt>/);
      expect(exported).toContain(
        language === 'ru' ? '<name>Точка</name>' : '<name>Waypoint</name>',
      );
      expect(exported).toContain('<ele>90</ele>');
    } finally {
      await context.setOffline(false);
    }
  });
}

test.describe('core panels without a service worker', () => {
  test.use({ serviceWorkers: 'block' });
  for (const language of ['en', 'ru'] as const) {
    test(`saved routes and manual coordinates work on their first offline use (${language})`, async ({
      page,
      context,
    }) => {
      await page.addInitScript(
        (value) => localStorage.setItem('roamlet-language', value),
        language,
      );
      const copy =
        language === 'ru'
          ? {
              save: 'Сохранить маршрут',
              librarySave: 'Сохранить в библиотеку',
              library: 'Мои маршруты',
              back: 'Назад к карте',
              manual: 'Новый маршрут по координатам',
              coordinates: 'Широта',
              add: 'Добавить координаты',
              export: 'Экспорт',
              exportDialog: 'Экспорт маршрута',
              download: 'Скачать GPX',
            }
          : {
              save: 'Save route',
              librarySave: 'Save to library',
              library: 'My routes',
              back: 'Back to map',
              manual: 'New manual route',
              coordinates: 'Latitude',
              add: 'Add coordinates',
              export: 'Export',
              exportDialog: 'Export route',
              download: 'Download GPX',
            };
      await page.goto('/');
      await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
      await page
        .getByLabel(language === 'ru' ? 'Импорт файла GPX' : 'Import GPX file')
        .setInputFiles({
          name: 'saved.gpx',
          mimeType: 'application/gpx+xml',
          buffer: Buffer.from(gpx),
        });
      await page.getByRole('button', { name: copy.save, exact: true }).click();
      await page.getByRole('button', { name: copy.librarySave, exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.route('**/assets/*.js', (route) => route.abort());
      await context.setOffline(true);
      try {
        await page
          .getByRole('region', {
            name: language === 'ru' ? 'Интерактивная карта маршрута' : 'Interactive route map',
          })
          .getByRole('button', { name: copy.library, exact: true })
          .click();
        await expect(page.getByTestId('panel-loader')).toHaveCount(0);
        await page.getByRole('button', { name: /^Offline escape/ }).click();
        await expect(
          page.getByRole('heading', { name: 'Offline escape', exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: copy.export, exact: true })).toBeEnabled();
        await page.getByRole('button', { name: copy.manual, exact: true }).click();
        for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
          await page.getByRole('textbox', { name: copy.coordinates, exact: true }).fill(value);
          await page.getByRole('button', { name: copy.add, exact: true }).click();
        }
        await expect(page.getByTestId('panel-loader')).toHaveCount(0);
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: copy.export, exact: true }).click();
        await page
          .getByRole('dialog', { name: copy.exportDialog, exact: true })
          .getByRole('button', { name: copy.download, exact: true })
          .click();
        const xml = await readFile((await (await pending).path())!, 'utf8');
        expect(xml.match(/<trkpt\s/g)).toHaveLength(2);
      } finally {
        await context.setOffline(false);
      }
    });
  }
});

test('missing routing key keeps the map usable but never substitutes a fake route', async ({
  page,
}) => {
  allowUnavailableRoutingRequest = true;
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
  await expect(
    page.getByRole('region', { name: 'Interactive route map' }).getByRole('status'),
  ).toHaveCount(0);
  for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
    await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await expect(page.getByRole('alert')).toContainText(
    'Automatic routing is currently unavailable.',
  );
  await expect(
    page.getByRole('alert').getByRole('button', { name: 'Use manual drawing', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled();
});
test('manual drawing calculates and exports offline without a routing key', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await context.setOffline(true);
  try {
    await page.getByRole('button', { name: 'Use manual drawing', exact: true }).click();
    for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
      await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
      await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    await expect(page.locator('.configuration-note')).toHaveCount(0);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Export route', exact: true })
      .getByRole('button', { name: 'Download GPX', exact: true })
      .click();
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
  await clickMapTool(page, 'Manual drawing');
  for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
    await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await page.waitForTimeout(1200);
  await context.setOffline(true);
  try {
    await page.unroute('**/*.openfreemap.org/**');
    await page.reload();
    await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save route', exact: true }).click();
    await page.getByRole('textbox', { name: 'Route name' }).fill('Offline draft');
    await page.getByRole('button', { name: 'Save to library', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'My routes', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download backup', exact: true }).click();
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

test('first installation does not offer an app update or report a draft saving error', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.getByRole('button', { name: 'Update app', exact: true })).toHaveCount(0);
  await expect(
    page.getByText(
      'The update could not save your draft. Please retry; the app has not reloaded.',
      { exact: true },
    ),
  ).toHaveCount(0);
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
    await clickMapTool(page, 'Manual drawing');
    for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
      await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
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
    await expect(await mapTool(page, 'Manual drawing')).toHaveAttribute('aria-pressed', 'true');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Export route', exact: true })
      .getByRole('button', { name: 'Download GPX', exact: true })
      .click();
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
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
  await page.getByRole('button', { name: 'Edit waypoints', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('isolated points');
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
});
