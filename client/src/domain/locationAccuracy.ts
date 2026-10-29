import type { Coordinate } from './types';

export function locationAccuracy(coordinate: Coordinate, accuracy: number) {
  const features: {
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'Polygon'; coordinates: Coordinate[][] };
  }[] = [];
  if (Number.isFinite(accuracy) && accuracy > 0) {
    const [longitude, latitude] = coordinate.map((value) => (value * Math.PI) / 180);
    const radius = accuracy / 6371008.8;
    const ring: Coordinate[] = [];
    for (let step = 0; step < 64; step++) {
      const bearing = (step * 2 * Math.PI) / 64;
      const lat = Math.asin(
        Math.sin(latitude) * Math.cos(radius) +
          Math.cos(latitude) * Math.sin(radius) * Math.cos(bearing),
      );
      const lng = longitude + Math.atan2(
        Math.sin(bearing) * Math.sin(radius) * Math.cos(latitude),
        Math.cos(radius) - Math.sin(latitude) * Math.sin(lat),
      );
      ring.push([(lng * 180) / Math.PI, (lat * 180) / Math.PI]);
    }
    ring.push([...ring[0]]);
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { type: 'FeatureCollection' as const, features };
}
