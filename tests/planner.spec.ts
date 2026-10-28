import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const coordinates = [[11.4041, 47.2692, 600], [11.405, 47.2697, 620], [11.409, 47.27, 630], [11.411, 47.271, 610]];
const fixture = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { summary: { distance: 640, duration: 240 } }, geometry: { type: 'LineString', coordinates } }] };
const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="Roamlet test" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Mountain morning</name></metadata><wpt lat="47.2692" lon="11.4041"><name>Meeting point</name></wpt><trk><name>Mountain morning</name><trkseg><trkpt lat="47.2692" lon="11.4041"><ele>600</ele></trkpt><trkpt lat="47.2697" lon="11.405"><ele>620</ele></trkpt></trkseg><trkseg><trkpt lat="47.27" lon="11.409"><ele>630</ele></trkpt><trkpt lat="47.271" lon="11.411"><ele>610</ele></trkpt></trkseg></trk></gpx>';
async function addPoint(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Search places or coordinates' }).fill(text);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}
async function createRoute(page: Page) {
  await addPoint(page, '47.2692, 11.4041'); await addPoint(page, '47.271, 11.411');
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
}
test.beforeEach(async ({ page }) => {
  // Fixtures are confined to browser tests. Production never substitutes geometry.
  await page.route('**/v2/directions/**', route => route.fulfill({ json: fixture }));
  await page.route('**/geocode/search?**', route => route.fulfill({ json: { features: [{ geometry: { coordinates: [11.4041, 47.2692] }, properties: { label: 'Innsbruck, Austria' } }] } }));
  await page.goto('/');
});
test('creates, recalculates, saves, reloads, reopens and exports actual returned points', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await createRoute(page);
  await page.getByRole('button', { name: 'Reverse', exact: true }).click(); await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name' }).fill('Weekend escape'); await page.getByRole('textbox', { name: /Description/ }).fill('Along the river');
  await page.getByRole('button', { name: 'Save to library' }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'My routes' }).click();
  await page.getByRole('button', { name: /Weekend escape Cycling/ }).click();
  await expect(page.getByRole('heading', { name: 'Weekend escape' })).toBeVisible();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export GPX' }).click();
  const download = await downloaded; expect(download.suggestedFilename()).toBe('Weekend escape.gpx');
  const text = await readFile((await download.path())!, 'utf8');
  expect(text.match(/<trkpt\s/g)).toHaveLength(coordinates.length);
  for (const c of coordinates) { expect(text).toContain(`lat="${c[1]}"`); expect(text).toContain(`lon="${c[0]}"`); }
  expect(text).toContain('Weekend escape'); expect(text).toContain('Along the river'); expect(text).toContain('<ele>630</ele>'); expect(errors).toEqual([]);
});
test('imports multiple segments, preserves GPX geometry and errors gracefully', async ({ page }) => {
  await page.getByLabel('Import GPX file').setInputFiles({ name: 'mountain.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
  await expect(page.getByRole('heading', { name: 'Mountain morning' })).toBeVisible();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export GPX' }).click();
  const text = await readFile((await (await downloaded).path())!, 'utf8');
  expect(text.match(/<trkseg>/g)).toHaveLength(2); expect(text.match(/<trkpt\s/g)).toHaveLength(4); expect(text).toContain('Meeting point');
  await page.getByLabel('Import GPX file').setInputFiles({ name: 'broken.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('<gpx><trk><') });
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('heading', { name: 'Mountain morning' })).toBeVisible();
});
test('edits names, duplicates, filters and confirms deletion', async ({ page }) => {
  await createRoute(page); await page.getByRole('button', { name: 'Save route', exact: true }).click(); await page.getByRole('textbox', { name: 'Route name' }).fill('First route'); await page.getByRole('button', { name: 'Save to library' }).click();
  await page.getByRole('button', { name: 'My routes' }).click(); await page.getByRole('button', { name: 'Edit First route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name' }).fill('River route'); await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Duplicate River route', exact: true }).click();
  await expect(page.locator('.library-route')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Search saved routes' }).fill('not found'); await expect(page.getByText('No routes match your search.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search saved routes' }).clear(); await page.getByRole('button', { name: 'Delete River route', exact: true }).click();
  await expect(page.getByText(/This cannot be undone/)).toBeVisible(); await page.getByRole('button', { name: 'Keep route' }).click(); await expect(page.locator('.library-route')).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete River route', exact: true }).click(); await page.getByRole('button', { name: 'Delete route', exact: true }).click(); await expect(page.locator('.library-route')).toHaveCount(1);
});
test('search works on submit; hiking and service failures are honest', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Search places or coordinates' }).fill('Innsbruck'); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Innsbruck, Austria' }).click();
  await page.getByRole('button', { name: 'Hiking', exact: true }).click();
  const request = page.waitForRequest('**/v2/directions/foot-hiking/geojson'); await addPoint(page, '47.271, 11.411'); await request;
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
  await page.route('**/v2/directions/**', route => route.fulfill({ status: 429, json: { error: 'quota' } }));
  await addPoint(page, '47.28, 11.42'); await expect(page.getByRole('alert')).toContainText('quota'); await expect(page.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
});
test('round trips use real provider round-trip requests; responsive controls stay reachable', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Round trip', exact: true }).click(); await addPoint(page, '47.2692, 11.4041');
  await page.route('**/v2/directions/**', async route => {
    const body = route.request().postDataJSON(); expect(body.options.round_trip.length).toBe(20000); expect(body.coordinates).toHaveLength(1);
    const loop = [coordinates[0], coordinates[1], coordinates[2], coordinates[0]];
    await route.fulfill({ json: { ...fixture, features: [{ ...fixture.features[0], geometry: { type: 'LineString', coordinates: loop } }] } });
  });
  await page.getByRole('button', { name: 'Discover round trips' }).click(); await expect(page.getByRole('button', { name: /Option 1/ })).toBeVisible(); await expect(page.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
  if (testInfo.project.name === 'mobile') {
    await page.locator('.mobile-sheet-toggle').click(); await expect(page.locator('.planner')).toHaveCSS('height', '57px');
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible(); await page.locator('.mobile-sheet-toggle').click(); await expect(page.getByRole('button', { name: 'Export GPX' })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('.maplibregl-ctrl-attrib').getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
});
