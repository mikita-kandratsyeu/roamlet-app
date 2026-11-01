import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const css = await readFile(new URL('../planner.css', import.meta.url), 'utf8');

for (const width of [230, 390, 1024]) {
  for (const language of ['en', 'ru']) {
    test(`stop actions share available width without clipping in ${language} at ${width}px`, async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width, height: 700 } });
        const labels =
          language === 'ru'
            ? ['Добавить точку', 'В обратном порядке', 'Удалить все точки']
            : ['Add a stop', 'Reverse', 'Clear stops'];
        const button = (className, label) =>
          `<button class="${className}" style="display:flex;align-items:center"><svg></svg>${label ? `<span>${label}</span>` : ''}</button>`;
        for (const dark of [false, true]) {
          for (const actions of [[0], [2], [0, 2], [1, 2], [0, 1, 2]]) {
            await page.setContent(`<style>
              * { box-sizing: border-box; }
              body { margin: 0; font-family: Arial, sans-serif; }
              :root { --font-size-control: 14px; --border: ${dark ? '#36463a' : '#d7ded9'}; --surface: ${dark ? '#202a23' : '#ffffff'}; --foreground: ${dark ? '#eef2ef' : '#17211b'}; --destructive: ${dark ? '#ff9b93' : '#b42318'}; }
              ${css}
            </style><div class="waypoint-tools" data-action-count="${actions.length}" style="width:${Math.min(width, 360)}px">
              ${actions.map((index) => button(['add-stop', 'reverse-stops', 'clear-stops'][index], actions.length < 3 || index === 0 ? labels[index] : '')).join('')}
            </div>`);
            const metrics = await page.evaluate(() => {
              const group = document.querySelector('.waypoint-tools');
              const buttons = [...group.querySelectorAll('button')];
              const bounds = group.getBoundingClientRect();
              return {
                groupWidth: bounds.width,
                widths: buttons.map((element) => element.getBoundingClientRect().width),
                heights: buttons.map((element) => element.getBoundingClientRect().height),
                spans: buttons.map((element) => !!element.querySelector('span')),
                contained: buttons.every((element) => {
                  const rect = element.getBoundingClientRect();
                  const label = element.querySelector('span');
                  const labelBounds = label?.getBoundingClientRect();
                  return (
                    rect.left >= bounds.left &&
                    rect.right <= bounds.right &&
                    (!label ||
                      ((getComputedStyle(label).textOverflow === 'ellipsis' ||
                        label.scrollWidth <= label.clientWidth) &&
                        labelBounds.right <= rect.right &&
                        labelBounds.bottom <= rect.bottom))
                  );
                }),
                overflow: document.documentElement.scrollWidth > window.innerWidth,
              };
            });
            assert.equal(metrics.contained, true, JSON.stringify({ actions, metrics }));
            assert.equal(metrics.overflow, false);
            assert.ok(metrics.heights.every((height) => height >= 44));
            if (actions.length < 3) {
              assert.ok(metrics.spans.every(Boolean));
              const expected = (metrics.groupWidth - (actions.length - 1) * 8) / actions.length;
              assert.ok(metrics.widths.every((value) => Math.abs(value - expected) < 1));
            } else {
              assert.deepEqual(metrics.spans, [true, false, false]);
              assert.deepEqual(metrics.widths.slice(1), [44, 44]);
            }
          }
        }
      } finally {
        await browser.close();
      }
    });
  }
}
