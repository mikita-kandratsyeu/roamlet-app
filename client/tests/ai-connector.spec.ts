import { expect, test } from '@playwright/test';
const baseUrl = 'https://ai.example/v1';
const geometry = [
  [30, 52, 100],
  [30.005, 52.005, 120],
  [30.01, 52.01, 110],
];
const fixture = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: geometry },
      properties: { summary: { distance: 1342, duration: 480 } },
    },
  ],
};
test.beforeEach(async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem('roamlet-language', 'en'));
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
  await page.route('**/api/route', (route) => route.fulfill({ json: fixture }));
  await page.route('**/api/google-drive?**', (route) =>
    route.fulfill({ json: { available: false, connected: false } }),
  );
  await page.route('**/api/github?**', (route) =>
    route.fulfill({ json: { available: false, connected: false } }),
  );
});
test('connects with a personal key, discloses data and applies only confirmed settings', async ({
  page,
}, testInfo) => {
  let connected = false;
  let suggestions = 0;
  let routings = 0;
  await page.route('**/api/route', (route) => {
    routings++;
    return route.fulfill({ json: fixture });
  });
  await page.route('**/api/ai?**', async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'session')
      return route.fulfill({
        json: {
          available: true,
          connected,
          providers: [baseUrl],
          ...(connected ? { connection: { baseUrl, model: 'example' } } : {}),
        },
      });
    if (action === 'connect') {
      expect(route.request().postDataJSON()).toEqual({
        baseUrl,
        model: 'example',
        apiKey: 'synthetic-ai-key',
      });
      connected = true;
      return route.fulfill({ json: { connected: true } });
    }
    if (action === 'propose') {
      suggestions++;
      expect(route.request().postDataJSON()).toEqual({
        prompt: 'Avoid ferries and steps',
        context: {
          activity: 'cycling',
          routingOptions: {
            cyclingProfile: 'cycling-regular',
            avoidFerries: false,
            avoidSteps: false,
          },
        },
      });
      return route.fulfill({
        json: {
          routingOptions: { avoidSteps: true, avoidFerries: true },
          explanation: 'Prefer routes without ferries or steps.',
        },
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  for (const point of ['52, 30', '52.01, 30.01']) {
    await page.getByRole('textbox', { name: 'Latitude', exact: true }).fill(point);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Save route', exact: true })).toBeEnabled();
  expect(routings).toBe(1);
  await page.getByRole('button', { name: 'AI route assistant', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'AI route assistant', exact: true });
  await assistant.getByRole('button', { name: 'Set up connection' }).click();
  const settings = page.getByRole('dialog', { name: 'AI connection settings', exact: true });
  const costNotice = settings.locator('[data-slot="alert-description"]');
  await expect(costNotice).toBeInViewport();
  expect((await costNotice.boundingBox())!.width).toBeGreaterThan(100);
  await settings.getByRole('textbox', { name: 'Model ID' }).fill('example');
  await settings.getByLabel('API key', { exact: true }).fill('synthetic-ai-key');
  await expect(settings.getByLabel('API key', { exact: true })).toHaveAttribute('type', 'password');
  await settings.getByRole('button', { name: 'Verify and connect (uses API quota)' }).click();
  await expect(settings.getByRole('button', { name: 'Change AI connection' })).toBeVisible();
  await settings.getByRole('button', { name: 'Close dialog', exact: true }).last().click();
  await assistant.getByRole('button', { name: 'Avoid ferries and steps', exact: true }).click();
  await expect(assistant.getByText('What will be sent', { exact: true })).toBeVisible();
  await assistant.getByRole('button', { name: 'Get suggestion (uses API quota)' }).click();
  await expect(assistant.getByRole('heading', { name: 'Suggested changes' })).toBeFocused();
  expect(suggestions).toBe(1);
  expect(routings).toBe(1);
  await expect(assistant.getByRole('button', { name: 'Apply and recalculate' })).toBeInViewport();
  const box = await assistant.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({ path: testInfo.outputPath('ai-proposal.png'), animations: 'disabled' });
  await assistant.getByRole('button', { name: 'Apply and recalculate' }).click();
  await expect(assistant).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Avoid steps', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Avoid ferries', exact: true })).toBeChecked();
  expect(routings).toBe(2);
  const stored = await page.evaluate(() => Object.values(localStorage).join(' '));
  expect(stored).not.toContain('synthetic-ai-key');
});
test('shows the AI connector in Russian dark mode and keeps setup usable', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('roamlet-language', 'ru');
    localStorage.setItem('roamlet-theme', 'dark');
  });
  await page.route('**/api/ai?**', (route) =>
    route.fulfill({ json: { available: true, connected: false, providers: [baseUrl] } }),
  );
  await page.goto('/');
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Подключения', exact: true }).click();
  const card = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'ИИ-помощник маршрута' }) });
  await card.getByRole('button', { name: 'Настроить подключение' }).click();
  const settings = page.getByRole('dialog', { name: 'Настройки ИИ-подключения' });
  await expect(
    settings.getByRole('button', { name: 'Проверить и подключить (расходует API-квоту)' }),
  ).toBeDisabled();
  await settings.getByRole('button', { name: 'ИИ-провайдер' }).click();
  await expect(page.getByRole('menuitemradio', { name: baseUrl })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(
    settings.getByRole('button', { name: 'Закрыть диалог', exact: true }).last(),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath('ai-setup-ru-dark.png'),
    animations: 'disabled',
  });
});
