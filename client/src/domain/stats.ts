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

/** A reversal smaller than this is GPS noise, not gain or loss. */
export const ELEVATION_REVERSAL_METERS = 3;

export interface FilteredElevation {
  ascent: number;
  descent: number;
  /**
   * Rise of edges inside a filtered climb whose own grade meets `steepGrade`.
   * A sub-3 m dip can be regained, so this can slightly exceed net ascent.
   */
  steepAscent: number;
  /** Horizontal metres of those steep edges. */
  steepHorizontal: number;
  /** Horizontal metres of every non-stationary edge. */
  horizontal: number;
}

function profileIsComplete(segments: Coordinate[][]): boolean {
  return (
    Array.isArray(segments) &&
    segments.length > 0 &&
    segments.every((segment) => Array.isArray(segment)) &&
    segments.some((segment) => segment.length > 1) &&
    segments.every((segment) =>
      segment.every((point) => Array.isArray(point) && Number.isFinite(point[2])),
    )
  );
}

/**
 * Noise-filtered ascent. `sign` -1 measures descent with the same 3 m hysteresis.
 * A stationary edge closes the current run and adds nothing: a height jump at one
 * coordinate is not gain. Segment gaps never connect.
 * Steep totals use each edge's own rise/run inside the valley-to-peak span.
 * The run's average grade is not used, so a gentle continuation does not erase a
 * steep pitch and an internal flat is not charged at vertical speed.
 */
function filteredChange(
  segments: Coordinate[][],
  sign: 1 | -1,
  steepGrade: number,
): Pick<FilteredElevation, 'ascent' | 'steepAscent' | 'steepHorizontal' | 'horizontal'> | null {
  if (!profileIsComplete(segments)) return null;
  let ascent = 0;
  let steepAscent = 0;
  let steepHorizontal = 0;
  let horizontal = 0;
  for (const segment of segments) {
    if (!segment.length) continue;
    let valley = sign * segment[0][2]!;
    let valleyIndex = 0;
    let peak = valley;
    let peakIndex = 0;
    let climbing = false;
    const close = () => {
      if (!climbing) return;
      ascent += peak - valley;
      for (let index = valleyIndex + 1; index <= peakIndex; index++) {
        const edge = distanceBetween(segment[index - 1], segment[index]);
        const rise = sign * segment[index][2]! - sign * segment[index - 1][2]!;
        if (edge > 0 && rise / edge >= steepGrade) {
          steepAscent += rise;
          steepHorizontal += edge;
        }
      }
      climbing = false;
    };
    for (let index = 1; index < segment.length; index++) {
      const edge = distanceBetween(segment[index - 1], segment[index]);
      const height = sign * segment[index][2]!;
      if (!(edge > 0)) {
        close();
        valley = peak = height;
        valleyIndex = peakIndex = index;
        continue;
      }
      horizontal += edge;
      if (!climbing) {
        if (height < valley) {
          valley = height;
          valleyIndex = index;
        }
        if (height - valley >= ELEVATION_REVERSAL_METERS) {
          peak = height;
          peakIndex = index;
          climbing = true;
        }
      } else if (height > peak) {
        peak = height;
        peakIndex = index;
      } else if (peak - height >= ELEVATION_REVERSAL_METERS) {
        close();
        valley = peak = height;
        valleyIndex = peakIndex = index;
      }
    }
    close();
  }
  return { ascent, steepAscent, steepHorizontal, horizontal };
}

/**
 * One elevation total for statistics and time. Steep fields sum edges inside a
 * filtered climb whose own rise/run is at least `steepGrade`. The default keeps
 * those fields at zero.
 */
export function measureElevation(
  segments: Coordinate[][],
  steepGrade = Number.POSITIVE_INFINITY,
): FilteredElevation | null {
  const ascent = filteredChange(segments, 1, steepGrade);
  const descent = filteredChange(segments, -1, Number.POSITIVE_INFINITY);
  if (!ascent || !descent) return null;
  return {
    ascent: ascent.ascent,
    descent: descent.ascent,
    steepAscent: ascent.steepAscent,
    steepHorizontal: ascent.steepHorizontal,
    horizontal: ascent.horizontal,
  };
}

/** Distances are metres; duration is seconds. Segment gaps never contribute.
 * Ascent and descent use the shared 3 m filter, so they match the time estimate.
 */
export function calculateStats(segments: Coordinate[][], activity: Activity): RouteStats {
  if (activity !== 'cycling' && activity !== 'hiking') throw new Error('Unsupported activity.');
  let distance = 0;
  let count = 0;
  let complete = true;
  for (const segment of segments) {
    for (let index = 0; index < segment.length; index++) {
      const point = segment[index];
      validate(point);
      count++;
      complete &&= point.length === 3;
      if (index === 0) continue;
      distance += distanceBetween(segment[index - 1], point);
    }
  }
  const result: RouteStats = {
    distance,
    duration: distance / ((activity === 'cycling' ? 18 : 5) / 3.6),
  };
  if (complete && count > 0) {
    const measured = measureElevation(segments);
    result.ascent = measured?.ascent ?? 0;
    result.descent = measured?.descent ?? 0;
  }
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
