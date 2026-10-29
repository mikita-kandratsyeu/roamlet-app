import type { Coordinate } from './types';

const radians = (value: number) => (value * Math.PI) / 180;

export function kilometerSpacing(zoom: number): number {
  return zoom < 9 ? 50 : zoom < 11 ? 10 : zoom < 13 ? 5 : 1;
}

export function lineFeatures(segments: Coordinate[][]) {
  return {
    type: 'FeatureCollection' as const,
    features: segments
      .filter((segment) => segment.length >= 2)
      .map((coordinates) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates },
      })),
  };
}

export function pointFeature(coordinate?: Coordinate | null) {
  return {
    type: 'FeatureCollection' as const,
    features: coordinate
      ? [
          {
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'Point' as const, coordinates: coordinate },
          },
        ]
      : [],
  };
}

/** Distance accumulates across segments, but gaps never contribute distance or geometry. */
export function routeAnnotations(segments: Coordinate[][], zoom: number) {
  const spacing = kilometerSpacing(zoom) * 1000;
  const arrowSpacing = spacing / 2;
  let distance = 0;
  let nextKilometer = spacing;
  let nextArrow = arrowSpacing;
  const features: {
    type: 'Feature';
    properties: { kind: 'kilometer' | 'direction'; label: string; bearing: number };
    geometry: { type: 'Point'; coordinates: Coordinate };
  }[] = [];
  for (const segment of segments) {
    for (let index = 1; index < segment.length; index++) {
      const a = segment[index - 1],
        b = segment[index];
      const latitudeDelta = radians(b[1] - a[1]);
      const longitudeDelta = radians(b[0] - a[0]);
      const h =
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(longitudeDelta / 2) ** 2;
      const length = 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
      if (!length || !Number.isFinite(length)) continue;
      const bearing =
        (Math.atan2(
          Math.sin(longitudeDelta) * Math.cos(radians(b[1])),
          Math.cos(radians(a[1])) * Math.sin(radians(b[1])) -
            Math.sin(radians(a[1])) * Math.cos(radians(b[1])) * Math.cos(longitudeDelta),
        ) *
          180) /
        Math.PI;
      const add = (at: number, kind: 'kilometer' | 'direction') => {
        const fraction = (at - distance) / length;
        // Interpolate the shortest longitude arc when a track crosses the date line.
        const delta = ((b[0] - a[0] + 540) % 360) - 180;
        features.push({
          type: 'Feature',
          properties: { kind, label: kind === 'kilometer' ? `${at / 1000} km` : '↑', bearing },
          geometry: {
            type: 'Point',
            coordinates: [
              ((a[0] + delta * fraction + 540) % 360) - 180,
              a[1] + (b[1] - a[1]) * fraction,
            ],
          },
        });
      };
      while (nextKilometer <= distance + length) {
        add(nextKilometer, 'kilometer');
        nextKilometer += spacing;
      }
      while (nextArrow <= distance + length) {
        add(nextArrow, 'direction');
        nextArrow += arrowSpacing;
      }
      distance += length;
    }
  }
  return { type: 'FeatureCollection' as const, features };
}
