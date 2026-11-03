import { elevationSamples } from './stats';
import type { Coordinate } from './types';

/** Nominal centred horizontal-distance window, in metres. */
export const SLOPE_WINDOW_METERS = 100;
/** Maximum number of LineString features, without dropping drawable edges. */
export const MAX_SLOPE_FEATURES = 2000;

export interface SlopeFeature {
  type: 'Feature';
  properties: { grade: number };
  geometry: { type: 'LineString'; coordinates: Coordinate[] };
}

interface DrawableRun {
  coordinates: Coordinate[];
  distances: number[];
}

/**
 * Grades are percentages over a 100 m window centred on each edge midpoint.
 * Windows are truncated at segment/zero-distance boundaries and use the original
 * samples bracketing the window (sparse samples can therefore exceed 100 m).
 * No heights or geometry are interpolated. Every zero-horizontal-distance edge
 * splits runs, so stationary elevation jumps never contribute to a grade.
 * At the feature cap, contiguous edge groups use distance-weighted window grades;
 * all original drawable geometry survives. More than 2000 independent runs is
 * unavailable rather than bridged. Validation/distances reuse route statistics.
 * Two monotone window cursors keep time and storage linear in the point count.
 */
export function buildRouteSlope(segments: Coordinate[][]): {
  available: boolean;
  features: SlopeFeature[];
} {
  const unavailable = { available: false, features: [] };
  let samples: ReturnType<typeof elevationSamples>;
  try {
    samples = elevationSamples(segments);
  } catch {
    return unavailable;
  }
  if (samples.length < 2) return unavailable;

  const runs: DrawableRun[] = [];
  let sampleIndex = 0;
  let edgeCount = 0;
  for (const segment of segments) {
    let start = 0;
    const finish = (end: number) => {
      if (end <= start) return;
      runs.push({
        coordinates: segment.slice(start, end + 1),
        distances: samples.slice(sampleIndex + start, sampleIndex + end + 1).map((s) => s.distance),
      });
      edgeCount += end - start;
    };
    for (let index = 1; index < segment.length; index++) {
      if (samples[sampleIndex + index].distance === samples[sampleIndex + index - 1].distance) {
        finish(index - 1);
        start = index;
      }
    }
    finish(segment.length - 1);
    sampleIndex += segment.length;
  }
  if (edgeCount === 0 || runs.length > MAX_SLOPE_FEATURES) return unavailable;

  // Sum ceil(runEdges / groupSize) <= edgeCount / groupSize + runs.length - 1.
  const groupSize = Math.ceil(edgeCount / (MAX_SLOPE_FEATURES - runs.length + 1));
  const features: SlopeFeature[] = [];
  for (const { coordinates, distances } of runs) {
    let left = 0;
    let right = 1;
    let groupStart = 0;
    let groupDistance = 0;
    let groupGrade = 0;
    for (let index = 1; index < coordinates.length; index++) {
      const edgeDistance = distances[index] - distances[index - 1];
      const midpoint = distances[index - 1] + edgeDistance / 2;
      const windowStart = midpoint - SLOPE_WINDOW_METERS / 2;
      const windowEnd = midpoint + SLOPE_WINDOW_METERS / 2;
      while (left + 1 < index && distances[left + 1] <= windowStart) left++;
      right = Math.max(right, index);
      while (right < coordinates.length - 1 && distances[right] < windowEnd) right++;
      const length = distances[right] - distances[left];
      const grade = (100 * (coordinates[right][2]! - coordinates[left][2]!)) / length;
      if (!Number.isFinite(grade)) return unavailable;
      groupDistance += edgeDistance;
      groupGrade += (grade - groupGrade) * (edgeDistance / groupDistance);
      if (!Number.isFinite(groupGrade)) return unavailable;
      if (index - groupStart === groupSize || index === coordinates.length - 1) {
        features.push({
          type: 'Feature',
          properties: { grade: groupGrade },
          geometry: {
            type: 'LineString',
            coordinates: coordinates
              .slice(groupStart, index + 1)
              .map((point) => [...point] as Coordinate),
          },
        });
        groupStart = index;
        groupDistance = groupGrade = 0;
      }
    }
  }
  return { available: true, features };
}
