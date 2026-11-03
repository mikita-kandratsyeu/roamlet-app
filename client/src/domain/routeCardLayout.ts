import type { RouteCardFormat } from './routeCard';

export function getRouteCardDimensions(format: RouteCardFormat): { width: number; height: number } {
  return { width: 1080, height: format === 'story' ? 1920 : format === 'square' ? 1080 : 1350 };
}
