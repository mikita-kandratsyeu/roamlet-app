import type { Coordinate, Waypoint } from './types';
import { manualRoute } from './manualRoute';
import { AUTOMATIC_POINT_LIMIT } from './waypointLegs';

export function detourEndpoints(waypoints: Waypoint[], index: number): Waypoint[] {
  if (!Number.isInteger(index) || index < 0 || index >= waypoints.length - 1)
    throw new Error('Invalid detour section.');
  return [{ ...waypoints[index], legMode: 'direct' }, { ...waypoints[index + 1] }];
}

export function applyManualDetour(
  waypoints: Waypoint[], index: number, points: Waypoint[],
): Waypoint[] {
  const endpoints = detourEndpoints(waypoints, index);
  if (points.length < 3 || points[0].id !== endpoints[0].id ||
    points.at(-1)?.id !== endpoints[1].id ||
    !sameCoordinate(points[0].coordinate, endpoints[0].coordinate) ||
    !sameCoordinate(points.at(-1)!.coordinate, endpoints[1].coordinate))
    throw new Error('Invalid detour points.');
  manualRoute(points, 'cycling');
  const internal = points.slice(1, -1);
  const ids = [...waypoints, ...internal].map((point) => point.id);
  if (new Set(ids).size !== ids.length) throw new Error('Invalid detour points.');
  if (waypoints.length + internal.length > AUTOMATIC_POINT_LIMIT)
    throw new Error('A route supports up to 50 stops. Remove a stop before adding another.');
  return [...waypoints.slice(0, index), { ...waypoints[index], legMode: 'direct' },
    ...internal.map((point): Waypoint => ({ ...point, legMode: 'direct' })),
    ...waypoints.slice(index + 1)];
}

function sameCoordinate(a: Coordinate, b: Coordinate) {
  return a[0] === b[0] && a[1] === b[1];
}
