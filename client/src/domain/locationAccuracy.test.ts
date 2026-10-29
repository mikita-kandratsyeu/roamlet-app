import { expect, it } from 'vitest';
import distance from '@turf/distance';
import { locationAccuracy } from './locationAccuracy';
import type { Coordinate } from './types';

it.each<[number, number]>([[13, 49], [179.999, 70], [0, 89.999]])(
  'creates a closed circle with the reported radius at %s, %s',
  (longitude, latitude) => {
    const center: Coordinate = [longitude, latitude];
    const area = locationAccuracy(center, 250);
    expect(area.type).toBe('FeatureCollection');
    const ring = area.features[0].geometry.coordinates[0];
    expect(ring).toHaveLength(65);
    expect(ring[64]).toEqual(ring[0]);
    for (const point of ring) {
      expect(distance(center, point, { units: 'meters' })).toBeCloseTo(250, 3);
    }
  },
);

it.each([0, -1, NaN, Infinity, undefined])('omits an invalid accuracy of %s', (accuracy) => {
  expect(locationAccuracy([13, 49], accuracy as number).features).toEqual([]);
});
