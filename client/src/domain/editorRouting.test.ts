import { describe, expect, it } from 'vitest';
import { initialEditor, migrateSnapshot, validateSnapshot } from './editorSnapshot';
import { editableRouteWaypoints, isRouteResultCurrent, routingInputKey, routingCalculationKey } from './editorRouting';
import {
  automaticPointCount,
  insertWaypoint,
  reorderWaypoints,
  reverseWaypoints,
  waypointLegMode,
  waypointRuns,
} from './waypointLegs';
import { normalizeRoutingOptions } from './routingOptions';
import { validateRoute } from './routeValidation';
import type { PlannedRoute, Waypoint } from './types';

const points: Waypoint[] = [
  { id: 'a', name: 'A', coordinate: [11, 47], legMode: 'direct' },
  { id: 'b', name: 'B', coordinate: [12, 47] },
  { id: 'c', name: 'C', coordinate: [13, 47], legMode: 'direct' },
  { id: 'd', name: 'D', coordinate: [14, 47] },
];
function ready(): PlannedRoute {
  const editor = initialEditor();
  return {
    ...editor.identity,
    name: '',
    description: '',
    activity: 'cycling',
    waypoints: points,
    segments: [points.map((point) => point.coordinate)],
    stats: { distance: 10, duration: 10 },
    source: 'mixed',
    updatedAt: new Date().toISOString(),
  };
}
describe('outgoing waypoint modes', () => {
  it('reverses physical leg modes without mutating the original', () => {
    const reversed = reverseWaypoints(points);
    expect(reversed.map((point) => point.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(reversed.slice(0, -1).map(waypointLegMode)).toEqual(['direct', 'automatic', 'direct']);
    expect(reverseWaypoints(reversed).slice(0, -1).map(waypointLegMode)).toEqual(
      points.slice(0, -1).map(waypointLegMode),
    );
    expect(points[0].legMode).toBe('direct');
    expect(reversed.at(-1)?.legMode).toBeUndefined();
  });
  it('reorders outgoing mode with the waypoint and splits both halves when inserting', () => {
    const reordered = reorderWaypoints(points, 0, 2);
    expect(reordered.map((point) => point.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(reordered[2].legMode).toBe('direct');
    const inserted = insertWaypoint(points, 1, { id: 'new', name: '', coordinate: [11.5, 47] });
    expect(inserted[0].legMode).toBe('direct');
    expect(inserted[1].legMode).toBe('direct');
    expect(points).toHaveLength(4);
    expect(() => reorderWaypoints(points, -1, 0)).toThrow();
    expect(() => insertWaypoint(points, 20, points[0])).toThrow();
  });
  it('defaults old waypoints to automatic, ignores trailing mode and counts participants once', () => {
    expect(waypointRuns(points).map((run) => run.mode)).toEqual(['direct', 'automatic', 'direct']);
    expect(automaticPointCount(points)).toBe(2);
    expect(
      automaticPointCount([
        { ...points[0], legMode: 'automatic' },
        { ...points[1], legMode: 'direct' },
      ]),
    ).toBe(2);
    expect(
      automaticPointCount([
        { ...points[0], legMode: 'direct' },
        { ...points[1], legMode: 'automatic' },
      ]),
    ).toBe(0);
    expect(reverseWaypoints([])).toEqual([]);
  });
});
describe('stale geometry and backwards compatible snapshots', () => {
  it('ignores names and pauses for calculation but retains changes to supplied heights', () => {
    const snapshot = { ...initialEditor(), planningMode: 'manual' as const, waypoints: points };
    expect(
      routingCalculationKey({
        ...snapshot,
        waypoints: points.map((point) => ({ ...point, name: 'Renamed', pauseMinutes: 10 })),
      }),
    ).toBe(routingCalculationKey(snapshot));
    expect(
      routingCalculationKey({
        ...snapshot,
        waypoints: points.map((point): Waypoint => ({
          ...point,
          coordinate: [point.coordinate[0], point.coordinate[1], 100],
        })),
      }),
    ).not.toBe(routingCalculationKey(snapshot));
  });
  it('retains old snapshots and defaults missing fields, but rejects malformed option/mode/stale values', () => {
    const old = initialEditor();
    delete old.routingOptions;
    delete old.routeStale;
    const migrated = migrateSnapshot(old);
    expect(migrated.routingOptions).toEqual(normalizeRoutingOptions());
    expect(migrated.routeStale).toBe(false);
    for (const patch of [
      { routeStale: 'false' },
      { routingOptions: { avoidSteps: 1 } },
      { waypoints: [{ ...points[0], legMode: 'road' }] },
    ])
      expect(() => validateSnapshot({ ...old, ...patch })).toThrow();
  });
  it('keeps retained geometry nonexportable when input or persisted stale state differs', () => {
    const snapshot = { ...initialEditor(), waypoints: points, result: ready() };
    snapshot.result.routingInputKey = routingInputKey(snapshot);
    expect(isRouteResultCurrent(snapshot)).toBe(true);
    expect(isRouteResultCurrent({ ...snapshot, routeStale: true })).toBe(false);
    expect(isRouteResultCurrent({ ...snapshot, waypoints: reverseWaypoints(points) })).toBe(false);
    expect(
      isRouteResultCurrent({ ...snapshot, routingOptions: { cyclingProfile: 'cycling-road' } }),
    ).toBe(false);
    expect(
      isRouteResultCurrent({
        ...snapshot,
        waypoints: points.map((point) => ({ ...point, name: 'Renamed' })),
      }),
    ).toBe(true);
    expect(isRouteResultCurrent({ ...snapshot, mode: 'snapshot' })).toBe(true);
    expect(isRouteResultCurrent({ ...snapshot, mode: 'snapshot', routeStale: true })).toBe(false);
  });
  it('checks legacy ready route waypoints/options without requiring a new input key', () => {
    const snapshot = { ...initialEditor(), waypoints: points, result: ready() };
    expect(isRouteResultCurrent(snapshot)).toBe(true);
    expect(
      isRouteResultCurrent({
        ...snapshot,
        waypoints: points.map((point) => ({ ...point, legMode: 'automatic' })),
      }),
    ).toBe(false);
  });
  it('accepts a ready loop with generated stops while checking stale status, activity and options', () => {
    const result = ready();
    result.routingOptions = { cyclingProfile: 'cycling-road', avoidFerries: true };
    const snapshot = {
      ...initialEditor(),
      planningMode: 'loop' as const,
      waypoints: [points[0]],
      result,
      routingOptions: result.routingOptions,
    };
    result.routingInputKey = routingInputKey({ ...snapshot, waypoints: points });
    expect(isRouteResultCurrent(snapshot)).toBe(true);
    expect(isRouteResultCurrent({ ...snapshot, routeStale: true })).toBe(false);
    expect(isRouteResultCurrent({ ...snapshot, activity: 'hiking' })).toBe(false);
    expect(
      isRouteResultCurrent({ ...snapshot, routingOptions: { cyclingProfile: 'cycling-mountain' } }),
    ).toBe(false);
    expect(isRouteResultCurrent({ ...snapshot, result: { ...result, segments: [] } })).toBe(false);
  });
  it('converts GPX endpoints only explicitly and rejects isolated trackpoints', () => {
    const route = {
      ...ready(),
      source: 'gpx' as const,
      waypoints: [],
      segments: [
        [
          [11, 47, 100],
          [11.1, 47, 120],
        ],
        [
          [12, 47, 100],
          [12.1, 47, 140],
        ],
      ] as PlannedRoute['segments'],
    };
    const converted = editableRouteWaypoints(route);
    expect(converted.map((point) => point.coordinate)).toEqual([
      [11, 47],
      [12.1, 47],
    ]);
    expect(route.waypoints).toEqual([]);
    expect(route.segments).toHaveLength(2);
    expect(() => editableRouteWaypoints({ ...route, segments: [[[11, 47]], [[12, 47]]] })).toThrow(
      'isolated',
    );
    expect(editableRouteWaypoints(ready())).toEqual(points);
  });
  it('validates mixed persistence and confirmed3D provenance but rejects malformed markers', () => {
    const route = ready();
    route.routingOptions = {
      cyclingProfile: 'cycling-mountain',
      avoidFerries: true,
      avoidSteps: true,
    };
    route.directSegments = [points.slice(0, 2).map((point) => point.coordinate)];
    expect(() => validateRoute(route)).not.toThrow();
    expect(() => validateRoute({ ...route, elevationSource: 'openrouteservice' })).toThrow();
    expect(() =>
      validateRoute({
        ...route,
        directSegments: [
          [
            [999, 47],
            [12, 47],
          ],
        ],
      }),
    ).toThrow();
    const elevated = {
      ...route,
      source: 'openrouteservice',
      directSegments: undefined,
      segments: [
        [
          [11, 47, 100],
          [12, 47, 110],
        ],
      ],
      stats: { ...route.stats, ascent: 10, descent: 0 },
      elevationSource: 'openrouteservice',
    };
    expect(() => validateRoute(elevated)).not.toThrow();
  });
});
