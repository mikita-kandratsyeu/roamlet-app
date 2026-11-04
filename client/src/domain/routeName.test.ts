import { expect, it } from 'vitest';
import { routeNameSuggestionKey } from './routeName';

it('selects a route name suggestion from the available range', () => {
  expect(routeNameSuggestionKey(0)).toBe('Beyond the familiar');
  expect(routeNameSuggestionKey(0.99)).toBe('A day outside');
  expect(routeNameSuggestionKey(1)).toBe('A day outside');
  expect(routeNameSuggestionKey(Number.NaN)).toBe('Beyond the familiar');
});
