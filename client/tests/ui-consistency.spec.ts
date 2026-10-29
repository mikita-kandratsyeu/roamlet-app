import { clickMapTool, mapTool } from './mapControls';
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
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
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
      await page
        .locator('.header-menu-theme-option')
        .nth(theme === 'dark' ? 1 : 0)
        .click();
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

test('map issue reporting stays in the tools menu at every screen size', async ({ page }) => {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const report = page.getByRole('link', { name: 'Report a map issue ↗' });
    await expect(report).toHaveCount(0);
    await expect(page.locator('.map-issue')).toHaveCount(0);
    const trigger = page.getByRole('button', { name: 'More map tools' });
    await expect(trigger).toBeInViewport();
    await trigger.click();
    const panel = page.getByRole('dialog', { name: 'Map controls' });
    await expect(panel).toBeInViewport();
    await expect(report).toHaveCount(1);
    await expect(report).toBeInViewport();
    await expect(report).toHaveAttribute('href', 'https://www.openstreetmap.org/');
    await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCount(1);
    await panel.getByRole('button', { name: 'Close map tools' }).click();
    await expect(report).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test('compact map controls keep three touch targets and all tools available', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const controls = page.getByRole('group', { name: 'Map controls' });
  await expect(controls.getByRole('button')).toHaveCount(3);
  await expect(controls.getByRole('button', { name: 'Use my location' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Fit route' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toHaveCount(0);
  await expect(page.locator('.map-bottom-toolbar .map-issue')).not.toBeVisible();
  const box = (await controls.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(154);
  expect(box.height).toBe(54);
  for (const button of await controls.getByRole('button').all()) {
    const target = (await button.boundingBox())!;
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
  const trigger = page.getByRole('button', { name: 'More map tools' });
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Map controls' });
  await expect(panel).toBeInViewport();
  for (const name of ['Reset north', 'Zoom in', 'Zoom out', 'Manual drawing', 'Undo', 'Redo']) {
    const tool = panel.getByRole('button', { name, exact: true });
    await expect(tool).toBeVisible();
    await expect(tool).toHaveCSS('border-top-width', '0px');
    await expect(tool).toHaveCSS('box-shadow', 'none');
  }
  const report = panel.getByRole('link', { name: 'Report a map issue ↗' });
  await expect(report).toBeVisible();
  await expect(report).toHaveCSS('border-radius', '0px');
  await expect(report).toHaveCSS('border-top-width', '1px');
  await panel.getByRole('button', { name: 'Zoom in' }).click();
  await page.screenshot({ path: testInfo.outputPath('compact-map-tools.png') });
  await panel.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More map tools' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Zoom in' })).toBeVisible();
});

test('small-screen statistics keep labels readable and time ranges on one line', async ({
  page,
}, testInfo) => {
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'mountain-profile.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(`<?xml version="1.0"?><gpx version="1.1" creator="test">
      <trk><name>Mountain profile</name><trkseg>
        <trkpt lat="47" lon="11"><ele>100</ele></trkpt>
        <trkpt lat="47.08" lon="11.08"><ele>600</ele></trkpt>
        <trkpt lat="47.12" lon="11.12"><ele>200</ele></trkpt>
      </trkseg></trk></gpx>`),
  });
  await expect(page.locator('.stat-card')).toHaveCount(6);
  for (const language of ['en', 'ru']) {
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page
      .getByRole('menuitemradio', { name: language === 'ru' ? 'Русский' : 'English' })
      .click();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const sheet = page.locator('.mobile-sheet-toggle');
      if ((await sheet.getAttribute('aria-expanded')) === 'false') await sheet.click();
      const cards = page.locator('.stat-card');
      for (const card of (await cards.all()).slice(0, 2))
        await expect(card.locator('dt')).toBeVisible();
      for (const card of (await cards.all()).slice(2)) {
        await expect(card).toHaveCSS('grid-column', '1 / -1');
        await expect(card.locator('dd')).toHaveCSS('white-space', 'nowrap');
        const label = (await card.locator('dt').boundingBox())!;
        const value = (await card.locator('dd').boundingBox())!;
        expect(value.x).toBeGreaterThanOrEqual(label.x + label.width + 10);
        expect(value.x + value.width).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await cards.nth(2).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`statistics-${language}-${width}.png`) });
    }
  }
});

test('mobile planner header toggles without a right-hand arrow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  const header = page.locator('.mobile-sheet-toggle');
  await expect(header).toBeVisible();
  await expect(header.locator('svg')).toHaveCount(0);
  await expect(header.locator('.sheet-identity')).toBeVisible();
  await header.focus();
  await expect(header).toBeFocused();
  const initial = await header.getAttribute('aria-expanded');
  await header.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', initial === 'true' ? 'false' : 'true');
  await header.press('Space');
  await expect(header).toHaveAttribute('aria-expanded', initial!);
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', initial === 'true' ? 'false' : 'true');
});

test('saved descriptions use two-line previews and open in the planner without map clutter', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 320, height: 844 }
      : { width: 1440, height: 1000 },
  );
  const description =
    'Meet at the station and bring water. Enjoy the forest trail and its views. '.repeat(12) +
    '\n\nReturn before sunset.';
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'description.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1" creator="test"><trk><name>Forest notes</name><trkseg><trkpt lat="47" lon="11"/><trkpt lat="47.01" lon="11.01"/></trkseg></trk></gpx>',
    ),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('textbox', { name: /^Description/ }).fill(description);
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.locator('.header-menu-theme-option').nth(1).click();
  }
  await page.getByRole('banner').getByRole('button', { name: 'My routes', exact: true }).click();
  await expect(page.getByTestId('panel-loader')).toHaveCount(0);
  const tags = ['Scenic', 'Weekend', 'Forest', 'Water', 'LongTag'.repeat(20)];
  await page.getByRole('button', { name: 'Edit Forest notes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Tags', exact: true }).fill(tags.join(', '));
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const libraryTag = page.locator('.library-route .library-route-tag').first();
  const tagColors = await libraryTag.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
    border: getComputedStyle(element).borderColor,
  }));
  const libraryPreview = page.locator('.library-route .route-description');
  await expect(libraryPreview).toHaveCSS('-webkit-line-clamp', '2');
  await expect(libraryPreview).toHaveAttribute('title', description);
  const libraryBox = (await libraryPreview.boundingBox())!;
  const lineHeight = await libraryPreview.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).lineHeight),
  );
  expect(libraryBox.height).toBeLessThanOrEqual(lineHeight * 2 + 1);
  await page.screenshot({ path: testInfo.outputPath('library-description.png') });
  await page.locator('.library-route .library-open-action').click();
  await expect(page.locator('.library-screen')).toHaveCount(0);
  const sheet = page.locator('.mobile-sheet-toggle');
  if ((await sheet.isVisible()) && (await sheet.getAttribute('aria-expanded')) === 'false')
    await sheet.click();
  const trigger = page.getByRole('button', { name: 'Read route description' });
  await expect(
    page.locator('.planner').getByRole('button', { name: 'Read route description' }),
  ).toBeVisible();
  await expect(page.locator('.map-region .planner-route-description')).toHaveCount(0);
  await expect(trigger.locator('.planner-route-description-preview')).toHaveCSS(
    '-webkit-line-clamp',
    '2',
  );
  const tagPreview = page.getByRole('button', { name: 'View all route tags' });
  await expect(tagPreview.locator('[data-slot="badge"]')).toHaveCount(4);
  await expect(tagPreview.locator('.planner-route-tag-overflow')).toHaveText('+2');
  const firstTag = tagPreview.locator('.planner-route-tag').first();
  await expect(firstTag).toHaveCSS('background-color', tagColors.background);
  await expect(firstTag).toHaveCSS('color', tagColors.color);
  await expect(firstTag).toHaveCSS('border-color', tagColors.border);
  const noteBox = (await trigger.boundingBox())!;
  const tagsBox = (await tagPreview.boundingBox())!;
  expect(tagsBox.y).toBeGreaterThanOrEqual(noteBox.y + noteBox.height);
  expect(tagsBox.x + tagsBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: testInfo.outputPath('planner-route-tags.png') });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Route description' });
  expect(await dialog.locator('.route-description-full').textContent()).toBe(description);
  await expect(dialog.locator('.route-full-tags > li')).toHaveCount(tags.length);
  for (const tag of tags) await expect(dialog.getByText(tag, { exact: true })).toBeVisible();
  await expect(dialog.locator('.route-full-tags [data-slot="badge"]').first()).toHaveCSS(
    'background-color',
    tagColors.background,
  );
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('full-route-description.png') });
  await dialog.press('Escape');
  await expect(trigger).toBeFocused();
});

test('coordinate fields support pair paste, inline correction and aligned mobile actions', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 320, height: 900 }
      : { width: 1440, height: 1000 },
  );
  await clickMapTool(page, 'Manual drawing');
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
  await mapTool(page, 'Undo');
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
  await clickMapTool(page, 'Manual drawing');
  for (const value of ['47.26, 11.4', '47.27, 11.41']) {
    await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await page.locator('.personal-time-section > summary').click();
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
  await clickMapTool(page, 'Manual drawing');
  await page.locator('.personal-time-section > summary').click();
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
    expect(surfaceBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(surfaceBox.x + surfaceBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
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
    if (new URL(request.url()).pathname === '/api/route') requests.push(request.url());
  });
  await clickMapTool(page, 'Manual drawing');
  for (const value of ['47.26, 11.4', '47.27, 11.41']) {
    await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await page.locator('.personal-time-section > summary').click();
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
  await page.getByRole('button', { name: 'Download backup', exact: true }).click();
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
  await clickMapTool(page, 'Manual drawing');
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
    screen.getByRole('button', { name: 'Восстановить из копии', exact: true }),
  ).toBeVisible();
  await expect(screen.getByLabel('Файл для импорта библиотеки', { exact: true })).not.toBeVisible();
  await expect(
    screen.getByRole('checkbox', { name: 'Выбрать Weekend ride для сравнения', exact: true }),
  ).toHaveCount(1);
  await expect(screen.getByRole('checkbox')).toHaveCount(1);
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

test('manual discovery and backup guidance share the existing design in both languages and themes', async ({
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
      .getByRole('menuitemradio', { name: language === 'ru' ? 'Русский' : 'English', exact: true })
      .click();
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
      await page
        .locator('.header-menu-theme-option')
        .nth(theme === 'dark' ? 1 : 0)
        .click();
      const manual = page.getByRole('button', {
        name: /^(Draw a route manually|Нарисовать маршрут вручную)$/,
      });
      await manual.scrollIntoViewIfNeeded();
      await expect(manual).toBeInViewport();
      await expect(manual).toHaveAttribute('data-variant', 'outline');
      await expect(manual).toHaveCSS('font-weight', '400');
      await expect(manual).toHaveCSS('box-shadow', 'none');
      const manualBox = (await manual.boundingBox())!;
      const tabsBox = (await page.locator('.planning-tabs').boundingBox())!;
      expect(manualBox.height).toBeGreaterThanOrEqual(44);
      expect(manualBox.x).toBeCloseTo(tabsBox.x, 1);
      expect(manualBox.width).toBeCloseTo(tabsBox.width, 1);
      expect(manualBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height);
      await page.screenshot({
        path: testInfo.outputPath(`manual-action-${language}-${theme}.png`),
      });
      await manual.click();
      const section = page.getByRole('region', { name: /^(Manual drawing|Ручное рисование)$/ });
      await expect(section).toBeVisible();
      const returnButton = section.getByRole('button', {
        name: /^(Return to automatic routing|Вернуться к автоматическому расчёту)$/,
      });
      await returnButton.scrollIntoViewIfNeeded();
      const box = (await returnButton.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.screenshot({
        path: testInfo.outputPath(`manual-discovery-${language}-${theme}.png`),
      });
      await returnButton.click();
      await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
      await page.getByRole('menuitem', { name: /^(My routes|Мои маршруты)$/ }).click();
      const backups = page.getByRole('group', {
        name: /^(Library backup|Резервная копия библиотеки)$/,
      });
      await expect(backups).toHaveAccessibleDescription(/JSON/);
      await expect(
        backups.getByRole('button', { name: /^(Download backup|Скачать резервную копию)$/ }),
      ).toBeDisabled();
      const restore = backups.getByRole('button', {
        name: /^(Restore from backup|Восстановить из копии)$/,
      });
      await restore.scrollIntoViewIfNeeded();
      await expect(restore).toBeInViewport();
      const backupBoxes = await Promise.all(
        (await backups.getByRole('button').all()).map((button) => button.boundingBox()),
      );
      for (const backupBox of backupBoxes) {
        expect(backupBox!.height).toBeGreaterThanOrEqual(44);
      }
      if (testInfo.project.name === 'mobile') {
        expect(backupBoxes[1]!.y).toBeGreaterThanOrEqual(
          backupBoxes[0]!.y + backupBoxes[0]!.height,
        );
        expect(backupBoxes[1]!.width).toBeCloseTo(backupBoxes[0]!.width, 1);
      }
      expect(
        await page.locator('.library-screen').evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`backup-guidance-${language}-${theme}.png`),
      });
      await page.getByRole('button', { name: /^(Back to map|Назад к карте)$/ }).click();
    }
  }
});

test('product help and no-results recovery are translated without deployment instructions', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 320, height: 800 }
      : { width: 1440, height: 1000 },
  );
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'example.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><metadata><name>Example route</name></metadata><trk><trkseg><trkpt lat="47.26" lon="11.4"/><trkpt lat="47.27" lon="11.41"/></trkseg></trk></gpx>',
    ),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const language of ['en', 'ru']) {
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page
      .getByRole('menuitemradio', { name: language === 'ru' ? 'Русский' : 'English', exact: true })
      .click();
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page.locator('.header-menu-theme-option').nth(1).click();
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page
      .getByRole('menuitem', { name: /^(Help and data sources|Помощь и источники данных)$/ })
      .click();
    const help = page.getByRole('dialog');
    await expect(help).toBeVisible();
    await expect(help).toHaveCSS('opacity', '1');
    await expect(help).not.toContainText(/ORS_API_KEY|Vercel|Firewall|cycling-regular|foot-hiking/);
    await expect(
      help.getByRole('heading', {
        name: language === 'ru' ? 'Планирование маршрутов' : 'Planning routes',
        exact: true,
      }),
    ).toBeVisible();
    await expect(help.getByRole('link', { name: 'ODbL', exact: true })).toHaveAttribute(
      'href',
      'https://opendatacommons.org/licenses/odbl/1-0/',
    );
    await page.screenshot({ path: testInfo.outputPath(`product-help-${language}.png`) });
    await help
      .getByRole('heading', {
        name: language === 'ru' ? 'Онлайн-запросы и ваши данные' : 'Online requests and your data',
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`product-help-data-${language}.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page.getByRole('menuitem', { name: /^(My routes|Мои маршруты)$/ }).click();
    const search = page.getByRole('textbox', {
      name: language === 'ru' ? 'Поиск сохранённых маршрутов' : 'Search saved routes',
      exact: true,
    });
    await search.fill('no-such-route');
    const empty = page.locator('.library-no-match');
    await expect(empty.getByRole('heading')).toHaveText(
      language === 'ru' ? 'Маршруты не найдены' : 'No matching routes',
    );
    await expect(empty).not.toContainText(
      language === 'ru' ? /Try another|Clear search|Change your search/ : /Маршруты не найдены/,
    );
    const reset = empty.getByRole('button', {
      name: language === 'ru' ? 'Сбросить поиск и фильтры' : 'Reset search and filters',
      exact: true,
    });
    await reset.scrollIntoViewIfNeeded();
    await expect(reset).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`no-results-${language}.png`) });
    await reset.click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(page.locator('.library-route')).toHaveCount(1);
    await page.getByRole('button', { name: /^(Back to map|Назад к карте)$/ }).click();
  }
});

test('empty mobile planner shows its guidance once and keeps a useful collapsed summary', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const sheet = page.locator('.mobile-sheet-toggle');
  await expect(sheet).toHaveAttribute('aria-expanded', 'true');
  await expect(sheet.locator('small')).toHaveCount(0);
  await expect(page.locator('.planner-route-status')).toHaveText(
    'Start with two points on the map',
  );
  await sheet.click();
  await expect(sheet.locator('small')).toHaveText('Start with two points on the map');
  await expect(page.locator('.planner-route-status')).not.toBeVisible();
  await sheet.click();
  await expect(sheet.locator('small')).toHaveCount(0);
  await expect(page.locator('.planner-route-status')).toBeVisible();
});

test('notifications fit narrow, landscape and wide screens with an inset square dismiss button', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
  await page.getByLabel('Импорт файла GPX').setInputFiles({
    name: 'invalid.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from('invalid GPX'),
  });
  const toast = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(toast).toBeVisible();
  await toast.locator('.notification-message').evaluate((element) => {
    element.textContent =
      'Не удалось сохранить маршрут в этом браузере на этом устройстве. ' +
      'ОченьДлинноеНазваниеМаршрутаБезПробелов'.repeat(2);
  });
  for (const viewport of [
    { width: 320, height: 360 },
    { width: 390, height: 740 },
    { width: 600, height: 375 },
    { width: 601, height: 375 },
    { width: 844, height: 390 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const close = toast.getByRole('button', { name: 'Закрыть уведомление', exact: true });
    await expect(close).toHaveCSS('transform', 'none');
    await expect
      .poll(async () => {
        const rect = (await toast.boundingBox())!;
        return rect.y >= 16 && rect.y + rect.height <= viewport.height - 16;
      })
      .toBe(true);
    const box = (await toast.boundingBox())!;
    const closeBox = (await close.boundingBox())!;
    const contentBox = (await toast.locator('[data-content]').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.y).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 16);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 16);
    expect(box.width).toBeLessThanOrEqual(400);
    expect(closeBox.width).toBe(44);
    expect(closeBox.height).toBe(44);
    expect(closeBox.x).toBeGreaterThan(box.x);
    expect(closeBox.y).toBeGreaterThan(box.y);
    expect(closeBox.x + closeBox.width).toBeLessThan(box.x + box.width);
    expect(closeBox.y + closeBox.height).toBeLessThan(box.y + box.height);
    expect(contentBox.x + contentBox.width).toBeLessThanOrEqual(closeBox.x);
    expect(await toast.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const iconBox = (await toast.locator('[data-icon]').boundingBox())!;
    const titleBox = (await toast.locator('[data-title]').boundingBox())!;
    expect(iconBox.y).toBeGreaterThanOrEqual(titleBox.y);
    expect(iconBox.y + iconBox.height).toBeLessThanOrEqual(titleBox.y + titleBox.height);
    await expect
      .poll(() =>
        close.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
          );
        }),
      )
      .toBe(true);
    if (viewport.width === 320 || viewport.width === 1920) {
      await page.screenshot({ path: testInfo.outputPath(`notification-${viewport.width}.png`) });
    }
  }
  const close = toast.getByRole('button', { name: 'Закрыть уведомление', exact: true });
  await close.focus();
  await close.press('Enter');
  await expect(toast).toHaveCount(0);
});

test('success notifications stay below dialogs without hiding actionable errors', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 320, height: 740 }
      : { width: 1440, height: 1000 },
  );
  const importer = page.getByLabel('Import GPX file');
  const toaster = page.locator('[data-sonner-toaster]');
  await importer.setInputFiles({
    name: 'invalid.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from('invalid GPX'),
  });
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Help and data sources', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(toaster).toHaveCSS('z-index', '100');
  await page.getByRole('dialog').press('Escape');
  await importer.setInputFiles({
    name: 'valid.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><trk><trkseg><trkpt lat="47.26" lon="11.4"/><trkpt lat="47.27" lon="11.41"/></trkseg></trk></gpx>',
    ),
  });
  const success = page.locator('[data-sonner-toast][data-type="success"]');
  await expect(success).toBeVisible();
  await expect(success).toHaveCSS('pointer-events', 'none');
  await expect(
    success.getByRole('button', { name: 'Dismiss notification', exact: true }),
  ).toHaveCSS('pointer-events', 'auto');
  const exportButton = page.getByRole('button', { name: 'Export', exact: true });
  await expect
    .poll(() =>
      exportButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit !== null && element.contains(hit);
      }),
    )
    .toBe(true);
  await exportButton.click();
  const dialog = page.getByRole('dialog', { name: 'Export route', exact: true });
  await expect(dialog).toBeVisible();
  await expect(toaster).toHaveCSS('z-index', '40');
  const downloadButton = dialog.getByRole('button', { name: 'Download GPX', exact: true });
  await downloadButton.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      downloadButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit !== null && element.contains(hit);
      }),
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('export-notification-layering.png') });
  const download = page.waitForEvent('download');
  await downloadButton.click();
  expect((await download).suggestedFilename()).toMatch(/\.gpx$/);
});
