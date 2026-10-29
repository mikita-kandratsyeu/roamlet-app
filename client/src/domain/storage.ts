import i18n from '../i18n';
import Dexie, { type Table } from 'dexie';
import { validateRoute, withRouteDefaults } from './routeValidation';
export { validateRoute } from './routeValidation';
import type { PlannedRoute } from './types';

export class RouteDatabase extends Dexie {
  routes!: Table<PlannedRoute, string>;
  constructor(name = 'roamlet-routes') {
    super(name);
    this.version(1).stores({ routes: 'id, updatedAt, createdAt' });
    this.version(2)
      .stores({ routes: 'id, updatedAt, createdAt' })
      .upgrade(async (transaction) => {
        // The owner requested removal of snapshots from the retired provider.
        await transaction
          .table('routes')
          .filter(
            (route) =>
              !['openrouteservice', 'mapbox', 'gpx', 'manual', 'mixed'].includes(route.source),
          )
          .delete();
      });
    this.version(3)
      .stores({ routes: 'id, updatedAt, createdAt', drafts: 'id' })
      .upgrade(async (transaction) => {
        await transaction
          .table('routes')
          .toCollection()
          .modify((route) => {
            if (route.favorite === undefined) route.favorite = false;
            if (route.tags === undefined) route.tags = [];
          });
      });
  }
}
export const routeDb = new RouteDatabase();

function failure(action: string, cause: unknown): Error {
  return new Error(`Unable to ${action} route data.`, { cause });
}

export async function listRoutes(onInvalid?: (count: number) => void): Promise<PlannedRoute[]> {
  try {
    const routes = await routeDb.routes.toArray();
    const valid: PlannedRoute[] = [];
    let invalid = 0;
    for (const route of routes) {
      try {
        validateRoute(route);
        valid.push(withRouteDefaults(route));
      } catch {
        invalid++;
      }
    }
    if (invalid) onInvalid?.(invalid);
    return valid.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
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
