import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const css = (
  await Promise.all(
    ['./ui/shadcn.css', '../styles.css', '../planner.css', './Library.css', './Dialog.css'].map(
      (path) => readFile(new URL(path, import.meta.url), 'utf8'),
    ),
  )
)
  .join('\n')
  .replaceAll(/@import[^;]+;/g, '');

async function metrics(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outline: style.outlineStyle,
      width: style.outlineWidth,
      offset: style.outlineOffset,
      border: style.borderColor,
      shadow: style.boxShadow,
      ring: getComputedStyle(document.documentElement).getPropertyValue('--ring').trim(),
      invalid: getComputedStyle(document.documentElement).getPropertyValue('--destructive').trim(),
    };
  });
}

function expectHalo(style) {
  assert.equal(style.outline, 'none');
  assert.match(style.shadow, /0px 0px 0px 3px/);
}

for (const touch of [false, true]) {
  test(`focus separates editing halos from keyboard outlines (${touch ? 'touch' : 'mouse'})`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ hasTouch: touch });
      const page = await context.newPage();
      for (const theme of ['', 'dark']) {
        await page.setContent(`<style>${css}
          .fixture { padding: 24px; display: grid; gap: 16px; }
          :where(.fixture) input, :where(.fixture) textarea { border: 1px solid var(--border); border-radius: 8px; }
          .fixture .library-search input { border: 0; }
        </style><main class="fixture">
          <button id="action">Action</button>
          <input id="text" aria-label="Name">
          <input id="number" type="number" aria-label="Speed">
          <input id="date" type="datetime-local" aria-label="Departure">
          <textarea id="notes" aria-label="Notes"></textarea>
          <div class="personal-time-field"><input id="invalid" aria-invalid="true" aria-label="Invalid speed"></div>
          <div class="route-library"><label class="library-search"><input id="search" aria-label="Search"></label></div>
          <div class="roamlet-dialog"><div class="dialog-body">
            <input id="dialog" aria-label="Filename">
            <input id="dialog-invalid" aria-invalid="true" aria-label="Invalid filename">
          </div></div>
          <input id="checkbox" type="checkbox" aria-label="Favorite">
          <input id="radio" type="radio" aria-label="Activity">
          <input id="range" type="range" aria-label="Radius">
          <input id="submit" type="submit" value="Save">
          <button id="slider" role="slider" aria-label="Distance" aria-valuenow="5" aria-valuemin="1" aria-valuemax="10">Distance</button>
          <select id="select" aria-label="Mode"><option>Manual</option></select>
          <a id="link" href="#">Help</a>
          <details><summary id="summary">Options</summary></details>
        </main>`);
        await page.evaluate((theme) => {
          document.documentElement.className = theme;
        }, theme);
        const activate = (locator) => (touch ? locator.tap() : locator.click());
        const action = page.locator('#action');
        await activate(action);
        assert.equal(await action.evaluate((element) => element.matches(':focus-visible')), false);
        assert.equal((await metrics(action)).outline, 'none');
        await page.keyboard.press('Tab');
        for (const id of [
          'text',
          'number',
          'date',
          'notes',
          'invalid',
          'dialog',
          'dialog-invalid',
        ]) {
          const input = page.locator(`#${id}`);
          await activate(input);
          assert.equal(await input.evaluate((element) => element === document.activeElement), true);
          const style = await metrics(input);
          expectHalo(style);
          const expected = id.includes('invalid') ? style.invalid : style.ring;
          const expectedBorder = await page.evaluate((color) => {
            const element = document.createElement('span');
            element.style.color = color;
            document.body.append(element);
            const resolved = getComputedStyle(element).color;
            element.remove();
            return resolved;
          }, expected);
          assert.equal(style.border, expectedBorder, `${id}, ${theme}`);
          const box = await input.boundingBox();
          await input.fill(id === 'date' ? '2026-11-03T10:00' : id === 'number' ? '18' : 'Edited');
          assert.deepEqual(await input.boundingBox(), box, 'focus and editing do not shift layout');
        }
        await activate(page.locator('#search'));
        expectHalo(await metrics(page.locator('.library-search')));
        const inner = await metrics(page.locator('#search'));
        assert.equal(inner.outline, 'none');
        assert.equal(inner.shadow, 'none');
        await page.locator('#action').focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        const keyboardAction = await metrics(action);
        assert.equal(keyboardAction.outline, 'solid');
        assert.equal(keyboardAction.width, '2px');
        assert.equal(keyboardAction.offset, '2px');
        assert.equal(keyboardAction.shadow, 'none');
        for (const id of [
          'checkbox',
          'radio',
          'range',
          'submit',
          'slider',
          'select',
          'link',
          'summary',
        ]) {
          await page.locator(`#${id}`).focus();
          const style = await metrics(page.locator(`#${id}`));
          assert.equal(style.outline, 'solid', id);
          assert.equal(style.width, '2px', id);
          assert.equal(style.shadow, 'none', id);
        }
        await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
        for (const id of ['text', 'invalid', 'dialog', 'dialog-invalid', 'search']) {
          await page.locator(`#${id}`).focus();
          const target = id === 'search' ? page.locator('.library-search') : page.locator(`#${id}`);
          const style = await metrics(target);
          assert.equal(style.outline, 'solid', `system outline: ${id}`);
          assert.equal(style.width, '2px', id);
          assert.equal(style.shadow, 'none', id);
        }
        assert.equal((await metrics(page.locator('#search'))).outline, 'none');
        await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
      }
      await context.close();
    } finally {
      await browser.close();
    }
  });
}
