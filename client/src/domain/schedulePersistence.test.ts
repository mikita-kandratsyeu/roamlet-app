import 'fake-indexeddb/auto';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { routeDb, saveRoute, listRoutes, duplicateRoute } from './storage';
import { draftWriter, loadDraft } from './drafts';
import { exportBackup, parseBackup, importBackup } from './backup';
import { initialEditor, migrateSnapshot, validateSnapshot, withEditorSchedule } from './editorSnapshot';
import { validateRoute } from './routeValidation';
import { estimatePersonalTime } from './time';
import { estimateRouteSchedule } from './schedule';
import type { PlannedRoute } from './types';
const fixture = (): PlannedRoute => ({
  ...initialEditor().identity,
  name: 'Schedule', description: '', activity: 'hiking', source: 'gpx',
  departureLocal: '2026-10-29T23:30',
  waypoints: [{ id: 'a', name: 'Start', coordinate: [0, 0], pauseMinutes: 5 },
    { id: 'b', name: 'Finish', coordinate: [0.01, 0], pauseMinutes: 10 }],
  segments: [[[0, 0], [0.01, 0]]], stats: { distance: 1112, duration: 800 },
  updatedAt: new Date().toISOString(),
});
beforeEach(async () => {
  await routeDb.routes.clear();
  await routeDb.table('drafts').clear();
});
afterAll(async () => { await routeDb.delete(); });
it('persists timing through save/reopen, duplication, backup export and all conflict modes', async () => {
  const route = fixture();
  await saveRoute(route);
  routeDb.close();
  await routeDb.open();
  const saved = (await listRoutes())[0];
  expect(saved.departureLocal).toBe(route.departureLocal);
  expect(saved.waypoints).toEqual(route.waypoints);
  const duplicate = await duplicateRoute(saved);
  expect(duplicate.departureLocal).toBe(saved.departureLocal);
  expect(duplicate.waypoints.map((point) => point.pauseMinutes)).toEqual([5, 10]);
  const data = parseBackup(exportBackup([saved]));
  expect(data.routes).toEqual([saved]);
  for (const mode of ['skip', 'replace', 'copy'] as const) {
    await importBackup(data, mode);
    const routes = await listRoutes();
    expect(routes.every((value) => value.departureLocal === saved.departureLocal)).toBe(true);
    expect(routes.every((value) => value.waypoints.map((point) => point.pauseMinutes).join() === '5,10')).toBe(true);
  }
});
it('round-trips draft timing independently from the old retained geometry and migrates old drafts unchanged', async () => {
  const ready = fixture();
  const snapshot = { ...initialEditor(), result: ready, mode: 'snapshot' as const,
    departureLocal: '2026-10-30T08:00', waypoints: ready.waypoints.map((point) => ({ ...point, pauseMinutes: 20 })) };
  const writer = draftWriter(vi.fn());
  writer.schedule(snapshot);
  expect(await writer.flush()).toBe(true);
  const restored = (await loadDraft())!.snapshot;
  expect(restored).toEqual(snapshot);
  expect(restored.routeStale).toBe(false);
  const saved = withEditorSchedule(ready, restored);
  expect(saved.departureLocal).toBe('2026-10-30T08:00');
  expect(saved.waypoints.map((point) => point.pauseMinutes)).toEqual([20, 20]);
  expect(saved.segments).toBe(ready.segments);
  expect(saved.stats).toBe(ready.stats);
  expect(ready.waypoints.map((point) => point.pauseMinutes)).toEqual([5, 10]);
  const old = initialEditor();
  expect(migrateSnapshot(old)).toEqual(old);
  const cleared = withEditorSchedule(saved, { waypoints: saved.waypoints.map(({ pauseMinutes: _pause, ...point }) => {
    void _pause; return point;
  }) });
  expect(cleared.departureLocal).toBeUndefined();
  expect(cleared.waypoints.every((point) => point.pauseMinutes === undefined)).toBe(true);
  validateRoute(cleared);
});
it('rejects invalid timing in routes, drafts and backups before writes, while accepting legacy absent fields', async () => {
  const route = fixture();
  for (const departureLocal of ['2026-02-30T12:00', '2026-01-01T24:00', '', null, 123]) {
    const invalid = { ...route, departureLocal };
    expect(() => validateRoute(invalid)).toThrow();
    expect(() => validateSnapshot({ ...initialEditor(), departureLocal })).toThrow();
    await expect(saveRoute(invalid as PlannedRoute)).rejects.toThrow();
    expect(() => parseBackup(JSON.stringify({ version: 1, exportedAt: route.updatedAt, routes: [invalid] }))).toThrow();
  }
  for (const pauseMinutes of [-1, 0.5, 10081, NaN, Infinity, '5', null]) {
    const waypoints = [{ ...route.waypoints[0], pauseMinutes }];
    expect(() => validateRoute({ ...route, waypoints })).toThrow();
    expect(() => validateSnapshot({ ...initialEditor(), waypoints })).toThrow();
  }
  expect(await listRoutes()).toEqual([]);
  const legacy = { ...route, departureLocal: undefined, waypoints: route.waypoints.map((point) => ({ ...point, pauseMinutes: undefined })) };
  await saveRoute(legacy);
  expect((await listRoutes())[0].departureLocal).toBeUndefined();
});
it('keeps aggregate stops and estimates intact, adding only waypoint pauses to the schedule', () => {
  const route = fixture();
  const options = { speedKmh: 5, stopsMinutes: 90, fitness: 'regular' as const, surface: 'paved' as const };
  const estimate = estimatePersonalTime(route, options)!;
  const schedule = estimateRouteSchedule(route, estimate.moving);
  expect(estimate.total - estimate.moving).toBe(5400);
  expect(estimate.moving).toBe(estimate.movingRange.upper);
  expect(schedule.pauseMinutes).toBe(15);
  expect(schedule.finishLocal).toBe('2026-10-30T00:03');
  expect(options.stopsMinutes).toBe(90);
  expect(estimatePersonalTime(route, options)).toEqual(estimate);
});
it('stores the surface choice with the route and reads older routes as unknown', async () => {
  const route = { ...fixture(), surface: 'rough' as const };
  await saveRoute(route);
  const saved = (await listRoutes()).find((value) => value.id === route.id)!;
  expect(saved.surface).toBe('rough');
  expect((await duplicateRoute(saved)).surface).toBe('rough');
  expect(parseBackup(exportBackup([saved])).routes[0].surface).toBe('rough');
  await importBackup(parseBackup(exportBackup([saved])), 'replace');
  expect((await listRoutes()).find((value) => value.id === route.id)?.surface).toBe('rough');
  const legacy = { ...fixture(), id: 'legacy' };
  delete legacy.surface;
  await saveRoute(legacy);
  expect((await listRoutes()).find((value) => value.id === 'legacy')?.surface).toBe('unknown');
  expect(() => validateRoute({ ...route, surface: 'gravel' })).toThrow();
});
