import { beforeEach, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { routeDb } from './storage';
import { draftWriter, loadDraft } from './drafts';
import { initialEditor, validateSnapshot } from './editorSnapshot';
beforeEach(async () => {
  await routeDb.table('drafts').clear();
});
it('validates version and snapshot before restoring one separate draft', async () => {
  const editor = initialEditor();
  const writer = draftWriter(vi.fn());
  writer.schedule(editor);
  expect(await writer.flush()).toBe(true);
  expect((await loadDraft())?.snapshot).toEqual(editor);
  await routeDb.table('drafts').put({ id: 'current', version: 999 });
  await expect(loadDraft()).rejects.toThrow('Invalid draft');
});
it('cancels old scheduled writes, serializes deletes, and retains a newly scheduled identity', async () => {
  const writer = draftWriter(vi.fn());
  writer.schedule(initialEditor());
  const clear = writer.clear();
  const next = initialEditor();
  next.name = 'New session';
  writer.schedule(next);
  const flush = writer.flush();
  await Promise.all([clear, flush]);
  expect((await loadDraft())?.snapshot.identity).toEqual(next.identity);
  expect((await loadDraft())?.snapshot.name).toBe('New session');
});
function blockNextDraftWrite() {
  let release!: () => void;
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const gate = new Dexie.Promise<void>((resolve) => {
    release = resolve;
  });
  const table = routeDb.table('drafts');
  const originalPut = table.put.bind(table);
  vi.spyOn(table, 'put').mockImplementationOnce((record) => {
    start();
    return gate.then(() => originalPut(record));
  });
  return { release, started };
}
it('flushes edits made while an earlier draft write is awaiting completion before resolving', async () => {
  const blocked = blockNextDraftWrite();
  const writer = draftWriter(vi.fn());
  const snapshot = initialEditor();
  writer.schedule(snapshot, true);
  const flushed = writer.flush();
  await blocked.started;
  writer.schedule({ ...snapshot, name: 'Edited during flush' }, true);
  blocked.release();
  expect(await flushed).toBe(true);
  expect((await loadDraft())?.snapshot.name).toBe('Edited during flush');
});
it('does not resurrect an old write or delete a new session when resetting during an awaited write', async () => {
  const blocked = blockNextDraftWrite();
  const writer = draftWriter(vi.fn());
  writer.schedule(initialEditor());
  const previousFlush = writer.flush();
  await blocked.started;
  const deleted = writer.clear();
  const next = initialEditor();
  next.name = 'After reset';
  writer.schedule(next);
  const nextFlush = writer.flush();
  blocked.release();
  await Promise.all([previousFlush, deleted, nextFlush]);
  expect((await loadDraft())?.snapshot.identity).toEqual(next.identity);
  expect((await loadDraft())?.snapshot.name).toBe('After reset');
});
it('does not clone retained route geometry until the debounced draft is flushed', async () => {
  const editor = initialEditor();
  editor.mode = 'snapshot';
  editor.result = {
    ...editor.identity, name: 'Track', description: '', activity: 'hiking', source: 'gpx',
    segments: [[[0, 0, 100], [0.01, 0, 110]]], waypoints: [],
    stats: { distance: 1112, duration: 800 }, updatedAt: editor.identity.createdAt,
  };
  const clone = vi.spyOn(globalThis, 'structuredClone');
  const writer = draftWriter(vi.fn());
  writer.schedule(editor, true);
  writer.schedule({ ...editor, name: 'Latest title' }, true);
  expect(clone.mock.calls.some(([value]) =>
    value && typeof value === 'object' && 'result' in value && value.result !== null,
  )).toBe(false);
  expect(clone.mock.calls.some(([value]) => value === editor.result)).toBe(false);
  clone.mockRestore();
  expect(await writer.flush()).toBe(true);
  const saved = await loadDraft();
  expect(saved?.snapshot).toEqual({ ...editor, name: 'Latest title' });
  saved!.snapshot.result!.segments[0][0][2] = 999;
  expect(editor.result.segments[0][0][2]).toBe(100);
  expect((await loadDraft())?.snapshot.result?.segments[0][0][2]).toBe(100);
});
it('captures snapshots before asynchronous writes and reports nonblocking errors', async () => {
  const onError = vi.fn();
  const writer = draftWriter(onError);
  const editor = initialEditor();
  writer.schedule(editor);
  editor.name = 'Mutated afterwards';
  await writer.flush();
  expect((await loadDraft())?.snapshot.name).toBe('');
  writer.schedule({ ...initialEditor(), stopsMinutes: -1 });
  expect(await writer.flush()).toBe(false);
  expect(onError).toHaveBeenCalledOnce();
  expect((await loadDraft())?.snapshot.name).toBe('');
});
it('rejects invalid points, identity, modes and time parameters', () => {
  for (const patch of [
    { speeds: { cycling: 0, hiking: 5 } },
    { waypoints: [{ id: 'x', name: 'X', coordinate: [181, 1] }] },
    { mode: 'invalid' },
    { identity: {} },
    { result: {} },
  ]) {
    expect(() => validateSnapshot({ ...initialEditor(), ...patch })).toThrow();
  }
});

it('migrates previous drafts with custom pace and ready geometry without invalidating the snapshot', async () => {
  const snapshot = initialEditor();
  snapshot.speeds = { cycling: 12.5, hiking: 4.8 };
  snapshot.stopsMinutes = 15;
  snapshot.mode = 'snapshot';
  snapshot.result = {
    ...snapshot.identity,
    name: 'Ready',
    description: '',
    activity: 'cycling',
    waypoints: [],
    segments: [
      [
        [0, 0],
        [0.01, 0],
      ],
    ],
    stats: { distance: 1344, duration: 3600 },
    source: 'openrouteservice',
    updatedAt: snapshot.identity.createdAt,
  };
  const { fitness: _fitness, surface: _surface, ...old } = snapshot;
  void _fitness;
  void _surface;
  await routeDb
    .table('drafts')
    .put({ id: 'current', version: 1, updatedAt: new Date().toISOString(), snapshot: old });
  expect((await loadDraft())?.snapshot).toEqual({ ...old, fitness: 'regular', surface: 'unknown' });
});
it('persists explicit draft fitness/surface and rejects unsupported choices', async () => {
  const writer = draftWriter(vi.fn());
  const snapshot = { ...initialEditor(), fitness: 'trained' as const, surface: 'rough' as const };
  writer.schedule(snapshot);
  expect(await writer.flush()).toBe(true);
  expect((await loadDraft())?.snapshot).toEqual(snapshot);
  expect(() => validateSnapshot({ ...snapshot, fitness: 'expert' })).toThrow();
  expect(() => validateSnapshot({ ...snapshot, surface: 'gravel' })).toThrow();
});
