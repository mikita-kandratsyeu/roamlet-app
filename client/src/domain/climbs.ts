import type { Coordinate, PlannedRoute } from './types';
import { elevationSamples } from './stats';

export const CLIMB_THRESHOLDS = Object.freeze({
  minimumLengthMeters: 300,
  minimumAscentMeters: 20,
  descentToleranceMeters: 3,
});

export interface Climb {
  segmentIndex: number;
  geometry: Coordinate[][];
  startDistanceMeters: number;
  endDistanceMeters: number;
  lengthMeters: number;
  /** Noise-filtered ascent: peak minus starting valley, not summed positive changes. */
  ascentMeters: number;
  /** 100 * net elevation gain / horizontal length (not mean sample grades). */
  averageGradePercent: number;
}

export type ClimbAnalysisResult =
  | { available: false; climbs: [] }
  | { available: true; elevationSource: 'gpx' | 'openrouteservice'; climbs: Climb[] };

type ClimbRoute = Pick<PlannedRoute, 'segments' | 'source' | 'elevationSource'>;

/**
 * Metres use the same horizontal, gap-excluding distances as route statistics.
 * A valley-to-peak rise of 3 m or more starts a run; a drop of 3 m or more from
 * the running peak ends it at that peak. Smaller reversals are noise, matching
 * the shared elevation filter.
 * Accepted runs span at least 300 m and gain at least 20 m net. Small reversals
 * do not inflate ascent. Internal plateaus count; leading/trailing flats do not.
 * Segment boundaries and zero-distance edges terminate runs: stationary height
 * jumps cannot create gain or connect climbs. No smoothing/interpolated heights.
 */
export function analyzeClimbs(route: ClimbRoute | null): ClimbAnalysisResult {
  const unavailable: ClimbAnalysisResult = { available: false, climbs: [] };
  if (!route || (route.source !== 'gpx' && route.elevationSource !== 'openrouteservice'))
    return unavailable;
  let samples: ReturnType<typeof elevationSamples>;
  try {
    samples = elevationSamples(route.segments);
  } catch {
    return unavailable;
  }
  if (samples.length < 2 || !(samples.at(-1)!.distance > 0)) return unavailable;

  const climbs: Climb[] = [];
  let sampleIndex = 0;
  route.segments.forEach((segment, segmentIndex) => {
    const distances = samples
      .slice(sampleIndex, sampleIndex + segment.length)
      .map((s) => s.distance);
    sampleIndex += segment.length;
    if (segment.length < 2) return;
    let valley = 0;
    let peak = 0;
    let climbing = false;
    const finish = () => {
      const lengthMeters = distances[peak] - distances[valley];
      const ascentMeters = segment[peak][2]! - segment[valley][2]!;
      if (
        climbing &&
        lengthMeters >= CLIMB_THRESHOLDS.minimumLengthMeters &&
        ascentMeters >= CLIMB_THRESHOLDS.minimumAscentMeters
      ) {
        climbs.push({
          segmentIndex,
          geometry: [segment.slice(valley, peak + 1).map((point) => [...point] as Coordinate)],
          startDistanceMeters: distances[valley],
          endDistanceMeters: distances[peak],
          lengthMeters,
          ascentMeters,
          averageGradePercent: (100 * ascentMeters) / lengthMeters,
        });
      }
    };
    for (let index = 1; index < segment.length; index++) {
      if (distances[index] === distances[index - 1]) {
        finish();
        valley = peak = index;
        climbing = false;
        continue;
      }
      const height = segment[index][2]!;
      if (!climbing) {
        if (height <= segment[valley][2]!) valley = index;
        if (height - segment[valley][2]! >= CLIMB_THRESHOLDS.descentToleranceMeters) {
          peak = index;
          climbing = true;
        }
      } else if (height > segment[peak][2]!) {
        peak = index;
      } else if (segment[peak][2]! - height >= CLIMB_THRESHOLDS.descentToleranceMeters) {
        finish();
        valley = peak = index;
        climbing = false;
      }
    }
    finish();
  });
  return {
    available: true,
    elevationSource: route.elevationSource === 'openrouteservice' ? 'openrouteservice' : 'gpx',
    climbs,
  };
}
