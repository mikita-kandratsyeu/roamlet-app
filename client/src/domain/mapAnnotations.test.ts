import { expect, it } from 'vitest';
import { kilometerSpacing, lineFeatures, pointFeature, routeAnnotations } from './mapAnnotations';
import type { Coordinate } from './types';

it('keeps each disconnected segment isolated, ignoring singleton lines', () => {
  const segments: Coordinate[][] = [
    [
      [0, 0],
      [0.02, 0],
    ],
    [
      [20, 0],
      [20.02, 0],
    ],
    [[50, 0]],
  ];
  expect(lineFeatures(segments).features.map((feature) => feature.geometry.coordinates)).toEqual(
    segments.slice(0, 2),
  );
  const annotations = routeAnnotations(segments, 14);
  const kilometers = annotations.features.filter(
    (feature) => feature.properties.kind === 'kilometer',
  );
  expect(kilometers.map((feature) => feature.properties.label)).toEqual([
    '1 km',
    '2 km',
    '3 km',
    '4 km',
  ]);
  expect(
    annotations.features.every(
      (feature) =>
        feature.geometry.coordinates[0] <= 0.02 ||
        (feature.geometry.coordinates[0] >= 20 && feature.geometry.coordinates[0] <= 20.02),
    ),
  ).toBe(true);
  expect(
    annotations.features
      .filter((feature) => feature.properties.kind === 'direction')
      .every((feature) => Math.abs(feature.properties.bearing - 90) < 0.001),
  ).toBe(true);
});
it('reduces kilometer marker density when zoomed out', () => {
  expect([8, 10, 12, 14].map(kilometerSpacing)).toEqual([50, 10, 5, 1]);
  const segments: Coordinate[][] = [
    [
      [0, 0],
      [1, 0],
    ],
  ];
  expect(routeAnnotations(segments, 8).features.length).toBeLessThan(
    routeAnnotations(segments, 14).features.length,
  );
});
it('handles empty, zero-length and singleton segments', () => {
  expect(
    routeAnnotations(
      [
        [],
        [[0, 0]],
        [
          [1, 1],
          [1, 1],
        ],
      ],
      14,
    ).features,
  ).toEqual([]);
  expect(pointFeature(null).features).toEqual([]);
  expect(pointFeature([1, 2, 3]).features[0].geometry.coordinates).toEqual([1, 2, 3]);
});
it('interpolates date-line annotations without placing points across the world', () => {
  const annotations = routeAnnotations(
    [
      [
        [179.99, 0],
        [-179.99, 0],
      ],
    ],
    14,
  );
  expect(annotations.features.length).toBeGreaterThan(0);
  expect(
    annotations.features.every((feature) => Math.abs(feature.geometry.coordinates[0]) > 179.9),
  ).toBe(true);
});
