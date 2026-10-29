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
  writer.schedule(snapshot);
  const flushed = writer.flush();
  await blocked.started;
  writer.schedule({ ...snapshot, name: 'Edited during flush' });
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
