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
  await context.route('**/api/google-drive?**', (route) =>
    route.fulfill({ json: { available: false, connected: false } }),
  );
  await page.goto('/');
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
});
test('GitHub App modal backs up encrypted routes through same-origin functions and restores explicitly', async ({
  page,
}, testInfo) => {
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
  await modal.getByRole('button', { name: 'Private repository' }).click();
  await page.getByRole('menuitemradio', { name: 'example/backups' }).click();
  await modal.getByRole('button', { name: 'Use this repository' }).click();
  await expect(modal.getByText('Connected to example/backups')).toBeVisible();
  await expect(modal.getByText('1 saved routes will be included')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Create encrypted backup' })).toBeInViewport();
  await expect(modal.getByRole('button', { name: 'Private repository' })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('github-create-tab.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await modal.getByLabel('Backup password', { exact: true }).fill(password);
  await modal.getByLabel('Confirm backup password').fill(password);
  await modal.getByRole('button', { name: 'Create encrypted backup' }).click();
  await expect(modal.getByText('Encrypted backup saved to GitHub.')).toBeVisible();
  await modal.getByRole('tab', { name: 'Restore a backup' }).click();
  await modal.getByRole('button', { name: 'Refresh cloud backups' }).click();
  await modal.getByRole('button', { name: 'Cloud backup', exact: true }).click();
  await page
    .getByRole('menuitemradio', { name: new RegExp(entry.name.replaceAll('.', '\\.')) })
    .click();
  await modal.getByLabel('Restore password', { exact: true }).fill(password);
  await modal.getByRole('button', { name: 'Preview restoration' }).click();
  await expect(modal.getByText('1 conflicting routes')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Conflicting routes' })).toContainText(
    'Import copies',
  );
  await modal.getByRole('button', { name: 'Conflicting routes' }).click();
  await expect(page.getByRole('menu')).toHaveClass(/planner-choice-menu/);
  await expect(page.getByRole('menuitemradio', { name: 'Import copies' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: 'Skip existing routes' }).click();
  await expect(modal.getByRole('button', { name: 'Conflicting routes' })).toContainText(
    'Skip existing routes',
  );
  await modal.getByRole('button', { name: 'Conflicting routes' }).click();
  await page.getByRole('menuitemradio', { name: 'Import copies' }).click();
  await page.screenshot({
    path: testInfo.outputPath('github-restore-tab.png'),
    fullPage: true,
    animations: 'disabled',
  });
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
}, testInfo) => {
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
  const disconnect = page.getByRole('button', { name: 'Disconnect GitHub', exact: true });
  await expect(disconnect).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('connected-connector-card.png'),
    animations: 'disabled',
  });
  await disconnect.click();
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
  const setup = page
    .getByRole('heading', { name: 'GitHub', exact: true })
    .locator('xpath=ancestor::article')
    .getByRole('button', { name: 'Настроить подключение' });
  const screen = page.getByRole('region', { name: 'Подключения', exact: true });
  await expect(screen.getByText('Не подключён', { exact: true })).toBeVisible();
  await expect(screen.getByRole('textbox', { name: 'Поиск коннекторов' })).toHaveCount(0);
  await expect(
    screen.getByRole('list', { name: 'Резервные копии' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(screen.getByRole('list', { name: 'Календарь' }).getByRole('listitem')).toHaveCount(
    1,
  );
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

test('connector errors use one Sonner toast while a dialog is open', async ({ page }) => {
  await page.route('**/api/github?**', (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    return action === 'session'
      ? route.fulfill({ json: { available: true, connected: true, login: 'example' } })
      : route.fulfill({
          status: 502,
          json: { error: { code: 'network', message: 'untrusted upstream text' } },
        });
  });
  await openConnections(page);
  await page.getByRole('button', { name: 'Manage connection' }).click();
  const modal = page.getByRole('dialog', { name: 'GitHub connection settings' });
  await modal.getByRole('button', { name: 'Load accessible repositories' }).click();
  const toast = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText('Could not reach GitHub. Check your connection, then retry.');
  await expect(modal.locator('[role="alert"]')).toHaveCount(0);
  await expect(page.getByText('Connection needs attention', { exact: true })).toBeVisible();
  await toast.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(toast).toHaveCount(0);
  await modal.getByRole('button', { name: 'Load accessible repositories' }).click();
  await expect(toast).toHaveCount(1);
  await modal.getByRole('button', { name: 'Done' }).click();
  await expect(toast).toHaveCount(1);
});

test('provider card rechecks connection with an accessible pending state', async ({
  page,
}, testInfo) => {
  let attempts = 0;
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  await page.route('**/api/github?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('action') !== 'session')
      return route.fulfill({ json: {} });
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 502,
        json: { error: { code: 'network', message: 'synthetic failure' } },
      });
    await pending;
    return route.fulfill({ json: { available: true, connected: false } });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Подключения', exact: true }).click();
  const card = page
    .locator('.connector-card')
    .filter({ has: page.getByRole('heading', { name: 'GitHub', exact: true }) });
  await expect(card.getByText('Проверьте подключение', { exact: true })).toBeVisible();
  const retry = card.getByRole('button', { name: 'Повторить', exact: true });
  await expect(retry).toBeVisible();
  await retry.focus();
  await page.keyboard.press('Enter');
  const checking = card.getByRole('button', { name: 'Проверяем подключение', exact: true });
  await expect(checking).toBeDisabled();
  await expect(checking).toHaveAttribute('aria-busy', 'true');
  await expect(checking.locator('svg')).toHaveClass(/connector-spinner/);
  const size = await checking.boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  expect(await card.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    (await card.boundingBox())!.width,
  );
  await page.screenshot({
    path: testInfo.outputPath('connector-check-pending.png'),
    animations: 'disabled',
  });
  complete();
  const setup = card.getByRole('button', { name: 'Настроить подключение', exact: true });
  await expect(setup).toBeEnabled();
  await expect(setup).toBeFocused();
  await expect(retry).toHaveCount(0);
  await expect(card.getByText('Не подключён', { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

for (const theme of ['light', 'dark'] as const) {
  test(`connector groups have responsive cards and one primary action (${theme})`, async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'desktop')
      await page.setViewportSize({ width: 1600, height: 900 });
    await page.route('**/api/github?**', (route) =>
      route.fulfill({ json: { available: true, connected: false } }),
    );
    await page.route('**/api/google-calendar?**', (route) =>
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
            backups: 'Резервные копии',
            calendar: 'Календарь',
            setup: 'Настроить подключение',
          }
        : {
            menu: 'Menu',
            connections: 'Connections',
            backups: 'Backups',
            calendar: 'Calendar',
            setup: 'Set up connection',
          };
    await page.getByRole('button', { name: labels.menu, exact: true }).click();
    await page.getByRole('menuitem', { name: labels.connections, exact: true }).click();
    const screen = page.getByRole('region', { name: labels.connections, exact: true });
    await expect(screen.getByRole('textbox')).toHaveCount(0);
    await expect(screen.locator('[aria-pressed]')).toHaveCount(0);
    const backups = screen.getByRole('list', { name: labels.backups, exact: true });
    const calendar = screen.getByRole('list', { name: labels.calendar, exact: true });
    await expect(backups.getByRole('listitem')).toHaveCount(2);
    await expect(backups.getByRole('heading')).toHaveText(['Google Drive', 'GitHub']);
    await expect(calendar.getByRole('heading')).toHaveText(['Google Calendar']);
    const cards = screen.getByRole('listitem');
    for (const card of await cards.all()) {
      const action = card.getByRole('button', { name: labels.setup, exact: true });
      await expect(action).toBeEnabled();
      await expect(card.getByRole('button')).toHaveCount(1);
      await expect(action).toHaveAttribute('data-variant', 'default');
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await card.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
        (await card.boundingBox())!.width,
      );
    }
    const first = (await backups.getByRole('listitem').nth(0).boundingBox())!;
    const second = (await backups.getByRole('listitem').nth(1).boundingBox())!;
    const calendarCard = (await calendar.getByRole('listitem').boundingBox())!;
    if (testInfo.project.name === 'mobile') {
      expect(second.y).toBeGreaterThan(first.y + first.height);
    } else {
      expect(second.y).toBe(first.y);
      expect(second.x).toBeGreaterThan(first.x + first.width);
      expect(
        (await screen.locator('.connections-content').boundingBox())!.width,
      ).toBeLessThanOrEqual(1000);
    }
    expect(calendarCard.width).toBeCloseTo(first.width, 0);
    expect(calendarCard.y).toBeGreaterThan(second.y + second.height);
    expect(await screen.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    const setup = backups
      .getByRole('listitem')
      .nth(1)
      .getByRole('button', { name: labels.setup, exact: true });
    await setup.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(setup).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`connector-groups-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
}
