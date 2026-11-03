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
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await page.getByRole('button', { name: 'More map tools', exact: true }).click();
  const feedbackLink = page.getByRole('link', { name: 'Report a map issue ↗', exact: true });
  await expect(feedbackLink).toHaveAttribute('href', 'https://www.openstreetmap.org/');
  const logo = await page.locator('.maplibregl-ctrl-attrib').boundingBox();
  const feedback = await feedbackLink.boundingBox();
  expect(
    logo &&
      feedback &&
      (logo.y + logo.height <= feedback.y ||
        feedback.y + feedback.height <= logo.y ||
        logo.x + logo.width <= feedback.x ||
        feedback.x + feedback.width <= logo.x),
  ).toBe(true);
  await page.getByRole('button', { name: 'Close map tools', exact: true }).click();
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
      JSON.stringify({ version: 1, preferences: { style: 'standard', panelHidden: true } }),
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
  await page.route('**/__fixtures__/map-style.json', (route) =>
    route.fulfill({ path: 'public/osm-standard.json', contentType: 'application/json' }),
  );
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
  const picker = page.getByRole('radiogroup', { name: 'Map style', exact: true });
  const standard = picker.getByRole('radio', { name: 'Standard', exact: true });
  await expect(standard).toBeChecked();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
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
  await picker.getByRole('radio', { name: 'Light', exact: true }).click();
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Synthetic Light map');
  await standard.click();
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  await expect(page.locator('.maplibregl-marker')).toHaveCount(1);
  await expect(page.locator('[data-sonner-toast][data-type="warning"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const language of ['en', 'ru'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`slope coloring is optional, accessible and preserves map tools (${language}, ${theme})`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      let routingRequests = 0;
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.addInitScript(({ language, theme }) => {
        localStorage.setItem('roamlet-language', language);
        localStorage.setItem('roamlet-theme', theme);
        localStorage.setItem('roamlet:preferences:v1', JSON.stringify({
          version: 1, preferences: { panelHidden: true },
        }));
      }, { language, theme });
      await page.route('**/__fixtures__/map-style.json', (route) => route.fulfill({ json: {
        version: 8,
        sources: { fixture: { type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          attribution: 'Synthetic map attribution' } },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': theme === 'dark' ? '#182a24' : '#faf7f2' } },
          { id: 'fixture', type: 'circle', source: 'fixture' },
        ],
      } }));
      await page.route('**/api/route', (route) => {
        routingRequests++;
        return route.abort();
      });
      const labels = language === 'ru'
        ? { tools: 'Другие инструменты карты', controls: 'Управление картой', toggle: 'Окрасить маршрут по уклону',
          legend: 'Легенда уклона', import: 'Импорт файла GPX', zoom: 'Приблизить' }
        : { tools: 'More map tools', controls: 'Map controls', toggle: 'Color route by slope',
          legend: 'Slope legend', import: 'Import GPX file', zoom: 'Zoom in' };
      await page.goto('/');
      await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
      await page.getByRole('button', { name: labels.tools, exact: true }).click();
      const panel = page.getByRole('dialog', { name: labels.controls, exact: true });
      await expect(panel.getByRole('button', { name: labels.toggle })).toBeDisabled();
      await panel.press('Escape');
      const gpx = '<gpx version="1.1"><trk><name>Synthetic slope</name><trkseg>' +
        '<trkpt lat="47" lon="11"><ele>100</ele></trkpt>' +
        '<trkpt lat="47.002" lon="11.002"><ele>130</ele></trkpt>' +
        '<trkpt lat="47.004" lon="11.004"><ele>130</ele></trkpt>' +
        '<trkpt lat="47.006" lon="11.006"><ele>100</ele></trkpt>' +
        '</trkseg></trk></gpx>';
      await page.getByLabel(labels.import).setInputFiles({
        name: 'slope.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx),
      });
      await page.getByRole('button', { name: labels.tools, exact: true }).click();
      const toggle = panel.getByRole('button', { name: labels.toggle });
      await expect(toggle).toBeEnabled();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await toggle.scrollIntoViewIfNeeded();
      await toggle.focus();
      await toggle.press('Enter');
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      const legend = panel.getByRole('group', { name: labels.legend });
      await legend.scrollIntoViewIfNeeded();
      await expect(legend).toBeVisible();
      for (const selector of ['.map-slope-tools', ':scope > a']) {
        const separatorWidth = await panel.locator(selector).evaluate(
          (element) => getComputedStyle(element).borderTopWidth,
        );
        expect(separatorWidth).toBe('0px');
      }
      await expect(panel).toBeInViewport();
      const bounds = await toggle.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      const overflow = await panel.evaluate((element) => element.scrollWidth > element.clientWidth);
      expect(overflow).toBe(false);
      await page.screenshot({ path: testInfo.outputPath('slope-tools.png') });
      await panel.press('Escape');
      await expect(page.getByRole('button', { name: labels.tools, exact: true })).toBeFocused();
      await page.locator('.maplibregl-canvas').screenshot({ path: testInfo.outputPath('slope-map.png') });
      await clickMapTool(page, labels.zoom);
      await page.getByRole('button', { name: labels.tools, exact: true }).click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(legend).toHaveCount(0);
      await panel.press('Escape');
      await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Synthetic map attribution');
      expect(routingRequests).toBe(0);
      expect(errors).toEqual([]);
    });
  }
}
