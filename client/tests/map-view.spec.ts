import { clickMapTool } from './mapControls';
import { test, expect } from '@playwright/test';
const key = 'roamlet:map-view:v1';
test.use({ timezoneId: 'Europe/Minsk', locale: 'en-US' });
test('uses timezone region first, restores last local view, and fits an imported route', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: () => {
          throw new Error('Automatic geolocation must not be requested');
        },
      },
    });
  });
  await page.route('**/*.mapbox.com/**', (route) => route.abort());
  await page.route('**/__fixtures__/map-style.json', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {
          fixture: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#faf7f2' } },
          { id: 'fixture', type: 'circle', source: 'fixture' },
        ],
      },
    }),
  );
  await page.goto('/');
  await expect(page.locator('.mapboxgl-ctrl-logo')).toHaveCount(0);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible();
  await expect(page.locator('.map-issue')).toHaveAttribute(
    'href',
    'https://www.openstreetmap.org/',
  );
  const logo = await page.locator('.maplibregl-ctrl-attrib').boundingBox();
  const feedback = await page.locator('.map-issue').boundingBox();
  expect(
    logo &&
      feedback &&
      (logo.y + logo.height <= feedback.y ||
        feedback.y + feedback.height <= logo.y ||
        logo.x + logo.width <= feedback.x ||
        feedback.x + feedback.width <= logo.x),
  ).toBe(true);
  await clickMapTool(page, 'Zoom in');
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => JSON.parse(localStorage.getItem(storageKey) || 'null')?.zoom,
        key,
      ),
    )
    .toBe(6);
  const first = await page.evaluate(
    (storageKey) => JSON.parse(localStorage.getItem(storageKey)!),
    key,
  );
  expect(first.center[0]).toBeCloseTo(28);
  expect(first.center[1]).toBeCloseTo(53.5);
  await page.reload();
  await clickMapTool(page, 'Zoom in');
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => JSON.parse(localStorage.getItem(storageKey) || 'null')?.zoom,
        key,
      ),
    )
    .toBe(7);
  const gpx =
    '<gpx version="1.1"><trk><name>Different region</name><trkseg><trkpt lat="47.26" lon="11.4"/><trkpt lat="47.27" lon="11.41"/></trkseg></trk></gpx>';
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'different.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => JSON.parse(localStorage.getItem(storageKey) || 'null')?.center?.[0],
        key,
      ),
    )
    .toBeGreaterThan(11);
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => JSON.parse(localStorage.getItem(storageKey) || 'null')?.center?.[0],
        key,
      ),
    )
    .toBeLessThan(12);
  expect(errors).toEqual([]);
});

test('loads the Standard OSM raster style and preserves waypoints when switching maps', async ({
  page,
}) => {
  const errors: string[] = [];
  const tileRequests: { referer?: string; cacheControl?: string }[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      'roamlet:preferences:v1',
      JSON.stringify({ style: 'standard', theme: 'light', panelHidden: true }),
    );
  });
  const tileImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#faf7f2';
    context.fillRect(0, 0, 256, 256);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('https://tile.openstreetmap.org/**', (route) => {
    const headers = route.request().headers();
    tileRequests.push({ referer: headers.referer, cacheControl: headers['cache-control'] });
    return route.fulfill({
      contentType: 'image/png',
      headers: { 'cache-control': 'public, max-age=604800' },
      body: Buffer.from(tileImage, 'base64'),
    });
  });
  await page.route('https://tiles.openfreemap.org/styles/bright', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {
          fixture: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            attribution: 'Synthetic Light map',
          },
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#faf7f2' } },
          { id: 'fixture', type: 'circle', source: 'fixture' },
        ],
      },
    }),
  );
  await page.goto('/');
  const picker = page.locator('select.map-style-select');
  await expect(picker).toHaveValue('/osm-standard.json');
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible();
  await expect.poll(() => tileRequests.length).toBeGreaterThan(0);
  for (const request of tileRequests) {
    expect(request.referer).toContain('http://127.0.0.1:4174/');
    expect(request.cacheControl).toBeUndefined();
  }
  const canvas = page.locator('.maplibregl-canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await canvas.click({ position: { x: bounds!.width * 0.6, y: bounds!.height * 0.4 } });
  await expect(page.locator('.maplibregl-marker')).toHaveCount(1);
  await picker.selectOption('https://tiles.openfreemap.org/styles/bright', { force: true });
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Synthetic Light map');
  await picker.selectOption('/osm-standard.json', { force: true });
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  await expect(page.locator('.maplibregl-marker')).toHaveCount(1);
  await expect(page.locator('.map-warning')).toHaveCount(0);
  expect(errors).toEqual([]);
});
