import { routeDb } from './storage';
import { migrateSnapshot, validateSnapshot, type EditorSnapshot } from './editorSnapshot';
export interface DraftRecord {
  id: 'current';
  version: 1;
  updatedAt: string;
  snapshot: EditorSnapshot;
}
export async function loadDraft(): Promise<DraftRecord | null> {
  const record = (await routeDb.table('drafts').get('current')) as DraftRecord | undefined;
  if (!record) return null;
  if (
    record.version !== 1 ||
    record.id !== 'current' ||
    !Number.isFinite(Date.parse(record.updatedAt))
  )
    throw new Error('Invalid draft data.');
  return { ...record, snapshot: migrateSnapshot(record.snapshot) };
}
export function draftWriter(onError: () => void, delay = 500) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { generation: number; snapshot: EditorSnapshot } | null = null;
  let queue: Promise<boolean> = Promise.resolve(true);
  function enqueue(task: () => Promise<void>): Promise<boolean> {
    queue = queue.then(task, task).then(
      () => true,
      () => {
        onError();
        return false;
      },
    );
    return queue;
  }
  async function flush(): Promise<boolean> {
    for (;;) {
      clearTimeout(timer);
      const captured = pending;
      pending = null;
      if (captured)
        enqueue(async () => {
          if (captured.generation !== generation) return;
          validateSnapshot(captured.snapshot);
          await routeDb.table('drafts').put({
            id: 'current',
            version: 1,
            updatedAt: new Date().toISOString(),
            snapshot: captured.snapshot,
          });
        });
      const writing = queue;
      if (!(await writing)) return false;
      if (!pending && queue === writing) return true;
    }
  }
  return {
    schedule(snapshot: EditorSnapshot) {
      pending = { generation, snapshot: structuredClone(snapshot) };
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
    },
    flush,
    clear() {
      generation++;
      clearTimeout(timer);
      pending = null;
      return enqueue(() => routeDb.table('drafts').delete('current'));
    },
    cancel() {
      generation++;
      clearTimeout(timer);
      pending = null;
    },
  };
}
