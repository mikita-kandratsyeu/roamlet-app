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
    await expect(button).toHaveAttribute('data-variant', 'outline');
    await expect(button.locator('span')).toBeVisible();
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
  if (add) expect(Math.abs(add.width - add.groupWidth)).toBeLessThanOrEqual(1);
  if (reverse && clear) {
    expect(Math.abs(reverse.width - clear.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(reverse.height - clear.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(reverse.top - clear.top)).toBeLessThanOrEqual(1);
    if (add) expect(reverse.top - add.bottom).toBeGreaterThanOrEqual(8);
  } else if (clear) expect(Math.abs(clear.width - clear.groupWidth)).toBeLessThanOrEqual(1);
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
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#e8efe7' } },
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
  await page.getByRole('banner').getByRole('button', { name: 'My routes', exact: true }).click();
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
}) => {
  await save(page, 'River');
  await page.getByRole('banner').getByRole('button', { name: 'My routes', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate River', exact: true }).click();
  const checks = page.getByRole('checkbox', { name: /^Select .* for comparison$/ });
  await expect(checks).toHaveCount(2);
  await checks.nth(0).check();
  await checks.nth(1).check();
  const compare = page.getByRole('button', { name: 'Compare routes', exact: true });
  await compare.click();
  const dialog = page.getByRole('dialog', { name: 'Compare saved routes', exact: true });
  await expect(dialog.getByRole('table', { name: 'Saved route comparison' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Fit route', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('group', { name: 'Map style', exact: true })).toHaveCount(0);
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
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
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
  await expect(actions.locator('.reverse-stops span')).toBeVisible();
  await expect(actions.locator('.clear-stops-label')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
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
