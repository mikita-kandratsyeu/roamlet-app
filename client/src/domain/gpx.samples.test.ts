import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { exportGpx, importGpx } from './gpx';

it.each([
  ['/Users/Mikita_Kandratsyeu1/Downloads/Новый маршрут.gpx', 2961],
  ['/Users/Mikita_Kandratsyeu1/Downloads/Новый маршрут.gpx 2', 16],
])('imports and re-exports the supplied file %s', (path, points) => {
  const route = importGpx(readFileSync(path as string, 'utf8'));
  expect(route.name).toBe('Новый маршрут');
  expect(route.waypoints).toHaveLength(2);
  expect(route.segments).toHaveLength(1);
  expect(route.segments[0]).toHaveLength(points as number);
  expect(importGpx(exportGpx(route)).segments).toEqual(route.segments);
});
