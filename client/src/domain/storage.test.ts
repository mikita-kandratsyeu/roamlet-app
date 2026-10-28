import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteRoute, duplicateRoute, listRoutes, RouteDatabase, routeDb, saveRoute } from './storage';
import Dexie from 'dexie';
import type { PlannedRoute } from './types';

function fixture(): PlannedRoute {
  return {
    id: 'original',
    name: 'Walk',
    description: 'Description',
    activity: 'hiking',
    segments: [
      [
        [0, 0, 10],
        [0, 0.01, 20],
      ],
      [[1, 1, 100]],
    ],
    waypoints: [{ id: 'waypoint', name: 'Start', coordinate: [0, 0, 10] }],
    stats: { distance: 1112, duration: 800, ascent: 10, descent: 0 },
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    source: 'gpx',
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await routeDb.routes.clear();
});
afterAll(async () => {
  await routeDb.delete();
});

describe('route persistence', () => {
  it('upgrades old libraries by deleting retired-provider snapshots, retaining Mapbox and GPX', async () => {
    const name = 'roamlet-retired-provider-test';
    const old = new Dexie(name);
    old.version(1).stores({ routes: 'id, updatedAt, createdAt' });
    await old.table('routes').bulkPut([
      { ...fixture(), id: 'retired', source: 'retired-provider' },
      { ...fixture(), id: 'map', source: 'mapbox' },
      { ...fixture(), id: 'gpx', source: 'gpx' },
    ]);
    old.close();
    const upgraded = new RouteDatabase(name);
    try {
      await upgraded.open();
      expect((await upgraded.routes.toArray()).map(route => route.id).sort()).toEqual(['gpx', 'map']);
    } finally {
      await upgraded.delete();
    }
  });
  it.each(['mapbox', 'gpx'] as const)(
    'preserves %s snapshots without changing their source',
    async (source) => {
      const route = { ...fixture(), source };
      await saveRoute(route);
      expect((await listRoutes())[0].source).toBe(source);
      expect((await listRoutes())[0].segments).toEqual(route.segments);
      const copy = await duplicateRoute(route);
      expect(copy.source).toBe(source);
    },
  );
  it('saves, updates, reloads after reopening and deletes idempotently', async () => {
    const route = fixture();
    await saveRoute(route);
    routeDb.close();
    await routeDb.open();
    const stored = (await listRoutes())[0];
    expect(stored.segments).toEqual(route.segments);
    expect(stored.waypoints).toEqual(route.waypoints);
    expect(stored.createdAt).toBe(route.createdAt);
    expect(Date.parse(stored.updatedAt)).toBeGreaterThan(Date.parse(route.updatedAt));
    expect(route.updatedAt).toBe('2020-01-01T00:00:00.000Z');
    route.name = 'Updated';
    await saveRoute(route);
    expect(await listRoutes()).toHaveLength(1);
    expect((await listRoutes())[0].name).toBe('Updated');
    await deleteRoute(route.id);
    await deleteRoute(route.id);
    expect(await listRoutes()).toEqual([]);
  });
  it('duplicates deeply with fresh route/waypoint ids and timestamps', async () => {
    const original = fixture();
    await saveRoute(original);
    const copy = await duplicateRoute(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.waypoints[0].id).not.toBe(original.waypoints[0].id);
    expect(copy.name).toBe('Walk (copy)');
    expect(copy.createdAt).toBe(copy.updatedAt);
    expect(copy.createdAt).not.toBe(original.createdAt);
    expect(await listRoutes()).toHaveLength(2);
    copy.segments[0][0][0] = 50;
    copy.waypoints[0].name = 'Changed';
    expect(original.segments[0][0][0]).toBe(0);
    expect(original.waypoints[0].name).toBe('Start');
    expect((await routeDb.routes.get(copy.id))?.segments[0][0][0]).toBe(0);
  });
  it('lists newest updates first', async () => {
    const old = fixture();
    const newer = { ...fixture(), id: 'newer', updatedAt: '2025-01-01T00:00:00.000Z' };
    await routeDb.routes.bulkPut([old, newer]);
    expect((await listRoutes()).map((route) => route.id)).toEqual(['newer', 'original']);
  });
  it('reports invalid data and persistence failures without partial writes', async () => {
    const invalid = { ...fixture(), id: '' };
    await expect(saveRoute(invalid)).rejects.toThrow(/Unable to save/);
    await expect(duplicateRoute(invalid)).rejects.toThrow(/Unable to duplicate/);
    await expect(deleteRoute('')).rejects.toThrow(/Unable to delete/);
    expect(await listRoutes()).toEqual([]);
    const spy = vi.spyOn(routeDb.routes, 'put').mockRejectedValueOnce(new Error('quota'));
    await expect(saveRoute(fixture())).rejects.toMatchObject({
      message: 'Unable to save route data.',
      cause: { message: 'quota' },
    });
    spy.mockRestore();
    await routeDb.routes.put({ ...fixture(), stats: { distance: NaN, duration: 0 } });
    await expect(listRoutes()).rejects.toThrow(/Unable to load/);
  });
});
