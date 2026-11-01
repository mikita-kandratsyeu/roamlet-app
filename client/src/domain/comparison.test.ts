import { expect, it } from 'vitest';
import { isValidComparisonSelection, MAX_COMPARISON_ROUTES } from './comparison';

it('accepts 2–5 distinct saved routes and rejects unsupported or repeated selections', () => {
  for (const count of [0, 1, 2, 3, 4, 5, 6]) {
    const routes = Array.from({ length: count }, (_, id) => ({ id: String(id) }));
    const before = JSON.stringify(routes);
    expect(isValidComparisonSelection(routes)).toBe(count >= 2 && count <= 5);
    expect(JSON.stringify(routes)).toBe(before);
  }
  expect(MAX_COMPARISON_ROUTES).toBe(5);
  expect(isValidComparisonSelection([{ id: 'same' }, { id: 'same' }])).toBe(false);
});
