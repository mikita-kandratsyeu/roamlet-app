import { test, expect, type Locator, type Page } from '@playwright/test';

test.use({ hasTouch: true });

const routeFixture = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { summary: { distance: 640, duration: 240 } },
      geometry: {
        type: 'LineString',
        coordinates: [
          [11.4041, 47.2692, 600],
          [11.411, 47.271, 610],
        ],
      },
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4174') return route.abort();
    if (url.pathname === '/__fixtures__/map-style.json') {
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#e8efe7' } },
          ],
        },
      });
    }
    if (url.pathname === '/api/route') return route.fulfill({ json: routeFixture });
    return route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
});

async function expandPlanner(page: Page) {
  const toggle = page.locator('.mobile-sheet-toggle');
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

async function touchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function alignedSheetHeader(page: Page) {
  const layout = await page.locator('.mobile-sheet-header').evaluate((element) => {
    const header = element.getBoundingClientRect();
    const text = element.querySelector('.sheet-identity')!.getBoundingClientRect();
    const collapse = element.querySelector('.mobile-sheet-collapse-icon')!.getBoundingClientRect();
    const resize = element.querySelector('.mobile-sheet-resize')!.getBoundingClientRect();
    const toggleStyle = getComputedStyle(element.querySelector('.mobile-sheet-toggle')!);
    const border = parseFloat(getComputedStyle(element).borderBottomWidth);
    return {
      topSpace: text.top - header.top,
      bottomSpace: header.bottom - border - text.bottom,
      textCenter: text.top + text.height / 2,
      collapseCenter: collapse.top + collapse.height / 2,
      resizeCenter: resize.top + resize.height / 2,
      collapseWidth: collapse.width,
      collapseHeight: collapse.height,
      resizeWidth: resize.width,
      resizeHeight: resize.height,
      paddingTop: toggleStyle.paddingTop,
      paddingBottom: toggleStyle.paddingBottom,
    };
  });
  expect(layout.topSpace).toBeCloseTo(layout.bottomSpace, 1);
  expect(layout.textCenter).toBeCloseTo(layout.collapseCenter, 1);
  expect(layout.collapseCenter).toBeCloseTo(layout.resizeCenter, 1);
  expect(layout.paddingTop).toBe(layout.paddingBottom);
  expect(layout.collapseWidth).toBe(44);
  expect(layout.collapseHeight).toBe(44);
  expect(layout.resizeWidth).toBe(44);
  expect(layout.resizeHeight).toBe(44);
}

async function reachable(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport();
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit !== null && (element === hit || element.contains(hit));
      }),
    )
    .toBe(true);
}

async function addStops(page: Page) {
  for (const coordinates of ['47.2692, 11.4041', '47.271, 11.411']) {
    const latitude = page.getByRole('textbox', { name: 'Latitude', exact: true });
    await latitude.fill(coordinates);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await expect(page.locator('[data-stop-id]')).toHaveCount(2);
}

test('ready-route footer keeps Russian save text and secondary icon actions on one row', async ({
  page,
}, testInfo) => {
  await addStops(page);
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  const notification = page.locator('[data-sonner-toast][data-type="success"]');
  await expect(notification).toBeVisible();
  await notification.locator('[data-close-button]').click();
  await expect(notification).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.setItem('roamlet-language', 'ru');
    window.dispatchEvent(new Event('roamlet-preferences-change'));
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      localStorage.setItem('roamlet-theme', theme);
      window.dispatchEvent(new Event('roamlet-preferences-change'));
    }, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expandPlanner(page);
      const footer = page.locator('.planner-footer');
      const save = footer.getByRole('button', { name: 'Сохранить маршрут', exact: true });
      const exportButton = footer.getByRole('button', { name: 'Экспорт', exact: true });
      const importButton = footer.getByRole('button', { name: 'Импорт GPX', exact: true });
      for (const button of [save, exportButton, importButton]) {
        await expect(button).toBeVisible();
        await expect(button).toBeEnabled();
        await touchTarget(button);
      }
      const boxes = await footer.locator('.route-actions > button').evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return { y: box.y, height: box.height };
        }),
      );
      expect(boxes).toEqual(Array.from({ length: 3 }, () => ({ y: boxes[0].y, height: 44 })));
      const fullLabel = await save
        .locator('.route-action-label')
        .evaluate((element) => element.scrollWidth <= element.clientWidth);
      expect(fullLabel).toBe(true);
      await exportButton.focus();
      await expect(exportButton).toBeFocused();
      await expect(exportButton).toHaveAttribute('title', 'Экспорт');
      await importButton.focus();
      await expect(importButton).toBeFocused();
      await expect(importButton).toHaveAttribute('title', 'Импорт GPX');
      expect(await footer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await footer.screenshot({
        path: testInfo.outputPath(`footer-ready-ru-${theme}-${width}.png`),
        animations: 'disabled',
      });
    }
  }
});

test('footer divider spans the same width as the header while preserving action insets', async ({
  page,
}, testInfo) => {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      localStorage.setItem('roamlet-theme', theme);
      window.dispatchEvent(new Event('roamlet-preferences-change'));
    }, theme);
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 844, height: 800 },
      { width: 390, height: 844 },
      { width: 320, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      await expandPlanner(page);
      const footer = page.locator('.planner-footer');
      const header = page.locator(
        viewport.width > 700 ? '.planner-heading' : '.mobile-sheet-header',
      );
      await expect(footer).toBeVisible();
      const headerBox = (await header.boundingBox())!;
      const footerBox = (await footer.boundingBox())!;
      const actionsBox = (await footer.locator('.route-actions').boundingBox())!;
      await expect(footer.locator('.route-actions > button')).toHaveCount(3);
      for (const button of await footer.locator('.route-actions > button').all()) {
        const box = (await button.boundingBox())!;
        expect(box.y).toBeCloseTo(actionsBox.y, 1);
        expect(box.height).toBe(44);
        await touchTarget(button);
      }
      for (const label of ['Export', 'Import GPX']) {
        const button = footer.getByRole('button', { name: label, exact: true });
        await expect(button).toHaveAttribute('title', label);
        expect((await button.boundingBox())!.width).toBe(44);
        expect(await button.innerText()).toBe('');
      }
      expect(footerBox.x).toBeCloseTo(headerBox.x, 1);
      expect(footerBox.x + footerBox.width).toBeCloseTo(headerBox.x + headerBox.width, 1);
      expect(actionsBox.x - footerBox.x).toBe(16);
      expect(footerBox.x + footerBox.width - actionsBox.x - actionsBox.width).toBe(16);
      await expect(footer).toHaveCSS('border-top-width', '1px');
      await expect(header).toHaveCSS('border-bottom-width', '1px');
      await expect
        .poll(
          async () =>
            (await footer.evaluate((element) => getComputedStyle(element).borderTopColor)) ===
            (await header.evaluate((element) => getComputedStyle(element).borderBottomColor)),
        )
        .toBe(true);
      await footer.screenshot({
        path: testInfo.outputPath(`footer-${theme}-${viewport.width}.png`),
        animations: 'disabled',
      });
    }
  }
});

test('compact Russian sheet fits narrow screens in both themes and retains long route names', async ({
  page,
}, testInfo) => {
  await page.evaluate(() => {
    localStorage.setItem('roamlet-language', 'ru');
    window.dispatchEvent(new Event('roamlet-preferences-change'));
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      localStorage.setItem('roamlet-theme', theme);
      window.dispatchEvent(new Event('roamlet-preferences-change'));
    }, theme);
    for (const width of [320, 390, 667]) {
      await page.setViewportSize({ width, height: 740 });
      const toggle = page.locator('.mobile-sheet-toggle');
      if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
      await expect(toggle).toHaveAccessibleDescription(
        'Новый маршрут Начните с двух точек на карте',
      );
      await touchTarget(toggle);
      await touchTarget(page.getByRole('button', { name: 'Развернуть планнер', exact: true }));
      await alignedSheetHeader(page);
      const panel = page.locator('#route-planner');
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      const grip = await page.locator('.mobile-sheet-header').evaluate((element) => {
        const style = getComputedStyle(element, '::before');
        return parseFloat(style.left) + parseFloat(style.width) / 2;
      });
      expect(grip).toBeCloseTo(width / 2, 0);
      await page.screenshot({
        path: testInfo.outputPath(`compact-${theme}-${width}.png`),
        animations: 'disabled',
      });
      expect(
        await panel.evaluate(
          (element) =>
            element.clientHeight -
            element.querySelector<HTMLElement>('.mobile-sheet-header')!.offsetHeight,
        ),
      ).toBe(0);
    }
  }
  const name = 'Очень длинное название маршрута для поездки выходного дня через горы и долины';
  await page.getByLabel('Импорт файла GPX').setInputFiles({
    name: 'long-title.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      `<gpx version="1.1"><trk><name>${name}</name><trkseg><trkpt lat="47" lon="11"/><trkpt lat="47.01" lon="11.01"/></trkseg></trk></gpx>`,
    ),
  });
  await page.setViewportSize({ width: 320, height: 740 });
  const toggle = page.locator('.mobile-sheet-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
  await expect(toggle.locator('strong')).toHaveText(name);
  await expect(toggle.locator('strong')).toHaveCSS('text-overflow', 'ellipsis');
  expect(await toggle.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('a vertical touch swipe opens the compact sheet without a second click', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const toggle = page.locator('.mobile-sheet-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect
    .poll(async () => {
      const panel = (await page.locator('#route-planner').boundingBox())!;
      const header = (await page.locator('.mobile-sheet-header').boundingBox())!;
      return panel.height - header.height;
    })
    .toBeCloseTo(1, 1);
  const box = (await toggle.boundingBox())!;
  const client = await page.context().newCDPSession(page);
  try {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - 60 }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('#route-planner')).toHaveAttribute('data-sheet-state', 'planning');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  } finally {
    await client.detach();
  }
});

test('map canvas stays mounted and matches its container through planner and viewport resizing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const canvas = page.locator('.maplibregl-canvas');
  const mapContainer = page.locator('.maplibregl-map');
  await expect(canvas).toHaveCount(1);
  const identity = await mapContainer.evaluate((element) => {
    element.dataset.resizeRegressionId = 'persistent-map-instance';
    return element.dataset.resizeRegressionId;
  });
  async function mapRemainsMounted() {
    await expect(mapContainer).toBeVisible();
    expect(await mapContainer.getAttribute('data-resize-regression-id')).toBe(identity);
    expect(await canvas.count()).toBe(1);
  }
  const toggle = page.locator('.mobile-sheet-toggle');
  await toggle.click();
  await expect(page.locator('#route-planner')).toHaveAttribute('data-sheet-state', 'compact');
  await expect.poll(mapRemainsMounted).toBeUndefined();
  await toggle.click();
  await expect(page.locator('#route-planner')).toHaveAttribute('data-sheet-state', 'planning');
  await expect.poll(mapRemainsMounted).toBeUndefined();
  await page.getByRole('button', { name: 'Expand planner view' }).click();
  await expect(page.locator('#route-planner')).toHaveAttribute('data-sheet-state', 'expanded');
  await expect.poll(mapRemainsMounted).toBeUndefined();
  await page.setViewportSize({ width: 430, height: 932 });
  await expect.poll(mapRemainsMounted).toBeUndefined();
  await page.setViewportSize({ width: 320, height: 740 });
  await expect.poll(mapRemainsMounted).toBeUndefined();
  await expect(mapContainer).toBeVisible();
  await expect(canvas).toHaveCount(1);
});

test('mobile sheet balances map space, expands for editing and keeps statistics on demand', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.locator('#route-planner');
  const toggle = page.locator('.mobile-sheet-toggle');
  const resize = page.getByRole('button', { name: 'Expand planner view', exact: true });
  await expect(panel).toHaveAttribute('data-sheet-state', 'planning');
  await touchTarget(resize);
  const initialMap = (await page.locator('.map-region').boundingBox())!;
  await toggle.click();
  await expect(panel).toHaveAttribute('data-sheet-state', 'compact');
  await expect(page.locator('.planner-footer')).not.toBeVisible();
  await expect(page.locator('.planner-scroll')).not.toBeVisible();
  await expect
    .poll(async () => (await page.locator('.map-region').boundingBox())!.height)
    .toBeGreaterThan(initialMap.height);
  await page.screenshot({ path: testInfo.outputPath('compact-planner.png') });
  await toggle.press('Enter');
  await expect(panel).toHaveAttribute('data-sheet-state', 'planning');
  await resize.press('Enter');
  await expect(panel).toHaveAttribute('data-sheet-state', 'expanded');
  await expect
    .poll(async () => (await page.locator('.map-region').boundingBox())!.height)
    .toBeCloseTo(140, 0);
  await page.getByRole('button', { name: 'Restore planner view' }).click();
  await expect(panel).toHaveAttribute('data-sheet-state', 'planning');
  const latitude = page.getByRole('textbox', { name: 'Latitude', exact: true });
  await latitude.focus();
  await expect(panel).toHaveAttribute('data-sheet-state', 'expanded');
  await reachable(latitude);
  await addStops(page);
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  const statistics = page.getByRole('region', { name: 'Route statistics', exact: true });
  await expect(statistics.getByText('Total time with stops', { exact: true })).toBeVisible();
  await expect(statistics.getByText('Provider estimate', { exact: true })).not.toBeVisible();
  await expect(statistics.getByText('Personal moving time', { exact: true })).not.toBeVisible();
  await statistics.locator('.statistics-details > summary').press('Enter');
  await expect(statistics.getByText('Provider estimate', { exact: true })).toBeVisible();
  await expect(statistics.getByText('Personal moving time', { exact: true })).toBeVisible();
  await toggle.click();
  await expect(toggle.locator('small')).toContainText('0.6 km');
  await toggle.click();
  await expect(page.locator('[data-stop-id]')).toHaveCount(2);
  await expect(statistics.locator('.statistics-details')).toHaveAttribute('open');
});

for (const viewport of [
  { width: 320, height: 360 },
  { width: 667, height: 375 },
]) {
  test(`short ${viewport.width}×${viewport.height} planner keeps inputs, footer and map reachable`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await expandPlanner(page);
    await alignedSheetHeader(page);
    const scroll = page.locator('.planner-scroll');
    await expect
      .poll(() => scroll.evaluate((element) => element.clientHeight))
      .toBeGreaterThanOrEqual(44);
    expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    expect(await scroll.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await expect(scroll).toHaveCSS('overscroll-behavior-y', 'contain');
    await expect(scroll).not.toHaveCSS('touch-action', 'none');
    const latitude = page.getByRole('textbox', { name: 'Latitude', exact: true });
    await latitude.focus();
    await reachable(latitude);
    await expect(latitude).toBeFocused();
    await expect(latitude).toHaveCSS('font-size', '16px');
    await latitude.fill('47.2692, 11.4041');
    const add = page.getByRole('button', { name: 'Add coordinates', exact: true });
    await reachable(add);
    await touchTarget(add);
    await add.click();
    await expect(page.locator('[data-stop-id]')).toHaveCount(1);
    const importer = page
      .locator('.planner-footer')
      .getByRole('button', { name: 'Import GPX', exact: true });
    await reachable(importer);
    await touchTarget(importer);
    const toggle = page.locator('.mobile-sheet-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const mapTools = page.getByRole('button', { name: 'More map tools', exact: true });
    await reachable(mapTools);
    await mapTools.click();
    const tools = page.getByRole('dialog', { name: 'Map controls', exact: true });
    await expect(tools).toBeInViewport();
    await tools.getByRole('button', { name: 'Close map tools' }).click();
    await expect(mapTools).toBeFocused();
    await toggle.click();
    await expect(page.locator('[data-stop-id]')).toHaveCount(1);
  });
}

for (const width of [320, 844]) {
  test(`hidden drag handles retain touch-sized alternative reorder actions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await expandPlanner(page);
    await addStops(page);
    const stops = page.locator('[data-stop-id]');
    const initialOrder = await stops.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-stop-id')),
    );
    for (const stop of await stops.all()) {
      await expect(stop.locator('.stop-grip')).toHaveCount(0);
      const name = stop.locator('.stop-name');
      await expect(name).not.toHaveCSS('touch-action', 'none');
      const nameBox = (await name.boundingBox())!;
      const cardBox = (await stop.locator('.waypoint-card').boundingBox())!;
      expect(nameBox.width).toBeGreaterThan(cardBox.width / 2);
      for (const control of await stop.locator('.stop-controls button').all())
        await touchTarget(control);
      expect(await stop.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
    await expect(page.getByRole('button', { name: 'Move stop 1 up', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Move stop 2 down', exact: true }),
    ).toBeDisabled();
    const down = page.getByRole('button', { name: 'Move stop 1 down', exact: true });
    await reachable(down);
    await down.click();
    await expect(stops.first()).toHaveAttribute('data-stop-id', initialOrder[1]!);
    const up = page.getByRole('button', { name: 'Move stop 2 up', exact: true });
    await page.keyboard.press('Tab');
    await up.focus();
    await reachable(up);
    await expect(up).toBeFocused();
    expect(await up.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
    await expect(up).not.toHaveCSS('outline-style', 'none');
    expect(
      await up.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth)),
    ).toBeGreaterThanOrEqual(2);
    await up.press('Enter');
    await expect(stops.first()).toHaveAttribute('data-stop-id', initialOrder[0]!);
  });
}

test('stop content fills the card without reserving space for drag grips', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await addStops(page);
  const stops = page.locator('[data-stop-id]');
  await expect(stops.locator('.stop-grip')).toHaveCount(0);
  for (const card of await stops.locator('.waypoint-card').all()) {
    const bounds = (await card.boundingBox())!;
    const badge = (await card.locator('.stop-badge').boundingBox())!;
    const name = (await card.locator('.stop-name').boundingBox())!;
    expect(badge.x - bounds.x).toBeCloseTo(9, 1);
    expect(name.x - (badge.x + badge.width)).toBeCloseTo(12, 1);
    await expect(card.locator('.stop-name')).toHaveCSS('flex-grow', '1');
  }
});

for (const viewport of [
  { width: 320, height: 360 },
  { width: 844, height: 390 },
]) {
  test(`save dialog fields and actions scroll accessibly at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await expandPlanner(page);
    await addStops(page);
    const save = page.getByRole('button', { name: 'Save route', exact: true });
    await expect(save).toBeEnabled();
    await reachable(save);
    await save.click();
    const dialog = page.getByRole('dialog', { name: 'Save route', exact: true });
    await expect(dialog).toBeInViewport();
    const name = dialog.getByRole('textbox', { name: 'Route name', exact: true });
    await expect(name).toBeFocused();
    await reachable(name);
    await expect(name).toHaveCSS('font-size', '16px');
    await name.fill('Short viewport route');
    const description = dialog.getByRole('textbox', { name: /^Description/ });
    await description.focus();
    await reachable(description);
    await description.fill('Editable without hiding the actions.');
    await expect(description).toHaveCSS('font-size', '16px');
    await expect(description).toHaveCSS('outline-width', '2px');
    const submit = dialog.getByRole('button', { name: 'Save to library', exact: true });
    await reachable(submit);
    await touchTarget(submit);
    await expect(submit).toBeEnabled();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    await reachable(cancel);
    await touchTarget(cancel);
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(save).toBeFocused();
  });
}
