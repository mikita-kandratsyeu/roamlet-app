import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const coordinates = [
  [11.4041, 47.2692, 600],
  [11.405, 47.2697, 620],
  [11.409, 47.27, 630],
  [11.411, 47.271, 610],
];
const fixture = {
  code: 'Ok',
  routes: [
    {
      distance: 640,
      duration: 240,
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
  await page.route('**/directions/v5/mapbox/**', (route) => route.fulfill({ json: fixture }));
  await page.route('**/search/geocode/v6/forward?**', (route) =>
    route.fulfill({
      json: {
        features: [
          {
            geometry: { coordinates: [11.4041, 47.2692] },
            properties: { full_address: 'Innsbruck, Austria' },
          },
        ],
      },
    }),
  );
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
  await expect(page.locator('.planner')).toContainText('Weekend escape');
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
  await expect(page.locator('.planner')).toContainText('Mountain morning');
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
test('search works on submit; hiking and service failures are honest', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Search places or coordinates' }).fill('Innsbruck');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Innsbruck, Austria' }).click();
  await page.getByRole('radio', { name: 'Hiking', exact: true }).click();
  const request = page.waitForRequest('**/directions/v5/mapbox/walking/**');
  await addPoint(page, '47.271, 11.411');
  await request;
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
  await page.route('**/directions/v5/mapbox/**', (route) =>
    route.fulfill({ status: 429, json: { message: 'quota' } }),
  );
  await addPoint(page, '47.28, 11.42');
  await expect(page.getByRole('alert')).toContainText('quota');
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
});
test('round trips route intermediate points with bounded search; responsive controls stay reachable', async ({
  page,
}, testInfo) => {
  await page.getByRole('radio', { name: 'Round trip', exact: true }).click();
  await addPoint(page, '47.2692, 11.4041');
  await page.route('**/directions/v5/mapbox/**', async (route) => {
    const url = new URL(route.request().url());
    const points = url.pathname.split('/').at(-1)!.split(';');
    expect(route.request().method()).toBe('GET');
    expect(url.searchParams.has('options')).toBe(false);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual(points[3]);
    const loop = [coordinates[0], coordinates[1], coordinates[2], coordinates[0]];
    await route.fulfill({
      json: {
        ...fixture,
        routes: [{ ...fixture.routes[0], geometry: { type: 'LineString', coordinates: loop } }],
      },
    });
  });
  await page.getByRole('button', { name: 'Find round trips' }).click();
  await expect(page.getByRole('button', { name: /Option 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
  if (testInfo.project.name === 'mobile') {
    await page.locator('.mobile-sheet-toggle').click();
    await expect(page.locator('.planner-scroll')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Export GPX' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await page.locator('.mobile-sheet-toggle').click();
    await expect(page.getByRole('button', { name: 'Export GPX' })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(
    page.locator('.mapboxgl-ctrl-attrib').getByRole('link', { name: 'OpenStreetMap' }),
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
    page.getByRole('textbox', { name: 'Поиск мест или координат' }),
    page.getByRole('menuitem', { name: 'Мои маршруты' }),
    page.locator('.mapboxgl-map'),
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
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Help and data sources' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(firstItem).toBeFocused();
  if (compact) {
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'My routes' })).toBeFocused();
  }
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
  await expect(page.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
});

test('focus indicators are single and keyboard focus follows fields, dialogs, library actions and map controls', async ({
  page,
}) => {
  const search = page.getByRole('textbox', { name: 'Search places or coordinates' });
  await search.fill('Innsbruck');
  await expect(search).toHaveCSS('outline-width', '2px');
  await expect(page.locator('.place-search')).toHaveCSS('outline-width', '0px');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCSS(
    'outline-width',
    '2px',
  );
  await expect(page.locator('.place-search')).toHaveCSS('outline-style', 'none');
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
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(librarySearch).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await createRoute(page);
  const newRoute = await requestNewRoute(page);
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
  for (let step = 0; step < 4; step++) await page.keyboard.press('Tab');
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
  await page.locator('.mapboxgl-canvas').focus();
  await expect(page.locator('.mapboxgl-canvas')).toHaveCSS('outline-width', '2px');
  await expect(page.locator('.mapboxgl-canvas')).toHaveCSS('outline-offset', '-3px');
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
  await createRoute(page);
  await expect(page.locator('.planner')).toHaveCSS('width', mobile ? '390px' : '420px');
  if (mobile) {
    await expect(page.locator('.elevation-box')).not.toHaveAttribute('open');
    await expect(page.locator('.statistics .elevation-box')).toHaveCount(1);
    await page.locator('.mobile-sheet-toggle').click();
    await expect(page.getByRole('button', { name: 'Export GPX' })).toBeVisible();
  } else {
    await expect(page.locator('#map-elevation-root .elevation-box')).toHaveAttribute('open');
    const chart = await page.locator('#map-elevation-root').boundingBox();
    expect(chart?.x).toBe(478);
    expect(chart?.width).toBe(714);
    await page.getByRole('button', { name: 'Hide planner' }).click();
    await expect(page.locator('#map-elevation-root .elevation-box')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
