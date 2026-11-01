import { test, expect, type Page } from '@playwright/test';
const password = 'synthetic-backup-password';
async function openConnections(page: Page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Connections', exact: true })).toBeVisible();
}
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
  await page.route('https://api.github.com/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
});
test('GitHub App modal backs up encrypted routes through same-origin functions and restores explicitly', async ({
  page,
}) => {
  let stored: Buffer | null = null;
  const entry = {
    id: 'roamlet-backups/11111111-1111-4111-8111-111111111111.roamlet',
    name: '11111111-1111-4111-8111-111111111111.roamlet',
    size: 0,
  };
  await page.route('**/api/github?**', async (route) => {
    const request = route.request();
    const action = new URL(request.url()).searchParams.get('action');
    expect(request.headers().authorization).toBeUndefined();
    if (action === 'session')
      await route.fulfill({
        json: {
          available: true,
          connected: true,
          login: 'example',
          installUrl: 'https://github.com/apps/roamlet/installations/new',
        },
      });
    else if (action === 'repositories')
      await route.fulfill({ json: { repositories: [{ owner: 'example', name: 'backups' }] } });
    else if (action === 'check') await route.fulfill({ json: {} });
    else if (action === 'upload') {
      expect(request.headers()['x-roamlet-request']).toBe('1');
      stored = request.postDataBuffer();
      expect(stored).not.toBeNull();
      expect(stored!.toString('utf8')).not.toContain('Split route');
      entry.size = stored!.length;
      await route.fulfill({ json: { backup: entry } });
    } else if (action === 'list') await route.fulfill({ json: { backups: stored ? [entry] : [] } });
    else if (action === 'download')
      await route.fulfill({ body: stored!, contentType: 'application/octet-stream' });
    else await route.fulfill({ json: {} });
  });
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'split.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><metadata><name>Split route</name></metadata><trk><trkseg><trkpt lat="47" lon="11"><ele>100</ele></trkpt><trkpt lat="47.01" lon="11.01"><ele>110</ele></trkpt></trkseg><trkseg><trkpt lat="48" lon="12"><ele>200</ele></trkpt><trkpt lat="48.01" lon="12.01"><ele>210</ele></trkpt></trkseg></trk></gpx>',
    ),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Save route', exact: true })
    .getByRole('button', { name: 'Save to library' })
    .click();
  await openConnections(page);
  await page.getByRole('button', { name: 'Manage connection' }).click();
  const modal = page.getByRole('dialog', { name: 'GitHub connection settings' });
  await modal.getByRole('button', { name: 'Load accessible repositories' }).click();
  await modal.getByLabel('Private repository').selectOption('example/backups');
  await modal.getByRole('button', { name: 'Use this repository' }).click();
  await expect(modal.getByText('Connected to example/backups')).toBeVisible();
  await modal.getByLabel('Backup password', { exact: true }).fill(password);
  await modal.getByLabel('Confirm backup password').fill(password);
  await modal.getByRole('button', { name: 'Create encrypted backup' }).click();
  await expect(modal.getByText('Encrypted backup saved to GitHub.')).toBeVisible();
  await modal.getByRole('button', { name: 'Refresh cloud backups' }).click();
  await modal.getByLabel('Cloud backup').selectOption(entry.id);
  await modal.getByLabel('Restore password').fill(password);
  await modal.getByRole('button', { name: 'Preview restoration' }).click();
  await expect(modal.getByText('1 conflicting routes')).toBeVisible();
  await expect(modal.getByLabel('Conflicting routes')).toHaveValue('copy');
  await modal.getByRole('button', { name: 'Import routes' }).click();
  await expect(
    modal.getByText('Library restored on this device. The current editor route is unchanged.'),
  ).toBeVisible();
  await modal.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Back to map' }).click();
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes' }).click();
  await expect(page.getByRole('list', { name: 'Saved routes' }).getByRole('listitem')).toHaveCount(
    2,
  );
});
test('shared cookie-session status survives reload and logout synchronizes to another tab', async ({
  page,
  context,
}) => {
  let authenticated = true;
  await context.route('**/api/github?**', (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'logout') {
      authenticated = false;
      return route.fulfill({ json: {} });
    }
    if (action === 'session')
      return route.fulfill({
        json: {
          available: true,
          connected: authenticated,
          login: authenticated ? 'example' : undefined,
        },
      });
    return route.fulfill({ json: {} });
  });
  await openConnections(page);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await openConnections(page);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByTestId('global-map-loader')).toHaveCount(0);
  await openConnections(other);
  await expect(other.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Disconnect GitHub?' });
  await expect(modal.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await modal.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByText('Not connected', { exact: true })).toBeVisible();
  await expect(other.getByText('Not connected', { exact: true })).toBeVisible();
});
test('scalable catalog opens a Russian dark-theme modal and restores focus', async ({
  page,
}, testInfo) => {
  await page.route('**/api/github?**', (route) =>
    route.fulfill({
      json: {
        available: true,
        connected: false,
        installUrl: 'https://github.com/apps/roamlet/installations/new',
      },
    }),
  );
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Подключения', exact: true }).click();
  const setup = page.getByRole('button', { name: 'Настроить подключение' });
  const screen = page.getByRole('region', { name: 'Подключения', exact: true });
  await expect(screen.getByText('Не подключён', { exact: true })).toBeVisible();
  await screen.getByRole('textbox', { name: 'Поиск коннекторов' }).fill('Drive');
  await expect(screen.getByText('По этому фильтру коннекторы не найдены.')).toBeVisible();
  await screen.getByRole('textbox', { name: 'Поиск коннекторов' }).fill('');
  await setup.click();
  const modal = page.getByRole('dialog', { name: 'Настройки подключения GitHub' });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Войти через GitHub' })).toBeEnabled();
  await expect(modal.getByRole('button', { name: 'Done' })).toHaveCount(0);
  expect((await modal.textContent())?.toLowerCase()).not.toContain('пилот');
  const viewport = page.viewportSize()!;
  expect(await modal.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({
    path: testInfo.outputPath('github-app-modal-dark-ru.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(setup).toBeFocused();
});

for (const theme of ['light', 'dark'] as const) {
  test(`connector toolbar matches library controls (${theme})`, async ({ page }, testInfo) => {
    if (testInfo.project.name === 'desktop')
      await page.setViewportSize({ width: 1600, height: 900 });
    await page.route('**/api/github?**', (route) =>
      route.fulfill({ json: { available: true, connected: false } }),
    );
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page
      .getByRole('menuitemradio', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true })
      .click();
    if (theme === 'dark') {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
    }
    const labels =
      theme === 'dark'
        ? {
            menu: 'Меню',
            connections: 'Подключения',
            search: 'Поиск коннекторов',
            all: 'Все коннекторы',
            connected: 'Подключённые',
            back: 'Назад к карте',
            library: 'Мои маршруты',
            librarySearch: 'Поиск сохранённых маршрутов',
          }
        : {
            menu: 'Menu',
            connections: 'Connections',
            search: 'Search connectors',
            all: 'All connectors',
            connected: 'Connected connectors',
            back: 'Back to map',
            library: 'My routes',
            librarySearch: 'Search saved routes',
          };
    await page.getByRole('button', { name: labels.menu, exact: true }).click();
    await page.getByRole('menuitem', { name: labels.connections, exact: true }).click();
    const screen = page.getByRole('region', { name: labels.connections, exact: true });
    const search = screen.getByRole('textbox', { name: labels.search });
    const metrics = (input: HTMLInputElement) => {
      const wrapper = input.closest('label')!;
      const outer = getComputedStyle(wrapper);
      const inner = getComputedStyle(input);
      const icon = wrapper.querySelector('svg')!;
      const box = wrapper.getBoundingClientRect();
      const iconBox = icon.getBoundingClientRect();
      return {
        height: box.height,
        radius: outer.borderRadius,
        padding: outer.padding,
        gap: outer.gap,
        background: outer.backgroundColor,
        inputBackground: inner.backgroundColor,
        inputBorder: inner.borderWidth,
        font: inner.fontSize,
        iconInset: iconBox.left - box.left,
      };
    };
    const connectorMetrics = await search.evaluate(metrics);
    expect(connectorMetrics.height).toBe(44);
    expect(connectorMetrics.iconInset).toBeGreaterThan(0);
    await search.focus();
    await expect
      .poll(() =>
        search.evaluate((input) => getComputedStyle(input.closest('label')!).outlineStyle),
      )
      .toBe('solid');
    const all = screen.getByRole('button', { name: labels.all, exact: true });
    const connected = screen.getByRole('button', { name: labels.connected, exact: true });
    await connected.click();
    await expect(connected).toHaveAttribute('aria-pressed', 'true');
    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    const filters = await all.evaluate((button) => ({
      height: button.getBoundingClientRect().height,
      background: getComputedStyle(button).backgroundColor,
    }));
    expect(filters.height).toBeGreaterThanOrEqual(44);
    const grid = screen.getByRole('list', {
      name: labels.connections === 'Connections' ? 'Available connectors' : 'Доступные коннекторы',
    });
    const gridWidth = (await grid.boundingBox())!.width;
    const columns = Math.max(1, Math.floor((gridWidth + 16) / (360 + 16)));
    const cardWidth = (await grid.getByRole('listitem').first().boundingBox())!.width;
    expect(cardWidth).toBeCloseTo((gridWidth - (columns - 1) * 16) / columns, 0);
    if (testInfo.project.name === 'mobile') {
      expect((await search.boundingBox())!.y).toBeLessThan((await all.boundingBox())!.y);
      expect(await screen.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );
    }
    await page.screenshot({
      path: testInfo.outputPath(`connector-toolbar-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await screen.getByRole('button', { name: labels.back, exact: true }).click();
    await page.getByRole('button', { name: labels.menu, exact: true }).click();
    await page.getByRole('menuitem', { name: labels.library, exact: true }).click();
    const libraryMetrics = await page
      .getByRole('textbox', { name: labels.librarySearch })
      .evaluate(metrics);
    expect(connectorMetrics).toEqual(libraryMetrics);
  });
}
