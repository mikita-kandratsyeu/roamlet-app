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
