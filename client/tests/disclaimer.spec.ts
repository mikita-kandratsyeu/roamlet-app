import { test, expect } from '@playwright/test';

const key = 'roamlet:disclaimer:v1';
const warning =
  'Your acknowledgement could not be saved. You can keep planning now, but this notice will appear again next time.';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
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
});

for (const language of ['en', 'ru']) {
  for (const theme of ['light', 'dark']) {
    test(`${language} ${theme}: mandatory, accessible and remembered`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(
        ({ language, theme }) => {
          localStorage.setItem('roamlet-language', language);
          localStorage.setItem('roamlet-theme', theme);
        },
        { language, theme },
      );
      await page.goto('/');
      const title = language === 'en' ? 'Before you plan' : 'Перед планированием';
      const label = language === 'en' ? 'Understood' : 'Понятно';
      const dialog = page.getByRole('dialog', { name: title });
      const confirm = dialog.getByRole('button', { name: label });
      await expect(dialog).toBeVisible();
      await expect(confirm).toBeFocused();
      await expect(dialog.getByRole('button')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await page.mouse.click(2, 2);
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(confirm).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(confirm).toBeFocused();
      const bounds = await dialog.boundingBox();
      const buttonBounds = await confirm.boundingBox();
      const viewport = page.viewportSize()!;
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      expect(buttonBounds!.height).toBeGreaterThanOrEqual(44);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(await page.locator('html').evaluate((element) => element.style.colorScheme)).toBe(
        theme,
      );
      await page.screenshot({ path: testInfo.outputPath(`disclaimer-${language}-${theme}.png`) });
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe('acknowledged');
      await page.reload();
      await expect(
        page.getByRole('button', { name: language === 'en' ? 'Menu' : 'Меню', exact: true }),
      ).toBeVisible();
      await expect(dialog).toHaveCount(0);
      await page.evaluate((key) => localStorage.removeItem(key), key);
      await page.reload();
      await expect(dialog).toBeVisible();
    });
  }
}

test('failed storage does not trap the current opening', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('Unavailable');
    };
    Storage.prototype.setItem = () => {
      throw new Error('Unavailable');
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Understood' }).click();
  await expect(page.getByText(warning)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Before you plan' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Before you plan' })).toBeVisible();
});

test('the disclaimer precedes draft recovery and language switching still works', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Understood' }).click();
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'draft.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><trk><trkseg><trkpt lat="47.26" lon="11.4"/><trkpt lat="47.27" lon="11.41"/></trkseg></trk></gpx>',
    ),
  });
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const databases = await indexedDB.databases();
        for (const database of databases) {
          if (!database.name) continue;
          const found = await new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open(database.name!);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              if (!db.objectStoreNames.contains('drafts')) {
                db.close();
                resolve(false);
                return;
              }
              const read = db.transaction('drafts').objectStore('drafts').get('current');
              read.onsuccess = () => {
                resolve(!!read.result);
                db.close();
              };
              read.onerror = () => {
                reject(read.error);
                db.close();
              };
            };
          });
          if (found) return true;
        }
        return false;
      }),
    )
    .toBe(true);
  await page.evaluate((key) => localStorage.removeItem(key), key);
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Before you plan' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Restore your draft?' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Understood' }).click();
  const restore = page.getByRole('button', { name: 'Restore draft' });
  await expect(restore).toBeFocused();
  await restore.click();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Русский' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Перед планированием' })).toHaveCount(0);
});
