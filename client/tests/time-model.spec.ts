import { clickMapTool } from './mapControls';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { calculateStats } from '../src/domain/stats';

async function addPoint(page: Page, value: string) {
  await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
  await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
}
async function choose(page: Page, label: string, option: string) {
  const settings = page.locator('.personal-time-section');
  if ((await settings.getAttribute('open')) === null) await settings.locator('summary').click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
}
async function download(page: Page, label: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  if (label === 'Export') {
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
  await page.route('**/api/route', (route) =>
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
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
});

test('long personal time ranges remain readable in both languages and themes', async ({
  page,
}, testInfo) => {
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'long-route.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><trk><trkseg><trkpt lat="47" lon="11"/><trkpt lat="48.1" lon="11"/></trkseg></trk></gpx>',
    ),
  });
  const statistics = page.locator('.statistics:not(.statistics-empty)');
  await expect(statistics.locator('.stat-card-personal')).toHaveCount(2);
  const importNotice = page.locator('[data-sonner-toast][data-type="success"]');
  await expect(importNotice).toBeVisible();
  await importNotice.locator('[data-close-button]').click();
  await expect(importNotice).toHaveCount(0);
  for (const language of ['en', 'ru']) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        ({ language, theme }) => {
          localStorage.setItem('roamlet-language', language);
          localStorage.setItem('roamlet-theme', theme);
          window.dispatchEvent(new Event('roamlet-preferences-change'));
        },
        { language, theme },
      );
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      const movingLabel =
        language === 'en' ? 'Personal moving time' : 'Время движения с вашей скоростью';
      await expect(statistics.getByText(movingLabel, { exact: true })).toBeVisible();
      await expect(statistics.locator('.stat-card-total')).toBeVisible();
      for (const width of [null, 320, 280, 230]) {
        await statistics.evaluate((element, width) => {
          element.style.width = width === null ? '' : `${width}px`;
        }, width);
        const layout = await statistics.evaluate((element) => {
          const grid = element.querySelector('.stat-grid')!;
          const gridBounds = grid.getBoundingClientRect();
          const cards = [...element.querySelectorAll<HTMLElement>('.stat-card-personal')];
          const bounds = cards.map((card) => card.getBoundingClientRect());
          const contentLeft = grid.querySelector('dt')!.getBoundingClientRect().left;
          const alignedContent = [
            ...cards.flatMap((card) => [...card.querySelectorAll('dt, dd')]),
            element.querySelector('.fine-print')!,
          ].every((item) => {
            const left =
              item.getBoundingClientRect().left +
              (item.classList.contains('fine-print')
                ? parseFloat(getComputedStyle(item).paddingLeft)
                : 0);
            return Math.abs(left - contentLeft) < 1;
          });
          const primaryCards = [...grid.querySelectorAll('.stat-card')].slice(0, 2);
          const primaryBounds = primaryCards.map((card) => card.getBoundingClientRect());
          const primaryValues = primaryCards.map((card) =>
            card.querySelector('dd')!.getBoundingClientRect(),
          );
          const primaryAligned =
            primaryBounds[1].top >= primaryBounds[0].bottom ||
            Math.abs(primaryValues[0].bottom - primaryValues[1].bottom) < 1;
          return {
            alignedContent,
            primaryAligned,
            stackedLabels: cards.every(
              (card) =>
                card.querySelector('dd')!.getBoundingClientRect().top >=
                card.querySelector('dt')!.getBoundingClientRect().bottom,
            ),
            fullWidth: bounds.every((card) => Math.abs(card.width - gridBounds.width) < 1),
            separateRows: bounds[1].top >= bounds[0].bottom,
            overflowing: cards.some((card) => card.scrollWidth > card.clientWidth),
            intactDurations: [...element.querySelectorAll('.stat-time-bound')].every(
              (bound) => getComputedStyle(bound).whiteSpace === 'nowrap',
            ),
            highlighted:
              getComputedStyle(cards[1]).backgroundColor !==
              getComputedStyle(cards[0]).backgroundColor,
          };
        });
        expect(layout).toEqual({
          alignedContent: true,
          primaryAligned: true,
          stackedLabels: true,
          fullWidth: true,
          separateRows: true,
          overflowing: false,
          intactDurations: true,
          highlighted: true,
        });
        if (width === null || width === 230) {
          await statistics.screenshot({
            path: testInfo.outputPath(`statistics-${language}-${theme}-${width ?? 'default'}.png`),
          });
        }
      }
      await statistics.evaluate((element) => {
        element.style.width = '';
      });
    }
  }
});

test('personal adjustments change the range without routing or replacing provider statistics', async ({
  page,
}) => {
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/route') requests += 1;
  });
  await addPoint(page, '47.26, 11.4');
  await addPoint(page, '47.27, 11.41');
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  const statistics = page.getByRole('region', { name: 'Route statistics', exact: true });
  await expect(statistics.getByText('Provider estimate', { exact: true })).toBeVisible();
  const providerTime = statistics
    .locator('dt')
    .filter({ hasText: /^Provider estimate$/ })
    .locator('xpath=following-sibling::dd[1]');
  await expect(providerTime).toHaveText('1 h 0 min');
  await expect(statistics.getByText('Planning reference', { exact: true })).toBeVisible();
  const original = await statistics.innerText();
  await choose(page, 'Surface', 'Rough surface');
  await expect.poll(() => statistics.innerText()).not.toBe(original);
  const speed = page.getByLabel('Personal speed (km/h)', { exact: true });
  await speed.fill('12');
  await speed.press('Enter');
  await expect(speed).toHaveValue('12');
  const rough = await statistics.innerText();
  await choose(page, 'Fitness level', 'Trained');
  await expect.poll(() => statistics.innerText()).not.toBe(rough);
  await expect(providerTime).toHaveText('1 h 0 min');
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name' }).fill('Model reference');
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes', exact: true }).click();
  const backup = JSON.parse(await download(page, 'Download backup'));
  expect(backup.routes[0].stats.distance).toBeCloseTo(
    calculateStats(
      [
        [
          [11.4, 47.26],
          [11.41, 47.27],
        ],
      ],
      'cycling',
    ).distance,
    6,
  );
  expect(backup.routes[0].stats.duration).toBe(3600);
  expect(requests).toBe(1);
});

test('hiking pace and climb allowance preserve split GPX tracks and original heights', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/route') requests.push(request.url());
  });
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'climb.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><metadata><name>Mountain split</name></metadata><trk><trkseg><trkpt lat="47.26" lon="11.4"><ele>100</ele></trkpt><trkpt lat="47.27" lon="11.41"><ele>400</ele></trkpt></trkseg><trkseg><trkpt lat="48" lon="12"><ele>500</ele></trkpt><trkpt lat="48.01" lon="12.01"><ele>800</ele></trkpt></trkseg></trk></gpx>',
    ),
  });
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  await page.locator('.personal-time-section > summary').click();
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
  const xml = await download(page, 'Export');
  expect(xml.match(/<trkseg>/g)).toHaveLength(2);
  expect(xml.match(/<trkpt\s/g)).toHaveLength(4);
  for (const height of [100, 400, 500, 800]) expect(xml).toContain(`<ele>${height}</ele>`);
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes', exact: true }).click();
  const backup = JSON.parse(await download(page, 'Download backup'));
  expect(backup.routes[0].stats.ascent).toBe(600);
  expect(backup.routes[0].segments).toHaveLength(2);
  expect(requests).toEqual([]);
});

test('draft recovery retains fitness, explicit surface and personal pace', async ({ page }) => {
  await clickMapTool(page, 'Manual drawing');
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
  await page.locator('.personal-time-section > summary').click();
  await expect(page.getByRole('button', { name: 'Fitness level', exact: true })).toContainText(
    'Trained',
  );
  await expect(page.getByRole('button', { name: 'Surface', exact: true })).toContainText(
    'Rough surface',
  );
  await expect(page.getByLabel('Personal speed (km/h)', { exact: true })).toHaveValue('12.5');
  await expect(page.locator('.waypoint-marker')).toHaveCount(2);
});
