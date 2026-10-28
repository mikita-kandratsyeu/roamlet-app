import i18n from '../i18n';
import Dexie, { type Table } from 'dexie';
import { calculateStats } from './stats';
import type { PlannedRoute } from './types';

export class RouteDatabase extends Dexie {
  routes!: Table<PlannedRoute, string>;
  constructor(name = 'roamlet-routes') {
    super(name);
    this.version(1).stores({ routes: 'id, updatedAt, createdAt' });
    this.version(2).stores({ routes: 'id, updatedAt, createdAt' }).upgrade(async transaction => {
      // The owner requested removal of snapshots from the retired provider.
      await transaction.table('routes').filter(route => !['mapbox', 'gpx'].includes(route.source)).delete();
    });
  }
}
export const routeDb = new RouteDatabase();

function validateRoute(route: PlannedRoute): void {
  if (
    !route ||
    typeof route.id !== 'string' ||
    !route.id.trim() ||
    typeof route.name !== 'string' ||
    typeof route.description !== 'string' ||
    !Array.isArray(route.segments) ||
    !route.segments.every(Array.isArray) ||
    !Array.isArray(route.waypoints) ||
    !['gpx', 'mapbox'].includes(route.source) ||
    typeof route.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(route.createdAt)) ||
    typeof route.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(route.updatedAt))
  ) {
    throw new Error('Invalid route data.');
  }
  calculateStats(route.segments, route.activity);
  const ids = new Set<string>();
  for (const waypoint of route.waypoints) {
    if (
      !waypoint ||
      typeof waypoint.id !== 'string' ||
      !waypoint.id.trim() ||
      ids.has(waypoint.id) ||
      typeof waypoint.name !== 'string'
    )
      throw new Error('Invalid route waypoint.');
    ids.add(waypoint.id);
    calculateStats([[waypoint.coordinate]], route.activity);
  }
  if (
    !route.stats ||
    !Number.isFinite(route.stats.distance) ||
    route.stats.distance < 0 ||
    !Number.isFinite(route.stats.duration) ||
    route.stats.duration < 0 ||
    [route.stats.ascent, route.stats.descent].some(
      (value) => value !== undefined && (!Number.isFinite(value) || value < 0),
    )
  ) {
    throw new Error('Invalid route statistics.');
  }
}
function failure(action: string, cause: unknown): Error {
  return new Error(`Unable to ${action} route data.`, { cause });
}

export async function listRoutes(): Promise<PlannedRoute[]> {
  try {
    const routes = await routeDb.routes.orderBy('updatedAt').reverse().toArray();
    routes.forEach(validateRoute);
    return routes;
  } catch (cause) {
    throw failure('load', cause);
  }
}

export async function saveRoute(route: PlannedRoute): Promise<void> {
  try {
    validateRoute(route);
    const snapshot = structuredClone(route);
    snapshot.updatedAt = new Date().toISOString();
    await routeDb.routes.put(snapshot);
  } catch (cause) {
    throw failure('save', cause);
  }
}

export async function deleteRoute(id: string): Promise<void> {
  try {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid route id.');
    await routeDb.routes.delete(id);
  } catch (cause) {
    throw failure('delete', cause);
  }
}

export async function duplicateRoute(route: PlannedRoute): Promise<PlannedRoute> {
  try {
    validateRoute(route);
    const duplicate = structuredClone(route);
    const now = new Date().toISOString();
    duplicate.id = crypto.randomUUID();
    duplicate.name = `${route.name} ${i18n.t('(copy)')}`;
    duplicate.createdAt = now;
    duplicate.updatedAt = now;
    duplicate.waypoints.forEach((waypoint) => {
      waypoint.id = crypto.randomUUID();
    });
    await routeDb.routes.add(duplicate);
    return duplicate;
  } catch (cause) {
    throw failure('duplicate', cause);
  }
}
