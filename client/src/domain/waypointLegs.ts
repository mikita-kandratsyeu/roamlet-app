import type { LegMode, Waypoint } from './types';

export const AUTOMATIC_POINT_LIMIT = 50;
export function waypointLegMode(waypoint: Waypoint): LegMode {
  return waypoint.legMode ?? 'automatic';
}
export function validLegMode(value: unknown): value is LegMode | undefined {
  return value === undefined || value === 'automatic' || value === 'direct';
}
/** Reverse physical legs rather than carrying the old outgoing mode to a different leg. */
export function reverseWaypoints(waypoints: Waypoint[]): Waypoint[] {
  return waypoints
    .map((point, index) => {
      const copy = { ...point };
      const mode = index > 0 ? waypoints[index - 1].legMode : undefined;
      if (mode === undefined) delete copy.legMode;
      else copy.legMode = mode;
      return copy;
    })
    .reverse();
}
/** When reordered, an outgoing mode follows its waypoint, including the formerly last stop. */
export function reorderWaypoints(waypoints: Waypoint[], from: number, to: number): Waypoint[] {
  if (
    ![from, to].every(Number.isInteger) ||
    from < 0 ||
    to < 0 ||
    from >= waypoints.length ||
    to >= waypoints.length
  )
    throw new Error('Invalid waypoint order.');
  const next = waypoints.map((point) => ({ ...point }));
  const [point] = next.splice(from, 1);
  next.splice(to, 0, point);
  return next;
}
/** Inserting within a leg gives both halves that leg's mode. */
export function insertWaypoint(
  waypoints: Waypoint[],
  index: number,
  waypoint: Waypoint,
): Waypoint[] {
  if (!Number.isInteger(index) || index < 0 || index > waypoints.length)
    throw new Error('Invalid waypoint order.');
  const point = { ...waypoint };
  if (index > 0 && index < waypoints.length) {
    if (waypoints[index - 1].legMode === undefined) delete point.legMode;
    else point.legMode = waypoints[index - 1].legMode;
  }
  return [...waypoints.slice(0, index), point, ...waypoints.slice(index)];
}
export interface WaypointRun {
  mode: LegMode;
  waypoints: Waypoint[];
}
/** Separate chunks intentionally preserve provider snapping gaps at direct/automatic boundaries. */
export function waypointRuns(waypoints: Waypoint[]): WaypointRun[] {
  const runs: WaypointRun[] = [];
  for (let index = 0; index < waypoints.length - 1; index++) {
    const mode = waypointLegMode(waypoints[index]);
    const previous = runs.at(-1);
    if (previous?.mode === mode) previous.waypoints.push(waypoints[index + 1]);
    else runs.push({ mode, waypoints: [waypoints[index], waypoints[index + 1]] });
  }
  return runs;
}
/** Points participating in automatic legs, including their shared endpoints, count only once. */
export function automaticPointCount(waypoints: Waypoint[]): number {
  return waypoints.reduce(
    (count, point, index) =>
      count +
      Number(
        (index < waypoints.length - 1 && waypointLegMode(point) === 'automatic') ||
          (index > 0 && waypointLegMode(waypoints[index - 1]) === 'automatic'),
      ),
    0,
  );
}
