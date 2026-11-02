import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStorageConnector } from './useStorageConnector';
import { createStorageConnector } from '../services/connectors/registry';
import {
  ConnectorError,
  type StorageConnector,
  type BackupEntry,
} from '../services/connectors/types';
import { decryptBackup, encryptBackup } from '../domain/encryptedBackup';
import { exportBackup } from '../domain/backup';
import { routeDb } from '../domain/storage';
import type { PlannedRoute } from '../domain/types';

const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto');
vi.mock('../services/connectors/registry', () => ({ createStorageConnector: vi.fn() }));
const config = {
  provider: 'github' as const,
  owner: 'example',
  repository: 'backups',
};
const password = 'synthetic-password';
const entry: BackupEntry = {
  id: 'roamlet-backups/11111111-1111-4111-8111-111111111111.roamlet',
  name: '11111111-1111-4111-8111-111111111111.roamlet',
  size: 500,
};
const route: PlannedRoute = {
  id: 'saved',
  name: 'Synthetic split route',
  description: '',
  activity: 'hiking',
  source: 'gpx',
  favorite: true,
  tags: ['test'],
  segments: [
    [
      [1, 2, 10],
      [1.01, 2.01, 20],
    ],
    [
      [3, 4, 5],
      [3.01, 4.01, 7],
    ],
  ],
  waypoints: [{ id: 'start', name: 'Start', coordinate: [1, 2, 10] }],
  stats: { distance: 100, duration: 60, ascent: 12 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};
let storage: StorageConnector;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.mocked(createStorageConnector).mockReset();
  storage = {
    checkConnection: vi.fn().mockResolvedValue(undefined),
    listBackups: vi.fn().mockResolvedValue([entry]),
    uploadBackup: vi.fn().mockResolvedValue(entry),
    downloadBackup: vi.fn(),
  };
  vi.mocked(createStorageConnector).mockReturnValue(storage);
  await routeDb.routes.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('does nothing until explicitly connected and forgets the memory-only connection on disconnect', async () => {
  const { result } = renderHook(useStorageConnector);
  expect(createStorageConnector).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.connect(config);
  });
  expect(result.current.connection).toEqual({
    provider: 'github',
    owner: 'example',
    repository: 'backups',
  });
  expect(result.current.connection).not.toHaveProperty('token');
  expect(storage.listBackups).not.toHaveBeenCalled();
  act(() => result.current.disconnect());
  expect(result.current.connection).toBeNull();
});

it('round-trips encrypted bytes with real library persistence and explicit preview/confirmation', async () => {
  await routeDb.routes.put(route);
  const { result } = renderHook(useStorageConnector);
  await act(async () => {
    await result.current.connect(config);
    await result.current.upload(password);
  });
  const bytes = vi.mocked(storage.uploadBackup).mock.calls[0][0];
  expect(new TextDecoder().decode(bytes)).not.toContain(route.name);
  expect((await decryptBackup(bytes, password)).routes).toEqual([route]);
  expect(result.current.success).toBe('uploaded');
  vi.mocked(storage.downloadBackup).mockResolvedValue(bytes);
  await act(async () => {
    await result.current.prepareRestore(entry, password);
  });
  expect(result.current.preview?.conflicts).toBe(1);
  expect(await routeDb.routes.count()).toBe(1);
  await act(async () => {
    await result.current.restore('copy');
  });
  expect(await routeDb.routes.count()).toBe(2);
  expect(
    (await routeDb.routes.toArray()).every(
      (value) => JSON.stringify(value.segments) === JSON.stringify(route.segments),
    ),
  ).toBe(true);
  expect(result.current.preview).toBeNull();
  expect(result.current.success).toBe('restored');
});

it('refuses short passwords and incomplete local libraries before any upload', async () => {
  const { result } = renderHook(useStorageConnector);
  await act(async () => {
    await result.current.connect(config);
    await result.current.upload('short');
  });
  expect(result.current.error).toBe('password');
  await routeDb.routes.put({ ...route, segments: [[[999, 2]]] });
  await act(async () => {
    await result.current.upload(password);
  });
  expect(result.current.error).toBe('local');
  expect(storage.uploadBackup).not.toHaveBeenCalled();
});

it('reports safe connection failures and permits retry', async () => {
  vi.mocked(storage.checkConnection).mockRejectedValueOnce(new ConnectorError('auth'));
  const { result } = renderHook(useStorageConnector);
  await act(async () => {
    await result.current.connect(config);
  });
  expect(result.current.error).toBe('auth');
  expect(result.current.connection).toBeNull();
  await act(async () => {
    await result.current.connect(config);
  });
  expect(result.current.connection).not.toBeNull();
  expect(result.current.error).toBeNull();
});

it.each(['resolve', 'reject'] as const)(
  'ignores an old connection %s after cancellation and a new connection',
  async (settle) => {
    const old = deferred<void>();
    vi.mocked(storage.checkConnection).mockReturnValueOnce(old.promise);
    const { result } = renderHook(useStorageConnector);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.connect(config);
    });
    const signal = vi.mocked(storage.checkConnection).mock.calls[0][0];
    act(() => result.current.cancel());
    await act(async () => {
      await result.current.connect({ ...config, repository: 'new-backups' });
    });
    await act(async () => {
      if (settle === 'resolve') old.resolve();
      else old.reject(new ConnectorError('auth'));
      await pending;
    });
    expect(signal?.aborted).toBe(true);
    expect(result.current.connection).toMatchObject({
      provider: 'github',
      repository: 'new-backups',
    });
    expect(result.current.error).toBeNull();
  },
);

it('ignores cancelled listings, protects newer results and aborts on unmount', async () => {
  const old = deferred<BackupEntry[]>();
  vi.mocked(storage.listBackups).mockReturnValueOnce(old.promise);
  const { result, unmount } = renderHook(useStorageConnector);
  await act(async () => {
    await result.current.connect(config);
  });
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.refresh();
  });
  const signal = vi.mocked(storage.listBackups).mock.calls[0][0];
  act(() => result.current.cancel());
  await act(async () => {
    await result.current.refresh();
    old.resolve([]);
    await pending;
  });
  expect(signal?.aborted).toBe(true);
  expect(result.current.backups).toEqual([entry]);
  const next = deferred<BackupEntry[]>();
  vi.mocked(storage.listBackups).mockReturnValueOnce(next.promise);
  act(() => {
    pending = result.current.refresh();
  });
  const nextSignal = vi.mocked(storage.listBackups).mock.calls[2][0];
  unmount();
  expect(nextSignal?.aborted).toBe(true);
  await act(async () => {
    next.reject(new ConnectorError('network'));
    await pending;
  });
});

it('does not preview or import a cancelled download, and reports wrong passwords without writes', async () => {
  const bytes = await encryptBackup(exportBackup([route]), password);
  const download = deferred<Uint8Array>();
  vi.mocked(storage.downloadBackup).mockReturnValueOnce(download.promise).mockResolvedValue(bytes);
  const { result } = renderHook(useStorageConnector);
  await act(async () => {
    await result.current.connect(config);
  });
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.prepareRestore(entry, password);
  });
  act(() => result.current.cancel());
  await act(async () => {
    download.resolve(bytes);
    await pending;
  });
  expect(result.current.preview).toBeNull();
  await act(async () => {
    await result.current.prepareRestore(entry, 'wrong-password');
  });
  expect(result.current.error).toBe('password');
  expect(await routeDb.routes.count()).toBe(0);
});

it('ignores a late upload response after disconnect', async () => {
  const upload = deferred<BackupEntry>();
  vi.mocked(storage.uploadBackup).mockReturnValueOnce(upload.promise);
  const { result } = renderHook(useStorageConnector);
  await act(async () => {
    await result.current.connect(config);
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.upload(password);
  });
  // Encryption is asynchronous: wait for the transport boundary, not an arbitrary delay.
  await vi.waitFor(() => expect(storage.uploadBackup).toHaveBeenCalled());
  const signal = vi.mocked(storage.uploadBackup).mock.calls[0][1];
  act(() => result.current.disconnect());
  await act(async () => {
    upload.resolve(entry);
    await pending;
  });
  expect(signal?.aborted).toBe(true);
  expect(result.current.connection).toBeNull();
  expect(result.current.success).toBeNull();
  expect(result.current.backups).toEqual([]);
});
