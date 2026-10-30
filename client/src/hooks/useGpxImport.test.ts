import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { initialEditor } from '../domain/editorSnapshot';
import type { PlannedRoute } from '../domain/types';
import { importGpxFile } from '../services/gpxImport';
import { useGpxImport } from './useGpxImport';

vi.mock('../services/gpxImport', () => ({ importGpxFile: vi.fn() }));
const file = new File(['<gpx/>'], 'route.gpx');
const route: PlannedRoute = {
  id: 'track',
  name: 'Track',
  description: '',
  activity: 'hiking',
  source: 'gpx',
  segments: [
    [
      [1, 2, 100],
      [1.01, 2, 120],
    ],
    [
      [2, 3, 50],
      [2.01, 3, 40],
    ],
  ],
  waypoints: [],
  stats: { distance: 2224, duration: 1600 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
function pendingImport() {
  let resolve!: (value: PlannedRoute) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<PlannedRoute>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  vi.mocked(importGpxFile).mockReturnValueOnce(promise);
  return { resolve, reject };
}
beforeEach(() => vi.mocked(importGpxFile).mockReset());

it('imports exact geometry and retains a cancellation signal for confirmation', async () => {
  vi.mocked(importGpxFile).mockResolvedValue(route);
  const snapshot = initialEditor();
  const { result } = renderHook(() => useGpxImport(snapshot));
  let imported: Awaited<ReturnType<typeof result.current.importFile>>;
  await act(async () => {
    imported = await result.current.importFile(file);
  });
  expect(imported!.route).toBe(route);
  expect(imported!.signal.aborted).toBe(false);
  expect(result.current.importing).toBe(false);
  act(() => result.current.cancelImport());
  expect(imported!.signal.aborted).toBe(true);
});

it.each(['resolve', 'reject'] as const)(
  'ignores stale %s after a newer import starts',
  async (settle) => {
    const snapshot = initialEditor();
    const first = pendingImport();
    const second = pendingImport();
    const { result } = renderHook(() => useGpxImport(snapshot));
    let old!: ReturnType<typeof result.current.importFile>;
    let current!: ReturnType<typeof result.current.importFile>;
    act(() => {
      old = result.current.importFile(file);
    });
    const signal = vi.mocked(importGpxFile).mock.calls[0][1]!;
    act(() => {
      current = result.current.importFile(file);
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      if (settle === 'resolve') first.resolve(route);
      else first.reject(new Error('Old import failed'));
      expect(await old).toBeNull();
    });
    expect(result.current.importing).toBe(true);
    await act(async () => {
      second.resolve(route);
      expect((await current)?.route).toBe(route);
    });
    expect(result.current.importing).toBe(false);
  },
);

it('cancels processing after an editor change or explicit cancellation', async () => {
  const snapshot = initialEditor();
  const pending = pendingImport();
  const { result, rerender } = renderHook(({ value }) => useGpxImport(value), {
    initialProps: { value: snapshot },
  });
  let imported!: ReturnType<typeof result.current.importFile>;
  act(() => {
    imported = result.current.importFile(file);
  });
  const signal = vi.mocked(importGpxFile).mock.calls[0][1]!;
  rerender({ value: { ...snapshot, name: 'Changed while importing' } });
  expect(signal.aborted).toBe(true);
  expect(result.current.importing).toBe(false);
  await act(async () => {
    pending.resolve(route);
    expect(await imported).toBeNull();
  });
});

it('propagates a current failure and permits retry', async () => {
  const snapshot = initialEditor();
  vi.mocked(importGpxFile)
    .mockRejectedValueOnce(new Error('Malformed GPX XML.'))
    .mockResolvedValueOnce(route);
  const { result } = renderHook(() => useGpxImport(snapshot));
  await act(async () => {
    await expect(result.current.importFile(file)).rejects.toThrow('Malformed GPX');
  });
  expect(result.current.importing).toBe(false);
  await act(async () => {
    expect((await result.current.importFile(file))?.route).toBe(route);
  });
});

it('aborts on unmount and ignores late completion', async () => {
  const snapshot = initialEditor();
  const pending = pendingImport();
  const { result, unmount } = renderHook(() => useGpxImport(snapshot));
  let imported!: ReturnType<typeof result.current.importFile>;
  act(() => {
    imported = result.current.importFile(file);
  });
  const signal = vi.mocked(importGpxFile).mock.calls[0][1]!;
  unmount();
  expect(signal.aborted).toBe(true);
  pending.resolve(route);
  expect(await imported).toBeNull();
});
