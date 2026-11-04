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
  await context.addInitScript(() => localStorage.setItem('roamlet-language', 'en'));
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
  await page.getByRole('button', { name: 'Add to Google Calendar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Route calendar event', exact: true });
  await dialog.getByLabel('Start time zone (IANA)').fill('Europe/Warsaw');
  await expect(dialog.getByRole('button', { name: 'Confirm event creation' })).toBeEnabled();
  expect(publications).toHaveLength(0);
  await expect(dialog.getByRole('button', { name: 'Confirm event creation' })).toBeInViewport();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('calendar-preview.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Confirm event creation' }).click();
  await expect(page.getByRole('link', { name: 'Open calendar event' })).toBeVisible();
  expect(publications).toHaveLength(1);
  expect(publications[0]).toMatchObject({ summary: 'Calendar ride', reminderMinutes: 30 });
  const schedule = page.getByRole('region', { name: 'Route schedule', exact: true });
  await schedule.getByLabel('Local departure date and time').fill('2026-11-07T11:00');
  await schedule.getByLabel('Local departure date and time').press('Enter');
  await expect(
    schedule.getByText('Route or event settings changed. Update the calendar event manually.'),
  ).toBeVisible();
  expect(publications).toHaveLength(1);
  await save(page);
  await page.getByRole('button', { name: 'Update calendar event', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'Add to Google Calendar' })).toHaveCount(0);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Export calendar (.ics)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Route calendar event', exact: true });
  await dialog.getByLabel('Start time zone (IANA)').fill('Europe/Warsaw');
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
