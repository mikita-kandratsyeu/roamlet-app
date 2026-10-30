import { describe, expect, it } from 'vitest';
import { coordinateDistance, loopWaypoints, rankLoopCandidates } from './loops';
import type { Coordinate, RoutingResult } from '../domain/types';

const candidate = (coordinates: Coordinate[], distance: number): RoutingResult => ({
  segments: [coordinates],
  stats: { distance, duration: 420 },
});

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
  it('ranks by target distance without changing geometry or input order', () => {
    const farther = candidate(loopWaypoints([31, 52], 12000 / 3, 30), 12000);
    const closer = candidate(loopWaypoints([31, 52], 9500 / 3, 210), 9500);
    const input = [farther, closer];
    expect(rankLoopCandidates(input, 10000)).toEqual([closer, farther]);
    expect(input).toEqual([farther, closer]);
    expect(rankLoopCandidates(input, 10000)[0]).toBe(closer);
  });
  it('keeps the closest near-duplicate despite jitter, reversed travel and different vertex counts', () => {
    const points = loopWaypoints([31, 52], 10000 / 3, 30);
    const densified: Coordinate[] = points.flatMap((point, index) =>
      index === points.length - 1
        ? [point]
        : [point, [(point[0] + points[index + 1][0]) / 2, (point[1] + points[index + 1][1]) / 2]],
    );
    const jittered = points.map(([longitude, latitude]): Coordinate => [
      longitude + 0.0001,
      latitude,
    ]);
    const closest = candidate(points, 10000);
    expect(
      rankLoopCandidates(
        [candidate(jittered, 10001), candidate([...densified].reverse(), 10002), closest],
        10000,
      ),
    ).toEqual([closest]);
  });
  it('does not merge different trips sharing a starting point or significantly different lengths', () => {
    const first = candidate(loopWaypoints([31, 52], 10000 / 3, 30), 10000);
    const other = candidate(loopWaypoints([31, 52], 10000 / 3, 210), 10000);
    const longer = candidate(loopWaypoints([31, 52], 14000 / 3, 30), 14000);
    expect(rankLoopCandidates([first, other, longer], 10000)).toHaveLength(3);
  });
  it('deduplicates reversed routes across the dateline', () => {
    const points = loopWaypoints([179.99, 0], 10000 / 3, 90);
    expect(
      rankLoopCandidates(
        [candidate(points, 10000), candidate([...points].reverse(), 10001)],
        10000,
      ),
    ).toHaveLength(1);
  });
  it('computes near-zero closure across the dateline', () => {
    expect(coordinateDistance([180, 52], [-180, 52])).toBeLessThan(0.001);
  });
});
