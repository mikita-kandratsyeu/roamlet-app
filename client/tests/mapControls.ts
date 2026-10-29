import { expect, type Page } from '@playwright/test';

export async function mapTool(page: Page, name: string) {
  const compact = await page.evaluate(() => matchMedia('(max-width: 700px)').matches);
  await expect
    .poll(async () => (await page.locator('.map-extra-controls button').count()) === 3)
    .toBe(compact);
  const tool = page.getByRole('button', { name, exact: true });
  if (!(await tool.isVisible())) {
    await page.getByRole('button', { name: /^(More map tools|Другие инструменты карты)$/ }).click();
  }
  return tool;
}

export async function clickMapTool(page: Page, name: string) {
  await (await mapTool(page, name)).click();
  const trigger = page.getByRole('button', { name: /^(More map tools|Другие инструменты карты)$/ });
  if ((await trigger.count()) && (await trigger.getAttribute('aria-expanded')) === 'true')
    await page.getByRole('dialog', { name: /^(Map controls|Управление картой)$/ }).press('Escape');
}
