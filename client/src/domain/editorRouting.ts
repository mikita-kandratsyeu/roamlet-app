import type { EditorSnapshot } from './editorSnapshot';
import type { PlannedRoute, Waypoint } from './types';
import { normalizeRoutingOptions } from './routingOptions';
import { waypointLegMode } from './waypointLegs';

export function routingInputKey(
  snapshot: Pick<EditorSnapshot, 'activity' | 'planningMode' | 'waypoints' | 'routingOptions'>,
): string {
  return JSON.stringify([
    snapshot.activity,
    snapshot.planningMode,
    snapshot.waypoints.map((point, index) => [
      point.coordinate.slice(0, 2),
      snapshot.planningMode === 'point' && index < snapshot.waypoints.length - 1
        ? waypointLegMode(point)
        : null,
    ]),
    snapshot.planningMode === 'manual' ? null : normalizeRoutingOptions(snapshot.routingOptions),
  ]);
}
/** Local direct geometry also depends on supplied heights, unlike the ORS request body. */
export function routingCalculationKey(
  snapshot: Pick<EditorSnapshot, 'activity' | 'planningMode' | 'waypoints' | 'routingOptions'>,
): string {
  return JSON.stringify([
    routingInputKey(snapshot),
    snapshot.waypoints.map((point) => point.coordinate),
  ]);
}
/** Use this guard for save/export: retained ready geometry is only a visual reference while stale. */
export function isRouteResultCurrent(snapshot: EditorSnapshot): boolean {
  if (!snapshot.result || snapshot.routeStale) return false;
  if (snapshot.mode === 'snapshot') return true;
  if (snapshot.planningMode === 'loop')
    return (
      snapshot.result.activity === snapshot.activity &&
      snapshot.result.segments.some((segment) => segment.length >= 2) &&
      JSON.stringify(normalizeRoutingOptions(snapshot.result.routingOptions)) ===
        JSON.stringify(normalizeRoutingOptions(snapshot.routingOptions))
    );
  const key = snapshot.result.routingInputKey;
  if (key !== undefined) return key === routingInputKey(snapshot);
  return (
    routingInputKey(snapshot) ===
    routingInputKey({
      activity: snapshot.result.activity,
      planningMode:
        snapshot.result.source === 'manual' && !snapshot.result.directSegments?.length
          ? 'manual'
          : 'point',
      waypoints: snapshot.result.waypoints,
      routingOptions: snapshot.result.routingOptions,
    })
  );
}
/** Explicit conversion discards imported track detail only when the caller confirms rerouting. */
export function editableRouteWaypoints(route: PlannedRoute): Waypoint[] {
  if (route.source !== 'gpx' && route.waypoints.length >= 2)
    return structuredClone(route.waypoints);
  const segments = route.segments.filter((segment) => segment.length >= 2);
  if (!segments.length) throw new Error('This route contains only isolated points.');
  return [segments[0][0], segments.at(-1)!.at(-1)!].map((coordinate, index) => ({
    id: crypto.randomUUID(),
    name: index ? 'Imported finish' : 'Imported start',
    coordinate: [coordinate[0], coordinate[1]],
  }));
}
