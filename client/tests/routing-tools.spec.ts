import { test, expect, type Page } from '@playwright/test';

const points = [[30, 52, 100], [30.005, 52.005, 120], [30.01, 52.01, 110]];
const fixture = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: points },
    properties: { summary: { distance: 1342, duration: 480 } },
  }],
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
  await page.route('**/__fixtures__/map-style.json', (route) => route.fulfill({ json: {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8efe7' } }],
  } }));
  await page.route('https://api.heigit.org/openrouteservice/**', (route) => route.abort());
  await page.route('https://api.heigit.org/openrouteservice/v2/directions/*/geojson', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ elevation: true, instructions: false });
    return route.fulfill({ json: fixture });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Приблизить', exact: true })).toBeEnabled();
});

test('planner choices share translated accessible menus and remain inside the viewport', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('checkbox', { name: 'Избегать лестниц' })).toBeVisible();
  await expect(page.getByText('Avoid steps', { exact: true })).toHaveCount(0);
  const profile = page.getByRole('button', { name: 'Велосипедный профиль', exact: true });
  await profile.press('ArrowDown');
  const menu = page.getByRole('menu');
  await expect(menu).toHaveClass(/planner-choice-menu/);
  await expect(page.getByRole('menuitemradio', { name: 'Обычный велосипед', exact: true })).toHaveAttribute('aria-checked', 'true');
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect((await profile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  await expect(profile).toBeFocused();
  await profile.click();
  await page.getByRole('menuitemradio', { name: 'Шоссейный велосипед', exact: true }).click();
  await expect(profile).toHaveText(/Шоссейный велосипед/);
  await plan(page);
  const section = page.getByRole('button', { name: 'Режим участка 1', exact: true });
  await section.click();
  await expect(page.getByRole('menu')).toHaveClass(/planner-choice-menu/);
  await page.getByRole('menuitemradio', { name: 'Прямая линия — без проверки', exact: true }).click();
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
  await page.screenshot({ path: `/Users/Mikita_Kandratsyeu1/.copilot/session-state/39c6be71-a7dc-4e0f-a0f5-e2fac6eb8700/files/routing-ui-${info.project.name}.png` });
});

test('recalculation notice has readable width and disabled alternatives explain their prerequisites', async ({ page }) => {
  await plan(page);
  let release!: () => void;
  let received!: () => void;
  const started = new Promise<void>((resolve) => { received = resolve; });
  await page.route('https://api.heigit.org/openrouteservice/v2/directions/*/geojson', async (route) => {
    received();
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: fixture });
  });
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
});
