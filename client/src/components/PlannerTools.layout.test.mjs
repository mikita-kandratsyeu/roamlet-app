import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const css = await readFile(new URL('../planner.css', import.meta.url), 'utf8');
const baseCss = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const timeExplanationCss = await readFile(
  new URL('./TimeExplanation.css', import.meta.url),
  'utf8',
);

for (const width of [230, 320, 360, 390]) {
  test(`personal-time layout has compact aligned rows at ${width}px`, async () => {
    const profile = `.personal-time-layout-${crypto.randomUUID()}`;
    const context = await chromium.launchPersistentContext(profile, { headless: true });
    try {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 700 });
      const russian = width === 320 || width === 390;
      const choice = (text) =>
        `<button class="personal-time-choice"><span>${text}</span><svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 5 L7 9 L11 5" /></svg></button>`;
      await page.setContent(`<style>
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, sans-serif; }
        ${css}
        .dark { --card: #171b19; --foreground: #eef2ef; --muted-foreground: #b8c1bb; --border: #36463a; background: #101411; color: var(--foreground); }
      </style><div class="dark"><details class="personal-time-section" open style="width:${width}px">
        <summary class="personal-time-heading">Personal time</summary>
        <div class="personal-time-fields">
          <div class="personal-time-row">
            <div class="personal-time-field"><label for="speed">${russian ? 'Личная скорость (км/ч)' : 'Personal speed (km/h)'}</label><input id="speed" value="18"></div>
            <div class="personal-time-field"><label for="stops">${russian ? 'Остановки (минуты)' : 'Stops (minutes)'}</label><input id="stops" value="0"></div>
          </div>
          <div class="personal-time-row">
            <div class="personal-time-field"><span class="personal-time-label">${russian ? 'Подготовка' : 'Fitness level'}</span>${choice(russian ? 'Обычная' : 'Regular')}</div>
            <div class="personal-time-field"><span class="personal-time-label">${russian ? 'Покрытие' : 'Surface'}</span>${choice(russian ? 'Неизвестное покрытие' : 'Unknown surface')}</div>
          </div>
        </div>
        <p class="personal-time-help">Measured flat-ground average.</p>
      </details></div>`);
      const metrics = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.personal-time-row')];
        const fields = [...document.querySelectorAll('.personal-time-field')];
        const inputs = [...document.querySelectorAll('input')];
        const controls = fields.map((field) => field.children[1].getBoundingClientRect());
        const labels = fields.map((field) => field.children[0].getBoundingClientRect());
        return {
          rowGap: rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom,
          labelGaps: controls.map((control, index) => control.top - labels[index].bottom),
          numericAlignment:
            inputs[0].getBoundingClientRect().top - inputs[1].getBoundingClientRect().top,
          dropdownAlignment: controls[2].top - controls[3].top,
          heights: controls.map((control) => control.height),
          shortLabelHeight: labels[2].height,
          padding: getComputedStyle(document.querySelector('details')).paddingTop,
          buttonRight: controls[3].right,
          cardContentRight: document.querySelector('details').getBoundingClientRect().right - 13,
          arrowVisible: [...document.querySelectorAll('.personal-time-choice')].every((button) => {
            const arrow = button.querySelector('svg').getBoundingClientRect();
            const bounds = button.getBoundingClientRect();
            return arrow.width === 14 && arrow.right <= bounds.right && arrow.left >= bounds.left;
          }),
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      assert.equal(metrics.rowGap, 12);
      assert.ok(metrics.rowGap <= 16);
      assert.deepEqual(metrics.labelGaps, [6, 6, 6, 6]);
      assert.equal(metrics.numericAlignment, 0);
      assert.equal(metrics.dropdownAlignment, 0);
      assert.deepEqual(metrics.heights, [44, 44, 44, 44]);
      assert.equal(metrics.shortLabelHeight, 16);
      assert.equal(metrics.padding, '12px');
      assert.ok(metrics.buttonRight <= metrics.cardContentRight);
      assert.equal(metrics.arrowVisible, true);
      assert.equal(metrics.horizontalOverflow, false);

      await page.evaluate(() => {
        const row = document.querySelector('.personal-time-row');
        row.dataset.errors = 'true';
        const error = document.createElement('p');
        error.className = 'personal-time-error';
        error.textContent = 'Enter a speed greater than 0.';
        row.firstElementChild.append(error);
      });
      assert.equal(
        await page
          .locator('.personal-time-error')
          .evaluate((element) => getComputedStyle(element).lineHeight),
        '18px',
      );
      assert.equal(
        await page
          .locator('input')
          .evaluateAll(
            (elements) =>
              elements[0].getBoundingClientRect().top - elements[1].getBoundingClientRect().top,
          ),
        0,
      );
      const borders = await page.evaluate(() => {
        const section = document.querySelector('.personal-time-section');
        const scroll = document.createElement('div');
        scroll.className = 'planner-scroll';
        section.before(scroll);
        scroll.append(section);
        const details = document.createElement('details');
        details.className = 'planner-details';
        scroll.append(details);
        return {
          personalTime: getComputedStyle(section).borderTopWidth,
          plannerDetails: getComputedStyle(details).borderTopWidth,
        };
      });
      assert.deepEqual(borders, { personalTime: '0px', plannerDetails: '1px' });

      for (const borderColor of ['#d7ded9', '#36463a']) {
        for (const open of [false, true]) {
          for (const routeState of ['ready', 'empty', 'absent']) {
            await page.setContent(`<style>
              * { box-sizing: border-box; }
              ${baseCss}
              ${timeExplanationCss}
              ${css}
              :root { --border: ${borderColor}; }
            </style><div class="planner-scroll">
              ${
                routeState === 'ready'
                  ? `<section class="statistics">
                <p class="fine-print">Base time excludes stops.</p>
                <details class="time-explanation" ${open ? 'open' : ''}>
                  <summary>How time is calculated</summary><p>Time assumptions</p>
                </details>
                <details class="elevation-box" ${open ? 'open' : ''}>
                  <summary>Elevation profile</summary><p>Elevation data</p>
                </details>
              </section>`
                  : routeState === 'empty'
                    ? '<section class="statistics statistics-empty">Add two stops</section>'
                    : '<p>Alternatives require two stops.</p>'
              }
              <details class="personal-time-section" ${open ? 'open' : ''}>
                <summary>Personal time</summary><p>Speed and stops</p>
              </details>
              <details class="planner-details" ${open ? 'open' : ''}>
                <summary>Climb analysis</summary><p>Climbs</p>
              </details>
              <details class="planner-details" ${open ? 'open' : ''}>
                <summary>Route schedule</summary><p>Schedule</p>
              </details>
            </div>`);
            if (routeState === 'ready') {
              const textGap = await page
                .locator('.time-explanation')
                .evaluate(
                  (section) =>
                    section.getBoundingClientRect().top -
                    section.previousElementSibling.getBoundingClientRect().bottom,
                );
              assert.equal(textGap, 12);
            }
            const separators = await page.locator('details').evaluateAll((sections) =>
              sections.map((section) => {
                const style = getComputedStyle(section);
                return {
                  top: style.borderTopWidth,
                  bottom: style.borderBottomWidth,
                  color: style.borderTopColor,
                };
              }),
            );
            assert.deepEqual(
              separators.map(({ top, bottom }) => ({ top, bottom })),
              (routeState === 'ready'
                ? ['1px', '1px', '1px', '1px', '1px']
                : ['0px', '1px', '1px']
              ).map((top) => ({ top, bottom: '0px' })),
            );
            const expectedColor =
              borderColor === '#d7ded9' ? 'rgb(215, 222, 217)' : 'rgb(54, 70, 58)';
            assert.ok(
              separators
                .filter(({ top }) => top === '1px')
                .every(({ color }) => color === expectedColor),
            );
          }
        }
      }
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
