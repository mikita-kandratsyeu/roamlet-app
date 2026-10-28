import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const gpx =
  '<gpx version="1.1" creator="Roamlet test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Offline escape</name><trkseg><trkpt lat="47.2692" lon="11.4041"><ele>600</ele></trkpt><trkpt lat="47.271" lon="11.411"><ele>630</ele></trkpt></trkseg></trk></gpx>';
test('production shell keeps saved routes and GPX export available offline, without caching maps', async ({
  page,
  context,
}) => {
  await page.goto('/');
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
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Where shall we go?' }),
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
  expect(cached.every((url) => url.startsWith('http://127.0.0.1:4175/'))).toBe(true);
  await context.setOffline(false);
});
test('missing credentials show a clear failure, with no fake route', async ({ page }) => {
  await page.goto('/');
  for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
    await page.getByRole('textbox', { name: 'Search places or coordinates' }).fill(value);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
  }
  await expect(page.getByRole('alert')).toContainText('ORS_API_KEY');
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
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
