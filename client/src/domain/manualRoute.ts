import { calculateStats } from './stats';
import type { Activity, Coordinate, RoutingResult, Waypoint } from './types';

export const MANUAL_STOP_LIMIT = 1000;

export function manualRoute(waypoints: Waypoint[], activity: Activity): RoutingResult {
  if (waypoints.length < 2 || waypoints.length > MANUAL_STOP_LIMIT)
    throw new Error('Choose between 2 and 1,000 points for a manual route.');
  const coordinates: Coordinate[] = waypoints.map(({ coordinate }) => {
    calculateStats([[coordinate]], activity);
    return [coordinate[0], coordinate[1]];
  });
  const segments = [coordinates];
  return { segments, stats: calculateStats(segments, activity) };
}
