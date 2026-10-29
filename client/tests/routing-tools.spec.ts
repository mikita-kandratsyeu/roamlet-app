import { test, expect, type Page } from '@playwright/test';

const points = [
  [30, 52, 100],
  [30.005, 52.005, 120],
  [30.01, 52.01, 110],
];
const fixture = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: points },
      properties: { summary: { distance: 1342, duration: 480 } },
    },
  ],
};
async function addPoint(page: Page, value: string) {
  await page.getByRole('textbox', { name: 'Широта', exact: true }).fill(value);
  await page.getByRole('button', { name: 'Добавить координаты', exact: true }).click();
}
async function plan(page: Page) {
  await addPoint(page, '52, 30');
  await addPoint(page, '52.01, 30.01');
  await expect(page.getByRole('button', { name: 'Сохранить маршрут', exact: true })).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('roamlet-language', 'ru'));
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
  await page.route('https://api.heigit.org/openrouteservice/**', (route) => route.abort());
  await page.route('**/api/route', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ elevation: true, instructions: false });
    return route.fulfill({ json: fixture });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Приблизить', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
});

test('planner choices share translated accessible menus and remain inside the viewport', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('checkbox', { name: 'Избегать лестниц' })).toBeVisible();
  await expect(page.getByText('Avoid steps', { exact: true })).toHaveCount(0);
  const profile = page.getByRole('button', { name: 'Велосипедный профиль', exact: true });
  expect((await profile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(profile).toHaveCSS('font-size', '14px');
  for (const button of await page
    .locator('.coordinate-add, .add-stop, .calculate-action > button')
    .all())
    await expect(button).toHaveCSS('font-size', '14px');
  await profile.press('ArrowDown');
  const menu = page.getByRole('menu');
  await expect(menu).toHaveClass(/planner-choice-menu/);
  await expect(
    page.getByRole('menuitemradio', { name: 'Обычный велосипед', exact: true }),
  ).toHaveCSS('font-size', '14px');
  await expect(
    page.getByRole('menuitemradio', { name: 'Обычный велосипед', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press('Escape');
  await expect(profile).toBeFocused();
  await profile.click();
  await page.getByRole('menuitemradio', { name: 'Шоссейный велосипед', exact: true }).click();
  await expect(profile).toHaveText(/Шоссейный велосипед/);
  await plan(page);
  const profileDetails = page.locator('.elevation-box');
  if ((await profileDetails.getAttribute('open')) === null)
    await profileDetails.locator('summary').click();
  const elevationPosition = page.getByRole('slider', {
    name: 'Положение на профиле высот',
    exact: true,
  });
  await elevationPosition.focus();
  await elevationPosition.press('ArrowRight');
  await expect(page.locator('.recharts-cartesian-axis-tick-value').first()).toHaveCSS(
    'font-size',
    '12px',
  );
  await expect(page.locator('.map-annotation-status')).toHaveCount(0);
  await expect(page.getByText('Точка профиля высот', { exact: true })).toHaveCount(0);
  const section = page.getByRole('button', { name: 'Режим участка 1', exact: true });
  await section.click();
  await expect(page.getByRole('menu')).toHaveClass(/planner-choice-menu/);
  await page
    .getByRole('menuitemradio', { name: 'Прямая линия — без проверки', exact: true })
    .click();
  await expect(section).toHaveText(/Прямая линия — без проверки/);
  const alternatives = page.getByRole('button', { name: 'Найти альтернативы', exact: true });
  await expect(alternatives).toBeDisabled();
  await expect(page.locator('#point-alternatives-help')).toHaveText(/переключите участок/);
  const surface = page.getByRole('button', { name: 'Покрытие', exact: true });
  await surface.click();
  await expect(page.getByRole('menu')).toHaveClass(/planner-choice-menu/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Тёмная', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await profile.click();
  const colors = await page.getByRole('menu').evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.color, style.backgroundColor];
  });
  expect(colors[0]).not.toBe(colors[1]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.planner')).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `/Users/Mikita_Kandratsyeu1/.copilot/session-state/39c6be71-a7dc-4e0f-a0f5-e2fac6eb8700/files/routing-ui-${info.project.name}.png`,
  });
});

test('recalculation notice has readable width and disabled alternatives explain their prerequisites', async ({
  page,
}) => {
  await plan(page);
  const elevationProfile = page.locator('.elevation-box');
  if ((await elevationProfile.getAttribute('open')) === null)
    await elevationProfile.locator('summary').click();
  await elevationProfile.locator('summary').click();
  await expect(elevationProfile).not.toHaveAttribute('open');
  let release!: () => void;
  let received!: () => void;
  const started = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route(
    '**/api/route',
    async (route) => {
      received();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ json: fixture });
    },
  );
  await addPoint(page, '52.02, 30.02');
  await started;
  const note = page.locator('.stale-route-note');
  const description = note.locator('[data-slot="alert-description"]');
  await expect(description).toContainText('Во время пересчёта показан предыдущий маршрут');
  const bounds = (await description.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(180);
  expect(bounds.height).toBeLessThan(130);
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeDisabled();
  await expect(page.locator('#point-alternatives-help')).toBeVisible();
  await expect(page.locator('#point-alternatives-help')).toContainText('ровно с двумя точками');
  const primary = (await page.locator('.calculate-action > button').first().boundingBox())!;
  const alternatives = (await page.locator('.find-alternatives').boundingBox())!;
  expect(alternatives.width).toBeCloseTo(primary.width, 0);
  expect(alternatives.y - (primary.y + primary.height)).toBeGreaterThanOrEqual(7);
  release();
  await expect(page.getByRole('button', { name: 'Сохранить маршрут', exact: true })).toBeEnabled();
  await expect(note).toHaveCount(0);
  await expect(elevationProfile).not.toHaveAttribute('open');
});

test('routing errors keep text, recovery actions and dismissal separate', async ({ page }) => {
  await plan(page);
  await page.route('**/api/route', (route) =>
    route.fulfill({ status: 429, json: { error: { message: 'quota' } } }),
  );
  await addPoint(page, '52.02, 30.02');
  const notice = page.locator('.planner-notice.error');
  await expect(notice).toBeVisible();
  const description = (await notice.locator('.planner-notice-description').boundingBox())!;
  const heading = (await notice.locator('.planner-notice-heading').boundingBox())!;
  expect(description.width).toBeGreaterThan(200);
  expect(description.y).toBeGreaterThanOrEqual(heading.y + heading.height);
  const card = (await notice.boundingBox())!;
  const buttons = notice.locator('.planner-notice-actions button');
  await expect(buttons).toHaveCount(3);
  const bounds = await buttons.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );
  for (const button of bounds) {
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.y).toBeGreaterThanOrEqual(description.y + description.height);
    expect(button.x).toBeGreaterThanOrEqual(card.x);
    expect(button.x + button.width).toBeLessThanOrEqual(card.x + card.width);
  }
  for (let first = 0; first < bounds.length; first++) {
    for (let next = first + 1; next < bounds.length; next++) {
      const a = bounds[first],
        b = bounds[next];
      expect(
        a.y + a.height <= b.y + 1 ||
          b.y + b.height <= a.y + 1 ||
          a.x + a.width <= b.x + 1 ||
          b.x + b.width <= a.x + 1,
      ).toBe(true);
    }
  }
  await expect(page.locator('.map-annotation-status')).toHaveCount(0);
  await notice.getByRole('button', { name: 'Закрыть уведомление', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeDisabled();
});
