import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const gpx =
  '<gpx version="1.1" creator="Roamlet test"><trk><name>Forest escape</name><trkseg><trkpt lat="47" lon="11"><ele>100</ele></trkpt><trkpt lat="47.02" lon="11.02"><ele>130</ele></trkpt><trkpt lat="47.03" lon="11"><ele>110</ele></trkpt></trkseg><trkseg><trkpt lat="47.04" lon="11"><ele>110</ele></trkpt><trkpt lat="47.05" lon="11.01"><ele>120</ele></trkpt></trkseg></trk></gpx>';

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
  await page.goto('/');
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await page
    .getByLabel('Import GPX file')
    .setInputFiles({ name: 'card.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
});

test('route image is generated on demand with real PNG sizes, privacy and preserved GPX', async ({
  page,
}, testInfo) => {
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export route', exact: true });
  await dialog.getByRole('radio', { name: 'For social media' }).click();
  await expect(dialog.getByRole('img', { name: 'Generated route image' })).toHaveCount(0);
  expect(workers).toEqual([]);
  for (const format of ['Post', 'Story']) {
    await dialog.getByRole('radio', { name: new RegExp(`^${format}`) }).click();
    await dialog
      .getByRole('radio', { name: format === 'Post' ? 'Light' : 'Dark', exact: true })
      .click();
    await dialog.getByRole('spinbutton').fill(format === 'Post' ? '0' : '200');
    await dialog
      .getByRole('textbox', { name: 'Image title' })
      .fill('Long scenic route · Длинный заголовок маршрута');
    await dialog.getByRole('button', { name: 'Create preview', exact: true }).click();
    const image = dialog.getByRole('img', { name: 'Generated route image' });
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => [
          element.naturalWidth,
          element.naturalHeight,
        ]),
      )
      .toEqual([1080, format === 'Post' ? 1350 : 1920]);
    const iconPixels = await image.evaluate((element: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(element, 0, 0);
      const pixels = context.getImageData(0, canvas.height - 240, canvas.width, 240).data;
      let road = 0,
        dot = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] === 250 && pixels[index + 1] === 247 && pixels[index + 2] === 242) road++;
        if (pixels[index] === 189 && pixels[index + 1] === 211 && pixels[index + 2] === 165) dot++;
      }
      canvas.width = 0;
      canvas.height = 0;
      return { road, dot };
    });
    expect(iconPixels.road).toBeGreaterThan(150);
    expect(iconPixels.dot).toBeGreaterThan(60);
    await expect
      .poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`route-card-${format.toLowerCase()}.png`) });
    await image.screenshot({ path: testInfo.outputPath(`image-${format.toLowerCase()}.png`) });
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download PNG' }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(
      `roamlet-route-${format === 'Post' ? 'post' : 'story'}.png`,
    );
    const bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.readUInt32BE(16)).toBe(1080);
    expect(bytes.readUInt32BE(20)).toBe(format === 'Post' ? 1350 : 1920);
  }
  expect(workers.some((url) => url.includes('routeCard.worker'))).toBe(true);
  await dialog.getByRole('spinbutton').fill('10000');
  await expect(dialog.getByRole('img')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Create preview', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('No route remains visible');
  await dialog.getByRole('radio', { name: 'GPX', exact: true }).click();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download GPX' }).click();
  const xml = await readFile((await (await pending).path())!, 'utf8');
  expect(xml.match(/<trkseg>/g)).toHaveLength(2);
  expect(xml.match(/<trkpt\s/g)).toHaveLength(5);
  expect(xml).toContain('Forest escape');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeFocused();
});

test('image export works with a yielded Canvas fallback when workers are unavailable', async ({
  page,
}) => {
  await page.evaluate(() => {
    Object.defineProperty(window, 'Worker', { value: undefined, configurable: true });
  });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export route', exact: true });
  await dialog.getByRole('radio', { name: 'For social media' }).click();
  await dialog.getByRole('button', { name: 'Create preview' }).click();
  await expect(dialog.getByRole('img', { name: 'Generated route image' })).toBeVisible();
  await expect
    .poll(() =>
      dialog.getByRole('img').evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBe(1080);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toHaveCount(0);
});
