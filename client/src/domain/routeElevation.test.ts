import { describe, expect, it, vi } from 'vitest';
import { analyzeRouteElevation } from './routeElevation';
import { calculateStats, elevationSamples } from './stats';
import * as stats from './stats';
import type { Coordinate } from './types';

const unavailable = {
  available: false,
  complete: false,
  distance: 0,
  ascent: 0,
  descent: 0,
  samples: [],
  runs: [],
};

function point(index: number, elevation?: number): Coordinate {
  return elevation === undefined ? [0, index * 0.001] : [0, index * 0.001, elevation];
}

const step = calculateStats([[point(0), point(1)]], 'hiking').distance;

describe('partial route elevation', () => {
  it('retains known runs, heights and full manual-edge offsets without mutation', () => {
    const segment = [
      point(0),
      point(1, 0),
      point(2, 10),
      point(3),
      point(4, 90),
      point(5, 70),
      point(6),
    ];
    const original = structuredClone(segment);
    segment.forEach(Object.freeze);
    Object.freeze(segment);
    const segments = [segment];
    Object.freeze(segments);
    const result = analyzeRouteElevation(segments);
    expect(result.available).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.distance).toBe(calculateStats(segments, 'hiking').distance);
    expect(result.ascent).toBe(10);
    expect(result.descent).toBe(20);
    expect(result.runs).toEqual([segment.slice(1, 3), segment.slice(4, 6)]);
    expect(result.runs[0][0]).toBe(segment[1]);
    expect(result.samples.map((sample) => sample.elevation)).toEqual([
      null,
      0,
      10,
      null,
      90,
      70,
      null,
    ]);
    result.samples.forEach((sample, index) => {
      expect(sample.distance).toBeCloseTo(step * index, 8);
      if (sample.elevation === null) expect(sample).not.toHaveProperty('coordinate');
      else expect(sample.coordinate).toBe(segment[index]);
    });
    expect(segment).toEqual(original);
    expect(elevationSamples(segments)).toEqual([]);
    expect(calculateStats(segments, 'hiking').ascent).toBeUndefined();
  });

  it('splits GPX gaps without counting their distance or elevation change', () => {
    const first = [point(0, 10), point(1, 30)];
    const second: Coordinate[] = [
      [100, 50, 900],
      [100, 50.001, 890],
    ];
    const result = analyzeRouteElevation([[], first, [], [[40, 40, 500]], [], second, []]);
    expect(result.available).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.runs).toEqual([first, second]);
    expect(result.ascent).toBe(20);
    expect(result.descent).toBe(10);
    expect(result.distance).toBeCloseTo(step * 2, 8);
    expect(result.samples.map((sample) => sample.elevation)).toEqual([
      10,
      30,
      null,
      500,
      null,
      900,
      890,
    ]);
    expect(result.samples.slice(1, 6).every((sample) => sample.distance === step)).toBe(true);
  });

  it('splits consecutive stationary jumps and only sums moving known edges', () => {
    const segment = [point(0, 10), point(1, 20), point(1, 1000), point(1, -500), point(2, -510)];
    const result = analyzeRouteElevation([segment]);
    expect(result.complete).toBe(true);
    expect(result.available).toBe(true);
    expect(result.ascent).toBe(10);
    expect(result.descent).toBe(10);
    expect(result.distance).toBeCloseTo(step * 2, 8);
    expect(result.runs).toEqual([segment.slice(0, 2), segment.slice(3)]);
    expect(result.samples.map((sample) => sample.elevation)).toEqual([
      10,
      20,
      null,
      1000,
      null,
      -500,
      -510,
    ]);
    expect(result.samples.slice(1, 6).every((sample) => sample.distance === step)).toBe(true);
  });

  it('distinguishes completeness from a drawable known pair', () => {
    expect(analyzeRouteElevation([])).toEqual(unavailable);
    expect(analyzeRouteElevation([[]])).toEqual(unavailable);
    for (const segments of [
      [[point(0, 10)]],
      [[point(0, 10)], [point(1, 20)]],
      [[point(0, 10), point(0, 20)]],
    ]) {
      const result = analyzeRouteElevation(segments);
      expect(result.available).toBe(false);
      expect(result.complete).toBe(true);
      expect(result.runs).toEqual([]);
      expect(result.ascent).toBe(0);
      expect(result.descent).toBe(0);
    }
    for (const segment of [
      [point(0, 10), point(1)],
      [point(0, 10), point(1), point(2, 20)],
      [point(0), point(1)],
    ]) {
      const result = analyzeRouteElevation([segment]);
      expect(result.available).toBe(false);
      expect(result.complete).toBe(false);
      expect(result.distance).toBeGreaterThan(0);
      expect(result.runs).toEqual([]);
    }
  });

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite original heights (%s)', (height) => {
    expect(analyzeRouteElevation([[point(0, 0), point(1, 10)], [point(2, height)]])).toEqual(
      unavailable,
    );
  });

  it('rejects malformed and out-of-range original coordinates', () => {
    const invalid: unknown[] = [
      [181, 0, 10],
      [0, 91, 10],
      [NaN, 0],
      [0, Infinity],
      [0],
      [0, 0, 1, 2],
      [0, 0, undefined],
      null,
    ];
    for (const coordinate of invalid) {
      expect(
        analyzeRouteElevation([[point(0, 0), point(1, 10)], [coordinate as Coordinate]]),
      ).toEqual(unavailable);
    }
  });

  it('does not swallow unrelated failures from statistics', () => {
    const failure = new Error('Unexpected statistics failure');
    const spy = vi.spyOn(stats, 'calculateStats').mockImplementationOnce(() => {
      throw failure;
    });
    try {
      expect(() => analyzeRouteElevation([[point(0, 10), point(1, 20)]])).toThrow(failure);
    } finally {
      spy.mockRestore();
    }
  });
});
