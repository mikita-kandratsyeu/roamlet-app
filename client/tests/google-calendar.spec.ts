import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const calendarCard = (page: Page) =>
  page
    .locator('.connector-card')
    .filter({ has: page.getByRole('heading', { name: 'Google Calendar', exact: true }) });
async function openConnections(page: Page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Connections', exact: true }).click();
}
async function prepare(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  for (const [latitude, longitude] of [
    ['47.26', '11.40'],
    ['47.27', '11.41'],
  ]) {
    await page.getByRole('textbox', { name: 'Latitude', exact: true }).fill(latitude);
    await page.getByRole('textbox', { name: 'Longitude', exact: true }).fill(longitude);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  await page.locator('.planner-details > summary').filter({ hasText: 'Route schedule' }).click();
  const schedule = page.getByRole('region', { name: 'Route schedule', exact: true });
  await expect(schedule.getByLabel('Local departure date and time')).toHaveCount(1);
  await schedule.getByLabel('Local departure date and time').fill('2026-11-07T10:00');
  await schedule.getByLabel('Local departure date and time').press('Enter');
  await schedule
    .getByLabel(/^Pause \(minutes\):/)
    .first()
    .fill('10');
  await schedule
    .getByLabel(/^Pause \(minutes\):/)
    .first()
    .press('Tab');
  await save(page);
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('textbox', { name: 'Route name', exact: true }).fill('Calendar ride');
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
}
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('roamlet-language')) localStorage.setItem('roamlet-language', 'en');
  });
  await context.route('**/__fixtures__/map-style.json', (route) =>
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
  await context.route('**/api/route', (route) =>
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
                .coordinates.map((point: number[]) => [...point, 100]),
            },
          },
        ],
      },
    }),
  );
  for (const provider of ['github', 'google-drive'])
    await context.route(`**/api/${provider}?**`, (route) =>
      route.fulfill({ json: { available: false, connected: false } }),
    );
  await context.route('https://*.googleapis.com/**', (route) => route.abort());
});
test('publishes a previewed saved route, updates the same event manually and fits the dialog', async ({
  page,
  context,
}, testInfo) => {
  const publications: Record<string, unknown>[] = [];
  await context.route('**/api/google-calendar?**', (route) => {
    const request = route.request();
    const action = new URL(request.url()).searchParams.get('action');
    expect(request.headers().authorization).toBeUndefined();
    if (action === 'session')
      return route.fulfill({
        json: {
          available: true,
          connected: true,
          accountId: 'synthetic-user',
          email: 'user@example.test',
          expiresAt: Date.now() + 3600000,
        },
      });
    if (action === 'publish') {
      expect(request.headers()['content-type']).toBe('application/json');
      expect(request.headers()['x-roamlet-request']).toBe('1');
      const value = request.postDataJSON();
      expect(value).not.toHaveProperty('segments');
      expect(value).not.toHaveProperty('coordinates');
      publications.push(value);
      return route.fulfill({
        json: {
          eventId: value.eventId,
          htmlLink: 'https://www.google.com/calendar/event?eid=synthetic',
        },
      });
    }
    return route.fulfill({ json: {} });
  });
  await prepare(page);
  await page.getByRole('button', { name: 'Add to calendar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Route calendar event', exact: true });
  await dialog.getByRole('button', { name: 'Start time zone (IANA)' }).click();
  await expect(page.locator('.calendar-timezone-menu')).toHaveCSS('overflow-y', 'auto');
  await expect(
    page.getByRole('menuitemradio', { name: 'Europe/Warsaw', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('menuitemradio', { name: 'America/Chicago', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Search all time zones' }).click();
  await page.getByRole('searchbox', { name: 'Search all time zones' }).fill('America/Chicago');
  await page.getByRole('menuitemradio', { name: 'America/Chicago', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Start time zone (IANA)' })).toContainText(
    'America/Chicago',
  );
  await expect(dialog.getByRole('button', { name: 'Confirm event creation' })).toBeEnabled();
  expect(publications).toHaveLength(0);
  await expect(dialog.getByRole('button', { name: 'Confirm event creation' })).toBeInViewport();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('calendar-preview.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Confirm event creation' }).click();
  const openEvent = page.getByRole('link', { name: 'Open calendar event' });
  await expect(openEvent).toBeVisible();
  const [addButtonSize, openButtonSize] = await Promise.all(
    [page.getByRole('button', { name: 'Add to calendar', exact: true }), openEvent].map((button) =>
      button.evaluate((element) => {
        const { width, height } = element.getBoundingClientRect();
        return { width, height };
      }),
    ),
  );
  expect(openButtonSize.width).toBeCloseTo(addButtonSize.width, 0);
  expect(openButtonSize.height).toBe(addButtonSize.height);
  expect(publications).toHaveLength(1);
  expect(publications[0]).toMatchObject({ summary: 'Calendar ride', reminderMinutes: 30 });
  const schedule = page.getByRole('region', { name: 'Route schedule', exact: true });
  await schedule.getByLabel('Local departure date and time').fill('2026-11-07T11:00');
  await schedule.getByLabel('Local departure date and time').press('Enter');
  const changedNotice = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: 'Route or event settings changed. Update the calendar event manually.' });
  await expect(changedNotice).toBeVisible();
  await changedNotice.getByRole('button', { name: 'Dismiss notification' }).click();
  expect(publications).toHaveLength(1);
  await save(page);
  await page.getByRole('button', { name: 'Add to calendar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm event update' }).click();
  await expect(dialog).toHaveCount(0);
  expect(publications).toHaveLength(2);
  expect(publications[1].eventId).toBe(publications[0].eventId);
});
test('hides Google actions without a connector and downloads ICS offline', async ({
  page,
  context,
}) => {
  await context.route('**/api/google-calendar?**', (route) =>
    route.fulfill({ json: { available: true, connected: false } }),
  );
  await prepare(page);
  const exportButton = page.getByRole('button', { name: 'Add to calendar' });
  await exportButton.scrollIntoViewIfNeeded();
  const dimensions = await exportButton.evaluate((button) => {
    const container = button.closest('.route-calendar-actions')!;
    return {
      buttonWidth: button.getBoundingClientRect().width,
      containerWidth: container.getBoundingClientRect().width,
      height: button.getBoundingClientRect().height,
    };
  });
  expect(dimensions.buttonWidth).toBeCloseTo(dimensions.containerWidth, 0);
  expect(dimensions.height).toBeGreaterThanOrEqual(44);
  await expect(exportButton).toHaveAttribute('data-variant', 'default');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Add to calendar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Route calendar event', exact: true });
  await dialog.getByRole('button', { name: 'Start time zone (IANA)' }).click();
  await page.getByRole('menuitemradio', { name: 'Europe/Warsaw', exact: true }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download .ics' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Calendar ride.ics');
  const path = await file.path();
  expect(path).not.toBeNull();
  const contents = await readFile(path!, 'utf8');
  expect(contents).toContain('BEGIN:VCALENDAR\r\n');
  expect(contents).toContain('SUMMARY:Calendar ride\r\n');
  expect(contents).toContain('DTSTART:20261107T090000Z\r\n');
  await expect(dialog.getByRole('button', { name: 'Confirm event creation' })).toHaveCount(0);
});
test('event preview uses localized dates, grouped settings and full-width offline download', async ({
  page,
  context,
}, testInfo) => {
  await context.route('**/api/google-calendar?**', (route) =>
    route.fulfill({ json: { available: true, connected: false } }),
  );
  await prepare(page);
  for (const dismiss of await page.getByRole('button', { name: 'Dismiss notification' }).all())
    await dismiss.click();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  for (const [language, theme, zoneLabel, previewLabel, guidanceLabel, downloadLabel] of [
    [
      'en',
      'Light',
      'Start time zone (IANA)',
      'Event preview',
      'Timing and privacy',
      'Download .ics',
    ],
    [
      'ru',
      'Dark',
      'Часовой пояс старта (IANA)',
      'Предпросмотр события',
      'Расчёт времени и приватность',
      'Скачать .ics',
    ],
  ]) {
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page.getByRole('menuitemradio', { name: theme, exact: true }).click();
    await page.getByRole('button', { name: /^(Menu|Меню)$/ }).click();
    await page
      .getByRole('menuitemradio', { name: language === 'ru' ? 'Русский' : 'English', exact: true })
      .click();
    await page
      .getByRole('button', { name: /^(Export calendar \(\.ics\)|Экспорт в календарь \(\.ics\))$/ })
      .click();
    const dialog = page.getByRole('dialog', { name: /^(Route calendar event|Событие маршрута)$/ });
    await expect(dialog.getByLabel(zoneLabel)).toBeFocused();
    await dialog.getByRole('button', { name: zoneLabel }).click();
    await page.getByRole('menuitemradio', { name: 'Europe/Warsaw', exact: true }).click();
    const preview = dialog.getByRole('region', { name: previewLabel });
    await expect(preview.getByRole('heading', { name: 'Calendar ride' })).toBeVisible();
    await expect(preview.locator('time').first()).toHaveAttribute(
      'datetime',
      '2026-11-07T10:00:00+01:00',
    );
    await expect(preview.locator('time').first()).toContainText(
      language === 'ru' ? 'нояб.' : 'Nov',
    );
    const disclosure = dialog.locator('details').filter({ hasText: guidanceLabel });
    await expect(disclosure).not.toHaveAttribute('open');
    const collapsedSpacing = await disclosure.evaluate((details) => ({
      padding: getComputedStyle(details).padding,
      summaryPadding: getComputedStyle(details.querySelector('summary')!).padding,
      summaryMinHeight: getComputedStyle(details.querySelector('summary')!).minHeight,
    }));
    expect(collapsedSpacing).toEqual({
      padding: '12px',
      summaryPadding: '0px',
      summaryMinHeight: '0px',
    });
    const download = dialog.getByRole('button', { name: downloadLabel, exact: true });
    await expect(download).toHaveAttribute('data-variant', 'default');
    await expect(download).toBeInViewport();
    await expect
      .poll(() => download.evaluate((button) => button.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(44);
    const layout = await dialog.evaluate((element) => {
      const button = element.querySelector('.calendar-event-footer > button')!;
      return {
        overflow: element.scrollWidth > element.clientWidth,
        buttonWidth: button.getBoundingClientRect().width,
        rowWidth: button.parentElement!.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.buttonWidth).toBeCloseTo(layout.rowWidth, 0);
    expect(layout.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: testInfo.outputPath(`event-preview-${language}.png`),
      animations: 'disabled',
    });
    await disclosure.locator('summary').click();
    await expect(disclosure).toHaveAttribute('open');
    await expect(disclosure.locator('.calendar-event-disclosure-body')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`event-preview-guidance-${language}.png`),
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: /^(Close dialog|Закрыть диалог)$/ }).click();
  }
});

test('Calendar connection uses the Drive dialog layout in English/light and Russian/dark', async ({
  page,
  context,
}, testInfo) => {
  await context.route('**/api/google-calendar?**', (route) =>
    route.fulfill({
      json: {
        available: true,
        connected: true,
        accountId: 'synthetic-user',
        email: 'user@example.test',
        expiresAt: Date.now() + 3600000,
      },
    }),
  );
  await page.goto('/');
  for (const [language, theme, manage, done] of [
    ['en', 'light', 'Manage connection', 'Done'],
    ['ru', 'dark', 'Управлять подключением', 'Готово'],
  ]) {
    await page.evaluate(
      ({ language, theme }) => {
        localStorage.setItem('roamlet-language', language);
        localStorage.setItem('roamlet-theme', theme);
      },
      { language, theme },
    );
    await page.goto('/?connectors=google-calendar&calendar=connected');
    const icon = calendarCard(page).locator('img');
    await expect(icon).toHaveAttribute('src', '/google-calendar-2026.svg');
    await expect
      .poll(() => icon.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(96);
    await calendarCard(page).getByRole('button', { name: manage }).click();
    const dialog = page.getByRole('dialog', { name: /Google Calendar/ });
    await expect(dialog).not.toHaveClass(/compact/);
    await expect(dialog.locator('.storage-connections')).toBeVisible();
    await expect(dialog.locator('.connector-connection-summary')).toContainText(
      'user@example.test',
    );
    await expect(dialog.locator('details')).toHaveCount(1);
    await expect(dialog.locator('details')).not.toHaveAttribute('open');
    const doneButton = dialog.getByRole('button', { name: done, exact: true });
    await expect(dialog.locator('.connector-modal-footer')).toBeVisible();
    await expect(doneButton).toBeInViewport();
    await expect(doneButton).toBeFocused();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`calendar-connection-${language}-${theme}.png`),
      animations: 'disabled',
    });
    await doneButton.click();
    await expect(calendarCard(page).getByRole('button', { name: manage })).toBeFocused();
  }
});

test('OAuth return opens Calendar settings and disconnect leaves Drive independent', async ({
  page,
  context,
}) => {
  let authenticated = false;
  await context.route('**/api/google-calendar?**', (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'start') {
      authenticated = true;
      return route.fulfill({
        status: 302,
        headers: { Location: '/?connectors=google-calendar&calendar=connected' },
      });
    }
    if (action === 'logout') authenticated = false;
    return route.fulfill({
      json: {
        available: true,
        connected: authenticated,
        ...(authenticated
          ? {
              accountId: 'synthetic-user',
              email: 'user@example.test',
              expiresAt: Date.now() + 3600000,
            }
          : {}),
      },
    });
  });
  await page.goto('/');
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await openConnections(page);
  await calendarCard(page).getByRole('button', { name: 'Set up connection' }).click();
  await page
    .getByRole('dialog', { name: 'Google Calendar connection settings' })
    .getByRole('button', { name: 'Sign in with Google' })
    .click();
  await expect(calendarCard(page).getByText('Connected', { exact: true })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await calendarCard(page).getByRole('button', { name: 'Disconnect Google Calendar' }).click();
  await page
    .getByRole('dialog', { name: 'Disconnect Google Calendar?' })
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click();
  await expect(calendarCard(page).getByText('Not connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Google Drive', exact: true })).toBeVisible();
});
