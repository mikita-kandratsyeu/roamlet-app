import { describe, expect, it } from 'vitest';
import { calculateStats, elevationSamples, measureElevation } from './stats';
import type { Coordinate } from './types';

describe('route statistics', () => {
  const segments: Coordinate[][] = [
    [
      [0, 0, 100],
      [0, 0.01, 130],
    ],
    [
      [100, 50, 900],
      [100, 50.01, 880],
    ],
  ];
  it('uses metres and seconds, without bridging segment gaps', () => {
    const hiking = calculateStats(segments, 'hiking');
    const cycling = calculateStats(segments, 'cycling');
    expect(hiking.distance).toBeCloseTo(2223.9, 0);
    expect(hiking.ascent).toBe(30);
    expect(hiking.descent).toBe(20);
    expect(hiking.duration).toBeCloseTo(hiking.distance / (5 / 3.6));
    expect(cycling.duration).toBeCloseTo(cycling.distance / 5);
  });
  it('samples all points and never introduces gap distance', () => {
    const samples = elevationSamples(segments);
    expect(samples.map((sample) => sample.elevation)).toEqual([100, 130, 900, 880]);
    expect(samples[0].distance).toBe(0);
    expect(samples[2].distance).toBe(samples[1].distance);
    expect(samples[3].distance).toBe(calculateStats(segments, 'hiking').distance);
  });
  it('omits elevation metrics if any elevation is absent', () => {
    const incomplete: Coordinate[][] = [
      [
        [0, 0, 0],
        [0, 0.01, 10],
      ],
      [[1, 1]],
    ];
    expect(calculateStats(incomplete, 'hiking').ascent).toBeUndefined();
    expect(calculateStats(incomplete, 'hiking').descent).toBeUndefined();
    expect(elevationSamples(incomplete)).toEqual([]);
  });
  it('handles empty, singleton, flat and antimeridian segments', () => {
    expect(calculateStats([[]], 'hiking')).toEqual({ distance: 0, duration: 0 });
    expect(elevationSamples([])).toEqual([]);
    expect(calculateStats([[[0, 0, 0]], [], [[10, 10, 1000]]], 'cycling')).toEqual({
      distance: 0,
      duration: 0,
      ascent: 0,
      descent: 0,
    });
    expect(
      calculateStats(
        [
          [
            [179.99, 0],
            [-179.99, 0],
          ],
        ],
        'hiking',
      ).distance,
    ).toBeCloseTo(2223.9, 0);
  });
  it('ignores reversals under 3 m and stationary height jumps', () => {
    expect(
      calculateStats(
        [
          [
            [0, 0, 100],
            [0, 0.001, 102],
            [0, 0.002, 100],
            [0, 0.003, 130],
          ],
        ],
        'hiking',
      ).ascent,
    ).toBe(30);
    const jumped = calculateStats(
      [
        [
          [0, 0, 0],
          [0, 0, 50],
          [0, 0.001, 50],
        ],
      ],
      'hiking',
    );
    expect(jumped.ascent).toBe(0);
    expect(jumped.descent).toBe(0);
  });
  it('grades cycling climbs per edge, so a gentle tail or internal flat does not swallow the steep pitch', () => {
    const metreDegrees = 180 / (Math.PI * 6_371_008.8);
    const point = (metres: number, elevation: number): Coordinate => [
      metres * metreDegrees,
      0,
      elevation,
    ];
    const diluted = measureElevation(
      [
        [
          point(0, 0),
          point(1000, 100),
          point(6000, 110),
        ],
      ],
      0.04,
    );
    expect(diluted).toMatchObject({ ascent: 110, steepAscent: 100 });
    expect(diluted!.steepHorizontal).toBeCloseTo(1000);
    expect(diluted!.horizontal).toBeCloseTo(6000);

    const plateau = measureElevation(
      [
        [
          point(0, 0),
          point(500, 80),
          point(3500, 80),
          point(4000, 160),
        ],
      ],
      0.04,
    );
    expect(plateau).toMatchObject({ ascent: 160, steepAscent: 160 });
    expect(plateau!.steepHorizontal).toBeCloseTo(1000);
    expect(plateau!.horizontal).toBeCloseTo(4000);

    const exact = measureElevation([[point(0, 0), point(2500, 100)]], 0.04);
    expect(exact).toMatchObject({ steepAscent: 100 });
    expect(exact!.steepHorizontal).toBeCloseTo(2500);
    const below = measureElevation([[point(0, 0), point(1000, 39)]], 0.04);
    expect(below).toMatchObject({ ascent: 39, steepAscent: 0, steepHorizontal: 0 });
  });
  it('rejects nonfinite and out-of-bounds coordinates', () => {
    expect(() => calculateStats([[[NaN, 0]]], 'hiking')).toThrow(/coordinate/);
    expect(() => calculateStats([[[0, 91]]], 'hiking')).toThrow(/coordinate/);
    expect(() => elevationSamples([[[0, 0, Infinity]]])).toThrow(/coordinate/);
  });
});
