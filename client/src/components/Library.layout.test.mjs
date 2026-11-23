import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const css = await readFile(new URL('./Library.css', import.meta.url), 'utf8');
const baseCss = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const ru = JSON.parse(await readFile(new URL('../locales/ru.json', import.meta.url), 'utf8'));
const en = JSON.parse(await readFile(new URL('../locales/en.json', import.meta.url), 'utf8'));

for (const [width, columns] of [
  [320, 1],
  [560, 1],
  [800, 1],
  [1024, 2],
  [1280, 3],
  [1600, 4],
  [1920, 4],
]) {
  test(`library keeps bounded cards and accessible backup tools at ${width}px`, async () => {
    const profile = `.library-layout-${crypto.randomUUID()}`;
    const context = await chromium.launchPersistentContext(profile, { headless: true });
    try {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      const t = (key) => (width === 320 || width === 800 || width === 1280 ? ru : en)[key] ?? key;
      const icon =
        '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9H15" /></svg>';
      const card = `<li class="library-route">
        <span class="library-activity-icon">${icon}</span>
        <button class="library-open library-route-body">
          <strong class="library-route-title">${'Long saved route title '.repeat(6)}</strong>
          <span class="library-route-meta">${t('Cycling')} · 12.0 km · 01/11/2026</span>
          <span class="library-route-tags"><span class="library-route-tag">${'Long tag '.repeat(6)}</span></span>
          <span class="route-description">${'A saved route description with complete details. '.repeat(4)}</span>
        </button>
        <button class="library-open-action">${icon}<span class="library-open-label">${t('Open')}</span></button>
        <div class="library-actions">
          <button class="icon-button library-favorite-action">${icon}</button>
          <button class="icon-button">${icon}<span class="library-action-label">${t('Edit')}</span></button>
          <button class="icon-button">${icon}<span class="library-action-label">${t('Copy')}</span></button>
          <button class="icon-button library-delete-action">${icon}</button>
        </div>
      </li>`;
      await page.setContent(`<style>
        ${baseCss.replaceAll(/@import[^;]+;/g, '')}
        :root { --background: #f7f9f7; --surface: #fff; --foreground: #1c2d23; --muted-foreground: #536359; --border: #d7ded9; --primary: #166534; --ring: #166534; --muted: #eef2ef; --accent: #e4efe7; }
        .dark { --background: #101411; --surface: #171b19; --foreground: #eef2ef; --muted-foreground: #b8c1bb; --border: #36463a; --primary: #86cda2; --ring: #86cda2; --muted: #27332a; --accent: #283d2e; }
        button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
        ${css}
      </style><section class="library-screen ${width === 320 || width === 1280 || width === 1920 ? 'dark' : ''}">
        <header class="library-screen-header">
          <div class="library-screen-heading">${icon}<h1>${t('Your route library')}</h1></div>
          <button class="back-to-map-button">${icon}${t('Back to map')}</button>
        </header>
        <div class="library-screen-scroll"><div class="route-library">
          <p class="library-screen-description">${t('Good routes are worth keeping. Saved on this device, no account needed.')}</p>
          <div class="library-toolbar">
            <label class="library-search">${icon}<input placeholder="${t('Find a saved route…')}"></label>
            <button class="library-sort">${icon}${t('Most recently updated')}${icon}</button>
          </div>
          <div class="library-tools">
            <button class="library-filter-trigger">${icon}${t('Filter routes')}</button>
            <button class="library-favorite-filter" aria-pressed="false">${icon}${t('Favorites only')}</button>
            <div class="library-backup-tools library-backup-actions">
              <details class="library-backup-disclosure"><summary>${icon}<span class="library-backup-label">${t('Library backup')}</span></summary>
                <p>${t('Routes stay only in this browser. No cloud copy. Clearing browser data deletes them.')} ${t('JSON backs up all saved routes, not settings or the current draft. GPX exports an individual route for other apps.')}</p>
              </details>
              <button>${icon}<span class="library-backup-label">${t('Download backup')}</span></button><button>${icon}<span class="library-backup-label">${t('Restore from backup')}</span></button>
            </div>
          </div>
          <section class="library-comparison">
            <div class="library-comparison-summary"><div class="library-comparison-heading">${icon}<h2>${t('Route comparison')}</h2></div></div>
            <div class="library-comparison-actions"><button disabled>${t('Compare routes')}</button></div>
          </section>
          <section class="library-filters" aria-labelledby="filter-title">
            <div class="library-filter-heading"><div class="library-filter-title">${icon}<h2 id="filter-title">${t('Filter routes')}</h2></div><button disabled>${t('Reset filters')}</button></div>
            <div class="library-filter-grid">
              <div class="library-filter-field"><span class="library-field-label">${t('Activity')}</span><button class="library-choice"><span>${t('All activities')}</span>${icon}</button></div>
              <div class="library-filter-field"><span class="library-field-label">${t('Filter by tag')}</span><button class="library-choice"><span>${'Long tag '.repeat(12)}</span>${icon}</button></div>
              <div class="library-filter-field library-length-field" role="group" aria-label="${t('Route length (km)')}"><span class="library-field-label">${t('Route length (km)')}</span><div class="library-length-range"><input type="number" min="0" aria-label="${t('Minimum length (km)')}" placeholder="${t('Min')}"><span>–</span><input type="number" min="0" aria-label="${t('Maximum length (km)')}" placeholder="${t('Max')}"></div></div>
            </div>
          </section>
          <ul class="library-list">${card.repeat(8)}</ul>
          <div class="library-loading"><div class="library-list library-skeleton-list" aria-hidden="true">${card.repeat(4)}</div></div>
          <div class="library-empty"><h3>${t('Your next adventure belongs here')}</h3><p>${t('Plan a route or import a GPX, then save it for later.')}</p></div>
        </div></div>
      </section>`);
      const metrics = await page.evaluate(() => {
        const content = document.querySelector('.route-library');
        const list = document.querySelector('.library-list');
        const cards = [...list.children].map((element) => element.getBoundingClientRect());
        const controls = [
          ...document.querySelectorAll(
            '.library-filter-trigger, .library-backup-actions > button, .library-choice, .library-length-range input, .library-favorite-filter, .library-actions button, .library-open-action',
          ),
        ];
        return {
          scrollbars: ['.library-screen-scroll', '.library-list'].map((selector) => {
            const style = getComputedStyle(document.querySelector(selector));
            return { width: style.scrollbarWidth, color: style.scrollbarColor };
          }),
          columns: cards.filter((card) => card.top === cards[0].top).length,
          cardWidths: cards.map((card) => card.width),
          contentWidth: content.getBoundingClientRect().width,
          headerWidth: document.querySelector('header').getBoundingClientRect().width,
          backupButtons: [...document.querySelectorAll('.library-backup-actions > button')].map(
            (element) => {
              const box = element.getBoundingClientRect();
              return { top: box.top, bottom: box.bottom, width: box.width, height: box.height };
            },
          ),
          headerPadding: getComputedStyle(document.querySelector('header')).paddingLeft,
          minimumTargetHeight: Math.min(
            ...controls.map((element) => element.getBoundingClientRect().height),
          ),
          overflow: [
            ...document.querySelectorAll(
              '.library-screen, .library-screen-scroll, .route-library, .library-tools, .library-backup-tools, .library-filters, .library-filter-grid, .library-length-range, .library-route',
            ),
          ].some((element) => element.scrollWidth > element.clientWidth + 1),
          skeletonColumns: getComputedStyle(document.querySelector('.library-skeleton-list'))
            .gridTemplateColumns,
          routeColumns: getComputedStyle(list).gridTemplateColumns,
          emptyBackground: getComputedStyle(document.querySelector('.library-empty'))
            .backgroundColor,
          surface: getComputedStyle(document.querySelector('.library-filters')).backgroundColor,
          backupChrome: (() => {
            const style = getComputedStyle(document.querySelector('.library-backup-tools'));
            return { padding: style.padding, border: style.borderTopWidth, margin: style.marginBottom };
          })(),
          widgets: ['.library-filters', '.library-comparison'].map(
            (selector) => {
              const style = getComputedStyle(document.querySelector(selector));
              return {
                background: style.backgroundColor,
                border: style.borderTop,
                radius: style.borderRadius,
                padding: style.padding,
                margin: style.marginBottom,
              };
            },
          ),
          heading: ['.library-filter-title h2', '.library-comparison-heading h2'].map(
            (selector) => {
              const style = getComputedStyle(document.querySelector(selector));
              return { size: style.fontSize, weight: style.fontWeight, color: style.color };
            },
          ),
          filterIconColor: getComputedStyle(document.querySelector('.library-filter-title > svg'))
            .color,
          comparisonIconColor: getComputedStyle(
            document.querySelector('.library-comparison-heading > svg'),
          ).color,
          filterControls: [
            ...document.querySelectorAll(
              '.library-choice, .library-length-range input, .library-favorite-filter',
            ),
          ].map((element) => {
            const rect = element.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
          }),
          headerGap:
            document.querySelector('.library-filter-grid').getBoundingClientRect().top -
            document.querySelector('.library-filter-heading').getBoundingClientRect().bottom,
          lengthGap: getComputedStyle(document.querySelector('.library-length-range')).columnGap,
        };
      });
      assert.equal(metrics.scrollbars[0].width, 'thin');
      assert.deepEqual(metrics.scrollbars[0], metrics.scrollbars[1]);
      assert.equal(metrics.columns, columns);
      assert.equal(metrics.contentWidth, Math.min(1600, width - (width <= 560 ? 32 : 48)));
      assert.equal(metrics.headerWidth, width);
      assert.equal(metrics.headerPadding, width <= 560 ? '16px' : '24px');
      assert.ok(metrics.minimumTargetHeight >= 44);
      assert.equal(metrics.overflow, false);
      assert.equal(metrics.skeletonColumns, metrics.routeColumns);
      assert.equal(metrics.emptyBackground, metrics.surface);
      assert.equal(metrics.backupChrome.padding, '0px');
      assert.equal(metrics.backupChrome.border, '0px');
      assert.equal(metrics.backupChrome.margin, '0px');
      assert.deepEqual(metrics.widgets[0], metrics.widgets[1]);
      assert.equal(metrics.widgets[0].padding, width <= 700 ? '14px' : '16px');
      assert.equal(metrics.widgets[0].radius, '12px');
      assert.equal(metrics.widgets[0].margin, '20px');
      assert.deepEqual(metrics.heading[0], metrics.heading[1]);
      assert.equal(metrics.heading[0].size, '16px');
      assert.equal(metrics.filterIconColor, metrics.comparisonIconColor);
      assert.equal(metrics.headerGap, 16);
      assert.equal(metrics.lengthGap, '6px');
      const [favorites, activity, tag, minimum, maximum] = metrics.filterControls;
      assert.equal(activity.top, tag.top);
      assert.equal(minimum.top, maximum.top);
      assert.ok(Math.abs(minimum.width - maximum.width) < 1);
      assert.ok(metrics.filterControls.every((control) => control.height === 44));
      assert.ok(favorites.top < activity.top);
      if (width <= 560) {
        assert.equal(metrics.backupButtons[0].top, metrics.backupButtons[1].top);
        assert.ok(metrics.backupButtons.every((button) => button.width === 44 && button.height === 44));
        assert.ok(minimum.top > activity.bottom);
      } else if (width > 1040) assert.equal(activity.top, minimum.top);
      else assert.ok(minimum.top > activity.bottom);
      if (width >= 1024)
        assert.ok(metrics.cardWidths.every((cardWidth) => cardWidth >= 300 && cardWidth <= 520));

      const disclosure = page.locator('.library-backup-disclosure');
      await assert.doesNotReject(() =>
        page.locator('.library-backup-actions > button').first().click(),
      );
      assert.equal(await disclosure.getAttribute('open'), null);
      await disclosure.locator('summary').focus();
      await page.keyboard.press('Enter');
      assert.equal(await disclosure.locator('p').isVisible(), true);
      await page.keyboard.press('Enter');
      assert.equal(await disclosure.locator('p').isVisible(), false);
      assert.equal(await page.locator('.library-backup-actions > button').last().isVisible(), true);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
