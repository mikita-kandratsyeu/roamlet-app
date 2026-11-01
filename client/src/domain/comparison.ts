import type { PlannedRoute } from './types';

export const MIN_COMPARISON_ROUTES = 2;
export const MAX_COMPARISON_ROUTES = 5;

export function isValidComparisonSelection(routes: readonly Pick<PlannedRoute, 'id'>[]): boolean {
  return (
    routes.length >= MIN_COMPARISON_ROUTES &&
    routes.length <= MAX_COMPARISON_ROUTES &&
    new Set(routes.map((route) => route.id)).size === routes.length
  );
}
