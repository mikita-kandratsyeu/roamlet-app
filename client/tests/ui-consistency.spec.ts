import { test, expect } from '@playwright/test';

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
    await expect(page.getByTestId('panel-loader')).toBeVisible();
    expect(await canvas.boundingBox()).toEqual(before);
    await expect(page.getByTestId('panel-loader')).toHaveCSS('position', 'fixed');
    release();
    await expect(page.locator('.library-screen')).toBeVisible();
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await expect(canvas).toBeVisible();
    expect(await canvas.boundingBox()).toEqual(before);
  } finally {
    release();
  }
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
  const before = await card.boundingBox();
  await card.getByRole('button', { name: 'Удалить Weekend ride', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await card.boundingBox()).toEqual(before);
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
