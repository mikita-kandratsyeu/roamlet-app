import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_LIMITS, exportBackup, importBackup, parseBackup, readBackupFile } from './backup';
import { routeDb } from './storage';
import { validateRoute } from './routeValidation';
import type { PlannedRoute } from './types';

const route = (id = 'route'): PlannedRoute => ({
  id,
  name: 'Walk',
  description: 'Notes',
  activity: 'hiking',
  source: 'gpx',
  favorite: true,
  tags: ['forest', 'weekend'],
  segments: [
    [
      [1, 2, 5],
      [2, 3, 9],
    ],
    [[9, 8]],
  ],
  waypoints: [{ id: 'start', name: 'Start', coordinate: [1, 2, 5] }],
  stats: { distance: 1000, duration: 720, ascent: 4 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
});
const backup = (routes = [route()]) => ({
  version: 1,
  exportedAt: '2026-01-03T00:00:00.000Z',
  routes,
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await routeDb.routes.clear();
});
afterAll(async () => {
  await routeDb.delete();
});

describe('versioned library backup', () => {
  it('round-trips split geometry, heights, metadata, statistics, favorites and tags without recalculation', async () => {
    const original = route();
    const data = parseBackup(exportBackup([original]));
    expect(data.version).toBe(1);
    expect(data.routes).toEqual([original]);
    expect(await importBackup(data)).toEqual({ imported: 1, skipped: 0, copied: 0, replaced: 0 });
    expect(await routeDb.routes.get(original.id)).toEqual({ ...original, surface: 'unknown' });
  });
  it.each(['skip', 'replace', 'copy'] as const)(
    'handles %s conflicts without changing the supplied snapshots',
    async (mode) => {
      await routeDb.routes.put({ ...route(), name: 'Existing' });
      const original = backup();
      const result = await importBackup(original, mode);
      expect(original.routes[0].id).toBe('route');
      const rows = await routeDb.routes.toArray();
      if (mode === 'skip') {
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('Existing');
        expect(result.skipped).toBe(1);
      }
      if (mode === 'replace') {
        expect(rows).toEqual([{ ...route(), surface: 'unknown' }]);
        expect(result.replaced).toBe(1);
      }
      if (mode === 'copy') {
        expect(rows).toHaveLength(2);
        const copy = rows.find((value) => value.id !== 'route')!;
        expect(copy.waypoints[0].id).not.toBe('start');
        expect(copy.segments).toEqual(route().segments);
        expect(result.copied).toBe(1);
      }
    },
  );
  it('defaults to safe copies and rechecks conflicts against the database', async () => {
    const data = backup();
    await importBackup(data);
    expect((await importBackup(data)).copied).toBe(1);
    expect(await routeDb.routes.count()).toBe(2);
  });
  it('rolls back every write when a later record cannot be persisted', async () => {
    const put = routeDb.routes.put.bind(routeDb.routes);
    vi.spyOn(routeDb.routes, 'put')
      .mockImplementationOnce(put)
      .mockRejectedValueOnce(new Error('quota'));
    await expect(importBackup(backup([route('a'), route('b')]))).rejects.toThrow('quota');
    expect(await routeDb.routes.count()).toBe(0);
  });
  it.each([
    null,
    [],
    { version: 2 },
    { ...backup(), exportedAt: 'bad' },
    { ...backup(), routes: {} },
    backup([route(), route()]),
  ])('rejects malformed structures and unsupported versions', (data) => {
    expect(() => parseBackup(JSON.stringify(data))).toThrow();
  });
  it.each([
    { activity: 'running' },
    { segments: [null] },
    { segments: [[[181, 0]]] },
    { segments: [[[0, 91]]] },
    { segments: [[[0, 0, 'height']]] },
    { createdAt: 'invalid' },
    { createdAt: '2026-02-30T00:00:00Z' },
    { updatedAt: '1' },
    { segments: new Array(1) },
    { segments: [[new Array(3)]] },
    { tags: new Array(1) },
    { updatedAt: 123 },
    { stats: { distance: -1, duration: 1 } },
    { stats: { distance: 1, duration: Infinity } },
    { favorite: 'yes' },
    { surface: 'gravel' },
    { tags: ['ok', 1] },
    { waypoints: [{ id: 'a', name: 'A', coordinate: null }] },
  ])('validates unknown route fields safely', (patch) => {
    expect(() => validateRoute({ ...route(), ...patch })).toThrow();
  });
  it('rejects invalid JSON and over-limit files before reading', async () => {
    expect(() => parseBackup('{')).toThrow('JSON');
    const text = vi.fn();
    await expect(
      readBackupFile({ size: BACKUP_LIMITS.bytes + 1, text } as unknown as File),
    ).rejects.toThrow('20 MiB');
    expect(text).not.toHaveBeenCalled();
    expect(() => parseBackup(' '.repeat(BACKUP_LIMITS.bytes + 1))).toThrow('20 MiB');
  });
  it('enforces route and point limits, including waypoint points', () => {
    expect(() => exportBackup(Array.from({ length: 1001 }, (_, i) => route(String(i))))).toThrow(
      'route limits',
    );
    const large = {
      ...route(),
      segments: [Array.from({ length: 100000 }, () => [1, 2] as [number, number])],
    };
    expect(() => exportBackup([large])).toThrow('point limits');
    const total = Array.from({ length: 6 }, (_, i) => ({
      ...route(String(i)),
      waypoints: [],
      segments: [Array.from({ length: 83334 }, () => [1, 2] as [number, number])],
    }));
    expect(() => exportBackup(total)).toThrow('point limits');
  });
  it('never partially imports malformed backups', async () => {
    await expect(
      importBackup(
        backup([route('good'), { ...route('bad'), tags: null } as unknown as PlannedRoute]),
      ),
    ).rejects.toThrow();
    expect(await routeDb.routes.count()).toBe(0);
  });
});
