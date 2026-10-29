import { clickMapTool, mapTool } from './mapControls';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const gpx =
  '<gpx version="1.1"><metadata><name>Segmented ride</name></metadata><trk><trkseg><trkpt lat="47.26" lon="11.4"><ele>600</ele></trkpt><trkpt lat="47.27" lon="11.41"><ele>620</ele></trkpt></trkseg><trkseg><trkpt lat="48" lon="12"><ele>800</ele></trkpt><trkpt lat="48.01" lon="12.01"><ele>790</ele></trkpt></trkseg></trk></gpx>';
async function addPoint(page: Page, value: string) {
  await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
  await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
}
async function library(page: Page) {
  await page.getByRole('button', { name: 'My routes', exact: true }).click();
}
async function readDownload(page: Page, buttonName: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  if (buttonName === 'Export') {
    await page
      .getByRole('dialog', { name: 'Export route', exact: true })
      .getByRole('button', { name: 'Download GPX', exact: true })
      .click();
  }
  return readFile((await (await pending).path())!, 'utf8');
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
  await page.route('https://api.heigit.org/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
});

test('export mini-map fits the route and keeps GPX download available without a basemap', async ({ page }) => {
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'segments.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx),
  });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export route', exact: true });
  const preview = dialog.getByRole('figure', { name: 'Route map preview' });
  await expect(preview.locator('.export-route-map-canvas')).toHaveClass(/is-ready/);
  await expect(preview.locator('canvas')).not.toHaveAttribute('tabindex');
  await expect(dialog.getByRole('textbox', { name: 'File name' })).toBeFocused();
  const bounds = await preview.boundingBox();
  const dialogBounds = await dialog.boundingBox();
  expect(bounds!.width).toBeLessThan(dialogBounds!.width);
  expect(bounds!.height).toBe(180);
  await page.keyboard.press('Escape');
  await page.route('**/__fixtures__/map-style.json', (route) => route.abort());
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(preview.getByRole('img', { name: 'Route outline' })).toBeVisible();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download GPX', exact: true }).click();
  const xml = await readFile((await (await pending).path())!, 'utf8');
  expect(xml.match(/<trkseg>/g)).toHaveLength(2);
  expect(xml.match(/<trkpt\s/g)).toHaveLength(4);
});

test('manual edits undo and redo, retain native text undo, and recover after reload', async ({
  page,
}) => {
  await clickMapTool(page, 'Manual drawing');
  await addPoint(page, '47.26, 11.4');
  await addPoint(page, '47.27, 11.41');
  const canvas = page.locator('.maplibregl-canvas');
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.waypoint-marker')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.waypoint-marker')).toHaveCount(2);
  const coordinates = page.getByRole('textbox', { name: 'Latitude' });
  await coordinates.fill('47.28, 11.42');
  await coordinates.press('Control+z');
  await expect(page.locator('.waypoint-marker')).toHaveCount(2);
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(page.locator('.waypoint-marker')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  await expect(await mapTool(page, 'Manual drawing')).toHaveAttribute('aria-pressed', 'true');
  const xml = await readDownload(page, 'Export');
  expect(xml.match(/<trkpt\s/g)).toHaveLength(2);
});

test('restored GPX preserves disconnected tracks and heights without routing', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/route') requests.push(request.url());
  });
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'segments.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
  const xml = await readDownload(page, 'Export');
  expect(xml.match(/<trkseg>/g)).toHaveLength(2);
  expect(xml.match(/<trkpt\s/g)).toHaveLength(4);
  for (const height of [600, 620, 800, 790]) expect(xml).toContain(`<ele>${height}</ele>`);
  expect(requests).toEqual([]);
});

test('library backup round trip is local and import leaves the editor unchanged', async ({
  page,
}) => {
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'segments.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
  const before = await readDownload(page, 'Export');
  await library(page);
  const backup = await readDownload(page, 'Download backup');
  const data = JSON.parse(backup);
  expect(data.routes).toHaveLength(1);
  expect(data.routes[0].segments).toEqual([
    [
      [11.4, 47.26, 600],
      [11.41, 47.27, 620],
    ],
    [
      [12, 48, 800],
      [12.01, 48.01, 790],
    ],
  ]);
  expect(backup).not.toContain('test-only-not-a-real-ors-key');
  await page.getByLabel('Import library file').setInputFiles({
    name: 'library.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backup),
  });
  await page.getByRole('button', { name: 'Import routes', exact: true }).click();
  await expect(page.locator('.library-route')).toHaveCount(2);
  await page.keyboard.press('Escape');
  const after = await readDownload(page, 'Export');
  expect(after).toBe(before);
});

test('favorites, tags and combined library filters survive reload and backup', async ({ page }) => {
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'segments.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
  await library(page);
  await page
    .locator('.library-route')
    .getByRole('button', { name: /Add to favorites/ })
    .click();
  await page.getByRole('button', { name: 'Edit Segmented ride', exact: true }).click();
  await page.getByLabel('Tags', { exact: true }).fill('ridge, weekend');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Favorites only', exact: true }).click();
  await page.getByRole('button', { name: 'Filter by tag', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'ridge', exact: true }).click();
  await page.getByLabel('Minimum length (km)', { exact: true }).fill('0');
  await page.getByLabel('Maximum length (km)', { exact: true }).fill('100');
  await page.getByRole('textbox', { name: 'Search saved routes' }).fill('Segmented');
  await expect(page.locator('.library-route')).toHaveCount(1);
  const backup = JSON.parse(await readDownload(page, 'Download backup'));
  expect(backup.routes[0].favorite).toBe(true);
  expect(backup.routes[0].tags).toEqual(['ridge', 'weekend']);
  await page.reload();
  await library(page);
  await expect(page.getByRole('button', { name: 'Favorites only', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Filter by tag', exact: true })).toContainText(
    'ridge',
  );
  await expect(page.getByLabel('Maximum length (km)', { exact: true })).toHaveValue('100');
  await expect(page.getByRole('textbox', { name: 'Search saved routes' })).toHaveValue('Segmented');
  await expect(page.locator('.library-route')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Favorites only', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('clicking an editable route inserts an ordered stop and one undo removes it', async ({
  page,
}) => {
  await clickMapTool(page, 'Manual drawing');
  await addPoint(page, '47.26, 11.4');
  await addPoint(page, '47.27, 11.41');
  await page.getByRole('button', { name: 'Fit route', exact: true }).click();
  await page.waitForTimeout(600);
  const markers = page.locator('.waypoint-marker');
  const first = (await markers.nth(0).boundingBox())!;
  const last = (await markers.nth(1).boundingBox())!;
  const x = (first.x + first.width / 2 + last.x + last.width / 2) / 2;
  const y = (first.y + first.height / 2 + last.y + last.height / 2) / 2;
  await page.mouse.click(x, y);
  await expect(markers).toHaveCount(3);
  const xml = await readDownload(page, 'Export');
  const points = [...xml.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)];
  expect(points).toHaveLength(3);
  expect(Number(points[1][1])).toBeGreaterThan(47.26);
  expect(Number(points[1][1])).toBeLessThan(47.27);
  await page.locator('.maplibregl-canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(markers).toHaveCount(2);
});

test('invalid backup does not change the library or editor', async ({ page }) => {
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'segments.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  const before = await readDownload(page, 'Export');
  await library(page);
  await page.getByLabel('Import library file').setInputFiles({
    name: 'unsupported.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 999, routes: [] })),
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'Unsupported library backup version.' }),
  ).toBeVisible();
  await expect(page.locator('.library-route')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await readDownload(page, 'Export')).toBe(before);
});

test('automatic undo restores ready geometry without an extra routing request', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/api/route', (route) => {
    requests += 1;
    const coordinates = route.request().postDataJSON().coordinates;
    return route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { summary: { distance: 1000, duration: 300 } },
            geometry: { type: 'LineString', coordinates },
          },
        ],
      },
    });
  });
  await addPoint(page, '47.26, 11.4');
  await addPoint(page, '47.27, 11.41');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  const twoPoints = await readDownload(page, 'Export');
  await addPoint(page, '47.28, 11.42');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  expect(requests).toBe(2);
  await page.locator('.maplibregl-canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.waypoint-marker')).toHaveCount(2);
  expect(await readDownload(page, 'Export')).toBe(twoPoints);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.waypoint-marker')).toHaveCount(3);
  await page.waitForTimeout(600);
  expect(requests).toBe(2);
});

test('language, appearance and map view persist without automatic geolocation', async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'roamlet:map-view:v1',
      JSON.stringify({ center: [28, 53.5], zoom: 5, bearing: 12, pitch: 10 }),
    ),
  );
  await page.reload();
  await clickMapTool(page, 'Zoom in');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('roamlet:map-view:v1') || 'null')?.zoom),
    )
    .toBe(6);
  const camera = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('roamlet:map-view:v1')!),
  );
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await expect(await mapTool(page, 'Приблизить')).toBeEnabled();
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('roamlet:map-view:v1')!),
  );
  expect(restored.zoom).toBeCloseTo(camera.zoom, 8);
  expect(restored.center[0]).toBeCloseTo(camera.center[0], 8);
  expect(restored.center[1]).toBeCloseTo(camera.center[1], 8);
  expect(restored.bearing).toBeCloseTo(camera.bearing, 8);
  expect(restored.pitch).toBeCloseTo(camera.pitch, 8);
});

test('reset settings confirms without deleting a draft or saved routes', async ({ page }) => {
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'segments.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
  await page.locator('.brand').click();
  await clickMapTool(page, 'Manual drawing');
  await addPoint(page, '47.26, 11.4');
  await addPoint(page, '47.27, 11.41');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reset settings', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Reset settings', exact: true })
    .click();
  await expect(page.locator('.waypoint-marker')).toHaveCount(2);
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(page.locator('.waypoint-marker')).toHaveCount(2);
  await library(page);
  await expect(page.locator('.library-route')).toHaveCount(1);
});

test('discarding a draft leaves manual preference and library intact', async ({ page }) => {
  await clickMapTool(page, 'Manual drawing');
  await addPoint(page, '47.26, 11.4');
  await addPoint(page, '47.27, 11.41');
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByRole('button', { name: 'Delete draft', exact: true }).click();
  await expect(page.locator('.waypoint-marker')).toHaveCount(0);
  await expect(await mapTool(page, 'Manual drawing')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Restore draft', exact: true })).toHaveCount(0);
});
