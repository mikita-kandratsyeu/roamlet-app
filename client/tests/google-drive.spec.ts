import { test, expect, type Page } from '@playwright/test';
const cookieName = 'roamlet-google-drive-session';
const opaqueCookie = 'synthetic-opaque-session-not-real';
const session = {
  available: true,
  connected: true,
  email: 'user@example.test',
  accountId: 'account123',
};
async function openCatalog(page: Page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Connections', exact: true }).click();
}
const googleCard = (page: Page) =>
  page
    .locator('.connector-card')
    .filter({ has: page.getByRole('heading', { name: 'Google Drive', exact: true }) });
test.beforeEach(async ({ page, context }) => {
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
  await context.route('https://*.googleapis.com/**', (route) => route.abort());
  await context.route('https://api.github.com/**', (route) => route.abort());
  await context.route('**/api/github?**', (route) =>
    route.fulfill({ json: { available: false, connected: false } }),
  );
  await page.goto('/');
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
});

test('Google Drive is first and its access-only OAuth return opens the catalog without exposing a token', async ({
  page,
  context,
}) => {
  await context.route('**/api/google-drive?**', async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'start')
      return route.fulfill({
        status: 302,
        headers: {
          Location: '/?connectors=google-drive&google=connected',
          'Set-Cookie': `${cookieName}=${opaqueCookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`,
        },
      });
    const headers = await route.request().allHeaders();
    if (action === 'session')
      return route.fulfill({
        json: headers.cookie?.includes(opaqueCookie)
          ? session
          : { available: true, connected: false },
      });
    return route.fulfill({ json: {} });
  });
  await openCatalog(page);
  const cards = page.getByRole('list', { name: 'Available connectors' }).getByRole('listitem');
  await expect(cards.nth(0).getByRole('heading')).toHaveText('Google Drive');
  await expect(cards.nth(1).getByRole('heading')).toHaveText('GitHub');
  await expect
    .poll(() =>
      googleCard(page)
        .locator('img')
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(96);
  await googleCard(page).getByRole('button', { name: 'Set up connection' }).click();
  const dialog = page.getByRole('dialog', { name: 'Google Drive connection settings' });
  await expect(dialog.locator('details')).toHaveCount(1);
  await expect(dialog.locator('details details')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.getByRole('region', { name: 'Connections', exact: true })).toBeVisible();
  await expect(googleCard(page).getByText('Connected', { exact: true })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  expect(await page.evaluate(() => document.cookie)).not.toContain(opaqueCookie);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(opaqueCookie);
  await page.reload();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await openCatalog(page);
  await expect(googleCard(page).getByText('Connected', { exact: true })).toBeVisible();
});

test('Google Drive encrypted backup and restore reuse planner menus and preserve route segments', async ({
  page,
  context,
}, testInfo) => {
  await context.addCookies([
    {
      name: cookieName,
      value: opaqueCookie,
      url: 'http://127.0.0.1:4174',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  let stored: Buffer | null = null;
  const entry = {
    id: 'synthetic_file_123',
    name: '11111111-1111-4111-8111-111111111111.roamlet',
    size: 0,
  };
  await context.route('**/api/google-drive?**', async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    expect(route.request().headers().authorization).toBeUndefined();
    if (action === 'session') return route.fulfill({ json: session });
    if (action === 'upload') {
      expect(route.request().headers()['x-roamlet-request']).toBe('1');
      stored = route.request().postDataBuffer();
      expect(stored).not.toBeNull();
      expect(stored!.toString('utf8')).not.toContain('Drive split route');
      expect(stored!.toString('utf8')).not.toContain(opaqueCookie);
      entry.size = stored!.length;
      return route.fulfill({ json: { backup: entry } });
    }
    if (action === 'list') return route.fulfill({ json: { backups: stored ? [entry] : [] } });
    if (action === 'download')
      return route.fulfill({ contentType: 'application/octet-stream', body: stored! });
    return route.fulfill({ json: {} });
  });
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'drive.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><metadata><name>Drive split route</name></metadata><trk><trkseg><trkpt lat="47" lon="11"><ele>100</ele></trkpt><trkpt lat="47.01" lon="11.01"><ele>110</ele></trkpt></trkseg><trkseg><trkpt lat="48" lon="12"><ele>200</ele></trkpt><trkpt lat="48.01" lon="12.01"><ele>210</ele></trkpt></trkseg></trk></gpx>',
    ),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Save route', exact: true })
    .getByRole('button', { name: 'Save to library' })
    .click();
  await openCatalog(page);
  await googleCard(page).getByRole('button', { name: 'Manage connection' }).click();
  const dialog = page.getByRole('dialog', { name: 'Google Drive connection settings' });
  await expect(dialog.getByRole('tab', { name: 'Create a backup' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByRole('button', { name: 'Private repository' })).toHaveCount(0);
  await expect(dialog.getByText('1 saved routes will be included')).toBeVisible();
  await dialog.getByLabel('Backup password', { exact: true }).fill('synthetic-password');
  await dialog.getByLabel('Confirm backup password').fill('synthetic-password');
  await dialog.getByRole('button', { name: 'Create encrypted backup' }).click();
  await expect(dialog.getByText('Encrypted backup saved to Google Drive.')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Restore a backup' }).click();
  await dialog.getByRole('button', { name: 'Refresh cloud backups' }).click();
  await dialog.getByRole('button', { name: 'Cloud backup', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveClass(/planner-choice-menu/);
  await page
    .getByRole('menuitemradio', { name: new RegExp(entry.name.replaceAll('.', '\\.')) })
    .click();
  await dialog.getByLabel('Restore password', { exact: true }).fill('synthetic-password');
  await dialog.getByRole('button', { name: 'Preview restoration' }).click();
  await expect(dialog.getByText('1 conflicting routes')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Conflicting routes' })).toContainText(
    'Import copies',
  );
  await dialog.getByRole('button', { name: 'Import routes' }).click();
  await expect(
    dialog.getByText('Library restored on this device. The current editor route is unchanged.'),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('google-drive-restored.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Back to map' }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Saved routes' }).getByRole('listitem')).toHaveCount(
    2,
  );
});

test('expired Google access uses one Sonner error and Google logout leaves GitHub connected', async ({
  page,
  context,
}) => {
  let googleConnected = true;
  await context.route('**/api/github?**', (route) =>
    route.fulfill({ json: { available: true, connected: true, login: 'github-user' } }),
  );
  await context.route('**/api/google-drive?**', (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'session')
      return route.fulfill({
        json: googleConnected ? session : { available: true, connected: false },
      });
    if (action === 'check') return route.fulfill({ json: {} });
    if (action === 'logout') {
      googleConnected = false;
      return route.fulfill({ json: {} });
    }
    return route.fulfill({
      status: 401,
      json: { error: { code: 'auth', message: 'upstream-secret-never-display' } },
    });
  });
  await openCatalog(page);
  await googleCard(page).getByRole('button', { name: 'Manage connection' }).click();
  const dialog = page.getByRole('dialog', { name: 'Google Drive connection settings' });
  await dialog.getByRole('tab', { name: 'Restore a backup' }).click();
  await dialog.getByRole('button', { name: 'Refresh cloud backups' }).click();
  const toast = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText('Your Google Drive session has expired');
  await expect(dialog.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
  await toast.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await googleCard(page)
    .getByRole('button', { name: 'Disconnect Google Drive', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Disconnect Google Drive?' })
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click();
  await expect(googleCard(page).getByText('Not connected', { exact: true })).toBeVisible();
  const github = page
    .locator('.connector-card')
    .filter({ has: page.getByRole('heading', { name: 'GitHub', exact: true }) });
  await expect(github.getByText('Connected', { exact: true })).toBeVisible();
});
