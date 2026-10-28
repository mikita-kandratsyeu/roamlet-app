import { describe, expect, it } from 'vitest';
import { coordinateDistance, loopWaypoints } from './loops';

describe('loop candidates', () => {
  it('constructs a closed triangle with the requested approximate perimeter', () => {
    const points = loopWaypoints([31, 52], 10000 / 3, 30);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual(points[3]);
    const distance = points
      .slice(1)
      .reduce((sum, point, i) => sum + coordinateDistance(points[i], point), 0);
    expect(distance).toBeCloseTo(10000, 0);
    expect(coordinateDistance(points[0], points[1])).toBeCloseTo(10000 / 3, 3);
  });
  it('wraps longitude across the dateline without changing the origin', () => {
    const origin: [number, number] = [179.99, 0];
    const points = loopWaypoints(origin, 10000, 90);
    expect(points[1][0]).toBeLessThan(0);
    expect(
      points.every(
        ([longitude, latitude]) => Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90,
      ),
    ).toBe(true);
    expect(origin).toEqual([179.99, 0]);
  });
  it('computes near-zero closure across the dateline', () => {
    expect(coordinateDistance([180, 52], [-180, 52])).toBeLessThan(0.001);
  });
});
