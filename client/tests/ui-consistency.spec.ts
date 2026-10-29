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

test('theme icons stay in one accessible row on narrow and desktop screens', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 320, height: 800 }
      : { width: 1440, height: 1000 },
  );
  for (const language of ['en', 'ru']) {
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page
      .getByRole('menuitemradio', { name: language === 'ru' ? 'Русский' : 'English' })
      .click();
    for (const theme of ['light', 'dark', 'system']) {
      await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
      const options = page.locator('.header-menu-theme-option');
      await expect(options).toHaveCount(3);
      await expect(page.locator('.header-menu-panel')).toHaveCSS('scale', '1');
      const boxes = await Promise.all((await options.all()).map((option) => option.boundingBox()));
      for (const box of boxes) {
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.y).toBeCloseTo(boxes[0]!.y, 1);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      }
      const groupBox = (await page.locator('.header-menu-theme-options').boundingBox())!;
      const rowBox = (await page.locator('.header-menu-theme-row').boundingBox())!;
      expect(groupBox.width).toBeCloseTo(rowBox.width, 1);
      expect(boxes[1]!.width).toBeCloseTo(boxes[0]!.width, 1);
      expect(boxes[2]!.width).toBeCloseTo(boxes[0]!.width, 1);
      const choice = page.locator('.header-menu-theme-option[data-state="checked"]');
      await expect(choice).toHaveCount(1);
      await expect(choice).toHaveAttribute('aria-checked', 'true');
      await expect(options.locator('.preference-check')).toHaveCount(0);
      await expect(choice).not.toHaveCSS('box-shadow', 'none');
      const reset = page.getByRole('menuitem', { name: /^(Reset settings|Сбросить настройки)$/ });
      const help = page.getByRole('menuitem', {
        name: /^(Help and data sources|Помощь и источники данных)$/,
      });
      const library = page.getByRole('menuitem', { name: /^(My routes|Мои маршруты)$/ });
      const actions = [library, reset, help];
      if (testInfo.project.name === 'mobile') {
        actions.push(page.getByRole('menuitem', { name: /^(New route|Новый маршрут)$/ }));
      }
      for (const item of actions) {
        await expect(item).toHaveCSS('justify-content', 'normal');
        await expect(item).toHaveCSS('font-weight', '400');
        await expect(item).toHaveCSS('font-size', '14px');
        const icon = (await item.locator('svg').boundingBox())!;
        const text = (await item.locator('span').boundingBox())!;
        const referenceIcon = (await reset.locator('svg').boundingBox())!;
        const referenceText = (await reset.locator('span').boundingBox())!;
        expect(icon.x).toBeCloseTo(referenceIcon.x, 1);
        expect(text.x).toBeCloseTo(referenceText.x, 1);
      }
      await expect(page.locator('.header-menu-panel')).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`theme-row-${language}-${theme}.png`) });
      const index = ['light', 'dark', 'system'].indexOf(theme);
      await options.nth(index).click();
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^(Menu|Меню)$/ })).toBeFocused();
      await expect(page.locator('html')).toHaveCSS(
        'color-scheme',
        theme === 'dark' ? 'dark' : 'light',
      );
    }
  }
});

test('back to map stays a themed navigation control on narrow and desktop screens', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 320, height: 800 }
      : { width: 1440, height: 1000 },
  );
  for (const language of ['en', 'ru']) {
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page
      .getByRole('menuitemradio', { name: language === 'ru' ? 'Русский' : 'English' })
      .click();
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
      await page.locator('.header-menu-theme-option').nth(theme === 'dark' ? 1 : 0).click();
      await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
      await page.getByRole('menuitem', { name: /^(My routes|Мои маршруты)$/ }).click();
      await expect(page.getByTestId('panel-loader')).toHaveCount(0);
      const back = page.locator('.library-screen').getByRole('button', {
        name: /^(Back to map|Назад к карте)$/,
      });
      await expect(back).toBeEnabled();
      await expect(back).toHaveAttribute('data-variant', 'ghost');
      await expect(back).toHaveCSS('border-top-width', '0px');
      await expect(back).toHaveCSS('box-shadow', 'none');
      await expect(back).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const box = (await back.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await back.focus();
      await expect(back).toHaveCSS('outline-style', 'solid');
      await expect(back).toHaveCSS('outline-width', '2px');
      await page.screenshot({ path: testInfo.outputPath(`back-to-map-${language}-${theme}.png`) });
      await back.click();
      await expect(page.locator('.library-screen')).toHaveCount(0);
    }
  }
});

test('coordinate fields support pair paste, inline correction and aligned mobile actions', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 320, height: 900 }
      : { width: 1440, height: 1000 },
  );
  await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
  for (const language of ['en', 'ru']) {
    if (language === 'ru') {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
    }
    const latitude = page.getByRole('textbox', {
      name: language === 'ru' ? 'Широта' : 'Latitude',
      exact: true,
    });
    const longitude = page.getByRole('textbox', {
      name: language === 'ru' ? 'Долгота' : 'Longitude',
      exact: true,
    });
    const add = page.getByRole('button', {
      name: language === 'ru' ? 'Добавить координаты' : 'Add coordinates',
      exact: true,
    });
    await latitude.scrollIntoViewIfNeeded();
    const latBox = (await latitude.boundingBox())!;
    const lonBox = (await longitude.boundingBox())!;
    const addBox = (await add.boundingBox())!;
    expect(latBox.y).toBeCloseTo(lonBox.y, 1);
    expect(latBox.width).toBeCloseTo(lonBox.width, 1);
    for (const input of [latitude, longitude]) {
      await expect(input).toHaveCSS('height', '44px');
      await expect(input).toHaveCSS('font-size', '16px');
    }
    if (testInfo.project.name === 'mobile') {
      expect(addBox.y).toBeGreaterThanOrEqual(latBox.y + latBox.height);
      expect(addBox.x).toBeCloseTo(latBox.x, 1);
      expect(addBox.width).toBeCloseTo(lonBox.x + lonBox.width - latBox.x, 1);
    } else expect(addBox.y).toBeCloseTo(latBox.y, 1);
    await expect(page.locator('.coordinate-help')).toBeVisible();
    const count = await page.locator('.waypoint-marker').count();
    await latitude.fill('91');
    await longitude.fill('11.4');
    await longitude.press('Enter');
    await expect(latitude).toHaveAttribute('aria-invalid', 'true');
    await expect(latitude).toBeFocused();
    await expect(page.locator('.coordinate-error')).toContainText(
      language === 'ru' ? 'Широта должна быть' : 'Latitude must be',
    );
    await expect(page.locator('.waypoint-marker')).toHaveCount(count);
    await expect(longitude).toHaveValue('11.4');
    await longitude.evaluate((input) => {
      const data = new DataTransfer();
      data.setData('text/plain', '47,26; 11,4');
      input.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await expect(latitude).toHaveValue('47,26');
    await expect(longitude).toHaveValue('11,4');
    await expect(page.locator('.coordinate-error')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`coordinate-entry-${language}.png`) });
    await longitude.press('Enter');
    await expect(page.locator('.waypoint-marker')).toHaveCount(count + 1);
    await expect(latitude).toHaveValue('');
    await expect(longitude).toHaveValue('');
    await expect(latitude).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
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
    await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
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

test('time controls have compact spacing and contained Russian dropdowns', async ({ page }) => {
  await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
  const speed = page.getByLabel('Personal speed (km/h)', { exact: true });
  const fitnessLabel = page.getByText('Fitness level', { exact: true });
  await speed.scrollIntoViewIfNeeded();
  const speedBox = (await speed.boundingBox())!;
  const labelBox = (await fitnessLabel.boundingBox())!;
  expect(labelBox.y - speedBox.y - speedBox.height).toBeGreaterThanOrEqual(6);
  expect(labelBox.y - speedBox.y - speedBox.height).toBeLessThanOrEqual(16);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const surface = page.getByRole('button', { name: 'Покрытие', exact: true });
    await surface.scrollIntoViewIfNeeded();
    const card = surface.locator('xpath=ancestor::details[1]');
    const cardBox = (await card.boundingBox())!;
    const surfaceBox = (await surface.boundingBox())!;
    expect(surfaceBox.x).toBeGreaterThanOrEqual(cardBox.x + 10);
    expect(surfaceBox.x + surfaceBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width - 10);
    await expect(surface.locator('svg').last()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await surface.click();
    const menu = page.getByRole('menu');
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
    const selected = page.getByRole('menuitemradio', { name: 'Неизвестное покрытие', exact: true });
    await expect(selected).toBeVisible();
    await expect(selected).toHaveAttribute('aria-checked', 'true');
    await expect(selected.locator('svg.lucide-check')).toBeVisible();
    await expect(menu.locator('svg.lucide-circle')).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});

test('personal time allows clearing and retyping with localized validation', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/v2/directions/')) requests.push(request.url());
  });
  await page.getByRole('button', { name: 'Manual drawing', exact: true }).click();
  for (const value of ['47.26, 11.4', '47.27, 11.41']) {
    await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
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
  const error = page.getByText('Enter a speed greater than 0.', { exact: true });
  await expect(error).toHaveCSS('font-size', '12px');
  await expect(error).toHaveCSS('line-height', '18px');
  await expect(error).toHaveCSS('font-weight', '400');
  expect(
    await speed.evaluate((element) =>
      element
        .getAttribute('aria-describedby')
        ?.split(/\s+/)
        .some((id) =>
          document.getElementById(id)?.textContent?.includes('Enter a speed greater than 0.'),
        ),
    ),
  ).toBe(true);
  await expect(speed).toHaveCSS(
    'border-color',
    await error.evaluate((element) => getComputedStyle(element).color),
  );
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
  await page.evaluate(async (path) => {
    const { routeDb } = await import(path);
    let prototype = Object.getPrototypeOf(routeDb.routes.orderBy('updatedAt'));
    while (!Object.hasOwn(prototype, 'toArray')) prototype = Object.getPrototypeOf(prototype);
    const original = prototype.toArray;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    prototype.toArray = function (this: unknown, ...args: unknown[]) {
      return gate.then(() => original.apply(this, args));
    };
    (window as Window & { releaseLibraryRead: () => void }).releaseLibraryRead = () => {
      prototype.toArray = original;
      release();
    };
  }, '/src/domain/storage.ts');
  const release = () =>
    page.evaluate(() =>
      (window as Window & { releaseLibraryRead?: () => void }).releaseLibraryRead?.(),
    );
  const canvas = page.locator('.maplibregl-canvas');
  const before = await canvas.boundingBox();
  try {
    await page.getByRole('button', { name: 'My routes', exact: true }).click();
    await expect(page.getByTestId('global-map-loader')).toBeVisible();
    await expect(page.locator('.global-map-loader__orbit')).toBeVisible();
    expect(await canvas.boundingBox()).toEqual(before);
    await expect(page.getByTestId('global-map-loader')).toHaveCSS('position', 'fixed');
    await release();
    await expect(page.locator('.library-screen')).toBeVisible();
    await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await expect(canvas).toBeVisible();
    expect(await canvas.boundingBox()).toEqual(before);
  } finally {
    await release();
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
  await page.getByRole('textbox', { name: 'Latitude' }).fill('47.26, 11.4');
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
