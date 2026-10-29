import type { Coordinate } from '../domain/types';
import { elevationSamples } from '../domain/stats';

export interface ElevationChartSample {
  distance: number;
  elevation: number | null;
  coordinate?: Coordinate;
}

export function elevationChartSamples(segments: Coordinate[][]): ElevationChartSample[] {
  const samples = elevationSamples(segments);
  if (!samples.length) return [];
  const stride = Math.max(1, Math.ceil(samples.length / 400));
  const chart: ElevationChartSample[] = [];
  let offset = 0;
  for (const segment of segments) {
    if (segment.length && chart.length)
      chart.push({ distance: samples[offset].distance, elevation: null });
    for (let index = 0; index < segment.length; index++) {
      if (index === 0 || index === segment.length - 1 || (offset + index) % stride === 0)
        chart.push({ ...samples[offset + index], coordinate: segment[index] });
    }
    offset += segment.length;
  }
  return chart;
}
