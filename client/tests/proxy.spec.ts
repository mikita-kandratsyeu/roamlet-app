import { test, expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
test('browser uses private Mapbox proxy for search/routing/terrain without receiving the token', async ({
  page,
}) => {
  await page.route('**/api.mapbox.com/**', (route) => route.abort());
  await page.route('**/events.mapbox.com/**', (route) => route.abort());
  await page.route('**/__fixtures__/map-style.json', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#faf7f2' } },
        ],
      },
    }),
  );
  const errors: string[] = [],
    apiHeaders: Record<string, string>[] = [],
    requestUrls: string[] = [],
    apiBodies: Promise<string>[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/'))
      apiBodies.push(response.body().then((body) => body.toString()));
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/api/')) {
      requestUrls.push(request.url());
      apiHeaders.push(request.headers());
    }
  });
  await page.goto('/');
  await expect(page.locator('.configuration-note')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search places or coordinates' }).fill('Innsbruck');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Innsbruck, Austria' }).click();
  await page.getByRole('textbox', { name: 'Search places or coordinates' }).fill('47.271, 11.411');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name' }).fill('Proxy river route');
  await page.getByRole('button', { name: 'Save to library' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes' }).click();
  await page.getByRole('button', { name: /Proxy river route Cycling/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GPX' }).click();
  const text = await readFile((await (await download).path())!, 'utf8');
  expect(text.match(/<trkpt\s/g)).toHaveLength(2);
  expect(text).toContain('lon="11.411"');
  expect(text).toContain('<ele>600</ele>');
  expect(requestUrls.some((url) => url.includes('/api/directions/cycling/geojson'))).toBe(true);
  expect(requestUrls.some((url) => url.includes('/api/terrain/12/'))).toBe(true);
  expect(requestUrls.every((url) => !url.includes('access_token'))).toBe(true);
  expect(requestUrls.every((url) => url.startsWith('http://127.0.0.1:4176/api/'))).toBe(true);
  expect(apiHeaders.every((headers) => !headers.authorization && !headers['x-api-key'])).toBe(true);
  expect(errors).toEqual([]);
  for (const body of await Promise.all(apiBodies))
    expect(body).not.toContain('test-only-server-sentinel-never-in-browser');
  const health = await (await page.request.get('/api/health')).json();
  expect(health).toEqual({ configured: true });
  const directory = fileURLToPath(new URL('../dist/assets/', import.meta.url));
  for (const file of await readdir(directory))
    if (file.endsWith('.js')) {
      const bundle = await readFile(`${directory}/${file}`, 'utf8');
      expect(bundle).not.toContain('test-only-server-sentinel-never-in-browser');
      expect(bundle).not.toContain('VITE_ORS_API_KEY');
      expect(bundle).not.toContain('api.openrouteservice.org');
      expect(bundle).not.toContain('api.heigit.org');
    }
});
