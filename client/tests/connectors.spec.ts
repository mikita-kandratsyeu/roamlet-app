import { test, expect, type Page } from '@playwright/test';

const syntheticToken = 'synthetic-test-only-token';
const password = 'synthetic-backup-password';
async function openConnections(page: Page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Connections', exact: true })).toBeVisible();
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Set up connection' }).click();
  await page.getByLabel('GitHub owner', { exact: true }).fill('pilot-owner');
  await page.getByLabel('Private repository', { exact: true }).fill('private-backups');
  await page.getByLabel('GitHub access token', { exact: true }).fill(syntheticToken);
  await page.getByRole('button', { name: 'Connect GitHub' }).click();
  await expect(page.getByText('Connected to pilot-owner/private-backups')).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('roamlet-language', 'en'));
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
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
});

test('direct GitHub encrypted backup and explicit restore preserve split geometry without server transmission', async ({
  page,
}) => {
  let stored: {
    type: string;
    name: string;
    path: string;
    size: number;
    encoding: string;
    content: string;
  } | null = null;
  const repository = 'https://api.github.com/repos/pilot-owner/private-backups';
  const sentToServer: string[] = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).origin === 'http://127.0.0.1:4174' &&
      (request.headers().authorization?.includes(syntheticToken) ||
        request.postData()?.includes(syntheticToken))
    )
      sentToServer.push(request.url());
  });
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe(`Bearer ${syntheticToken}`);
    if (request.url() === repository) {
      await route.fulfill({
        json: { private: true, permissions: { push: true } },
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    } else if (request.method() === 'PUT') {
      const data = request.postDataJSON();
      expect(data).not.toHaveProperty('sha');
      const path = decodeURIComponent(new URL(request.url()).pathname.split('/contents/')[1]);
      const bytes = Buffer.from(data.content, 'base64');
      expect(bytes.toString('utf8')).not.toContain('Pilot split route');
      expect(bytes.toString('utf8')).not.toContain(syntheticToken);
      stored = {
        type: 'file',
        name: path.split('/')[1],
        path,
        size: bytes.length,
        encoding: 'base64',
        content: data.content,
      };
      await route.fulfill({
        status: 201,
        json: { content: stored },
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    } else if (request.url() === `${repository}/contents/roamlet-backups`) {
      await route.fulfill({
        json: { entries: stored ? [stored] : [] },
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    } else {
      expect(stored).not.toBeNull();
      await route.fulfill({ json: stored, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
  });
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'pilot.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><metadata><name>Pilot split route</name></metadata><trk><trkseg><trkpt lat="47" lon="11"><ele>100</ele></trkpt><trkpt lat="47.01" lon="11.01"><ele>110</ele></trkpt></trkseg><trkseg><trkpt lat="48" lon="12"><ele>200</ele></trkpt><trkpt lat="48.01" lon="12.01"><ele>210</ele></trkpt></trkseg></trk></gpx>',
    ),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  const save = page.getByRole('dialog', { name: 'Save route', exact: true });
  await save.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(save).toHaveCount(0);
  await openConnections(page);
  await connect(page);
  await page.getByLabel('Backup password', { exact: true }).fill(password);
  await page.getByLabel('Confirm backup password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted backup' }).click();
  await expect(page.getByText('Encrypted backup saved to GitHub.')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh cloud backups' }).click();
  await expect(page.getByLabel('Cloud backup')).toBeVisible();
  expect(stored).not.toBeNull();
  await page.getByLabel('Cloud backup').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Preview restoration' }).click();
  const preview = page.getByRole('region', { name: 'Library import preview' });
  await expect(preview.getByText('1 routes to import')).toBeVisible();
  await expect(preview.getByText('1 conflicting routes')).toBeVisible();
  await expect(preview.getByLabel('Conflicting routes')).toHaveValue('copy');
  await preview.getByRole('button', { name: 'Import routes' }).click();
  await expect(
    page.getByText('Library restored on this device. The current editor route is unchanged.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to map' }).click();
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Saved routes' }).getByRole('listitem')).toHaveCount(
    2,
  );
  expect(sentToServer).toEqual([]);
});

test('memory-only connection survives navigation but not reload and never sends requests automatically', async ({
  page,
}) => {
  let requests = 0;
  await page.route('https://api.github.com/**', (route) => {
    requests++;
    return route.fulfill({
      json: { private: true, permissions: { push: true } },
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  await openConnections(page);
  expect(requests).toBe(0);
  await connect(page);
  await page.getByRole('button', { name: 'Back to map' }).click();
  await openConnections(page);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await page.reload();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await openConnections(page);
  await expect(page.getByText('Not connected', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  const browserStorage = await page.evaluate(async () => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
    databases: await indexedDB.databases(),
  }));
  expect(JSON.stringify(browserStorage)).not.toContain(syntheticToken);
});

test('connector page supports Russian dark theme, official icon, keyboard return and narrow layouts', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Подключения', exact: true }).click();
  const screen = page.getByRole('region', { name: 'Подключения', exact: true });
  await expect(screen).toBeVisible();
  await expect(screen.getByText('Не подключён', { exact: true })).toBeVisible();
  const logo = screen.locator('img.github-brand-mark');
  await expect(logo).toHaveAttribute('src', '/github-mark.png');
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(560);
  await screen.getByRole('button', { name: 'Настроить подключение' }).click();
  await expect(screen.getByLabel('Владелец на GitHub')).toBeFocused();
  await expect(screen.getByLabel('Токен доступа GitHub')).toHaveAttribute('type', 'password');
  const viewport = page.viewportSize()!;
  expect(await screen.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ path: testInfo.outputPath('connections-dark-ru.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Меню', exact: true })).toBeFocused();
});
