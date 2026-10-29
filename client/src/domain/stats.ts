import type { Activity, Coordinate, RouteStats } from './types';

const EARTH_RADIUS = 6_371_008.8;
const RADIANS = Math.PI / 180;

function validate(point: Coordinate): void {
  if (
    !Array.isArray(point) ||
    (point.length !== 2 && point.length !== 3) ||
    !Array.from(point).every(Number.isFinite) ||
    Math.abs(point[0]) > 180 ||
    Math.abs(point[1]) > 90
  ) {
    throw new Error('Invalid coordinate: expected [longitude, latitude, optional elevation].');
  }
}

function distanceBetween(a: Coordinate, b: Coordinate): number {
  const lat = (b[1] - a[1]) * RADIANS;
  const lon = (b[0] - a[0]) * RADIANS;
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(a[1] * RADIANS) * Math.cos(b[1] * RADIANS) * Math.sin(lon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** Distances are metres; duration is seconds. Segment gaps never contribute. */
export function calculateStats(segments: Coordinate[][], activity: Activity): RouteStats {
  if (activity !== 'cycling' && activity !== 'hiking') throw new Error('Unsupported activity.');
  let distance = 0;
  let ascent = 0;
  let descent = 0;
  let count = 0;
  let complete = true;
  for (const segment of segments) {
    for (let index = 0; index < segment.length; index++) {
      const point = segment[index];
      validate(point);
      count++;
      complete &&= point.length === 3;
      if (index === 0) continue;
      const previous = segment[index - 1];
      distance += distanceBetween(previous, point);
      if (point.length === 3 && previous.length === 3) {
        const change = point[2] - previous[2];
        ascent += Math.max(0, change);
        descent += Math.max(0, -change);
      }
    }
  }
  const result: RouteStats = {
    distance,
    duration: distance / ((activity === 'cycling' ? 18 : 5) / 3.6),
  };
  if (complete && count > 0) Object.assign(result, { ascent, descent });
  return result;
}

/** Cumulative metres within segments; an incomplete elevation profile returns no samples. */
export function elevationSamples(
  segments: Coordinate[][],
): { distance: number; elevation: number }[] {
  const stats = calculateStats(segments, 'hiking');
  if (stats.ascent === undefined) return [];
  let distance = 0;
  const samples: { distance: number; elevation: number }[] = [];
  for (const segment of segments) {
    segment.forEach((point, index) => {
      if (index > 0) distance += distanceBetween(segment[index - 1], point);
      samples.push({ distance, elevation: point[2]! });
    });
  }
  return samples;
}
