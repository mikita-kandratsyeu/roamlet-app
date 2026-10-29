import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { calculateStats } from '../src/domain/stats';

async function addPoint(page: Page, value: string) {
  await page.getByRole('textbox', { name: 'Latitude, longitude' }).fill(value);
  await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
}
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
}
async function download(page: Page, label: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
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
  await page.route('https://api.heigit.org/openrouteservice/v2/directions/*/geojson', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { summary: { distance: 10000, duration: 3600 } },
            geometry: {
              type: 'LineString',
              coordinates: route.request().postDataJSON().coordinates,
            },
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
});

test('personal adjustments change the range without routing or replacing provider statistics', async ({
  page,
}) => {
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/v2/directions/')) requests += 1;
  });
  await addPoint(page, '47.26, 11.4');
  await addPoint(page, '47.27, 11.41');
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  const statistics = page.getByRole('region', { name: 'Route statistics', exact: true });
  await expect(statistics.getByText('Provider estimate', { exact: true })).toBeVisible();
  await expect(statistics.getByText('1 h 0 min', { exact: true })).toBeVisible();
  const original = await statistics.innerText();
  await choose(page, 'Surface', 'Rough surface');
  await expect.poll(() => statistics.innerText()).not.toBe(original);
  const rough = await statistics.innerText();
  await choose(page, 'Fitness level', 'Trained');
  await expect.poll(() => statistics.innerText()).not.toBe(rough);
  await expect(statistics.getByText('1 h 0 min', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name' }).fill('Model reference');
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: 'My routes', exact: true }).click();
  const backup = JSON.parse(await download(page, 'Export library'));
  expect(backup.routes[0].stats.distance).toBeCloseTo(calculateStats([[[11.4, 47.26], [11.41, 47.27]]], 'cycling').distance, 6);
  expect(backup.routes[0].stats.duration).toBe(3600);
  expect(requests).toBe(1);
});

test('hiking pace and climb allowance preserve split GPX tracks and original heights', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/v2/directions/')) requests.push(request.url());
  });
  await page
    .getByLabel('Import GPX file')
    .setInputFiles({
      name: 'climb.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(
        '<gpx version="1.1"><metadata><name>Mountain split</name></metadata><trk><trkseg><trkpt lat="47.26" lon="11.4"><ele>100</ele></trkpt><trkpt lat="47.27" lon="11.41"><ele>400</ele></trkpt></trkseg><trkseg><trkpt lat="48" lon="12"><ele>500</ele></trkpt><trkpt lat="48.01" lon="12.01"><ele>800</ele></trkpt></trkseg></trk></gpx>',
      ),
    });
  const pace = page.getByLabel('Walking pace (min/km)', { exact: true });
  await expect(pace).toBeVisible();
  const statistics = page.getByRole('region', { name: 'Route statistics', exact: true });
  await expect(statistics.getByText('Provider estimate', { exact: true })).toHaveCount(0);
  const before = await statistics.innerText();
  await pace.fill('');
  await expect(pace).toHaveValue('');
  await pace.fill('15');
  await pace.press('Enter');
  await expect.poll(() => statistics.innerText()).not.toBe(before);
  const xml = await download(page, 'Export GPX');
  expect(xml.match(/<trkseg>/g)).toHaveLength(2);
  expect(xml.match(/<trkpt\s/g)).toHaveLength(4);
  for (const height of [100, 400, 500, 800]) expect(xml).toContain(`<ele>${height}</ele>`);
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: 'My routes', exact: true }).click();
  const backup = JSON.parse(await download(page, 'Export library'));
  expect(backup.routes[0].stats.ascent).toBe(600);
  expect(backup.routes[0].segments).toHaveLength(2);
  expect(requests).toEqual([]);
});

test('draft recovery retains fitness, explicit surface and personal pace', async ({ page }) => {
  await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
  await addPoint(page, '47.26, 11.4');
  await addPoint(page, '47.27, 11.41');
  await choose(page, 'Fitness level', 'Trained');
  await choose(page, 'Surface', 'Rough surface');
  const speed = page.getByLabel('Personal speed (km/h)', { exact: true });
  await speed.fill('12.5');
  await speed.press('Tab');
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fitness level', exact: true })).toContainText(
    'Trained',
  );
  await expect(page.getByRole('button', { name: 'Surface', exact: true })).toContainText(
    'Rough surface',
  );
  await expect(page.getByLabel('Personal speed (km/h)', { exact: true })).toHaveValue('12.5');
  await expect(page.locator('.waypoint-marker')).toHaveCount(2);
});
