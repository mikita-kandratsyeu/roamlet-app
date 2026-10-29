import type { Activity, PlannedRoute, RoutingOptions, Waypoint } from './types';
import {
  DEFAULT_ROUTING_OPTIONS,
  normalizeRoutingOptions,
  validRoutingOptions,
} from './routingOptions';
import { validLegMode } from './waypointLegs';
import { isRouteResultCurrent } from './editorRouting';
import { validateRoute } from './routeValidation';
import { calculateStats } from './stats';
import { isFitness, isSurface, type Fitness, type Surface } from './time';
import { validDepartureLocal, validPauseMinutes } from './schedule';

export interface EditorSnapshot {
  identity: { id: string; createdAt: string };
  savedRouteId: string | null;
  routeMetadata?: Pick<PlannedRoute, 'favorite' | 'tags'>;
  activity: Activity;
  waypoints: Waypoint[];
  result: PlannedRoute | null;
  routingOptions?: RoutingOptions;
  routeStale?: boolean;
  mode: 'manual' | 'snapshot';
  planningMode: 'point' | 'loop' | 'manual';
  automaticMode?: 'point' | 'loop';
  targetKm: number;
  name: string;
  description: string;
  speeds: Record<Activity, number>;
  stopsMinutes: number;
  departureLocal?: string;
  fitness: Fitness;
  surface: Surface;
}
export const newIdentity = () => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString() });
export function initialEditor(): EditorSnapshot {
  return {
    identity: newIdentity(),
    savedRouteId: null,
    activity: 'cycling',
    waypoints: [],
    result: null,
    routingOptions: { ...DEFAULT_ROUTING_OPTIONS },
    routeStale: false,
    mode: 'manual',
    planningMode: 'point',
    automaticMode: 'point',
    targetKm: 20,
    name: '',
    description: '',
    speeds: { cycling: 18, hiking: 5 },
    stopsMinutes: 0,
    fitness: 'regular',
    surface: 'unknown',
  };
}
export function validateSnapshot(value: unknown): asserts value is EditorSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid draft data.');
  const s = value as EditorSnapshot;
  if (
    !s.identity ||
    typeof s.identity.id !== 'string' ||
    !s.identity.id.trim() ||
    !Number.isFinite(Date.parse(s.identity.createdAt)) ||
    !(s.savedRouteId === null || typeof s.savedRouteId === 'string') ||
    !['cycling', 'hiking'].includes(s.activity) ||
    !['manual', 'snapshot'].includes(s.mode) ||
    !['point', 'loop', 'manual'].includes(s.planningMode) ||
    (s.automaticMode !== undefined && !['point', 'loop'].includes(s.automaticMode)) ||
    !Number.isFinite(s.targetKm) ||
    s.targetKm <= 0 ||
    typeof s.name !== 'string' ||
    typeof s.description !== 'string' ||
    !Array.isArray(s.waypoints) ||
    s.waypoints.length > 1000 ||
    !s.speeds ||
    ![s.speeds.cycling, s.speeds.hiking].every((n) => Number.isFinite(n) && n > 0) ||
    !Number.isFinite(s.stopsMinutes) ||
    s.stopsMinutes < 0 ||
    (s.departureLocal !== undefined && !validDepartureLocal(s.departureLocal)) ||
    (s.fitness !== undefined && !isFitness(s.fitness)) ||
    (s.surface !== undefined && !isSurface(s.surface)) ||
    (s.routingOptions !== undefined && !validRoutingOptions(s.routingOptions)) ||
    (s.routeStale !== undefined && typeof s.routeStale !== 'boolean')
  )
    throw new Error('Invalid draft data.');
  if (
    s.routeMetadata !== undefined &&
    (!s.routeMetadata ||
      typeof s.routeMetadata !== 'object' ||
      (s.routeMetadata.favorite !== undefined && typeof s.routeMetadata.favorite !== 'boolean') ||
      (s.routeMetadata.tags !== undefined &&
        (!Array.isArray(s.routeMetadata.tags) ||
          !s.routeMetadata.tags.every((tag) => typeof tag === 'string'))))
  )
    throw new Error('Invalid draft metadata.');
  const ids = new Set<string>();
  for (const p of s.waypoints) {
    if (
      !p ||
      typeof p.id !== 'string' ||
      !p.id.trim() ||
      ids.has(p.id) ||
      typeof p.name !== 'string' ||
      !validLegMode(p.legMode) ||
      (p.pauseMinutes !== undefined && !validPauseMinutes(p.pauseMinutes))
    )
      throw new Error('Invalid draft points.');
    ids.add(p.id);
    calculateStats([[p.coordinate]], s.activity);
  }
  if (s.result !== null) validateRoute(s.result);
}

/** Overlay timing at save/export/render time, never mutate or invalidate retained geometry.
 * Router responses may contain old (or no) pause metadata; the editor is authoritative by ID.
 */
export function withEditorSchedule(
  route: PlannedRoute,
  snapshot: Pick<EditorSnapshot, 'departureLocal' | 'waypoints'>,
): PlannedRoute {
  const points = new Map(snapshot.waypoints.map((point) => [point.id, point]));
  const { departureLocal: _departure, ...rest } = route;
  void _departure;
  return {
    ...rest,
    ...(snapshot.departureLocal === undefined ? {} : { departureLocal: snapshot.departureLocal }),
    waypoints: route.waypoints.map((point) => {
      const edited = points.get(point.id);
      if (!edited) return point;
      const { pauseMinutes: _pause, ...rest } = point;
      void _pause;
      return { ...rest, ...(edited.pauseMinutes === undefined ? {} : { pauseMinutes: edited.pauseMinutes }) };
    }),
  };
}

export function migrateSnapshot(value: unknown): EditorSnapshot {
  validateSnapshot(value);
  const snapshot: EditorSnapshot = {
    ...value,
    fitness: value.fitness ?? 'regular',
    surface: value.surface ?? 'unknown',
    routingOptions: normalizeRoutingOptions(value.routingOptions),
    routeStale: value.routeStale ?? false,
  };
  if (snapshot.result && !isRouteResultCurrent(snapshot)) snapshot.routeStale = true;
  return snapshot;
}
