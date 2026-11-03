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

test('AI export preview stays private and usable in both languages and themes', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const language of ['en', 'ru']) {
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page.getByRole('menuitemradio', { name: language === 'ru' ? 'Русский' : 'English' }).click();
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
      await page.locator('.header-menu-theme-option').nth(theme === 'dark' ? 1 : 0).click();
      await page.getByRole('button', { name: /^(Export|Экспорт)$/, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: /^(Export route|Экспорт маршрута)$/ });
      await dialog.getByRole('radio', { name: /^(For AI|Для ИИ)$/ }).click();
      const preview = dialog.getByRole('textbox', { name: /^(Request preview|Предпросмотр запроса)$/ });
      await expect(preview).toBeVisible();
      expect(await preview.inputValue()).not.toContain('Forest escape');
      expect(await preview.inputValue()).not.toContain('"locationData"');
      const privacy = dialog.getByRole('checkbox');
      const privacyCard = dialog.locator('.ai-export-privacy');
      await expect(privacyCard).toHaveCSS('flex-direction', 'row');
      await expect(privacy).toHaveCSS('width', '20px');
      await expect(privacy).toHaveCSS('height', '20px');
      const privacyRow = await privacyCard.boundingBox();
      expect(privacyRow!.height).toBeGreaterThanOrEqual(44);
      await expect(privacy).not.toBeChecked();
      const uncheckedBorder = await privacyCard.evaluate((element) => getComputedStyle(element).borderColor);
      await privacy.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(privacy).toBeFocused();
      await expect(privacyCard).toHaveCSS('outline-style', 'solid');
      await privacy.press('Space');
      await expect(privacy).toBeChecked();
      await expect(privacy.locator('+ svg')).toHaveCSS('visibility', 'visible');
      await expect(privacyCard).not.toHaveCSS('border-color', uncheckedBorder);
      await privacyCard.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`ai-privacy-checked-${language}-${theme}.png`) });
      expect(await preview.inputValue()).toContain('"locationData"');
      await privacyCard.locator('#ai-export-privacy-hint').click();
      await expect(privacy).not.toBeChecked();
      expect(await preview.inputValue()).not.toContain('"locationData"');
      await expect(dialog.getByRole('complementary', { name: /^(Before sharing with AI|Перед отправкой в чат с ИИ)$/ })).toBeVisible();
      expect(await preview.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(180);
      const copy = dialog.getByRole('button', { name: /^(Copy for AI|Скопировать для ИИ)$/ });
      await copy.scrollIntoViewIfNeeded();
      await expect(copy).toBeInViewport();
      await copy.focus();
      await expect(copy).toBeFocused();
      await copy.press('Enter');
      const notification = page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: /Request copied|Запрос скопирован/ });
      await expect(notification).toBeVisible();
      await expect(dialog.getByText(/Request copied|Запрос скопирован/)).toHaveCount(0);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await preview.inputValue());
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await dialog.locator('.dialog-body').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`ai-export-${language}-${theme}.png`) });
      await dialog.getByRole('checkbox').check();
      expect(await preview.inputValue()).toContain('Forest escape');
      await dialog.getByRole('radio', { name: 'GPX', exact: true }).click();
      await expect(dialog.getByRole('button', { name: /^(Download GPX|Скачать GPX)$/ })).toBeVisible();
      await dialog.getByRole('button', { name: /^(Close dialog|Закрыть диалог)$/ }).click();
    }
  }
});

test('planned-route badge text is vertically centered in both languages and themes', async ({
  page,
}) => {
  for (const language of ['en', 'ru']) {
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page
      .getByRole('menuitemradio', { name: language === 'ru' ? 'Русский' : 'English' })
      .click();
    await page.getByRole('button', { name: /^(Export|Экспорт)$/, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^(Export route|Экспорт маршрута)$/ });
    await dialog.getByRole('radio', { name: /^(For social media|Для соцсетей)$/ }).click();
    for (const theme of ['Light', 'Dark']) {
      const themeLabel = language === 'en' ? theme : theme === 'Light' ? 'Светлая' : 'Тёмная';
      await dialog.getByRole('radio', { name: themeLabel, exact: true }).click();
      await dialog
        .getByRole('button', {
          name: /^(Create preview|Regenerate preview|Создать предпросмотр|Обновить предпросмотр)$/,
        })
        .click();
      const image = dialog.getByRole('img');
      await expect(image).toBeVisible();
      const center = await image.evaluate((element: HTMLImageElement, dark: boolean) => {
        const canvas = document.createElement('canvas');
        canvas.width = element.naturalWidth;
        canvas.height = element.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(element, 0, 0);
        const color = dark ? [157, 228, 181] : [31, 104, 70];
        const pixels = context.getImageData(568, 86, 440, 36).data;
        let top = Infinity;
        let bottom = -Infinity;
        for (let index = 0; index < pixels.length; index += 4) {
          if (color.every((channel, offset) => pixels[index + offset] === channel)) {
            const y = Math.floor(index / 4 / 440);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
        return (top + bottom) / 2;
      }, theme === 'Dark');
      expect(
        Math.abs(center - 17.5),
        `${language} ${theme}: text center ${center}`,
      ).toBeLessThanOrEqual(0.5);
    }
    await dialog.getByRole('button', { name: /^(Close dialog|Закрыть диалог)$/ }).click();
  }
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
    const placeholderBox = await dialog.locator('.route-card-placeholder').boundingBox();
    expect(placeholderBox).not.toBeNull();
    await dialog.getByRole('button', { name: 'Create preview', exact: true }).click();
    const image = dialog.getByRole('img', { name: 'Generated route image' });
    await expect(image).toBeVisible();
    const readyBox = await image.boundingBox();
    expect(readyBox).not.toBeNull();
    expect(Math.abs(readyBox!.width - placeholderBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(readyBox!.height - placeholderBox!.height)).toBeLessThanOrEqual(1);
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => [
          element.naturalWidth,
          element.naturalHeight,
        ]),
      )
      .toEqual([1080, format === 'Post' ? 1350 : 1920]);
    const iconPixels = await image.evaluate((element: HTMLImageElement, dark: boolean) => {
      const canvas = document.createElement('canvas');
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(element, 0, 0);
      const pixels = context.getImageData(72, 76, 56, 56).data;
      const roadColor = dark ? [23, 59, 48] : [250, 247, 242];
      const dotColor = dark ? [82, 116, 93] : [189, 211, 165];
      let road = 0,
        dot = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          pixels[index] === roadColor[0] &&
          pixels[index + 1] === roadColor[1] &&
          pixels[index + 2] === roadColor[2]
        )
          road++;
        if (
          pixels[index] === dotColor[0] &&
          pixels[index + 1] === dotColor[1] &&
          pixels[index + 2] === dotColor[2]
        )
          dot++;
      }
      const tile = context.getImageData(84, 84, 1, 1).data;
      const background = context.getImageData(64, 84, 1, 1).data;
      const tileContrast =
        Math.abs(tile[0] - background[0]) +
        Math.abs(tile[1] - background[1]) +
        Math.abs(tile[2] - background[2]);
      const dividerY = canvas.height - 72 - 200 + 36 + 52;
      const divider = context.getImageData(540, dividerY, 1, 1).data;
      const beside = context.getImageData(530, dividerY, 1, 1).data;
      const dividerContrast =
        Math.abs(divider[0] - beside[0]) +
        Math.abs(divider[1] - beside[1]) +
        Math.abs(divider[2] - beside[2]);
      const metricCenters: { cell: number; kind: string; center: number; pixels: number }[] = [];
      const panelY = canvas.height - 72 - 200;
      for (const cell of [0, 1]) {
        const cellX = 72 + cell * 468;
        for (const band of [
          {
            kind: 'label',
            y: panelY + 36,
            height: 128,
            color: dark ? [173, 197, 182] : [89, 114, 100],
          },
          {
            kind: 'value',
            y: panelY + 36,
            height: 128,
            color: dark ? [244, 247, 239] : [24, 60, 44],
          },
        ]) {
          const data = context.getImageData(cellX, band.y, 468, band.height).data;
          let left = Infinity,
            right = -Infinity,
            count = 0;
          for (let index = 0; index < data.length; index += 4) {
            if (
              data[index] === band.color[0] &&
              data[index + 1] === band.color[1] &&
              data[index + 2] === band.color[2]
            ) {
              const x = (index / 4) % 468;
              left = Math.min(left, x);
              right = Math.max(right, x);
              count++;
            }
          }
          metricCenters.push({
            cell,
            kind: band.kind,
            center: cellX + (left + right) / 2,
            pixels: count,
          });
        }
      }
      canvas.width = 0;
      canvas.height = 0;
      return { road, dot, dividerContrast, tileContrast, metricCenters };
    }, format === 'Story');
    expect(iconPixels.road).toBeGreaterThan(150);
    expect(iconPixels.dot).toBeGreaterThan(30);
    expect(iconPixels.tileContrast).toBeGreaterThan(100);
    expect(iconPixels.dividerContrast).toBeGreaterThan(8);
    for (const metric of iconPixels.metricCenters) {
      expect(metric.pixels, metric.kind).toBeGreaterThan(20);
      expect(Math.abs(metric.center - (306 + metric.cell * 468)), metric.kind).toBeLessThanOrEqual(
        5,
      );
    }
    await expect
      .poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`route-card-${format.toLowerCase()}.png`) });
    await image.scrollIntoViewIfNeeded();
    const imageBox = (await image.boundingBox())!;
    const bodyBox = (await dialog.locator('.dialog-body').boundingBox())!;
    const footerBox = (await dialog.locator('.dialog-footer').boundingBox())!;
    expect(imageBox.y).toBeGreaterThanOrEqual(bodyBox.y - 1);
    expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(footerBox.y + 1);
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

test('social export layout and shared scrollbars work in both languages and themes', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 320, height: 800 }
      : { width: 1440, height: 1000 },
  );
  const plannerScrollbar = () =>
    page.locator('.planner-scroll').evaluate((element) => ({
      width: getComputedStyle(element).scrollbarWidth,
      color: getComputedStyle(element).scrollbarColor,
    }));
  for (const language of ['en', 'ru']) {
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page
      .getByRole('menuitemradio', { name: language === 'ru' ? 'Русский' : 'English' })
      .click();
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
      const menuScrollbar = await page.locator('.header-menu-panel').evaluate((element) => ({
        width: getComputedStyle(element).scrollbarWidth,
        color: getComputedStyle(element).scrollbarColor,
      }));
      expect(menuScrollbar).toEqual(await plannerScrollbar());
      await page
        .locator('.header-menu-theme-option')
        .nth(theme === 'dark' ? 1 : 0)
        .click();
      await page.getByRole('button', { name: /^(Export|Экспорт)$/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('radio', { name: /^(For social media|Для соцсетей)$/ }).click();
      const body = dialog.locator('.dialog-body');
      await expect(body.locator('.route-card-actions')).toHaveCount(0);
      await expect(dialog.locator('.dialog-footer .route-card-actions')).toBeVisible();
      await expect(dialog).toHaveClass(/wide/);
      await expect(dialog).toHaveCSS('opacity', '1');
      await expect(dialog).toHaveCSS('scale', '1');
      await expect(dialog).toHaveCSS(
        'padding-left',
        testInfo.project.name === 'mobile' ? '0px' : '28px',
      );
      await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);
      await expect(dialog.getByRole('img')).toHaveCount(0);
      const { settings, stage, footerInset, scrollGap, captionGap, captionInset } =
        await dialog.evaluate((element) => {
          const settingsBox = element
            .querySelector('.route-card-settings')!
            .getBoundingClientRect();
          const stageBox = element.querySelector('.route-card-stage')!.getBoundingClientRect();
          return {
            settings: {
              x: settingsBox.x,
              y: settingsBox.y,
              width: settingsBox.width,
              height: settingsBox.height,
            },
            stage: { x: stageBox.x, y: stageBox.y },
            captionGap:
              stageBox.bottom -
              element.querySelector('.route-card-background-note')!.getBoundingClientRect().bottom,
            captionInset:
              parseFloat(
                getComputedStyle(element.querySelector('.route-card-stage')!).paddingBottom,
              ) +
              parseFloat(
                getComputedStyle(element.querySelector('.route-card-stage')!).borderBottomWidth,
              ),
            footerInset: (() => {
              const footer = element.querySelector('.dialog-footer')!.getBoundingClientRect();
              const dialog = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                left: footer.left - dialog.left - parseFloat(style.borderLeftWidth),
                right: dialog.right - footer.right - parseFloat(style.borderRightWidth),
              };
            })(),
            scrollGap: (() => {
              const body = element.querySelector<HTMLElement>('.dialog-body')!;
              const box = body.getBoundingClientRect();
              const scrollbarWidth = body.offsetWidth - body.clientWidth;
              return box.right - scrollbarWidth - Math.max(settingsBox.right, stageBox.right);
            })(),
          };
        });
      expect(footerInset.left).toBeCloseTo(0, 0);
      expect(footerInset.right).toBeCloseTo(0, 0);
      expect(scrollGap).toBeGreaterThanOrEqual(16);
      expect(captionGap).toBeCloseTo(captionInset, 0);
      if (testInfo.project.name === 'desktop') {
        expect(stage.x).toBeGreaterThan(settings.x + settings.width);
        expect(stage.y).toBeCloseTo(settings.y, 0);
      } else expect(stage.y).toBeGreaterThanOrEqual(settings.y + settings.height);
      await expect(
        dialog.getByRole('button', { name: /^(Create preview|Создать предпросмотр)$/ }),
      ).toBeInViewport();
      const bodyScrollbar = await body.evaluate((element) => ({
        width: getComputedStyle(element).scrollbarWidth,
        color: getComputedStyle(element).scrollbarColor,
      }));
      expect(bodyScrollbar).toEqual(await plannerScrollbar());
      expect(bodyScrollbar.width).toBe('thin');
      expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`export-top-${language}-${theme}.png`) });
      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(
        dialog.getByRole('button', { name: /^(Close dialog|Закрыть диалог)$/ }),
      ).toBeInViewport();
      await expect(dialog.getByRole('radio', { name: 'GPX', exact: true })).toBeInViewport();
      await expect(
        dialog.getByRole('button', { name: /^(Create preview|Создать предпросмотр)$/ }),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath(`export-bottom-${language}-${theme}.png`),
      });
      await dialog.press('Escape');
      await expect(page.getByRole('button', { name: /^(Export|Экспорт)$/ })).toBeFocused();
    }
  }
  await page.emulateMedia({ forcedColors: 'active' });
  expect((await plannerScrollbar()).color).toBe('auto');
});
