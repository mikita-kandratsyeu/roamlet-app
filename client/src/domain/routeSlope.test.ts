import { describe, expect, it } from 'vitest';
import { buildRouteSlope, MAX_SLOPE_FEATURES, SLOPE_WINDOW_METERS } from './routeSlope';
import { calculateStats } from './stats';
import type { Coordinate } from './types';

const step: Coordinate[] = [
  [0, 0],
  [0, 0.0001],
];
const stepMeters = calculateStats([step], 'hiking').distance;

function track(count: number, grade: number, longitude = 0): Coordinate[] {
  return Array.from({ length: count }, (_, index): Coordinate => [
    longitude,
    index * 0.0001,
    100 + (index * stepMeters * grade) / 100,
  ]);
}

function drawableEdges(segments: Coordinate[][]): Coordinate[][] {
  return segments.flatMap((segment) =>
    segment
      .slice(1)
      .flatMap((point, index) =>
        calculateStats([[segment[index], point]], 'hiking').distance > 0
          ? [[segment[index], point]]
          : [],
      ),
  );
}

const unavailable = { available: false, features: [] };

describe('route slope', () => {
  it.each([10, -7, 0])('keeps constant %s%% grades, including truncated boundaries', (grade) => {
    const segment = track(31, grade);
    const result = buildRouteSlope([segment]);
    expect(result.available).toBe(true);
    expect(result.features).toHaveLength(30);
    for (const feature of result.features) {
      expect(feature.type).toBe('Feature');
      expect(feature.geometry.type).toBe('LineString');
      expect(feature.properties.grade).toBeCloseTo(grade, 8);
    }
    expect(result.features.flatMap((f) => drawableEdges([f.geometry.coordinates]))).toEqual(
      drawableEdges([segment]),
    );
  });

  it('reduces short elevation noise with a distance window without changing heights', () => {
    expect(SLOPE_WINDOW_METERS).toBe(100);
    const segment = track(31, 0);
    segment[15] = [segment[15][0], segment[15][1], 108];
    const result = buildRouteSlope([segment]);
    expect(result.available).toBe(true);
    expect(result.features[14].properties.grade).toBe(0);
    expect(result.features[15].properties.grade).toBe(0);
    const maxGrade = Math.max(...result.features.map((f) => Math.abs(f.properties.grade)));
    expect(maxGrade).toBeLessThan((100 * 8) / stepMeters / 5);
    expect(result.features.flatMap((f) => drawableEdges([f.geometry.coordinates]))).toEqual(
      drawableEdges([segment]),
    );
  });

  it('never connects gaps or shares elevation windows between segments', () => {
    const segments = [track(8, 10), [], [[50, 50, 900]] as Coordinate[], track(8, -7, 100)];
    const result = buildRouteSlope(segments);
    expect(result.available).toBe(true);
    expect(result.features).toHaveLength(14);
    result.features.slice(0, 7).forEach((f) => expect(f.properties.grade).toBeCloseTo(10, 8));
    result.features.slice(7).forEach((f) => expect(f.properties.grade).toBeCloseTo(-7, 8));
    expect(result.features.flatMap((f) => drawableEdges([f.geometry.coordinates]))).toEqual(
      drawableEdges(segments),
    );
  });

  it('splits every stationary edge, including consecutive elevation jumps', () => {
    const segment: Coordinate[] = [
      [0, 0, 100],
      [0, 0.0001, 100],
      [0, 0.0001, 500],
      [0, 0.0001, -200],
      [0, 0.0002, -200],
      [0, 0.0002, 1000],
      [0, 0.0003, 1000],
    ];
    const result = buildRouteSlope([segment]);
    expect(result.available).toBe(true);
    expect(result.features.map((f) => f.properties.grade)).toEqual([0, 0, 0]);
    expect(result.features.map((f) => f.geometry.coordinates)).toEqual([
      segment.slice(0, 2),
      segment.slice(3, 5),
      segment.slice(5, 7),
    ]);
  });

  it.each(
    (
      [
        [0, 0],
        [0, 0, NaN],
        [0, 0, Infinity],
        [0, 0, -Infinity],
        [NaN, 0, 100],
        [0, Infinity, 100],
        [181, 0, 100],
        [0, 91, 100],
      ] satisfies Coordinate[]
    ).map((point) => ({ point })),
  )('rejects the entire track for an invalid or incomplete point $point', ({ point }) => {
    expect(buildRouteSlope([track(10, 5), [point]])).toEqual(unavailable);
    expect(buildRouteSlope([[track(2, 5)[0], point, track(2, 5)[1]]])).toEqual(unavailable);
  });

  it('rejects malformed coordinates using statistics validation', () => {
    const malformed = [[0, 0, 1, 2]] as unknown as Coordinate[];
    expect(buildRouteSlope([track(10, 5), malformed])).toEqual(unavailable);
  });

  it('handles empty, singleton, stationary and tiny drawable tracks', () => {
    for (const segments of [
      [],
      [[]],
      [[[0, 0, 100]]],
      [
        [
          [0, 0, 100],
          [0, 0, 500],
        ],
      ],
    ]) {
      expect(buildRouteSlope(segments as Coordinate[][])).toEqual(unavailable);
    }
    const tiny: Coordinate[][] = [
      [
        [0, 0, 100],
        [0, 0.0000001, 100.001],
      ],
    ];
    const result = buildRouteSlope(tiny);
    expect(result.available).toBe(true);
    expect(result.features[0].geometry.coordinates).toEqual(tiny[0]);
    expect(result.features[0].properties.grade).toBeCloseTo(
      (100 * 0.001) / calculateStats(tiny, 'hiking').distance,
      6,
    );
  });

  it('caps a 100k-point track deterministically without mutation or dropped geometry', () => {
    const segment = track(100_000, 5);
    const original = segment.map((point) => [...point]);
    segment.forEach(Object.freeze);
    Object.freeze(segment);
    const segments = [segment];
    Object.freeze(segments);
    const result = buildRouteSlope(segments);
    expect(result.available).toBe(true);
    expect(result.features.length).toBeLessThanOrEqual(MAX_SLOPE_FEATURES);
    expect(result.features.every((f) => Math.abs(f.properties.grade - 5) < 1e-6)).toBe(true);
    const reconstructed = result.features.flatMap((f, index) =>
      index === 0 ? f.geometry.coordinates : f.geometry.coordinates.slice(1),
    );
    expect(reconstructed).toEqual(original);
    expect(segment).toEqual(original);
    expect(buildRouteSlope(segments)).toEqual(result);
  });

  it('preserves multiple drawable runs at the cap and refuses unsafe excess runs', () => {
    const segments = Array.from({ length: MAX_SLOPE_FEATURES }, (_, index) =>
      track(4, index % 2 === 0 ? 5 : -5, index / 100),
    );
    const result = buildRouteSlope(segments);
    expect(result.available).toBe(true);
    expect(result.features).toHaveLength(MAX_SLOPE_FEATURES);
    expect(result.features.map((f) => f.geometry.coordinates)).toEqual(segments);
    expect(
      result.features.every(
        (f, index) => Math.abs(f.properties.grade - (index % 2 === 0 ? 5 : -5)) < 1e-6,
      ),
    ).toBe(true);
    expect(buildRouteSlope([...segments, track(2, 5)])).toEqual(unavailable);

    const stationaryRuns: Coordinate[] = [];
    for (let index = 0; index <= MAX_SLOPE_FEATURES; index++) {
      stationaryRuns.push([0, index * 0.0001, index], [0, (index + 1) * 0.0001, index]);
    }
    expect(buildRouteSlope([stationaryRuns])).toEqual(unavailable);
  });
});
