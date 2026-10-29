import type { Activity, PlannedRoute, Waypoint } from './types';
import { validateRoute } from './routeValidation';
import { calculateStats } from './stats';

export interface EditorSnapshot {
  identity: { id: string; createdAt: string };
  savedRouteId: string | null;
  routeMetadata?: Pick<PlannedRoute, 'favorite' | 'tags'>;
  activity: Activity;
  waypoints: Waypoint[];
  result: PlannedRoute | null;
  mode: 'manual' | 'snapshot';
  planningMode: 'point' | 'loop' | 'manual';
  targetKm: number;
  name: string;
  description: string;
  speeds: Record<Activity, number>;
  stopsMinutes: number;
}
export const newIdentity = () => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString() });
export function initialEditor(): EditorSnapshot {
  return { identity: newIdentity(), savedRouteId: null, activity: 'cycling', waypoints: [], result: null,
    mode: 'manual', planningMode: 'point', targetKm: 20, name: '', description: '',
    speeds: { cycling: 18, hiking: 5 }, stopsMinutes: 0 };
}
export function validateSnapshot(value: unknown): asserts value is EditorSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid draft data.');
  const s = value as EditorSnapshot;
  if (!s.identity || typeof s.identity.id !== 'string' || !s.identity.id.trim() ||
      !Number.isFinite(Date.parse(s.identity.createdAt)) ||
      !(s.savedRouteId === null || typeof s.savedRouteId === 'string') ||
      !['cycling', 'hiking'].includes(s.activity) || !['manual', 'snapshot'].includes(s.mode) ||
      !['point', 'loop', 'manual'].includes(s.planningMode) || !Number.isFinite(s.targetKm) || s.targetKm < 2 || s.targetKm > 100 ||
      typeof s.name !== 'string' || typeof s.description !== 'string' || !Array.isArray(s.waypoints) || s.waypoints.length > 1000 ||
      !s.speeds || ![s.speeds.cycling, s.speeds.hiking].every(n => Number.isFinite(n) && n > 0) ||
      !Number.isFinite(s.stopsMinutes) || s.stopsMinutes < 0) throw new Error('Invalid draft data.');
  if (s.routeMetadata !== undefined && (!s.routeMetadata || typeof s.routeMetadata !== 'object' ||
    (s.routeMetadata.favorite !== undefined && typeof s.routeMetadata.favorite !== 'boolean') ||
    (s.routeMetadata.tags !== undefined && (!Array.isArray(s.routeMetadata.tags) || !s.routeMetadata.tags.every(tag => typeof tag === 'string'))))) throw new Error('Invalid draft metadata.');
  const ids = new Set<string>();
  for (const p of s.waypoints) {
    if (!p || typeof p.id !== 'string' || !p.id.trim() || ids.has(p.id) || typeof p.name !== 'string') throw new Error('Invalid draft points.');
    ids.add(p.id);
    calculateStats([[p.coordinate]], s.activity);
  }
  if (s.result !== null) validateRoute(s.result);
}
