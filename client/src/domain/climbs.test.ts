import { describe, expect, it } from 'vitest';
import { analyzeClimbs, CLIMB_THRESHOLDS } from './climbs';
import type { Coordinate, PlannedRoute } from './types';

const metreDegrees = 180 / (Math.PI * 6_371_008.8);
function profile(heights: number[], step = 100): Coordinate[] {
  return heights.map((height, index) => [index * step * metreDegrees, 0, height]);
}
function route(segments: Coordinate[][], source: PlannedRoute['source'] = 'gpx') {
  return { segments, source };
}
function climbs(segments: Coordinate[][]) {
  const result = analyzeClimbs(route(segments));
  expect(result.available).toBe(true);
  return result.climbs;
}

it('returns geometry, horizontal offsets and net grade without relying on provider stats', () => {
  const segment = profile([100, 108, 106, 118, 125]);
  const input = route([segment]);
  const snapshot = structuredClone(input);
  const [climb] = analyzeClimbs(input).climbs;
  expect(climb.segmentIndex).toBe(0);
  expect(climb.startDistanceMeters).toBe(0);
  expect(climb.endDistanceMeters).toBeCloseTo(400);
  expect(climb.lengthMeters).toBeCloseTo(400);
  expect(climb.ascentMeters).toBe(25);
  expect(climb.averageGradePercent).toBeCloseTo(6.25);
  expect(climb.geometry).toEqual([segment]);
  climb.geometry[0][0][2] = -100;
  expect(input).toEqual(snapshot);
});

it('suppresses oscillation noise even when summed positive changes exceed 20 m', () => {
  expect(climbs([profile(Array.from({ length: 40 }, (_, i) => (i % 2 ? 103 : 100)))])).toEqual([]);
  expect(climbs([profile([100, 104, 100, 105, 100, 106, 100, 107, 100])])).toEqual([]);
});

it('never joins segments or counts their geographical/elevation gaps', () => {
  expect(climbs([profile([0, 10], 200), profile([1000, 1010], 200)])).toEqual([]);
  const first = profile([100, 110, 120, 130], 110);
  const second = profile([1000, 1010, 1020, 1030], 110).map(
    (point) => [point[0] + 30, point[1], point[2]] as Coordinate,
  );
  const detected = climbs([first, [], second]);
  expect(detected).toHaveLength(2);
  expect(detected[1].segmentIndex).toBe(2);
  expect(detected[1].startDistanceMeters).toBeCloseTo(330);
  expect(detected[1].endDistanceMeters).toBeCloseTo(660);
  expect(detected[1].geometry).toEqual([second]);
});

it('includes internal plateaus but excludes leading/trailing flats and downhill', () => {
  const segment = profile([100, 100, 110, 110, 110, 130, 130, 120, 100]);
  const [climb] = climbs([segment]);
  expect(climb.startDistanceMeters).toBeCloseTo(100);
  expect(climb.endDistanceMeters).toBeCloseTo(500);
  expect(climb.lengthMeters).toBeCloseTo(400);
  expect(climb.geometry).toEqual([segment.slice(1, 6)]);
  expect(climbs([profile([100, 100, 100, 100])])).toEqual([]);
  expect(climbs([profile([100, 90, 80, 70])])).toEqual([]);
});

it('splits a reversal of exactly 3 m and keeps a smaller dip inside one climb', () => {
  expect(climbs([profile([0, 10, 7, 15, 20], 110)])).toEqual([]);
  expect(climbs([profile([0, 10, 8, 6, 15, 20], 110)])).toEqual([]);
  expect(climbs([profile([0, 10, 20, 30, 26, 36, 46, 56], 110)])).toHaveLength(2);
  const split = climbs([profile([0, 30, 27, 57], 300)]);
  expect(split.map((climb) => climb.ascentMeters)).toEqual([30, 30]);
  expect(climbs([profile([0, 10, 8, 30], 150)])).toHaveLength(1);
});

it('guards stationary points: height jumps neither invent gain nor join runs', () => {
  expect(
    analyzeClimbs(
      route([
        [
          [0, 0, 0],
          [0, 0, 100],
        ],
      ]),
    ).available,
  ).toBe(false);
  expect(
    climbs([
      [
        [0, 0, 0],
        [0, 0, 100],
        [400 * metreDegrees, 0, 100],
      ],
    ]),
  ).toEqual([]);
  const segment = profile([0, 10, 20, 30], 110);
  const afterJump = profile([100, 110, 120, 130], 110).map(
    (point) => [point[0] + segment[3][0], 0, point[2]] as Coordinate,
  );
  const detected = climbs([[...segment, ...afterJump]]);
  expect(detected).toHaveLength(2);
  expect(detected.map((c) => c.ascentMeters)).toEqual([30, 30]);
  expect(detected.every((c) => Number.isFinite(c.averageGradePercent))).toBe(true);
});

it('applies inclusive ascent and length thresholds independently', () => {
  expect(CLIMB_THRESHOLDS).toEqual({
    minimumLengthMeters: 300,
    minimumAscentMeters: 20,
    descentToleranceMeters: 3,
  });
  expect(climbs([profile([0, 20], 299.99)])).toEqual([]);
  expect(climbs([profile([0, 19.99], 301)])).toEqual([]);
  expect(climbs([profile([0, 20], 300)])).toHaveLength(1);
  expect(climbs([profile([0, 20], 300.01)])).toHaveLength(1);
});

describe('eligibility', () => {
  it.each(['openrouteservice', 'mapbox', 'manual', 'mixed'] as const)(
    'rejects unmarked %s heights',
    (source) => {
      expect(analyzeClimbs(route([profile([0, 20], 400)], source))).toEqual({
        available: false,
        climbs: [],
      });
    },
  );
  it.each(['openrouteservice', 'mixed'] as const)(
    'accepts explicitly marked ORS heights (%s)',
    (source) => {
      const result = analyzeClimbs({
        ...route([profile([0, 20], 400)], source),
        elevationSource: 'openrouteservice',
      });
      expect(result.available).toBe(true);
      if (result.available) expect(result.elevationSource).toBe('openrouteservice');
      expect(result.climbs).toHaveLength(1);
    },
  );
  it.each(
    [
      [],
      [[]],
      [[[0, 0, 0]]],
      [
        [
          [0, 0],
          [0.01, 0],
        ],
      ],
      [
        [
          [0, 0, 0],
          [0.01, 0],
        ],
      ],
      [profile([0, 20], 400), [[1, 1]]],
      [
        [
          [0, 0, 0],
          [0.01, 0, NaN],
        ],
      ],
      [
        [
          [0, 0, 0],
          [0.01, 0, Infinity],
        ],
      ],
      [
        [
          [0, 0, 0],
          [181, 0, 20],
        ],
      ],
    ].map((segments) => ({ segments: segments as Coordinate[][] })),
  )('rejects missing, partial, invalid or insufficient profiles (%j)', ({ segments }) => {
    expect(analyzeClimbs(route(segments))).toEqual({ available: false, climbs: [] });
    expect(
      analyzeClimbs({ ...route(segments, 'mixed'), elevationSource: 'openrouteservice' }),
    ).toEqual({ available: false, climbs: [] });
  });
  it('handles no route', () => {
    expect(analyzeClimbs(null)).toEqual({ available: false, climbs: [] });
  });
});
