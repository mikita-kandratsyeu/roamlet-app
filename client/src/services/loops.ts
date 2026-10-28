import type { Coordinate } from '../domain/types';

const EARTH_RADIUS = 6371008.8;
const radians = (value: number) => (value * Math.PI) / 180;
const degrees = (value: number) => (value * 180) / Math.PI;

export function coordinateDistance(a: Coordinate, b: Coordinate): number {
  const latitude = radians(b[1] - a[1]);
  const longitude = radians(b[0] - a[0]);
  const value =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(longitude / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, value)));
}

function destination(origin: Coordinate, distance: number, bearing: number): Coordinate {
  const angle = distance / EARTH_RADIUS;
  const direction = radians(bearing);
  const latitude = radians(origin[1]);
  const longitude = radians(origin[0]);
  const targetLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angle) +
      Math.cos(latitude) * Math.sin(angle) * Math.cos(direction),
  );
  const targetLongitude =
    longitude +
    Math.atan2(
      Math.sin(direction) * Math.sin(angle) * Math.cos(latitude),
      Math.cos(angle) - Math.sin(latitude) * Math.sin(targetLatitude),
    );
  return [((degrees(targetLongitude) + 540) % 360) - 180, degrees(targetLatitude)];
}

export function loopWaypoints(origin: Coordinate, radius: number, bearing: number): Coordinate[] {
  return [
    [origin[0], origin[1]],
    destination(origin, radius, bearing),
    destination(origin, radius, bearing + 60),
    [origin[0], origin[1]],
  ];
}
