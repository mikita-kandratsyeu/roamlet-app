import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const css = (
  await Promise.all(
    [
      '../styles.css',
      './ui/shadcn.css',
      './MapLoader.css',
      './MapLoadingIndicator.css',
      './ComparisonMap.css',
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
  )
)
  .join('\n')
  .replaceAll(/@import[^;]+;/g, '');

const indicator = `<svg class="map-loading-route" viewBox="0 0 160 88" aria-hidden="true">
  <path class="map-loading-route__base" d="M16 64C30 64 28 28 52 28S72 68 94 60S112 16 144 24" />
  <path class="map-loading-route__trace" d="M16 64C30 64 28 28 52 28S72 68 94 60S112 16 144 24" pathLength="100" />
</svg>`;

test('map loaders stay centered and themed with static reduced-motion routes', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const theme of ['', 'dark']) {
        for (const reducedMotion of ['no-preference', 'reduce']) {
          await page.emulateMedia({ reducedMotion });
          for (const comparison of [false, true]) {
            const label = 'Загружаем карту…';
            const content = comparison
              ? `<div class="comparison-map"><div class="comparison-map-loading map-loading-surface" role="status">${indicator}<span>${label}</span></div></div>`
              : `<div class="global-map-loader map-loading-surface"><div class="global-map-loader__content" role="status">${indicator}<h2>${label}</h2></div></div>`;
            await page.setContent(
              `<html class="${theme}"><style>${css}</style><body>${content}</body></html>`,
            );
            const metrics = await page.locator('[role="status"]').evaluate((status) => {
              const surface = document.querySelector('.map-loading-surface');
              const route = status.querySelector('svg');
              const trace = status.querySelector('.map-loading-route__trace');
              const bounds = surface.getBoundingClientRect();
              const routeBounds = route.getBoundingClientRect();
              const message = status.querySelector('h2, span').getBoundingClientRect();
              const reference = document.createElement('div');
              reference.style.backgroundColor = 'var(--background)';
              surface.append(reference);
              const themeBackground = getComputedStyle(reference).backgroundColor;
              reference.remove();
              return {
                overflow: document.documentElement.scrollWidth > window.innerWidth,
                centerOffset: Math.abs(
                  routeBounds.x + routeBounds.width / 2 - bounds.x - bounds.width / 2,
                ),
                routeWidth: routeBounds.width,
                messageBottom: message.bottom,
                surfaceBottom: bounds.bottom,
                background: getComputedStyle(surface).backgroundColor,
                themeBackground,
                color: getComputedStyle(route).color,
                animation: getComputedStyle(trace).animationName,
                dash: getComputedStyle(trace).strokeDasharray,
              };
            });
            assert.equal(metrics.overflow, false);
            assert.ok(metrics.centerOffset < 1);
            assert.equal(metrics.routeWidth, 160);
            assert.ok(metrics.messageBottom <= metrics.surfaceBottom);
            assert.equal(metrics.background, metrics.themeBackground);
            assert.notEqual(metrics.color, metrics.background);
            assert.equal(
              metrics.animation,
              reducedMotion === 'reduce' ? 'none' : 'map-loading-route-trace',
            );
            if (reducedMotion === 'reduce') assert.equal(metrics.dash, 'none');
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
});
