import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
  await page.route('https://api.heigit.org/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
});

test('history controls exist only on the map', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toHaveCount(1);
  await expect(page.locator('.planner').getByRole('button', { name: /^(Undo|Redo)$/ })).toHaveCount(
    0,
  );
  await expect(page.locator('.map-undo-tool')).toBeVisible();
  await expect(page.locator('.map-redo-tool')).toBeVisible();
});

test('personal time fields follow planner sizing without duplicate history buttons', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 320, height: 900 }
      : { width: 1440, height: 1000 },
  );
  await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
  for (const value of ['47.26, 11.4', '47.27, 11.41']) {
    await page.getByRole('textbox', { name: 'Latitude, longitude' }).fill(value);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  const speed = page.getByLabel('Personal speed (km/h)', { exact: true });
  const stops = page.getByLabel('Stops (minutes)', { exact: true });
  await speed.scrollIntoViewIfNeeded();
  await expect(speed).toBeVisible();
  await expect(stops).toBeVisible();
  for (const input of [speed, stops]) {
    const box = (await input.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeLessThanOrEqual(48);
  }
  await expect(page.locator('.planner').getByRole('button', { name: /^(Undo|Redo)$/ })).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('planner-time-fields.png') });
});

test('personal time allows clearing and retyping with localized validation', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/v2/directions/')) requests.push(request.url());
  });
  await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
  for (const value of ['47.26, 11.4', '47.27, 11.41']) {
    await page.getByRole('textbox', { name: 'Latitude, longitude' }).fill(value);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  const speed = page.getByLabel('Personal speed (km/h)', { exact: true });
  const stops = page.getByLabel('Stops (minutes)', { exact: true });
  await speed.fill('');
  await expect(speed).toHaveValue('');
  await speed.fill('12.5');
  await speed.press('Tab');
  await stops.fill('');
  await expect(stops).toHaveValue('');
  await stops.fill('15');
  await stops.press('Enter');
  await expect(stops).toHaveValue('15');
  await speed.fill('0');
  await speed.press('Tab');
  await expect(speed).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
  await expect(page.getByText('Оценка времени', { exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByRole('button', { name: 'Восстановить черновик', exact: true }).click();
  await expect(page.getByLabel('Личная скорость (км/ч)', { exact: true })).toHaveValue(/12[.,]5/);
  await expect(page.getByLabel('Остановки (минуты)', { exact: true })).toHaveValue('15');
  expect(requests).toEqual([]);
});

test('library loading overlays the editor without moving the map', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/src/components/Library.tsx*', async (route) => {
    await gate;
    await route.continue();
  });
  const canvas = page.locator('.maplibregl-canvas');
  const before = await canvas.boundingBox();
  try {
    await page.getByRole('button', { name: 'My routes', exact: true }).click();
    await expect(page.getByTestId('global-map-loader')).toBeVisible();
    await expect(page.locator('.global-map-loader__orbit')).toBeVisible();
    expect(await canvas.boundingBox()).toEqual(before);
    await expect(page.getByTestId('global-map-loader')).toHaveCSS('position', 'fixed');
    release();
    await expect(page.locator('.library-screen')).toBeVisible();
    await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await expect(canvas).toBeVisible();
    expect(await canvas.boundingBox()).toEqual(before);
  } finally {
    release();
  }
});

test('saved route cards keep uniform heights and aligned actions with long names and tags', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 320, height: 900 }
      : { width: 1440, height: 1200 },
  );
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'grid.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><trk><name>Short route</name><trkseg><trkpt lat="47.26" lon="11.4"/><trkpt lat="47.27" lon="11.41"/></trkseg></trk></gpx>',
    ),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'My routes', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export library', exact: true }).click();
  const backup = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  const original = backup.routes[0];
  backup.routes = Array.from({ length: 6 }, (_, index) => ({
    ...original,
    id: `grid-route-${index}`,
    name:
      index % 2 ? `Route ${index}` : `A long route name ${'with another copy '.repeat(12)}${index}`,
    tags: index % 2 ? [] : ['weekend', 'waterfront', 'mountain', 'forest', 'spring', 'trail'],
    waypoints: original.waypoints.map((point: { id: string }) => ({
      ...point,
      id: `${point.id}-${index}`,
    })),
  }));
  await page.getByLabel('Import library file').setInputFiles({
    name: 'grid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole('button', { name: 'Import routes', exact: true }).click();
  const cards = page.locator('.library-route');
  await expect(cards).toHaveCount(7);
  const boxes = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const card = element.getBoundingClientRect();
      const footer = element.querySelector('.library-actions')!.getBoundingClientRect();
      return { height: card.height, footer: footer.top - card.top };
    }),
  );
  for (const box of boxes) {
    expect(Math.abs(box.height - boxes[0].height)).toBeLessThan(1);
    expect(Math.abs(box.footer - boxes[0].footer)).toBeLessThan(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('library-uniform-grid.png') });
});

test('draft recovery uses the same compact confirmation layout', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
  await page.getByRole('textbox', { name: 'Latitude, longitude' }).fill('47.26, 11.4');
  await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Restore your draft?', exact: true });
  await expect(dialog.locator('.dialog-header .dialog-description')).toContainText(
    'An unfinished route',
  );
  await expect(dialog.locator('.dialog-body > p')).toHaveCount(0);
  await expect(dialog.locator('.button-row.dialog-actions')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('draft-dialog.png') });
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
});

test('reset confirmation uses shared action spacing and restores focus', async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Reset settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset settings', exact: true });
  const actions = dialog.locator('.button-row.dialog-actions');
  await expect(actions).toBeVisible();
  await expect(actions).toHaveCSS('gap', /^(8|10)px$/);
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  const confirm = dialog.getByRole('button', { name: 'Reset settings', exact: true });
  await expect(cancel).toBeFocused();
  const a = (await cancel.boundingBox())!;
  const b = (await confirm.boundingBox())!;
  expect(
    Math.max(b.x - a.x - a.width, a.x - b.x - b.width, b.y - a.y - a.height, a.y - b.y - b.height),
  ).toBeGreaterThanOrEqual(7.5);
  await page.screenshot({ path: testInfo.outputPath('reset-dialog.png') });
  await cancel.click();
  await expect(menu).toBeFocused();
});

test('library controls share application styling in Russian, light and dark, without narrow-screen overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 320, height: 900 }
      : { width: 1440, height: 1000 },
  );
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'sample.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><trk><name>Weekend ride</name><trkseg><trkpt lat="47.26" lon="11.4"/><trkpt lat="47.27" lon="11.41"/></trkseg></trk></gpx>',
    ),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await menu.click();
  await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
  await page.getByRole('button', { name: 'Мои маршруты', exact: true }).click();
  const screen = page.locator('.library-screen');
  await expect(screen).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(screen.getByRole('button', { name: 'Назад к карте', exact: true })).toBeVisible();
  await expect(
    screen.getByRole('button', { name: 'Импорт библиотеки', exact: true }),
  ).toBeVisible();
  await expect(screen.getByLabel('Файл для импорта библиотеки', { exact: true })).not.toBeVisible();
  await expect(screen.getByRole('checkbox')).toHaveCount(0);
  await expect(screen.getByRole('button', { name: 'Только избранное', exact: true })).toBeVisible();
  await expect(screen.getByText('Сначала обновлённые', { exact: true })).toBeVisible();
  expect(await screen.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const card = screen.locator('.library-route');
  const before = await card.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    width: element.getBoundingClientRect().width,
    offset: (element as HTMLElement).offsetTop,
    scrollHeight: element.closest('.library-screen-scroll')!.scrollHeight,
  }));
  await card.getByRole('button', { name: 'Удалить Weekend ride', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const after = await card.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    width: element.getBoundingClientRect().width,
    offset: (element as HTMLElement).offsetTop,
    scrollHeight: element.closest('.library-screen-scroll')!.scrollHeight,
  }));
  expect(after.height).toBeCloseTo(before.height, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.offset).toBe(before.offset);
  expect(after.scrollHeight).toBe(before.scrollHeight);
  await page.screenshot({ path: testInfo.outputPath('library-delete-overlay.png') });
  await page.getByRole('button', { name: 'Оставить маршрут', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('library-ru-light.png') });
  await screen.getByRole('button', { name: 'Назад к карте', exact: true }).click();
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Тёмная', exact: true }).click();
  await page.getByRole('button', { name: 'Мои маршруты', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await screen.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('library-ru-dark.png') });
});
