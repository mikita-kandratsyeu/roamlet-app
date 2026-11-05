import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const css = (
  await Promise.all(
    [
      '../styles.css',
      '../planner.css',
      './Library.css',
      './ComparisonScreen.css',
      './RouteWeather.css',
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
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

test('expanded weather keeps only the disclosure separator in both themes and layouts', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['', 'dark']) {
        for (const title of ['Weather at start', 'Погода на старте']) {
          await page.setContent(`<style>${css}</style>
            <div class="${theme}">
              <details class="planner-details" style="--border: #888" open>
                <summary class="section-heading"><h2>${title}</h2></summary>
                <div class="planner-details-body">
                  <section class="route-weather"><p>Open-Meteo</p></section>
                </div>
              </details>
            </div>`);
          const metrics = await page.locator('.route-weather').evaluate((weather) => ({
            border: getComputedStyle(weather).borderTopWidth,
            padding: getComputedStyle(weather).paddingTop,
            disclosureBorder: getComputedStyle(weather.closest('details')).borderTopWidth,
          }));
          assert.equal(metrics.border, '0px', `${title}, ${theme}, ${width}px`);
          assert.equal(metrics.padding, '12px');
          assert.equal(metrics.disclosureBorder, '1px');
        }
      }
    }
  } finally {
    await browser.close();
  }
});

test('weather forecast cards stay readable without horizontal overflow', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const width of [320, 360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['', 'dark']) {
        await page.setContent(`<style>${css}</style>
          <div class="${theme}" style="width: min(360px, calc(100vw - 40px))">
            <section class="route-weather">
              <h3>Forecast near departure</h3>
              <div class="route-weather-summary">
                <time>Nov 2, 8:00 AM</time>
                <dl class="route-weather-highlight">
                  <div><dt>Temperature</dt><dd>12 °C</dd></div>
                  <div><dt>Feels like</dt><dd>10 °C</dd></div>
                </dl>
              </div>
              <dl class="route-weather-metrics">
                <div><dt>Precipitation probability</dt><dd>30 %</dd></div>
                <div><dt>Precipitation</dt><dd>0.5 mm</dd></div>
                <div><dt>Wind</dt><dd>15 km/h</dd></div>
                <div><dt>Wind gusts</dt><dd>24 km/h</dd></div>
                <div><dt>Wind from</dt><dd>270°</dd></div>
              </dl>
              <ol class="route-weather-hours">
                <li><time>8:00 AM</time><dl>
                  <div><dt>Temperature</dt><dd>12 °C</dd></div>
                  <div><dt>Вероятность осадков</dt><dd>30 %</dd></div>
                  <div><dt>Wind</dt><dd>15 km/h</dd></div>
                </dl></li>
                <li><time>9:00 AM</time><dl>
                  <div><dt>Temperature</dt><dd>12 °C</dd></div>
                  <div><dt>Вероятность осадков</dt><dd>30 %</dd></div>
                  <div><dt>Wind</dt><dd>15 km/h</dd></div>
                </dl></li>
              </ol>
            </section>
          </div>`);
        const metrics = await page.locator('.route-weather').evaluate((weather) => {
          const firstTemperature = weather.querySelector(
            '.route-weather-highlight > div:first-child dd',
          );
          const forecastMetrics = weather.querySelector('.route-weather-metrics');
          const hourlyForecast = weather.querySelector('.route-weather-hours');
          const hourlyCard = weather.querySelector('.route-weather-hours li');
          const hourlyMetric = weather.querySelector('.route-weather-hours li dl > div');
          const hourlyValue = hourlyMetric.querySelector('dd');
          return {
            scrollWidth: document.documentElement.scrollWidth,
            temperatureSize: getComputedStyle(firstTemperature).fontSize,
            metricColumns: getComputedStyle(forecastMetrics).gridTemplateColumns.split(' ').length,
            hourlyColumns: getComputedStyle(hourlyForecast).gridTemplateColumns.split(' ').length,
            hourlyCardColumns: getComputedStyle(hourlyCard).gridTemplateColumns.split(' ').length,
            hourlyMetricColumns:
              getComputedStyle(hourlyMetric).gridTemplateColumns.split(' ').length,
            hourlyValueWhitespace: getComputedStyle(hourlyValue).whiteSpace,
            hourlyCardGridColumn: getComputedStyle(hourlyCard).gridColumn,
            labelBottom: hourlyMetric.querySelector('dt').getBoundingClientRect().bottom,
            valueTop: hourlyValue.getBoundingClientRect().top,
          };
        });
        assert.equal(metrics.scrollWidth, width, `${theme || 'light'} at ${width}px`);
        assert.equal(metrics.temperatureSize, '24px');
        assert.equal(metrics.metricColumns, 2);
        assert.equal(metrics.hourlyColumns, 2);
        assert.equal(metrics.hourlyCardColumns, 1);
        assert.equal(metrics.hourlyMetricColumns, width <= 360 ? 1 : 2);
        assert.equal(metrics.hourlyValueWhitespace, 'nowrap');
        if (width <= 360) {
          assert.equal(metrics.hourlyCardGridColumn, '1 / -1');
          assert.ok(metrics.valueTop >= metrics.labelBottom, 'metric values do not overlap labels');
        } else {
          assert.equal(metrics.hourlyCardGridColumn, 'auto');
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
