import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit, devices } from '@playwright/test';

const css = (
  await Promise.all(
    ['../styles.css', '../planner.css', './RouteSchedule.css'].map((path) =>
      readFile(new URL(path, import.meta.url), 'utf8'),
    ),
  )
)
  .join('\n')
  .replaceAll(/@import[^;]+;/g, '');

for (const [browserType, device] of [
  [chromium, devices['Desktop Chrome']],
  [chromium, devices['Pixel 7']],
  [webkit, devices['iPhone 13']],
]) {
  test(`native departure input fits narrow fields and remains editable on ${device.defaultBrowserType}, mobile=${device.isMobile}`, async () => {
    const browser = await browserType.launch({ headless: true });
    try {
      const context = await browser.newContext(device);
      const page = await context.newPage();
      for (const language of ['en', 'ru']) {
        for (const theme of ['', 'dark']) {
          for (const width of [230, 288, 320]) {
            for (const value of ['', '2026-11-02T16:23', '9999-12-31T23:59']) {
              await page.setContent(`<style>${css}
                input { padding: 4px 12px; border: 1px solid; border-radius: 6px; }
              </style><div class="${theme}" lang="${language}">
                <section class="route-schedule" style="width: ${width}px">
                  <div class="route-schedule-departure personal-time-field">
                    <label for="departure">${
                      language === 'ru'
                        ? 'Местные дата и время отправления'
                        : 'Local departure date and time'
                    }</label>
                    <input id="departure" type="datetime-local" value="${value}"
                      min="0001-01-01T00:00" max="9999-12-31T23:59" step="60">
                  </div>
                </section>
              </div>`);
              const metrics = await page.locator('#departure').evaluate((input) => {
                const bounds = input.getBoundingClientRect();
                const field = input.parentElement.getBoundingClientRect();
                return {
                  width: bounds.width,
                  height: bounds.height,
                  left: bounds.left - field.left,
                  right: field.right - bounds.right,
                  fieldWidth: field.width,
                  overflow: input.scrollWidth > input.clientWidth,
                  fontSize: parseFloat(getComputedStyle(input).fontSize),
                  touch: matchMedia('(pointer: coarse)').matches,
                };
              });
              const description = `${device.defaultBrowserType}, ${language}, ${theme}, ${width}px, ${value}`;
              assert.ok(Math.abs(metrics.fieldWidth - width) < 0.5, description);
              assert.ok(Math.abs(metrics.width - width) < 0.5, description);
              assert.ok(metrics.left >= -0.5 && metrics.right >= -0.5, description);
              assert.ok(metrics.height >= 44, description);
              assert.equal(metrics.overflow, false, `date editor overflow: ${description}`);
              if (metrics.touch)
                assert.ok(metrics.fontSize >= 16, `avoid mobile focus zoom: ${description}`);
              await page.locator('#departure').fill('2026-11-03T08:15');
              await page.locator('#departure').press('Tab');
              assert.equal(await page.locator('#departure').inputValue(), '2026-11-03T08:15');
            }
          }
        }
      }
      await context.close();
    } finally {
      await browser.close();
    }
  });
}
