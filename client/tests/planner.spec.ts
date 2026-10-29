import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const coordinates = [
  [11.4041, 47.2692, 600],
  [11.405, 47.2697, 620],
  [11.409, 47.27, 630],
  [11.411, 47.271, 610],
];
const fixture = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { summary: { distance: 640, duration: 240 } },
      geometry: { type: 'LineString', coordinates: coordinates.map((point) => point.slice(0, 2)) },
    },
  ],
};
const gpx =
  '<?xml version="1.0"?><gpx version="1.1" creator="Roamlet test" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Mountain morning</name></metadata><wpt lat="47.2692" lon="11.4041"><name>Meeting point</name></wpt><trk><name>Mountain morning</name><trkseg><trkpt lat="47.2692" lon="11.4041"><ele>600</ele></trkpt><trkpt lat="47.2697" lon="11.405"><ele>620</ele></trkpt></trkseg><trkseg><trkpt lat="47.27" lon="11.409"><ele>630</ele></trkpt><trkpt lat="47.271" lon="11.411"><ele>610</ele></trkpt></trkseg></trk></gpx>';
async function addPoint(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Latitude' }).fill(text);
  await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
}
async function requestNewRoute(page: Page) {
  const button = page.getByRole('button', { name: 'New route', exact: true });
  if (await button.isVisible()) {
    await button.press('Enter');
    return button;
  }
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (!(await page.getByRole('menu').isVisible())) await menu.click();
  await page.getByRole('menuitem', { name: 'New route', exact: true }).press('Enter');
  return menu;
}
async function createRoute(page: Page) {
  await addPoint(page, '47.2692, 11.4041');
  await addPoint(page, '47.271, 11.411');
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
}
test.beforeEach(async ({ page }) => {
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
          { id: 'background', type: 'background', paint: { 'background-color': '#e8efe7' } },
          { id: 'fixture', type: 'circle', source: 'fixture' },
        ],
      },
    }),
  );
  await page.route('https://*.mapbox.com/**', (route) => route.abort());
  // Fixtures are confined to browser tests. Production never substitutes geometry.
  await page.route('https://api.heigit.org/openrouteservice/**', (route) => route.abort());
  await page.route('https://api.heigit.org/openrouteservice/v2/directions/*/geojson', (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()).toMatchObject({
      accept: 'application/geo+json',
      'content-type': 'application/json',
      authorization: 'test-only-not-a-real-ors-key',
    });
    expect(request.postDataJSON()).toMatchObject({ instructions: false, elevation: true });
    return route.fulfill({ json: fixture });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
});
test('manual drawing uses one ruler tool, direct map points and local undo without Directions', async ({
  page,
}) => {
  const directions: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/v2/directions/')) directions.push(request.url());
  });
  const tool = page.getByRole('button', { name: 'Manual drawing', exact: true });
  await expect(tool).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Map controls' }).getByRole('button', { name: 'Reset north', exact: true })).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'Manual', exact: true })).toHaveCount(0);
  await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Route style' })).toHaveCount(0);
  const addPointsTool = page.getByRole('button', { name: 'Add points on map', exact: true });
  if (await addPointsTool.isVisible()) await addPointsTool.click();
  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toHaveCSS('cursor', 'crosshair');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.65, box.y + box.height * 0.15);
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.2);
  await expect(page.locator('.waypoint-marker')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Export route', exact: true })
    .getByRole('button', { name: 'Download GPX', exact: true })
    .click();
  const xml = await readFile((await (await download).path())!, 'utf8');
  expect(xml.match(/<trkpt\s/g)).toHaveLength(2);
  expect(xml).not.toContain('Routing by Mapbox');
  expect(xml).not.toContain('Routing by openrouteservice');
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.waypoint-marker')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.waypoint-marker')).toHaveCount(0);
  expect(directions).toEqual([]);
});

test('export dialog edits a safe filename, keeps Komoot help collapsed and restores focus', async ({
  page,
}) => {
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'mountain.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  const exportButton = page.getByRole('button', { name: 'Export', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Export route', exact: true });
  let downloads = 0;
  page.on('download', () => downloads++);
  await exportButton.click();
  await expect(dialog).toBeVisible();
  const filename = dialog.getByRole('textbox', { name: 'File name', exact: true });
  await expect(filename).toBeEditable();
  const summary = dialog.locator('summary').filter({ hasText: 'How to import into Komoot' });
  const guide = summary.locator('..');
  await expect(summary).toBeVisible();
  await expect(guide).not.toHaveAttribute('open');
  const helpLink = guide.getByRole('link');
  await expect(helpLink).not.toBeVisible();
  await summary.focus();
  await summary.press('Enter');
  await expect(guide).toHaveAttribute('open');
  await expect(helpLink).toBeVisible();
  const helpUrl = new URL((await helpLink.getAttribute('href'))!);
  expect(helpUrl.protocol).toBe('https:');
  expect(helpUrl.hostname).toBe('support.komoot.com');
  expect(helpUrl.pathname).toMatch(/^\/hc\/en-us\/articles\/\d+/);
  expect(downloads).toBe(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(exportButton).toBeFocused();
  expect(downloads).toBe(0);

  await exportButton.click();
  await expect(dialog).toBeVisible();
  await expect(guide).not.toHaveAttribute('open');
  await filename.fill('  Ridge / walk:?  ');
  await expect(filename).toHaveValue('  Ridge / walk:?  ');
  expect(downloads).toBe(0);
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download GPX', exact: true }).click();
  const download = await pending;
  await expect(dialog).not.toBeVisible();
  await expect(exportButton).toBeFocused();
  expect(downloads).toBe(1);
  const suggestedFilename = download.suggestedFilename();
  expect(suggestedFilename).toMatch(/^Ridge[ _-]+walk[ _-]*\.gpx$/);
  expect(suggestedFilename).not.toMatch(/[<>:"/\\|?*]/);
  expect([...suggestedFilename].every((character) => character.charCodeAt(0) >= 32)).toBe(true);
  expect(suggestedFilename).toBe(suggestedFilename.trim());
  const xml = await readFile((await download.path())!, 'utf8');
  expect(xml.match(/<trkseg>/g)).toHaveLength(2);
  expect(xml.match(/<trkpt\s/g)).toHaveLength(4);
  expect(xml).toContain('Mountain morning');
});

test('manual controls keep logical order and remain reachable at 320px in Russian', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
  const tool = page.getByRole('button', { name: 'Ручное рисование', exact: true });
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await expect(tool).toHaveCSS('background-color', 'rgb(155, 197, 167)');
  const controls = page.getByRole('group', { name: 'Управление картой', exact: true });
  const buttons = controls.locator('button');
  await expect(buttons).toHaveCount(7);
  for (const button of await buttons.all()) {
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('manual routes retain exact points when saved, reopened and edited', async ({ page }) => {
  const directions: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/v2/directions/')) directions.push(request.url());
  });
  await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
  await addPoint(page, '47.2692, 11.4041');
  await addPoint(page, '47.271, 11.411');
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name' }).fill('Manual afternoon');
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes', exact: true }).click();
  await page.getByRole('button', { name: /Manual afternoon Cycling/ }).click();
  await page.getByRole('button', { name: 'Edit waypoints', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await addPoint(page, '47.273, 11.413');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Export route', exact: true })
    .getByRole('button', { name: 'Download GPX', exact: true })
    .click();
  const xml = await readFile((await (await download).path())!, 'utf8');
  expect(xml.match(/<trkpt\s/g)).toHaveLength(3);
  expect(xml).toContain('lat="47.273" lon="11.413"');
  expect(directions).toEqual([]);
});

test('global map loader covers the viewport and releases controls after loading', async ({
  page,
}) => {
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/__fixtures__/map-style.json', async (route) => {
    await waiting;
    await route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#e8efe7' } },
        ],
      },
    });
  });
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const loader = page.getByTestId('global-map-loader');
    await expect(loader).toBeVisible();
    await expect(loader).toHaveCSS('position', 'fixed');
    const size = await loader.boundingBox();
    const viewport = page.viewportSize()!;
    expect(size).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    await expect(page.locator('#root')).toHaveAttribute('inert');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.global-map-loader__orbit')).toHaveCSS('animation-name', 'none');
    release();
    await expect(loader).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
    await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  } finally {
    release();
  }
});
test('creates, recalculates, saves, reloads, reopens and exports actual returned points', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await createRoute(page);
  await page.getByRole('button', { name: 'Reverse', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name' }).fill('Weekend escape');
  await page.getByRole('textbox', { name: /Description/ }).fill('Along the river');
  await page.getByRole('button', { name: 'Save to library' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes' }).click();
  await page.getByRole('button', { name: /Weekend escape Cycling/ }).click();
  await expect(page.locator('.planner')).toContainText('Weekend escape');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page
    .getByRole('dialog', { name: 'Export route', exact: true })
    .getByRole('button', { name: 'Download GPX', exact: true })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('Weekend escape.gpx');
  const text = await readFile((await download.path())!, 'utf8');
  expect(text.match(/<trkpt\s/g)).toHaveLength(coordinates.length);
  for (const c of coordinates) {
    expect(text).toContain(`lat="${c[1]}"`);
    expect(text).toContain(`lon="${c[0]}"`);
  }
  expect(text).toContain('Weekend escape');
  expect(text).toContain('Along the river');
  expect(text).not.toContain('<ele>');
  expect(errors).toEqual([]);
});
test('imports multiple segments, preserves GPX geometry and errors gracefully', async ({
  page,
}) => {
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'mountain.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  await expect(page.locator('.planner')).toContainText('Mountain morning');
  const snapshot = page.locator('.snapshot-notice');
  const edit = page.getByRole('button', { name: 'Edit waypoints', exact: true });
  await expect(snapshot).toContainText('Original geometry preserved');
  await expect(snapshot).toHaveCSS('padding', '12px');
  await expect(snapshot).toHaveCSS('border-radius', '8px');
  await expect(snapshot.locator('button')).toHaveCount(0);
  await expect(edit).toHaveCSS('height', '44px');
  await expect
    .poll(async () => {
      const noticeBox = await snapshot.boundingBox();
      const editBox = await edit.boundingBox();
      return Math.abs(editBox!.y - noticeBox!.y - noticeBox!.height - 10);
    })
    .toBeLessThan(1);
  expect((await edit.boundingBox())!.width).toBeCloseTo((await snapshot.boundingBox())!.width, 0);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page
    .getByRole('dialog', { name: 'Export route', exact: true })
    .getByRole('button', { name: 'Download GPX', exact: true })
    .click();
  const text = await readFile((await (await downloaded).path())!, 'utf8');
  expect(text.match(/<trkseg>/g)).toHaveLength(2);
  expect(text.match(/<trkpt\s/g)).toHaveLength(4);
  expect(text).toContain('Meeting point');
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'broken.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from('<gpx><trk><'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.planner')).toContainText('Mountain morning');
});
test('edits names, duplicates, filters and confirms deletion', async ({ page }) => {
  await createRoute(page);
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name' }).fill('First route');
  await page.getByRole('button', { name: 'Save to library' }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes' }).click();
  await page.getByRole('button', { name: 'Edit First route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name' }).fill('River route');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Duplicate River route', exact: true }).click();
  await expect(page.locator('.library-route')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Search saved routes' }).fill('not found');
  await expect(
    page.getByText('No matching routes. Try another name or clear the search.'),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Search saved routes' }).clear();
  await page.getByRole('button', { name: 'Delete River route', exact: true }).click();
  await expect(page.getByText(/This cannot be undone/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep route' }).click();
  await expect(page.locator('.library-route')).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete River route', exact: true }).click();
  await page.getByRole('button', { name: 'Delete route', exact: true }).click();
  await expect(page.locator('.library-route')).toHaveCount(1);
});
test('coordinate input replaces paid search; hiking and service failures are honest', async ({
  page,
}) => {
  const paidRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes('/search/geocode/') || url.pathname.includes('terrain-rgb'))
      paidRequests.push(url.pathname);
  });
  await page.getByRole('textbox', { name: 'Latitude' }).fill('Innsbruck');
  await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Latitude' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByText('Enter a number, for example 47.26.')).toBeVisible();
  await addPoint(page, '47.2692, 11.4041');
  await page.getByRole('radio', { name: 'Hiking', exact: true }).click();
  const request = page.waitForRequest(
    'https://api.heigit.org/openrouteservice/v2/directions/foot-hiking/geojson',
  );
  await addPoint(page, '47.271, 11.411');
  const hikingRequest = await request;
  expect(hikingRequest.method()).toBe('POST');
  expect(hikingRequest.postDataJSON()).toEqual({
    coordinates: [
      [11.4041, 47.2692],
      [11.411, 47.271],
    ],
    instructions: false,
    elevation: true,
  });
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
  await page.route('https://api.heigit.org/openrouteservice/v2/directions/*/geojson', (route) =>
    route.fulfill({ status: 429, json: { error: { message: 'quota' } } }),
  );
  await addPoint(page, '47.28, 11.42');
  await expect(page.getByRole('alert')).toContainText('quota');
  await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled();
  expect(paidRequests).toEqual([]);
});
test('round trips route intermediate points with bounded search; responsive controls stay reachable', async ({
  page,
}, testInfo) => {
  await page.getByRole('radio', { name: 'Round trip', exact: true }).click();
  await addPoint(page, '47.2692, 11.4041');
  let attempts = 0;
  await page.route(
    'https://api.heigit.org/openrouteservice/v2/directions/*/geojson',
    async (route) => {
      attempts += 1;
      const points = route.request().postDataJSON().coordinates;
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({
        coordinates: points,
        instructions: false,
        elevation: true,
      });
      expect(points).toHaveLength(4);
      expect(points[0]).toEqual(points[3]);
      const loop = [coordinates[0], coordinates[1], coordinates[2], coordinates[0]];
      await route.fulfill({
        json: {
          ...fixture,
          features: [
            {
              ...fixture.features[0],
              geometry: { type: 'LineString', coordinates: loop.map((point) => point.slice(0, 2)) },
            },
          ],
        },
      });
    },
  );
  await page.getByRole('button', { name: 'Find round trips' }).click();
  await expect(page.getByRole('button', { name: /Option 1/ })).toBeVisible();
  expect(attempts).toBeGreaterThan(0);
  expect(attempts).toBeLessThanOrEqual(6);
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
  if (testInfo.project.name === 'mobile') {
    await page.locator('.mobile-sheet-toggle').click();
    await expect(page.locator('.planner-scroll')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await page.locator('.mobile-sheet-toggle').click();
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(
    page.locator('.maplibregl-ctrl-attrib').getByRole('link', { name: 'OpenStreetMap' }),
  ).toBeVisible();
});

test('Onest loads Latin and Cyrillic faces and keeps Russian controls within a 320px viewport', async ({
  page,
}) => {
  const statuses = await page.evaluate(async () =>
    (await document.fonts.load('400 16px "Onest Variable"', 'Маршрут Route')).map(
      (face) => face.status,
    ),
  );
  expect(statuses.length).toBeGreaterThanOrEqual(2);
  expect(statuses.every((status) => status === 'loaded')).toBe(true);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Русский' }).click();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  for (const element of [
    page.locator('body'),
    page.getByRole('textbox', { name: 'Широта' }),
    page.getByRole('menuitem', { name: 'Мои маршруты' }),
    page.locator('.maplibregl-map'),
  ]) {
    await expect(element).toHaveCSS('font-family', /Onest Variable/);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('header supports desktop creation and an accessible compact menu', async ({
  page,
}, testInfo) => {
  const trigger = page.getByRole('button', { name: 'Menu', exact: true });
  const compact = testInfo.project.name === 'mobile';
  await expect(page.getByRole('banner').getByRole('button', { includeHidden: false })).toHaveCount(
    compact ? 2 : 3,
  );
  const firstItem = page.getByRole('menuitem', {
    name: compact ? 'New route' : 'My routes',
    exact: true,
  });
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'My routes', exact: true }),
  ).toBeVisible();
  for (const control of [
    trigger,
    page.getByRole('button', { name: compact ? 'My routes' : 'New route', exact: true }),
  ]) {
    const bounds = await control.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await trigger.click();
  await expect(firstItem).toBeFocused();
  const preferences = page.getByRole('menu');
  await expect(preferences).toHaveCSS('width', '338px');
  await expect(firstItem).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const selectedLanguage = page.getByRole('menuitemradio', { name: 'English' });
  await expect(selectedLanguage.locator('.preference-check')).toBeVisible();
  await expect(selectedLanguage.locator(':scope > span').first()).toHaveCSS('display', 'none');
  const row = await selectedLanguage.boundingBox();
  const check = await selectedLanguage.locator('.preference-check').boundingBox();
  expect(Math.abs(row!.x + row!.width - check!.x - check!.width - 12)).toBeLessThan(1);
  await expect(preferences.locator('.header-menu-note')).toHaveCount(2);
  await expect(preferences.locator('.header-menu-action-item').first()).toHaveCSS(
    'justify-content',
    'center',
  );
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Help and data sources' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(firstItem).toBeFocused();
  if (compact) {
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'My routes' })).toBeFocused();
  }
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Русский' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(firstItem).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).not.toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest('.header-menu') === null)).toBe(
    true,
  );
  await trigger.click();
  await page.locator('.planner-scroll').click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole('menu')).not.toBeVisible();
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Help and data sources' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('menuitemradio', { name: 'Русский' }).click();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  if (!compact)
    await expect(page.getByRole('button', { name: 'Новый маршрут', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Русский' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const panel = await page.getByRole('menu').boundingBox();
  expect(panel?.x).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await createRoute(page);
  await trigger.click();
  const creationFocus = await requestNewRoute(page);
  await expect(page.getByRole('menu')).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Leave this route?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(creationFocus).toBeFocused();
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
});

test('focus indicators are single and keyboard focus follows fields, dialogs, library actions and map controls', async ({
  page,
}) => {
  const search = page.getByRole('textbox', { name: 'Latitude' });
  await search.fill('Innsbruck');
  await expect(search).toHaveCSS('outline-width', '2px');
  await expect(page.locator('.coordinate-entry')).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Longitude' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Add coordinates', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Add coordinates', exact: true })).toHaveCSS(
    'outline-width',
    '2px',
  );
  await expect(page.locator('.coordinate-entry')).toHaveCSS('outline-style', 'none');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await menu.press('ArrowDown');
  const menuLibrary = page.getByRole('menuitem', { name: 'My routes' });
  await menuLibrary.focus();
  await expect(menuLibrary).toHaveCSS('outline-offset', '-2px');
  await page.getByRole('menuitem', { name: 'My routes' }).press('Enter');
  const librarySearch = page.getByRole('textbox', { name: 'Search saved routes' });
  await expect(librarySearch).toBeFocused();
  await expect(page.locator('.library-search')).toHaveCSS('outline-width', '2px');
  await expect(librarySearch).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Back to map', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeFocused();
  await createRoute(page);
  const newRoute = await requestNewRoute(page);
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(newRoute).toBeFocused();
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
  const save = page.getByRole('button', { name: 'Save route', exact: true });
  await save.press('Enter');
  const name = page.getByRole('textbox', { name: 'Route name' });
  await expect(name).toBeFocused();
  await expect(name).toHaveCSS('outline-width', '2px');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: /Description/ })).toBeFocused();
  await expect(page.getByRole('textbox', { name: /Description/ })).toHaveCSS(
    'outline-width',
    '2px',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(save).toBeFocused();
  await save.press('Enter');
  await name.fill('Focus trip');
  await page.getByRole('button', { name: 'Save to library' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(save).toBeFocused();
  await menu.press('ArrowDown');
  await page.getByRole('menuitem', { name: 'My routes' }).press('Enter');
  await expect(librarySearch).toBeFocused();
  const edit = page.getByRole('button', { name: 'Edit Focus trip' });
  await expect(edit).toBeVisible();
  for (let step = 0; step < 20; step++) {
    if (await edit.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(edit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(name).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(edit).toBeFocused();
  const remove = page.getByRole('button', { name: 'Delete Focus trip' });
  await remove.press('Enter');
  await expect(page.getByRole('button', { name: 'Keep route' })).toBeFocused();
  await page.getByRole('button', { name: 'Keep route' }).click();
  await expect(remove).toBeFocused();
  await remove.press('Enter');
  await page.getByRole('button', { name: 'Delete route', exact: true }).click();
  await expect(remove).not.toBeVisible();
  await expect(librarySearch).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
  await zoom.focus();
  await expect(zoom).toHaveCSS('outline-width', '2px');
  await expect(zoom).toHaveCSS('outline-offset', '-2px');
  await expect(zoom).toHaveCSS('box-shadow', 'none');
  await page.locator('.maplibregl-canvas').focus();
  await expect(page.locator('.maplibregl-canvas')).toHaveCSS('outline-width', '2px');
  await expect(page.locator('.maplibregl-canvas')).toHaveCSS('outline-offset', '-3px');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator(':root')).toHaveCSS('--focus-ring', 'Highlight');
  await zoom.focus();
  await expect(zoom).toHaveCSS('outline-style', 'solid');
});

test('persists light and dark themes across reloads and themes dialogs and map controls', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await menu.click();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const darkSurface = await page
    .locator('.app-header')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await menu.click();
  await expect(page.getByRole('menuitemradio', { name: 'Dark', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitem', { name: 'Help and data sources' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', darkSurface);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect
    .poll(() =>
      page.locator('.app-header').evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .not.toBe(darkSurface);
  await menu.click();
  await page.getByRole('menuitemradio', { name: 'System', exact: true }).click();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  const viewport = page.viewportSize()!;
  expect(await page.locator('body').evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    viewport.width,
  );
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
  await expect(zoom).toHaveAttribute('data-slot', 'button');
  const bounds = await zoom.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
});

test('uses subtle surface motion and respects reduced-motion preferences', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await expect(page.locator('.planner-heading')).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCSS('animation-name', 'surface-open');
  await page.getByRole('menuitem', { name: 'Help and data sources' }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('animation-name', 'surface-open');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('dialog')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.planner-heading')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.planner')).toHaveCSS('transition-duration', '0s');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('centers the saved-route empty-state icon above its text', async ({ page }) => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes' }).click();
  await expect(page.getByRole('heading', { name: 'No saved routes yet' })).toBeVisible();
  const empty = await page.locator('.library-empty').boundingBox();
  const icon = await page.locator('.library-empty > svg').boundingBox();
  expect(empty).not.toBeNull();
  expect(icon).not.toBeNull();
  expect(Math.abs(icon!.x + icon!.width / 2 - (empty!.x + empty!.width / 2))).toBeLessThan(1);
});

test('matches Figma planner geometry while preserving branding and responsive elevation', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  await page.setViewportSize(mobile ? { width: 390, height: 1100 } : { width: 1440, height: 1000 });
  await expect(page.locator('.brand-mark img')).toHaveAttribute('src', '/icon.svg');
  await expect(page.locator('.brand-wordmark')).toHaveText('Roamlet');
  await expect(page.locator('.app-header')).toHaveCSS('height', '64px');
  const actions = await page.locator('.route-actions').boundingBox();
  const importButton = await page.locator('.planner-footer .import-action').boundingBox();
  expect(importButton!.y - actions!.y - actions!.height).toBeCloseTo(10, 0);
  await expect(page.locator('.route-actions')).toHaveCSS('gap', '8px');
  await expect(page.locator('.planner-footer .import-action')).toHaveCSS('height', '44px');
  await createRoute(page);
  await expect(page.locator('.elevation-box')).toHaveCount(0);
  await expect(page.getByText('Elevation gain', { exact: true })).toHaveCount(0);
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'heights.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  if (mobile)
    await expect(page.getByRole('button', { name: /Mountain morning 0.3 km/ })).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'Mountain morning' })).toBeVisible();
  await expect(page.locator('.planner')).toHaveCSS('width', mobile ? '390px' : '420px');
  if (mobile) {
    await expect(page.locator('.elevation-box')).not.toHaveAttribute('open');
    await expect(page.locator('.statistics .elevation-box')).toHaveCount(1);
    await page.locator('.mobile-sheet-toggle').click();
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
  } else {
    await expect(page.locator('#map-elevation-root .elevation-box')).toHaveAttribute('open');
    const chart = await page.locator('#map-elevation-root').boundingBox();
    expect(chart?.x).toBe(478);
    expect(chart?.width).toBe(714);
    const summary = page.locator('.elevation-box summary');
    await expect(summary).toHaveText('Elevation profile');
    await expect(summary.locator('.elevation-toggle')).toHaveCSS('width', '32px');
    expect(await summary.evaluate((element) => getComputedStyle(element, '::after').content)).toBe(
      'none',
    );
    await summary.click();
    await expect(page.locator('.elevation-box')).not.toHaveAttribute('open');
    await expect(page.locator('.elevation-chart')).not.toBeVisible();
    await summary.press('Enter');
    await expect(page.locator('.elevation-box')).toHaveAttribute('open');
    await expect(page.locator('.elevation-chart')).toBeVisible();
    await page.getByRole('button', { name: 'Hide planner' }).click();
    await expect(page.locator('#map-elevation-root .elevation-box')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('point edits preserve the camera and location does not add stops', async ({
  page,
  context,
}) => {
  const mapView = () => page.evaluate(() => localStorage.getItem('roamlet:map-view:v1'));
  await expect.poll(mapView).not.toBeNull();
  const initialZoom = JSON.parse((await mapView())!).zoom;
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => JSON.parse((await mapView())!).zoom).toBe(initialZoom + 1);
  const original = await mapView();
  await createRoute(page);
  expect(await mapView()).toBe(original);
  await addPoint(page, '47.28, 11.42');
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  expect(await mapView()).toBe(original);
  await page.getByRole('button', { name: 'Move stop 2 up' }).click();
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  expect(await mapView()).toBe(original);
  await page.getByRole('button', { name: 'Remove stop 2' }).click();
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  expect(await mapView()).toBe(original);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ longitude: 13, latitude: 49 });
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect.poll(async () => JSON.parse((await mapView())!).center[0]).toBeCloseTo(13);
  await expect(page.locator('.waypoint-list > li')).toHaveCount(2);
});

test('dragging a stop handle reorders real stops and recalculates the route', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'Desktop drag handles; compact layouts use reorder buttons.',
  );
  await createRoute(page);
  await addPoint(page, '47.28, 11.42');
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  const stops = page.locator('.waypoint-list > li');
  await expect(stops).toHaveCount(3);
  const first = await stops.nth(0).locator('.stop-name').innerText();
  const handle = await stops.nth(0).locator('.stop-grip svg').boundingBox();
  const destination = await stops.nth(2).locator('.stop-name').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    destination!.x + destination!.width / 2,
    destination!.y + destination!.height / 2,
    { steps: 10 },
  );
  await expect(stops.nth(2)).toHaveClass(/drop-target/);
  await page.mouse.up();
  await expect(stops.nth(2).locator('.stop-name')).toContainText(first.split('\n').at(-1)!);
  await stops.nth(2).locator('.stop-grip').dragTo(stops.nth(0).locator('.stop-name'));
  await expect(stops.nth(0).locator('.stop-name')).toContainText(first.split('\n').at(-1)!);
  const beforeCancel = await stops.allTextContents();
  const cancelHandle = await stops.nth(0).locator('.stop-grip').boundingBox();
  await page.mouse.move(
    cancelHandle!.x + cancelHandle!.width / 2,
    cancelHandle!.y + cancelHandle!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(destination!.x + 10, destination!.y + 10, { steps: 10 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await stops.allTextContents()).toEqual(beforeCancel);
  await expect(page.locator('.drop-target, .dragging')).toHaveCount(0);
  await page.mouse.move(
    cancelHandle!.x + cancelHandle!.width / 2,
    cancelHandle!.y + cancelHandle!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(800, 200, { steps: 10 });
  await page.mouse.up();
  expect(await stops.allTextContents()).toEqual(beforeCancel);
  await expect(page.locator('.drop-target, .dragging')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
});

for (const hidden of [false, true]) {
  test(`map overlays do not intersect when resizing with planner hidden: ${hidden}`, async ({
    page,
  }, testInfo) => {
    const sizes =
      testInfo.project.name === 'mobile'
        ? [
            [500, 740],
            [390, 844],
            [320, 740],
          ]
        : [
            [1440, 1000],
            [1100, 740],
            [1025, 740],
            [768, 900],
          ];
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (hidden) {
      await page.getByRole('button', { name: 'Hide planner' }).click();
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Русский' }).click();
    }
    const selectors = [
      '.planner',
      '.planner-reopen',
      '.map-top-label',
      '.map-hint',
      '.map-style-tabs',
      '.map-import',
      '.map-issue',
      '.map-extra-controls',
      '#map-elevation-root',
      '.maplibregl-ctrl-attrib',
    ];
    for (const withRoute of [false, true]) {
      if (withRoute) {
        await page.locator('input[type="file"]').setInputFiles({
          name: 'overlays.gpx',
          mimeType: 'application/gpx+xml',
          buffer: Buffer.from(gpx),
        });
      }
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        await expect
          .poll(
            async () => {
              const rectangles: {
                selector: string;
                x: number;
                y: number;
                width: number;
                height: number;
              }[] = [];
              for (const selector of selectors) {
                const element = page.locator(selector);
                if (await element.isVisible()) {
                  const bounds = await element.boundingBox();
                  if (bounds) rectangles.push({ selector, ...bounds });
                }
              }
              const collisions: string[] = [];
              for (let i = 0; i < rectangles.length; i++) {
                const a = rectangles[i];
                for (const b of rectangles.slice(i + 1)) {
                  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
                  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
                  if (overlapX > 1 && overlapY > 1)
                    collisions.push(`${a.selector} / ${b.selector}`);
                }
              }
              return collisions;
            },
            { message: `Overlays at ${width}×${height}, route: ${withRoute}` },
          )
          .toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
  });
}
