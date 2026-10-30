import { test, expect, type Page } from '@playwright/test';
import { clickMapTool } from './mapControls';

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
  await expect(page.getByRole('button', { name: 'Моё местоположение', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
});

test('dragging a route line previews locally and creates one undoable waypoint on release', async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const directions: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/route') directions.push(request.url());
  });
  await clickMapTool(page, 'Ручное рисование');
  const canvas = page.locator('.maplibregl-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.65, box.y + box.height * 0.15);
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.23);
  const markers = page.locator('.waypoint-marker');
  await expect(markers).toHaveCount(2);
  const a = (await markers.nth(0).boundingBox())!;
  const b = (await markers.nth(1).boundingBox())!;
  const start = { x: (a.x + a.width / 2 + b.x + b.width / 2) / 2,
    y: (a.y + a.height / 2 + b.y + b.height / 2) / 2 };
  const touch = isMobile ? await page.context().newCDPSession(page) : null;
  const down = async () => {
    if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchStart',
      touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
    else {
      await page.mouse.move(start.x, start.y);
      await expect(canvas).toHaveCSS('cursor', 'grab');
      await page.mouse.down();
    }
  };
  const move = async () => {
    if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove',
      touchPoints: [{ x: start.x, y: start.y + 45, id: 1 }] });
    else await page.mouse.move(start.x, start.y + 45, { steps: 8 });
  };
  const up = async () => {
    if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
  };
  await down();
  await move();
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  await expect(markers).toHaveCount(2);
  await up();
  await expect(markers).toHaveCount(3);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect(markers).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect(markers).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(markers).toHaveCount(2);
  await down();
  await move();
  await page.keyboard.press('Escape');
  await up();
  await expect(markers).toHaveCount(2);
  expect(directions).toEqual([]);
  expect(errors).toEqual([]);
  await touch?.detach();
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
  await page.locator('.personal-time-section > summary').click();
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
    path: info.outputPath('routing-ui.png'),
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
  const note = page.locator('.planner-route-status');
  const description = note.locator('.planner-route-status-copy p');
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
  await expect(note).toHaveCount(1);
  await expect(note).toHaveAttribute('role', 'status');
  await expect(note).toContainText('Несохранённые изменения');
  await expect(note).not.toHaveClass(/is-calculating|is-stale|is-error/);
  await expect(elevationProfile).not.toHaveAttribute('open');
});

test('routing errors keep text, recovery actions and dismissal separate', async ({ page }) => {
  await plan(page);
  await page.route('**/api/route', (route) =>
    route.fulfill({ status: 429, json: { error: { message: 'quota' } } }),
  );
  await addPoint(page, '52.02, 30.02');
  const notice = page.locator('.planner-route-status.is-error');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('role', 'alert');
  const description = (await notice.locator('.planner-route-status-copy').boundingBox())!;
  const card = (await notice.boundingBox())!;
  expect(description.width).toBeGreaterThan(200);
  expect(description.y).toBeGreaterThanOrEqual(card.y);
  const buttons = notice.locator('.planner-route-status-actions button');
  await expect(buttons).toHaveCount(4);
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
  await expect(page.locator('.planner-route-status')).toHaveAttribute('role', 'status');
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeDisabled();
});
