import { expect, it } from 'vitest';
import { elevationChartSamples } from './elevationChartSamples';
import type { Coordinate } from '../domain/types';

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
