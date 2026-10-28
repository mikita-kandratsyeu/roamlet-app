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
      geometry: { type: 'LineString', coordinates },
    },
  ],
};
const gpx =
  '<?xml version="1.0"?><gpx version="1.1" creator="Roamlet test" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Mountain morning</name></metadata><wpt lat="47.2692" lon="11.4041"><name>Meeting point</name></wpt><trk><name>Mountain morning</name><trkseg><trkpt lat="47.2692" lon="11.4041"><ele>600</ele></trkpt><trkpt lat="47.2697" lon="11.405"><ele>620</ele></trkpt></trkseg><trkseg><trkpt lat="47.27" lon="11.409"><ele>630</ele></trkpt><trkpt lat="47.271" lon="11.411"><ele>610</ele></trkpt></trkseg></trk></gpx>';
async function addPoint(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Search places or coordinates' }).fill(text);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}
async function createRoute(page: Page) {
  await addPoint(page, '47.2692, 11.4041');
  await addPoint(page, '47.271, 11.411');
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
}
test.beforeEach(async ({ page }) => {
  // Fixtures are confined to browser tests. Production never substitutes geometry.
  await page.route('**/api/directions/**', (route) => route.fulfill({ json: fixture }));
  await page.route('**/geocode/search?**', (route) =>
    route.fulfill({
      json: {
        features: [
          {
            geometry: { coordinates: [11.4041, 47.2692] },
            properties: { label: 'Innsbruck, Austria' },
          },
        ],
      },
    }),
  );
  await page.route('**/api/health', (route) => route.fulfill({ json: { configured: true } }));
  await page.goto('/');
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
  await expect(page.getByRole('heading', { name: 'Weekend escape' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GPX' }).click();
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
  expect(text).toContain('<ele>630</ele>');
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
  await expect(page.getByRole('heading', { name: 'Mountain morning' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GPX' }).click();
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
  await expect(page.getByRole('heading', { name: 'Mountain morning' })).toBeVisible();
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
  await expect(page.getByText('No routes match your search.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search saved routes' }).clear();
  await page.getByRole('button', { name: 'Delete River route', exact: true }).click();
  await expect(page.getByText(/This cannot be undone/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep route' }).click();
  await expect(page.locator('.library-route')).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete River route', exact: true }).click();
  await page.getByRole('button', { name: 'Delete route', exact: true }).click();
  await expect(page.locator('.library-route')).toHaveCount(1);
});
test('search works on submit; hiking and service failures are honest', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Search places or coordinates' }).fill('Innsbruck');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Innsbruck, Austria' }).click();
  await page.getByRole('button', { name: 'Hiking', exact: true }).click();
  const request = page.waitForRequest('**/api/directions/foot-hiking/geojson');
  await addPoint(page, '47.271, 11.411');
  await request;
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
  await page.route('**/api/directions/**', (route) =>
    route.fulfill({ status: 429, json: { error: 'quota' } }),
  );
  await addPoint(page, '47.28, 11.42');
  await expect(page.getByRole('alert')).toContainText('quota');
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
});
test('round trips use real provider round-trip requests; responsive controls stay reachable', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: 'Round trip', exact: true }).click();
  await addPoint(page, '47.2692, 11.4041');
  await page.route('**/api/directions/**', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.options.round_trip.length).toBe(20000);
    expect(body.coordinates).toHaveLength(1);
    const loop = [coordinates[0], coordinates[1], coordinates[2], coordinates[0]];
    await route.fulfill({
      json: {
        ...fixture,
        features: [{ ...fixture.features[0], geometry: { type: 'LineString', coordinates: loop } }],
      },
    });
  });
  await page.getByRole('button', { name: 'Discover round trips' }).click();
  await expect(page.getByRole('button', { name: /Option 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
  if (testInfo.project.name === 'mobile') {
    await page.locator('.mobile-sheet-toggle').click();
    await expect(page.locator('.planner')).toHaveCSS('height', '57px');
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await page.locator('.mobile-sheet-toggle').click();
    await expect(page.getByRole('button', { name: 'Export GPX' })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(
    page.locator('.maplibregl-ctrl-attrib').getByRole('link', { name: 'OpenStreetMap' }),
  ).toBeVisible();
});

test('split header keeps route creation direct and supports an accessible responsive menu', async ({
  page,
}, testInfo) => {
  const trigger = page.getByRole('button', { name: 'Menu', exact: true });
  await expect(page.getByRole('banner').getByRole('button')).toHaveCount(2);
  for (const control of [trigger, page.getByRole('button', { name: 'New route', exact: true })]) {
    const bounds = await control.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'My routes' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Help and data sources' })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).not.toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest('.header-menu') === null)).toBe(
    true,
  );
  await trigger.click();
  await page.getByRole('heading', { name: 'Where shall we go?' }).click();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Help and data sources' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('menuitemradio', { name: 'Русский' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
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
  await createRoute(page);
  await trigger.click();
  await page.getByRole('button', { name: 'New route', exact: true }).click();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Leave this route?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New route', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
});

test('focus indicators are single and keyboard focus follows fields, dialogs, library actions and map controls', async ({
  page,
}) => {
  const search = page.getByRole('textbox', { name: 'Search places or coordinates' });
  await search.fill('Innsbruck');
  await expect(page.locator('.place-search')).toHaveCSS('outline-width', '2px');
  await expect(search).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCSS(
    'outline-width',
    '2px',
  );
  await expect(page.locator('.place-search')).toHaveCSS('outline-style', 'none');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await menu.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'My routes' })).toHaveCSS(
    'outline-offset',
    '-2px',
  );
  await page.getByRole('menuitem', { name: 'My routes' }).press('Enter');
  const librarySearch = page.getByRole('textbox', { name: 'Search saved routes' });
  await expect(librarySearch).toBeFocused();
  await expect(page.locator('.library-search')).toHaveCSS('outline-width', '2px');
  await expect(librarySearch).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(librarySearch).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await createRoute(page);
  const newRoute = page.getByRole('button', { name: 'New route', exact: true });
  await newRoute.press('Enter');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(newRoute).toBeFocused();
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
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
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
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
