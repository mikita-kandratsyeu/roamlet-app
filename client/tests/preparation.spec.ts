import { test, expect, type Page } from '@playwright/test';

async function addPoint(page: Page, coordinate: string) {
  const [latitude, longitude] = coordinate.split(',').map((part) => part.trim());
  await page.getByRole('textbox', { name: 'Latitude', exact: true }).fill(latitude);
  await page.getByRole('textbox', { name: 'Longitude', exact: true }).fill(longitude);
  await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
}
async function checkStopActions(page: Page) {
  const actions = page.locator('.waypoint-tools');
  const buttons = actions.locator(':scope > button');
  for (const button of await buttons.all()) {
    await button.scrollIntoViewIfNeeded();
    if (await button.evaluate((element) => element.classList.contains('add-stop'))) {
      await expect(button).toHaveAttribute('data-variant', 'outline');
      await expect(button.locator('span')).toBeVisible();
    } else {
      await expect(button).toHaveAttribute('data-variant', 'outline');
      await expect(button.locator('span')).toHaveCount(0);
      const label = await button.getAttribute('aria-label');
      expect(label).toBeTruthy();
      await expect(button).toHaveAttribute('title', label!);
    }
  }
  const layout = await actions.evaluate((group) => {
    const bounds = group.getBoundingClientRect();
    return Array.from(group.querySelectorAll<HTMLButtonElement>(':scope > button')).map(
      (button) => {
        const box = button.getBoundingClientRect();
        return {
          kind: button.classList.contains('add-stop')
            ? 'add'
            : button.classList.contains('reverse-stops')
              ? 'reverse'
              : 'clear',
          width: box.width,
          height: box.height,
          top: box.top,
          bottom: box.bottom,
          left: box.left - bounds.left,
          right: bounds.right - box.right,
          groupWidth: bounds.width,
          overflow: button.scrollWidth > button.clientWidth,
        };
      },
    );
  });
  for (const button of layout) {
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.left).toBeGreaterThanOrEqual(-1);
    expect(button.right).toBeGreaterThanOrEqual(-1);
    expect(button.overflow).toBe(false);
  }
  const add = layout.find((button) => button.kind === 'add');
  const reverse = layout.find((button) => button.kind === 'reverse');
  const clear = layout.find((button) => button.kind === 'clear');
  for (const button of layout) {
    expect(button.height).toBe(44);
    expect(button.top).toBeCloseTo(layout[0].top, 1);
  }
  if (reverse) expect(reverse.width).toBe(44);
  if (clear) expect(clear.width).toBe(44);
  if (add) {
    const icons = Number(Boolean(reverse)) + Number(Boolean(clear));
    expect(add.width).toBeCloseTo(add.groupWidth - icons * (44 + 8), 1);
  }
}

async function save(page: Page, name: string) {
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
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
            attribution: 'Test map attribution',
          },
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#e8efe7' } },
          { id: 'fixture', type: 'circle', source: 'fixture' },
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
            properties: { summary: { distance: 1344, duration: 600 } },
            geometry: {
              type: 'LineString',
              coordinates: route
                .request()
                .postDataJSON()
                .coordinates.map((coordinate: number[], index: number) => [
                  ...coordinate,
                  100 + index * 50,
                ]),
            },
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await addPoint(page, '47.26, 11.4');
  await addPoint(page, '47.27, 11.41');
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
});

test('schedule edits persist and do not reroute; arrivals cross midnight', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/route') requests += 1;
  });
  await page.locator('.planner-details > summary').filter({ hasText: 'Route schedule' }).click();
  const schedule = page.getByRole('region', { name: 'Route schedule', exact: true });
  const departure = schedule.getByLabel('Local departure date and time', { exact: true });
  await departure.fill('2026-10-29T23:59');
  await departure.press('Enter');
  const pause = schedule.getByLabel(/^Pause \(minutes\):/).first();
  await pause.fill('10');
  await pause.press('Tab');
  await expect(schedule.getByRole('listitem').first().locator('time').nth(1)).toHaveAttribute(
    'datetime',
    '2026-10-30T00:09',
  );
  await expect(schedule.locator('.route-schedule-finish time')).toHaveAttribute(
    'datetime',
    /^2026-10-30T/,
  );
  await save(page, 'Night ride');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes', exact: true }).click();
  await page.getByRole('button', { name: /^Night ride Cycling/ }).click();
  await expect(page.locator('.library-screen')).toHaveCount(0);
  await expect(page.locator('.planner-heading h1')).toHaveText('Night ride');
  const scheduleDetails = page.locator('.planner-details').filter({ hasText: 'Route schedule' });
  if ((await scheduleDetails.getAttribute('open')) === null) await scheduleDetails.locator('summary').first().click();
  await expect(scheduleDetails).toHaveAttribute('open');
  await expect(departure).toHaveValue('2026-10-29T23:59');
  await expect(pause).toHaveValue('10');
  await page.waitForTimeout(500);
  expect(requests).toBe(0);
});

test('schedule pause errors stay below editable inputs in English and Russian', async ({ page }) => {
  await page.locator('.planner-details > summary').filter({ hasText: 'Route schedule' }).click();
  for (const language of ['en', 'ru']) {
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page.getByRole('menuitemradio', {
      name: language === 'ru' ? 'Русский' : 'English', exact: true,
    }).click();
    const schedule = page.locator('.route-schedule');
    const pauses = schedule.locator('.route-schedule-pause input');
    for (const width of [230, 320]) {
      await schedule.evaluate((element, value) => { element.style.width = `${value}px`; }, width);
      for (let index = 0; index < 2; index++) {
        await pauses.nth(index).fill(index === 0 ? '-1' : '10081');
        await pauses.nth(index).press('Enter');
        await expect(pauses.nth(index)).toHaveAttribute('aria-invalid', 'true');
      }
      const fields = schedule.locator('.route-schedule-pause');
      for (let index = 0; index < 2; index++) {
        const field = fields.nth(index);
        await expect(field.getByRole('alert')).toBeVisible();
        const layout = await field.evaluate((element) => {
          const label = element.querySelector('label')!.getBoundingClientRect();
          const input = element.querySelector('input')!.getBoundingClientRect();
          const error = element.querySelector('[role="alert"]')!.getBoundingClientRect();
          const bounds = element.getBoundingClientRect();
          return {
            inputHeight: input.height,
            labelGap: input.top - label.bottom,
            errorGap: error.top - input.bottom,
            bottomGap: bounds.bottom - error.bottom,
            horizontalOverflow: element.scrollWidth > element.clientWidth,
          };
        });
        expect(layout.inputHeight).toBeGreaterThanOrEqual(44);
        expect(layout.labelGap).toBeGreaterThanOrEqual(6);
        expect(layout.errorGap).toBeGreaterThanOrEqual(6);
        expect(layout.bottomGap).toBeGreaterThanOrEqual(0);
        expect(layout.horizontalOverflow).toBe(false);
        await pauses.nth(index).fill('5');
        await pauses.nth(index).press('Enter');
        await expect(field.getByRole('alert')).toHaveCount(0);
        await expect(pauses.nth(index)).toHaveValue('5');
      }
    }
  }
});

test('comparison preserves editor and closes back to the selected library routes', async ({
  page,
}, testInfo) => {
  const routeName = 'River · Riverside trail through the forest and mountain passes';
  await save(page, routeName);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes', exact: true }).click();
  await page.getByRole('button', { name: `Duplicate ${routeName}`, exact: true }).click();
  const checks = page.getByRole('checkbox', { name: /^Select .* for comparison$/ });
  await expect(checks).toHaveCount(2);
  await checks.nth(0).check();
  await checks.nth(1).check();
  const headerPadding = testInfo.project.name === 'mobile' ? '16px' : '24px';
  await expect(page.locator('.library-screen-header')).toHaveCSS('padding-left', headerPadding);
  await expect(page.locator('.library-screen-header')).toHaveCSS('padding-right', headerPadding);
  const libraryTitleStyle = await page.locator('.library-screen-heading h1').evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
  });
  const plannerStyle = await page.locator('#route-planner').evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.width, borderRadius: style.borderRadius, boxShadow: style.boxShadow, left: element.getBoundingClientRect().left };
  });
  const compare = page.getByRole('button', { name: 'Compare routes', exact: true });
  await compare.click();
  const dialog = page.getByRole('dialog', { name: 'Compare saved routes', exact: true });
  await expect(dialog).toHaveClass(/comparison-screen/);
  await expect(dialog.getByRole('button', { name: 'Back to routes', exact: true })).toBeFocused();
  const screenBounds = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(screenBounds.x).toBe(0);
  expect(screenBounds.y).toBe(0);
  expect(screenBounds.width).toBe(viewport.width);
  expect(screenBounds.height).toBe(viewport.height);
  const title = dialog.locator('.comparison-screen-header h1');
  await expect(title).toHaveCSS('font-size', libraryTitleStyle.fontSize);
  await expect(title).toHaveCSS('font-weight', libraryTitleStyle.fontWeight);
  await expect(title).toHaveCSS('line-height', libraryTitleStyle.lineHeight);
  expect((await title.boundingBox())!.x).toBeLessThan((await dialog.getByRole('button', { name: 'Back to routes', exact: true }).boundingBox())!.x);
  await expect(title).toHaveCSS('font-family', /Manrope/);
  if (testInfo.project.name === 'desktop') {
    const panel = dialog.locator('.comparison-screen-panel');
    await expect(panel).toHaveCSS('width', plannerStyle.width);
    await expect(panel).toHaveCSS('border-radius', plannerStyle.borderRadius);
    await expect(panel).toHaveCSS('box-shadow', plannerStyle.boxShadow);
    expect((await panel.boundingBox())!.x).toBe(plannerStyle.left);
  }
  await expect(dialog.getByRole('table', { name: 'Saved route comparison' })).toHaveCount(0);
  await dialog.locator('summary').filter({ hasText: 'Route statistics' }).click();
  await expect(dialog.getByRole('table', { name: 'Saved route comparison' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Fit route', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('group', { name: 'Map style', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Manual drawing', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'More map tools', exact: true }).click();
  const tools = page.getByRole('dialog', { name: 'Map controls', exact: true });
  await expect(tools).toBeVisible();
  await expect(tools.getByRole('button', { name: 'Manual drawing', exact: true })).toHaveCount(0);
  if (testInfo.project.name === 'mobile') await tools.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await tools.getByRole('button', { name: 'Close map tools', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.locator('.comparison-map').evaluate((element) => {
        const frame = element.getBoundingClientRect();
        const canvas = element.querySelector('.maplibregl-canvas')!.getBoundingClientRect();
        return Math.max(
          Math.abs(frame.bottom - canvas.bottom),
          Math.abs(frame.width - canvas.width),
        );
      }),
    )
    .toBeLessThanOrEqual(2);
  const map = dialog.locator('.maplibregl-canvas');
  const mapHandle = await map.elementHandle();
  const beforeCollapse = (await map.boundingBox())!;
  await dialog.getByRole('button', { name: 'Hide comparison panel', exact: true }).click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  if (testInfo.project.name === 'mobile') {
    await expect.poll(async () => {
      const box = (await map.boundingBox())!;
      return box.width * box.height;
    }).toBeGreaterThan(beforeCollapse.width * beforeCollapse.height);
  } else {
    const compactPanel = (await dialog.locator('.comparison-screen-panel').boundingBox())!;
    expect(compactPanel.width).toBe(44);
    expect(compactPanel.height).toBeLessThanOrEqual(100);
    expect((await map.boundingBox())!.width).toBe(viewport.width);
  }
  expect(await map.evaluate((element, original) => element === original, mapHandle)).toBe(true);
  await dialog.getByRole('button', { name: 'Show comparison panel', exact: true }).click();
  const visibility = dialog.getByRole('checkbox');
  await visibility.first().uncheck();
  await expect(visibility.last()).toBeDisabled();
  await dialog.getByRole('button', { name: /^Focus route / }).first().click();
  await expect(visibility.first()).toBeChecked();
  await dialog.getByRole('button', { name: 'Show all routes', exact: true }).click();
  await expect(visibility.last()).toBeEnabled();
  await expect(dialog.locator('.maplibregl-ctrl-attrib')).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.setViewportSize({ width: testInfo.project.name === 'mobile' ? 320 : 1920, height: 900 });
  for (const language of ['en', 'ru']) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(({ language, theme }) => {
        localStorage.setItem('roamlet-language', language);
        localStorage.setItem('roamlet-theme', theme);
        window.dispatchEvent(new Event('roamlet-preferences-change'));
      }, { language, theme });
      const workspace = page.locator('.comparison-screen');
      await expect(workspace.locator('.comparison-screen-header')).toHaveCSS('padding-left', headerPadding);
      await expect(workspace.locator('.comparison-screen-header')).toHaveCSS('padding-right', headerPadding);
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      else await expect(page.locator('html')).not.toHaveClass(/dark/);
      await expect.poll(() => workspace.evaluate((element) => {
        const screen = getComputedStyle(element);
        const route = getComputedStyle(element.querySelector('.comparison-screen-route strong')!);
        const panel = getComputedStyle(element.querySelector('.comparison-screen-panel')!);
        const header = getComputedStyle(element.querySelector('.comparison-screen-header')!);
        const scroll = getComputedStyle(element.querySelector('.comparison-screen-details')!);
        const plannerScroll = getComputedStyle(document.querySelector('.planner-scroll')!);
        return screen.color === route.color && header.backgroundColor === panel.backgroundColor &&
          scroll.scrollbarWidth === plannerScroll.scrollbarWidth && scroll.scrollbarColor === plannerScroll.scrollbarColor;
      })).toBe(true);
      await expect(workspace.getByRole('button', { name: language === 'en' ? 'Back to routes' : 'Назад к маршрутам', exact: true })).toBeVisible();
      for (const button of await workspace.locator('.comparison-screen-header button, .comparison-screen-panel-header button, .comparison-screen-panel-actions button, .comparison-screen-route, .comparison-screen-visibility').all()) {
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      }
      expect(await workspace.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
      const metricAlignment = await workspace.locator('.comparison-screen-card-metrics').first().evaluate((element) => {
        const values = Array.from(element.querySelectorAll('dd')).map((value) => value.getBoundingClientRect().top);
        return Math.abs(values[0] - values[1]);
      });
      expect(metricAlignment).toBeLessThanOrEqual(1);
      const attribution = (await workspace.locator('.maplibregl-ctrl-attrib').boundingBox())!;
      const panel = (await workspace.locator('.comparison-screen-panel').boundingBox())!;
      expect(attribution.y + attribution.height <= panel.y || attribution.y >= panel.y + panel.height || attribution.x + attribution.width <= panel.x || attribution.x >= panel.x + panel.width).toBe(true);
      if (testInfo.project.name === 'desktop') {
        await page.mouse.move(0, 0);
        const card = workspace.locator('.comparison-screen-card').first();
        const route = card.locator('.comparison-screen-route');
        const background = await card.evaluate((element) => getComputedStyle(element).backgroundColor);
        await route.hover();
        await expect(route).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect.poll(() => route.evaluate((element) => getComputedStyle(element).color === getComputedStyle(element.closest('.comparison-screen-card')!).color)).toBe(true);
        await expect.poll(() => card.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(background);
        await expect(card).toHaveAttribute('data-focused', 'false');
        await expect(card.getByRole('checkbox')).toBeChecked();
        if (language === 'ru') await page.screenshot({ path: testInfo.outputPath(`comparison-hover-${theme}.png`) });
        await card.getByRole('checkbox').hover();
        await expect.poll(() => card.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(background);
        await page.mouse.move(0, 0);
      }
      if (language === 'ru') await page.screenshot({ path: testInfo.outputPath(`comparison-${theme}.png`) });
    }
  }
  await page.evaluate(() => {
    localStorage.setItem('roamlet-language', 'en');
    window.dispatchEvent(new Event('roamlet-preferences-change'));
  });
  await dialog.getByRole('button', { name: 'Back to routes', exact: true }).click();
  await expect(compare).toBeFocused();
  await expect(page.locator('.library-screen-header')).toHaveCSS('padding-left', headerPadding);
  await expect(page.locator('.library-screen-header')).toHaveCSS('padding-right', headerPadding);
  await compare.click();
  await page.keyboard.press('Escape');
  await expect(compare).toBeFocused();
  await expect(checks.nth(0)).toBeChecked();
  await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
});

test('disclosure arrows align and mobile route actions have labels and 44px targets', async ({
  page,
}, testInfo) => {
  await page.locator('.planner-details > summary').filter({ hasText: 'Climb analysis' }).click();
  const climb = page.getByRole('region', { name: 'Climb analysis', exact: true });
  await climb.getByRole('button', { name: /^Climb 1/ }).click();
  await expect(climb.getByRole('button', { name: /^Climb 1/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('How time is estimated', { exact: true })).toBeVisible();
  await expect(page.getByText('How climbs are detected', { exact: true })).toBeVisible();
  expect(await page.locator('.time-explanation').getAttribute('open')).toBeNull();
  expect(await page.locator('.climb-analysis details').getAttribute('open')).toBeNull();
  const headerLayout = await climb.evaluate((section) => {
    const details = section.closest('.planner-details')!;
    const title = details.querySelector('summary h2')!.getBoundingClientRect();
    const thresholds = section.querySelector('.climb-analysis__thresholds')!.getBoundingClientRect();
    const settings = details.previousElementSibling!.getBoundingClientRect();
    return {
      gap: title.top - settings.bottom,
      thresholdGap: thresholds.top - title.bottom,
      alignment: Math.abs(title.left - thresholds.left),
    };
  });
  expect(headerLayout.gap).toBeGreaterThanOrEqual(12);
  expect(headerLayout.thresholdGap).toBeGreaterThanOrEqual(4);
  expect(headerLayout.alignment).toBeLessThanOrEqual(1);
  if (testInfo.project.name !== 'mobile') return;
  const positions = await page
    .locator('#route-planner .planner-disclosure > summary .disclosure-toggle')
    .evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => element.getBoundingClientRect().right));
  expect(positions.length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
  const actions = page.locator('.waypoint-tools');
  for (const name of ['Add a stop', 'Reverse', 'Clear stops']) {
    const button = actions.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  await expect(actions.locator('.reverse-stops span')).toHaveCount(0);
  await expect(actions.locator('.clear-stops span')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('stop actions fit one labelled outline action and named icons in both languages and themes', async ({ page }, testInfo) => {
  const notification = page.locator('[data-sonner-toast][data-type="success"]');
  await expect(notification).toBeVisible();
  await notification.locator('[data-close-button]').click();
  await expect(notification).toHaveCount(0);
  for (const language of ['en', 'ru']) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(({ language, theme }) => {
        localStorage.setItem('roamlet-language', language);
        localStorage.setItem('roamlet-theme', theme);
        window.dispatchEvent(new Event('roamlet-preferences-change'));
      }, { language, theme });
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await checkStopActions(page);
        const actions = page.locator('.waypoint-tools');
        await expect(actions.locator('button')).toHaveCount(3);
        await page.mouse.move(0, 0);
        await expect.poll(() => actions.evaluate((element) => {
          const add = getComputedStyle(element.querySelector('.add-stop')!);
          const reverse = getComputedStyle(element.querySelector('.reverse-stops')!);
          const calculate = getComputedStyle(document.querySelector('.calculate-action .primary')!);
          return add.backgroundColor === reverse.backgroundColor &&
            add.borderColor === reverse.borderColor &&
            add.backgroundColor !== calculate.backgroundColor;
        })).toBe(true);
        const add = actions.getByRole('button', { name: language === 'en' ? 'Add a stop' : 'Добавить точку', exact: true });
        await add.click();
        await expect(page.getByRole('textbox', { name: language === 'en' ? 'Latitude' : 'Широта', exact: true })).toBeFocused();
        for (const selector of ['.reverse-stops', '.clear-stops']) {
          const icon = actions.locator(selector);
          await icon.focus();
          await expect(icon).toBeFocused();
          expect(await icon.innerText()).toBe('');
        }
        await actions.screenshot({ path: testInfo.outputPath(`stop-actions-${language}-${theme}-${width}.png`), animations: 'disabled' });
      }
    }
  }
  await page.locator('.clear-stops').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-stop-id]')).toHaveCount(2);
});

test('stop actions keep one layout for empty, single, loop, manual and localized narrow planners', async ({
  page,
  context,
}) => {
  const actions = page.locator('.waypoint-tools');
  await checkStopActions(page);
  await actions.getByRole('button', { name: 'Clear stops', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear stops', exact: true }).click();
  await expect(actions.locator('button')).toHaveCount(1);
  await checkStopActions(page);
  await addPoint(page, '47.26, 11.4');
  await expect(actions.locator('button')).toHaveCount(2);
  await checkStopActions(page);
  await addPoint(page, '47.27, 11.41');
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  await checkStopActions(page);
  await page.getByRole('radio', { name: 'Round trip', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to round trip', exact: true }).click();
  await expect(actions.locator('button')).toHaveCount(1);
  await checkStopActions(page);
  await actions.getByRole('button', { name: 'Clear stops', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear stops', exact: true }).click();
  await expect(actions).toBeHidden();
  await page.getByRole('radio', { name: 'Point to point', exact: true }).click();
  await page.getByRole('button', { name: 'Draw a route manually', exact: true }).click();
  await addPoint(page, '47.26, 11.4');
  await addPoint(page, '47.27, 11.41');
  await checkStopActions(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await checkStopActions(page);
  }
});
