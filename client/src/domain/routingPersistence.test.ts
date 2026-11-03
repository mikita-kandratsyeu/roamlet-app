import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialEditor } from './editorSnapshot';
import { draftWriter, loadDraft } from './drafts';
import { routeDb, saveRoute, listRoutes, duplicateRoute } from './storage';
import { exportBackup, importBackup } from './backup';
import { loadPreferences, savePreferences } from './preferences';
import { isRouteResultCurrent, routingInputKey } from './editorRouting';
import { editorReducer } from '../hooks/useRouteEditor';
import type { PlannedRoute } from './types';
import { exportGpx, importGpx } from './gpx';

beforeEach(async () => {
  await routeDb.routes.clear();
  await routeDb.table('drafts').clear();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
function mixed(): PlannedRoute {
  const editor = initialEditor();
  return {
    ...editor.identity,
    activity: 'cycling',
    name: 'Mixed',
    description: '',
    source: 'mixed',
    updatedAt: new Date().toISOString(),
    routingOptions: { cyclingProfile: 'cycling-road', avoidFerries: true, avoidSteps: true },
    waypoints: [
      { id: 'a', name: '', coordinate: [11, 47], legMode: 'direct' },
      { id: 'b', name: '', coordinate: [11.1, 47] },
      { id: 'c', name: '', coordinate: [11.2, 47] },
    ],
    segments: [
      [
        [11, 47],
        [11.1, 47],
      ],
      [
        [11.1, 47, 600],
        [11.2, 47, 610],
      ],
    ],
    directSegments: [
      [
        [11, 47],
        [11.1, 47],
      ],
    ],
    stats: { distance: 1000, duration: 100 },
  };
}
it('persists mixed leg modes, profile/avoids and old ready geometry as a stale draft', async () => {
  const snapshot = initialEditor();
  snapshot.result = mixed();
  snapshot.waypoints = structuredClone(snapshot.result.waypoints);
  snapshot.routingOptions = snapshot.result.routingOptions;
  snapshot.result.routingInputKey = routingInputKey(snapshot);
  snapshot.routeStale = true;
  snapshot.waypoints[0].coordinate = [11.01, 47];
  const writer = draftWriter(vi.fn());
  writer.schedule(snapshot);
  expect(await writer.flush()).toBe(true);
  const restored = (await loadDraft())!.snapshot;
  expect(restored.routeStale).toBe(true);
  expect(restored.routingOptions).toEqual(snapshot.routingOptions);
  expect(restored.result).toEqual(snapshot.result);
  expect(restored.waypoints[0].legMode).toBe('direct');
  expect(isRouteResultCurrent(restored)).toBe(false);
});
it('detects mismatched persisted inputs even when the caller forgot to mark the draft stale', async () => {
  const snapshot = initialEditor();
  snapshot.result = mixed();
  snapshot.waypoints = structuredClone(snapshot.result.waypoints);
  snapshot.routingOptions = snapshot.result.routingOptions;
  snapshot.result.routingInputKey = routingInputKey(snapshot);
  snapshot.waypoints[0].coordinate = [11.01, 47];
  snapshot.routeStale = false;
  const writer = draftWriter(vi.fn());
  writer.schedule(snapshot);
  expect(await writer.flush()).toBe(true);
  expect((await loadDraft())!.snapshot.routeStale).toBe(true);
});
it('restores stale status with undo and redo checkpoints', () => {
  const snapshot = { ...initialEditor(), result: mixed(), routeStale: false };
  let history = editorReducer({ present: snapshot, past: [], future: [] }, { type: 'checkpoint' });
  history = editorReducer(history, { type: 'patch', key: 'routeStale', value: true });
  history = editorReducer(history, { type: 'undo' });
  expect(history.present.routeStale).toBe(false);
  history = editorReducer(history, { type: 'redo' });
  expect(history.present.routeStale).toBe(true);
});
it('round trips mixed routes and direct chunks through library, duplication and backup', async () => {
  const route = mixed();
  await saveRoute(route);
  const stored = (await listRoutes())[0];
  expect(stored.routingOptions).toEqual(route.routingOptions);
  expect(stored.directSegments).toEqual(route.directSegments);
  expect(stored.waypoints).toEqual(route.waypoints);
  const copy = await duplicateRoute(stored);
  expect(copy.routingOptions).toEqual(stored.routingOptions);
  expect(copy.waypoints.map((point) => point.legMode)).toEqual(
    stored.waypoints.map((point) => point.legMode),
  );
  const backup = JSON.parse(exportBackup([stored]));
  await routeDb.routes.clear();
  await importBackup(backup, 'replace');
  expect((await listRoutes())[0]).toEqual(stored);
});
it('persists new routing preferences and keeps old preference defaults', () => {
  expect(loadPreferences().routingOptions).toEqual({
    cyclingProfile: 'cycling-regular',
    avoidFerries: false,
    avoidSteps: false,
  });
  const routingOptions = {
    cyclingProfile: 'cycling-mountain' as const,
    avoidFerries: true,
    avoidSteps: true,
  };
  expect(savePreferences({ routingOptions })).toBe(true);
  expect(loadPreferences().routingOptions).toEqual(routingOptions);
  expect(savePreferences({ routingOptions: { avoidSteps: 'yes' as never } })).toBe(false);
  expect(loadPreferences().routingOptions).toEqual(routingOptions);
});
it('round trips partial mixed elevation provenance without creating whole-route totals', async () => {
  const route: PlannedRoute = { ...mixed(), elevationSource: 'openrouteservice' };
  await saveRoute(route);
  const stored = (await listRoutes())[0];
  expect(stored).toMatchObject(route);
  const copy = await duplicateRoute(stored);
  expect(copy.elevationSource).toBe('openrouteservice');
  expect(copy.segments).toEqual(route.segments);
  expect(copy.stats.ascent).toBeUndefined();
  await routeDb.routes.clear();
  await importBackup(JSON.parse(exportBackup([stored])), 'replace');
  const restored = (await listRoutes())[0];
  expect(restored).toEqual(stored);
  expect(restored.stats.ascent).toBeUndefined();
  expect(importGpx(exportGpx(restored)).segments).toEqual(restored.segments);
  const snapshot = { ...initialEditor(), result: restored };
  const writer = draftWriter(vi.fn());
  writer.schedule(snapshot);
  expect(await writer.flush()).toBe(true);
  expect((await loadDraft())!.snapshot.result).toEqual(restored);
});

it.each(['no-known-run', 'whole-route-totals', 'direct-heights', 'automatic-partial'] as const)(
  'rejects invalid partial elevation provenance (%s)', async (kind) => {
    const route: PlannedRoute = { ...mixed(), elevationSource: 'openrouteservice' };
    if (kind === 'no-known-run') route.segments = [[[11, 47], [11.2, 47]]];
    if (kind === 'whole-route-totals') route.stats = { ...route.stats, ascent: 10, descent: 0 };
    if (kind === 'direct-heights') route.directSegments = [[[11, 47, 100], [11.1, 47, 120]]];
    if (kind === 'automatic-partial') route.source = 'openrouteservice';
    await expect(saveRoute(route)).rejects.toThrow('Unable to save route data.');
  },
);

it('preserves confirmed elevation provenance in library and backup without granting it to legacy routes', async () => {
  const route = {
    ...mixed(),
    source: 'openrouteservice' as const,
    directSegments: undefined,
    elevationSource: 'openrouteservice' as const,
    segments: [
      [
        [11, 47, 600],
        [11.1, 47, 610],
      ],
    ] as PlannedRoute['segments'],
    stats: { distance: 1000, duration: 100, ascent: 10, descent: 0 },
  };
  await saveRoute(route);
  expect((await listRoutes())[0].elevationSource).toBe('openrouteservice');
  expect(JSON.parse(exportBackup([route])).routes[0].elevationSource).toBe('openrouteservice');
  const legacy = { ...route, id: 'legacy', elevationSource: undefined };
  await saveRoute(legacy);
  expect(
    (await listRoutes()).find((item) => item.id === 'legacy')?.elevationSource,
  ).toBeUndefined();
});
