import { calculateStats, measureElevation } from './stats';
import type { Coordinate } from './types';

export interface RouteElevationSample {
  distance: number;
  elevation: number | null;
  coordinate?: Coordinate;
}

export interface RouteElevationAnalysis {
  available: boolean;
  complete: boolean;
  distance: number;
  ascent: number;
  descent: number;
  samples: RouteElevationSample[];
  runs: Coordinate[][];
}

/** Genuine heights at full horizontal offsets; gaps and stationary edges split known runs. */
export function analyzeRouteElevation(segments: Coordinate[][]): RouteElevationAnalysis {
  let stats: ReturnType<typeof calculateStats>;
  try {
    stats = calculateStats(segments, 'hiking');
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== 'Invalid coordinate: expected [longitude, latitude, optional elevation].'
    ) {
      throw error;
    }
    return {
      available: false,
      complete: false,
      distance: 0,
      ascent: 0,
      descent: 0,
      samples: [],
      runs: [],
    };
  }

  const samples: RouteElevationSample[] = [];
  const runs: Coordinate[][] = [];
  let distance = 0;
  for (const segment of segments) {
    if (!segment.length) continue;
    if (samples.length) samples.push({ distance, elevation: null });
    let run: Coordinate[] | undefined;
    for (let index = 0; index < segment.length; index++) {
      const point = segment[index];
      if (index > 0) {
        const previous = segment[index - 1];
        const edgeDistance = calculateStats([[previous, point]], 'hiking').distance;
        distance += edgeDistance;
        if (edgeDistance === 0) samples.push({ distance, elevation: null });
        if (edgeDistance > 0 && previous.length === 3 && point.length === 3) {
          if (!run) {
            run = [previous];
            runs.push(run);
          }
          run.push(point);
        } else {
          run = undefined;
        }
      }
      samples.push(
        point.length === 3
          ? { distance, elevation: point[2], coordinate: point }
          : { distance, elevation: null },
      );
    }
  }
  const measured = runs.length ? measureElevation(runs) : null;
  return {
    available: runs.length > 0,
    complete: stats.ascent !== undefined,
    distance: stats.distance,
    ascent: measured?.ascent ?? 0,
    descent: measured?.descent ?? 0,
    samples,
    runs,
  };
}
