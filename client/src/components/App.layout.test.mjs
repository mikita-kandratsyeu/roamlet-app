import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const css = (
  await Promise.all(
    ['../styles.css', '../planner.css', './Library.css', './ComparisonScreen.css'].map((path) =>
      readFile(new URL(path, import.meta.url), 'utf8'),
    ),
  )
)
  .join('\n')
  .replaceAll(/@import[^;]+;/g, '');

test('unsaved badge stays compact in both languages and themes on narrow and desktop layouts', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['', 'dark']) {
        for (const label of ['Not saved', 'Не сохранено']) {
          await page.setContent(`<style>${css}</style>
            <div class="${theme}">
              <div class="planner-route-status" style="width: 250px">
                <span class="planner-unsaved-badge" data-slot="badge">
                  <span class="planner-unsaved-dot" aria-hidden="true"></span>${label}
                </span>
              </div>
            </div>`);
          const metrics = await page.locator('.planner-unsaved-badge').evaluate((badge) => {
            const rect = badge.getBoundingClientRect();
            const style = getComputedStyle(badge);
            const dot = badge.querySelector('.planner-unsaved-dot').getBoundingClientRect();
            return {
              width: rect.width,
              height: rect.height,
              background: style.backgroundColor,
              color: style.color,
              dotWidth: dot.width,
              dotHeight: dot.height,
              scrollWidth: document.documentElement.scrollWidth,
            };
          });
          assert.ok(metrics.width < 160, `compact width: ${label}, ${theme}, ${width}px`);
          assert.ok(metrics.height <= 28, `single-line height: ${label}, ${theme}, ${width}px`);
          assert.equal(metrics.dotWidth, 6);
          assert.equal(metrics.dotHeight, 6);
          assert.equal(metrics.background, theme ? 'rgb(55, 43, 24)' : 'rgb(255, 245, 220)');
          assert.equal(metrics.color, theme ? 'rgb(242, 206, 131)' : 'rgb(121, 82, 13)');
          assert.equal(metrics.scrollWidth, width);
        }
      }
    }
  } finally {
    await browser.close();
  }
});

test('application and full-screen views stop shrinking below 320px', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>${css}</style>
      <div id="root"><div class="app"><div class="editor-screen"></div></div></div>
      <section class="library-screen"></section>
      <section class="comparison-screen" data-slot="dialog-content"></section>
      <section class="optional-screen-overlay"></section>`);
    for (const width of [280, 319, 320, 360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => ({
        widths: [
          'html',
          'body',
          '#root',
          '.app',
          '.library-screen',
          '.comparison-screen',
          '.optional-screen-overlay',
        ].map((selector) => document.querySelector(selector).getBoundingClientRect().width),
        scrollWidth: document.documentElement.scrollWidth,
      }));
      const expectedWidth = Math.max(320, width);
      for (const measuredWidth of metrics.widths) {
        assert.equal(measuredWidth, expectedWidth, `layout width at ${width}px`);
      }
      assert.equal(metrics.scrollWidth, expectedWidth, `horizontal overflow at ${width}px`);
    }
  } finally {
    await browser.close();
  }
});
