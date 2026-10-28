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
  await page.route('**/api/health', (route) => route.fulfill({ json: { configured: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
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
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
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
