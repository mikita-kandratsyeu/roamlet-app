import { test, expect, type Page } from '@playwright/test';
import { clickMapTool } from './mapControls';
import { readFile } from 'node:fs/promises';

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
    await expect.poll(async () => {
      await page.mouse.move(start.x + 1, start.y);
      await page.mouse.move(start.x, start.y);
      return canvas.evaluate((element) => element.style.cursor);
    }).toBe('grab');
    if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchStart',
      touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
    else await page.mouse.down();
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

test('map navigation stays flat, stops panning on release and does not add gesture points', async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const camera = { center: [28, 53.5], zoom: 10, bearing: 25, pitch: 50 };
    localStorage.setItem('roamlet:map-view:v1', JSON.stringify(camera));
    const record = JSON.parse(localStorage.getItem('roamlet:preferences:v1') || 'null');
    if (record) localStorage.setItem('roamlet:preferences:v1', JSON.stringify({ ...record,
      preferences: { ...record.preferences, camera } }));
  });
  await page.reload();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await clickMapTool(page, 'Приблизить');
  const camera = () => page.evaluate(() => JSON.parse(localStorage.getItem('roamlet:map-view:v1')!));
  await expect.poll(async () => (await camera()).pitch).toBe(0);
  expect((await camera()).bearing).toBe(25);
  await clickMapTool(page, 'Ручное рисование');
  const canvas = page.locator('.maplibregl-canvas');
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.15);
  const markers = page.locator('.waypoint-marker');
  await expect(markers).toHaveCount(1);
  const x = bounds.x + bounds.width * 0.65, y = bounds.y + bounds.height * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 70, y - 45, { steps: 5 });
  await page.mouse.up();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const released = (await markers.first().boundingBox())!;
  await page.waitForTimeout(400);
  const settled = (await markers.first().boundingBox())!;
  expect(Math.hypot(settled.x - released.x, settled.y - released.y)).toBeLessThan(1.5);
  await expect(markers).toHaveCount(1);
  const zoom = (await camera()).zoom;
  await page.mouse.dblclick(x, y);
  await expect(markers).toHaveCount(2);
  expect((await camera()).zoom).toBe(zoom);
  await canvas.focus();
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await camera()).bearing).not.toBe(25);
  expect((await camera()).pitch).toBe(0);
  if (isMobile) {
    const touch = await page.context().newCDPSession(page);
    const zoomBefore = (await camera()).zoom;
    const centerX = bounds.x + bounds.width * 0.5;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
      { x: centerX - 35, y, id: 1 }, { x: centerX + 35, y, id: 2 },
    ] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { x: centerX - 35, y: y + 45, id: 1 }, { x: centerX + 35, y: y + 45, id: 2 },
    ] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { x: centerX - 75, y: y + 45, id: 1 }, { x: centerX + 75, y: y + 45, id: 2 },
    ] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await camera()).zoom).toBeGreaterThan(zoomBefore);
    expect((await camera()).pitch).toBe(0);
    await expect(markers).toHaveCount(2);
    await touch.detach();
  }
});

test('moving an existing waypoint previews its adjacent line before release', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await clickMapTool(page, 'Ручное рисование');
  const canvas = page.locator('.maplibregl-canvas');
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.15);
  await page.mouse.click(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.23);
  const markers = page.locator('.waypoint-marker');
  await expect(markers).toHaveCount(2);
  const original = (await markers.first().boundingBox())!;
  const start = { x: original.x + original.width / 2, y: original.y + original.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 45, { steps: 8 });
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  await expect(page.locator('.map-hint')).toContainText('Предпросмотр прямыми линиями');
  await expect(markers).toHaveCount(2);
  const dragged = (await markers.first().boundingBox())!;
  expect(Math.abs(dragged.x + dragged.width / 2 - start.x)).toBeLessThan(1.5);
  expect(Math.abs(dragged.y + dragged.height / 2 - start.y - 45)).toBeLessThan(1.5);
  await page.screenshot({ path: info.outputPath('waypoint-move-preview.png') });
  await page.mouse.up();
  await expect(page.getByText('Предпросмотр прямыми линиями', { exact: false })).toHaveCount(0);
  await expect(markers).toHaveCount(2);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.abs((await markers.first().boundingBox())!.y - original.y)).toBeLessThan(1);
});

test('a section detour stays local until Done and keeps the other section automatically routed', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requests: number[][][] = [];
  await page.route('**/api/route', (route) => {
    const coordinates = route.request().postDataJSON().coordinates as number[][];
    requests.push(coordinates);
    return route.fulfill({ json: { type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'LineString', coordinates: coordinates.map((point, index) => [...point, 100 + index * 20]) },
      properties: { summary: { distance: 1000, duration: 300 } },
    }] } });
  });
  await plan(page);
  await addPoint(page, '52.02, 30.02');
  await expect(page.getByRole('button', { name: 'Сохранить маршрут', exact: true })).toBeEnabled();
  const before = requests.length;
  await clickMapTool(page, 'Показать весь маршрут');
  let starts = 0;
  const start = async () => {
    const positions = await Promise.all([0, 1].map((index) => page.locator('.waypoint-marker').nth(index).boundingBox()));
    await page.getByRole('button', { name: 'Режим участка 1', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Нарисовать обход', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Нарисовать обход', exact: true })).toBeVisible();
    await expect(page.locator('.waypoint-marker')).toHaveCount(2);
    const fitted = await Promise.all([0, 1].map((index) => page.locator('.waypoint-marker').nth(index).boundingBox()));
    const canvas = (await page.locator('.maplibregl-canvas').boundingBox())!;
    const toolbar = (await page.getByRole('group', { name: 'Нарисовать обход', exact: true }).boundingBox())!;
    for (const marker of fitted) {
      expect(marker!.x).toBeGreaterThan(canvas.x + 12);
      expect(marker!.x + marker!.width).toBeLessThan(canvas.x + canvas.width - 12);
      expect(marker!.y).toBeGreaterThan(canvas.y + 12);
      expect(marker!.y + marker!.height).toBeLessThan(toolbar.y - 12);
    }
    if (starts++ === 0) {
      const distance = (boxes: typeof positions) => Math.hypot(boxes[1]!.x - boxes[0]!.x, boxes[1]!.y - boxes[0]!.y);
      expect(distance(fitted)).toBeGreaterThan(distance(positions) + 10);
    }
  };
  const addDetour = async () => {
    const markers = page.locator('.waypoint-marker');
    await expect(markers).toHaveCount(2);
    const a = (await markers.nth(0).boundingBox())!, b = (await markers.nth(1).boundingBox())!;
    await page.mouse.click((a.x + a.width / 2 + b.x + b.width / 2) / 2 + 45,
      (a.y + a.height / 2 + b.y + b.height / 2) / 2);
    await expect(markers).toHaveCount(3);
  };
  await start();
  await expect(page.getByRole('button', { name: 'Готово', exact: true })).toBeDisabled();
  await addDetour();
  expect(requests).toHaveLength(before);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Режим участка 1', exact: true })).toHaveText(/По дорогам/);
  expect(requests).toHaveLength(before);
  await start();
  await addDetour();
  const toolbar = page.getByRole('group', { name: 'Нарисовать обход', exact: true });
  const bounds = (await toolbar.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: info.outputPath('manual-detour.png') });
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить маршрут', exact: true })).toBeEnabled();
  expect(requests.at(-1)).toEqual([[30.01, 52.01], [30.02, 52.02]]);
  await expect(page.getByRole('button', { name: 'Режим участка 1', exact: true })).toHaveText(/Прямая линия/);
  await expect(page.getByRole('button', { name: 'Режим участка 3', exact: true })).toHaveText(/По дорогам/);
  const moreStatistics = page.getByText('Подробная статистика', { exact: true });
  if (await moreStatistics.count()) await moreStatistics.click();
  const gain = page.getByText('Набор высоты (на участках с высотами)', { exact: true });
  await expect(gain).toBeVisible();
  await expect(gain.locator('..')).toContainText('20 м');
  await expect(page.getByText('Профиль высот', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Другие инструменты карты', exact: true }).click();
  const slopeToggle = page.getByRole('button', { name: 'Окрасить маршрут по уклону', exact: true });
  await expect(slopeToggle).toBeEnabled();
  await slopeToggle.click();
  await expect(page.getByText('Окрашены только участки с известными высотами. Отсутствующие высоты не вычисляются.', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Управление картой', exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать GPX', exact: true }).click();
  const downloadedPath = await (await downloadPromise).path();
  expect(downloadedPath).not.toBeNull();
  const gpx = await readFile(downloadedPath!, 'utf8');
  expect(gpx.match(/<ele>/g)).toHaveLength(2);
  expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
  await expect(page.getByRole('dialog', { name: 'Экспорт маршрута', exact: true })).toHaveCount(0);
  await clickMapTool(page, 'Отменить');
  await expect(page.getByRole('button', { name: 'Режим участка 3', exact: true })).toHaveCount(0);
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
  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute('data-type', 'loading');
  await expect(toast).toContainText('Расчёт маршрута…');
  const note = page.locator('.planner-route-status');
  await expect(note.locator('.spin')).toHaveCount(0);
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
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute('data-type', 'success');
  await expect(toast).toContainText('Маршрут рассчитан.');
  await expect(note).toHaveCount(1);
  await expect(note).toHaveAttribute('role', 'status');
  await expect(note).toContainText('Несохранённые изменения');
  await expect(note).not.toHaveClass(/is-calculating|is-stale|is-error/);
  await expect(elevationProfile).not.toHaveAttribute('open');
});

test('routing errors appear only in Sonner while planner keeps persistent stale context', async ({ page }, testInfo) => {
  await plan(page);
  await page.route('**/api/route', (route) =>
    route.fulfill({ status: 429, json: { error: { message: 'quota' } } }),
  );
  await addPoint(page, '52.02, 30.02');
  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute('data-type', 'error');
  const note = page.locator('.planner-route-status');
  await expect(note).toHaveAttribute('role', 'status');
  await expect(note).toHaveClass(/is-stale/);
  await expect(note).toContainText('Показан предыдущий маршрут');
  await expect(note.locator('button')).toHaveCount(0);
  const error = await toast.locator('[data-description]').innerText();
  await expect(page.locator('.planner')).not.toContainText(error);
  const titleBox = (await toast.locator('[data-title]').boundingBox())!;
  const descriptionBox = (await toast.locator('[data-description]').boundingBox())!;
  const retry = toast.getByRole('button', { name: 'Повторить расчёт', exact: true });
  const retryBox = (await retry.boundingBox())!;
  expect(descriptionBox.width).toBeGreaterThan(180);
  expect(retryBox.y).toBeGreaterThanOrEqual(descriptionBox.y + descriptionBox.height);
  expect(retryBox.x).toBeCloseTo(titleBox.x, 0);
  expect(retryBox.height).toBeGreaterThanOrEqual(44);
  await toast.screenshot({ path: testInfo.outputPath('routing-error-compact.png') });
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeDisabled();
  await toast.getByRole('button', { name: 'Закрыть уведомление', exact: true }).click();
  await expect(toast).toHaveCount(0);
  await expect(note).toContainText('Показан предыдущий маршрут');
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Обновить маршрут', exact: true }).click();
  await expect(toast).toHaveAttribute('data-type', 'error');
  await page.route('**/api/route', (route) => route.fulfill({ json: fixture }));
  await toast.getByRole('button', { name: 'Повторить расчёт', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeEnabled();
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute('data-type', 'success');
  await expect(note).not.toHaveClass(/is-stale/);
});