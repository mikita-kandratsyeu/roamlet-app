import type { Coordinate, RoutingResult } from '../domain/types';

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

const LOOP_SAMPLES = 64;

function sampleLoop(points: Coordinate[]): Coordinate[] {
  const lengths = points.slice(1).map((point, index) => coordinateDistance(points[index], point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let segment = 0;
  let travelled = 0;
  return Array.from({ length: LOOP_SAMPLES }, (_, index) => {
    const distance = (total * index) / LOOP_SAMPLES;
    while (segment < lengths.length - 1 && travelled + lengths[segment] <= distance) {
      travelled += lengths[segment++];
    }
    const fraction = lengths[segment] > 0 ? (distance - travelled) / lengths[segment] : 0;
    const start = points[segment];
    const end = points[segment + 1];
    const longitudeDelta = ((end[0] - start[0] + 540) % 360) - 180;
    return [
      ((start[0] + longitudeDelta * fraction + 540) % 360) - 180,
      start[1] + (end[1] - start[1]) * fraction,
    ];
  });
}

export function rankLoopCandidates(candidates: RoutingResult[], target: number): RoutingResult[] {
  const sorted = [...candidates].sort(
    (a, b) => Math.abs(a.stats.distance - target) - Math.abs(b.stats.distance - target),
  );
  const distinct: { route: RoutingResult; samples: Coordinate[] }[] = [];
  for (const route of sorted) {
    const samples = sampleLoop(route.segments[0]);
    const reversed = sampleLoop([...route.segments[0]].reverse());
    const duplicate = distinct.some((previous) => {
      if (
        Math.abs(previous.route.stats.distance - route.stats.distance) >
        Math.max(previous.route.stats.distance, route.stats.distance) * 0.1
      )
        return false;
      // Compare by travelled distance, not vertex count; reversed trips also count as duplicates.
      return [samples, reversed].some(
        (direction) =>
          direction.filter(
            (point, index) => coordinateDistance(point, previous.samples[index]) <= 100,
          ).length /
            LOOP_SAMPLES >=
          0.9,
      );
    });
    if (!duplicate) distinct.push({ route, samples });
  }
  return distinct.map(({ route }) => route);
}

export function loopWaypoints(origin: Coordinate, radius: number, bearing: number): Coordinate[] {
  return [
    [origin[0], origin[1]],
    destination(origin, radius, bearing),
    destination(origin, radius, bearing + 60),
    [origin[0], origin[1]],
  ];
}
