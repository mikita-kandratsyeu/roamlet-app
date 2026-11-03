import type { Coordinate } from '../domain/types';
import { analyzeRouteElevation } from '../domain/routeElevation';

export interface ElevationChartSample {
  distance: number;
  elevation: number | null;
  coordinate?: Coordinate;
}

export function elevationChartSamples(segments: Coordinate[][]): ElevationChartSample[] {
  const { available, samples } = analyzeRouteElevation(segments);
  if (!available) return [];
  const stride = Math.max(1, Math.ceil(samples.length / 400));
  return samples.filter((sample, index) => {
    if (index === 0 || index === samples.length - 1 || index % stride === 0) return true;
    const unknown = sample.elevation === null;
    return (
      unknown !== (samples[index - 1].elevation === null) ||
      unknown !== (samples[index + 1].elevation === null)
    );
  });
}
