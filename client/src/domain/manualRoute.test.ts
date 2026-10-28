import { describe, expect, it } from 'vitest';
import { manualRoute, MANUAL_STOP_LIMIT } from './manualRoute';
import type { Waypoint } from './types';

const points: Waypoint[] = [
  { id: 'a', name: 'Start', coordinate: [11.4, 47.26, 600] },
  { id: 'b', name: 'Finish', coordinate: [11.41, 47.27, 700] },
];

describe('manual routes', () => {
  it('connects only user points, without interpolating geometry or inventing elevation', () => {
    const route = manualRoute(points, 'cycling');
    expect(route.segments).toEqual([
      [
        [11.4, 47.26],
        [11.41, 47.27],
      ],
    ]);
    expect(route.stats.distance).toBeGreaterThan(1000);
    expect(route.stats.ascent).toBeUndefined();
    route.segments[0][0][0] = 0;
    expect(points[0].coordinate[0]).toBe(11.4);
  });
  it('estimates duration using the existing cycling and hiking speeds', () => {
    const bike = manualRoute(points, 'cycling');
    const walk = manualRoute(points, 'hiking');
    expect(walk.stats.distance).toBe(bike.stats.distance);
    expect(bike.stats.duration).toBeCloseTo(bike.stats.distance / 5);
    expect(walk.stats.duration / bike.stats.duration).toBeCloseTo(18 / 5);
  });
  it('supports more points than Directions and validates the local limit', () => {
    const many = Array.from({ length: 26 }, (_, i) => ({ ...points[0], id: String(i) }));
    expect(manualRoute(many, 'cycling').segments[0]).toHaveLength(26);
    expect(() => manualRoute([], 'cycling')).toThrow('2 and 1,000');
    expect(() => manualRoute(Array(MANUAL_STOP_LIMIT + 1).fill(points[0]), 'cycling')).toThrow(
      '2 and 1,000',
    );
    expect(() =>
      manualRoute([{ ...points[0], coordinate: [999, 47] }, points[1]], 'cycling'),
    ).toThrow();
  });
});
