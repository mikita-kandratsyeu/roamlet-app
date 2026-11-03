import { expect, it } from 'vitest';
import { elevationChartSamples } from './elevationChartSamples';
import type { Coordinate } from '../domain/types';
import { analyzeRouteElevation } from '../domain/routeElevation';
import { calculateStats } from '../domain/stats';

it('links samples to exact coordinates without joining separate tracks', () => {
  const segments: Coordinate[][] = [
    [
      [11, 47, 100],
      [11.01, 47, 120],
    ],
    [],
    [
      [12, 48, 130],
      [12.01, 48, 110],
    ],
  ];
  const before = structuredClone(segments);
  const samples = elevationChartSamples(segments);
  expect(samples).toHaveLength(5);
  expect(samples[1].coordinate).toEqual(segments[0][1]);
  expect(samples[2].elevation).toBeNull();
  expect(samples[2].distance).toBe(samples[1].distance);
  expect(samples[3].coordinate).toEqual(segments[2][0]);
  expect(segments).toEqual(before);
});

it('does not invent unavailable heights', () => {
  expect(
    elevationChartSamples([
      [
        [11, 47, 100],
        [11.01, 47],
      ],
    ]),
  ).toEqual([]);
});

it('keeps partial profiles at full offsets and gives unknown heights no hover coordinate', () => {
  const segment: Coordinate[] = [
    [0, 0],
    [0, 0.001, 10],
    [0, 0.002, 20],
    [0, 0.003],
    [0, 0.004, 900],
    [0, 0.005, 890],
    [0, 0.006],
  ];
  const samples = elevationChartSamples([segment]);
  expect(samples).toEqual(analyzeRouteElevation([segment]).samples);
  expect(samples.map((sample) => sample.elevation)).toEqual([null, 10, 20, null, 900, 890, null]);
  expect(samples[1].distance).toBeGreaterThan(0);
  expect(samples.at(-1)?.distance).toBe(calculateStats([segment], 'hiking').distance);
  samples
    .filter((sample) => sample.elevation === null)
    .forEach((sample) => {
      expect(sample).not.toHaveProperty('coordinate');
    });
});

it('keeps each known run endpoint and break while downsampling partial and stationary runs', () => {
  const segment: Coordinate[] = Array.from({ length: 1200 }, (_, index) => [
    0,
    index / 10000,
    index,
  ]);
  segment[403] = [0, 403 / 10000];
  segment[802] = [0, 801 / 10000, 9000];
  const segments = [
    segment,
    [
      [50, 50, 10],
      [50, 50.001, 20],
    ] as Coordinate[],
  ];
  const before = structuredClone(segments);
  const analysis = analyzeRouteElevation(segments);
  const samples = elevationChartSamples(segments);
  expect(samples.length).toBeLessThan(420);
  for (const run of analysis.runs) {
    expect(samples.some((sample) => sample.coordinate === run[0])).toBe(true);
    expect(samples.some((sample) => sample.coordinate === run.at(-1))).toBe(true);
  }
  expect(samples.filter((sample) => sample.elevation === null)).toEqual(
    analysis.samples.filter((sample) => sample.elevation === null),
  );
  expect(samples.at(-1)?.distance).toBe(analysis.distance);
  expect(segments).toEqual(before);
});

it('does not bridge long unknown stretches and preserves their boundary offsets', () => {
  const segment: Coordinate[] = Array.from({ length: 1500 }, (_, index) =>
    index < 2 || index >= 1498 ? [0, index / 10000, index] : [0, index / 10000],
  );
  const analysis = analyzeRouteElevation([segment]);
  const samples = elevationChartSamples([segment]);
  expect(samples.length).toBeLessThan(410);
  expect(samples[1].coordinate).toBe(segment[1]);
  expect(samples[2]).toEqual(analysis.samples[2]);
  expect(samples.at(-3)).toEqual(analysis.samples.at(-3));
  expect(samples.at(-2)?.coordinate).toBe(segment.at(-2));
  expect(
    samples.slice(2, -2).every((sample) => sample.elevation === null && !sample.coordinate),
  ).toBe(true);
});

it('returns no chart for invalid data, stationary heights or isolated known points', () => {
  for (const segments of [
    [
      [
        [0, 0, 10],
        [0, 0.001],
        [0, 0.002, 20],
      ],
    ],
    [
      [
        [0, 0, 10],
        [0, 0, 20],
      ],
    ],
    [[[0, 0, 10]], [[0, 0.001, 20]]],
    [
      [
        [0, 0, 10],
        [0, 0.001, 20],
      ],
      [[0, 0, Infinity]],
    ],
  ]) {
    expect(elevationChartSamples(segments as Coordinate[][])).toEqual([]);
  }
});

it('keeps every segment endpoint when decimating the chart', () => {
  const segment: Coordinate[] = Array.from({ length: 1000 }, (_, index) => [
    index / 1000,
    47,
    index,
  ]);
  const samples = elevationChartSamples([segment]);
  expect(samples.length).toBeLessThan(400);
  expect(samples[0].coordinate).toEqual(segment[0]);
  expect(samples.at(-1)?.coordinate).toEqual(segment.at(-1));
});
