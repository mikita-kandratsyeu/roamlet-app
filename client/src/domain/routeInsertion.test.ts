import { expect, it } from 'vitest';
import { routeInsertion } from './routeInsertion';
import type { Coordinate, Waypoint } from './types';
const points = (...coordinates: Coordinate[]): Waypoint[] =>
  coordinates.map((coordinate, index) => ({ id: String(index), name: String(index), coordinate }));
it('inserts between route-ordered stops rather than the nearest pin on a hairpin', () => {
  const geometry: Coordinate[][] = [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0.1],
    ],
  ];
  const result = routeInsertion([0, 0.5], geometry, points([0, 0], [1, 1], [0, 0.1]));
  expect(result?.index).toBe(2);
  expect(result?.coordinate[0]).toBeCloseTo(0);
  expect(result?.coordinate[1]).toBeCloseTo(0.5);
});
it('projects onto the line and interpolates elevation without modifying the snapshot', () => {
  const geometry: Coordinate[][] = [
    [
      [10, 40, 100],
      [12, 42, 200],
    ],
  ];
  const snapshot = structuredClone(geometry);
  const result = routeInsertion([11, 41], geometry, points([10, 40], [12, 42]));
  expect(result).toEqual({ index: 1, coordinate: [11, 41, 150] });
  expect(geometry).toEqual(snapshot);
});
it('uses a consistent route distance scale across changing latitudes', () => {
  const geometry: Coordinate[][] = [
    [
      [1, 10],
      [1, 60],
      [5, 60],
      [5, 70],
    ],
  ];
  expect(routeInsertion([3, 60], geometry, points([1, 10], [1, 60], [5, 70]))?.index).toBe(2);
});
it('does not create an insertion across segment gaps or beyond route endpoints', () => {
  const geometry: Coordinate[][] = [
    [
      [0, 0],
      [1, 0],
    ],
    [
      [2, 0],
      [3, 0],
    ],
  ];
  expect(routeInsertion([1.5, 0], geometry, points([0, 0], [3, 0]))).toBeNull();
  expect(routeInsertion([0.5, 0], geometry, points([0, 0], [3, 0]))).toBeNull();
  expect(routeInsertion([0.5, 0], geometry, points([0, 0], [1, 0], [2, 0], [3, 0]))).toEqual({
    index: 1,
    coordinate: [0.5, 0],
  });
  expect(routeInsertion([-1, 0], geometry, points([0, 0], [1, 0]))).toBeNull();
});
it('handles degenerate geometry and insufficient waypoints safely', () => {
  expect(routeInsertion([0, 0], [], points([0, 0], [1, 1]))).toBeNull();
  expect(routeInsertion([0, 0], [[[0, 0]]], points([0, 0], [1, 1]))).toBeNull();
  expect(
    routeInsertion(
      [0, 0],
      [
        [
          [0, 0],
          [0, 0],
        ],
      ],
      points([0, 0], [0, 0]),
    ),
  ).toBeNull();
  expect(
    routeInsertion(
      [0, 0],
      [
        [
          [0, 0],
          [1, 1],
        ],
      ],
      points([0, 0]),
    ),
  ).toBeNull();
});
it('matches the closing stop after intervening waypoints in a closed route', () => {
  const geometry: Coordinate[][] = [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ];
  expect(routeInsertion([0.5, 0.5], geometry, points([0, 0], [1, 1], [0, 0]))?.index).toBe(2);
});
