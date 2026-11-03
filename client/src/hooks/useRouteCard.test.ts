import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateRouteCard } from '../services/routeCard';
import type { RouteCardRequest } from '../domain/routeCard';
import { useRouteCard } from './useRouteCard';

vi.mock('../services/routeCard', () => ({ generateRouteCard: vi.fn() }));
const request: RouteCardRequest = {
  segments: [
    [
      [10, 50],
      [11, 51],
    ],
  ],
  title: 'Route',
  format: 'post',
  theme: 'light',
  privacyRadius: 0,
  activity: 'hiking',
  activityLabel: 'Hiking',
  plannedLabel: 'Planned route',
  metrics: [],
};
const blob = new Blob(['png'], { type: 'image/png' });
const create = vi.fn(() => 'blob:card');
const revoke = vi.fn();
function deferred() {
  let resolve!: (blob: Blob) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Blob>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  vi.mocked(generateRouteCard).mockReturnValueOnce(promise);
  return { resolve, reject };
}
beforeEach(() => {
  vi.mocked(generateRouteCard).mockReset();
  create.mockClear();
  revoke.mockClear();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('generates only on demand and releases preview URLs on parameter change and unmount', async () => {
  vi.mocked(generateRouteCard).mockResolvedValue(blob);
  const { result, rerender, unmount } = renderHook(({ value }) => useRouteCard(value), {
    initialProps: { value: request },
  });
  expect(generateRouteCard).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.generate();
  });
  expect(result.current.preview).toMatchObject({ status: 'ready', blob, url: 'blob:card' });
  rerender({ value: { ...request, privacyRadius: 500 } });
  expect(result.current.preview.status).toBe('idle');
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:card');
  expect(generateRouteCard).toHaveBeenCalledOnce();
  await act(async () => {
    await result.current.generate();
  });
  unmount();
  expect(revoke).toHaveBeenCalledTimes(2);
});

it.each(['resolve', 'reject'] as const)(
  'ignores obsolete %s when options change',
  async (settle) => {
    const pending = deferred();
    const { result, rerender } = renderHook(({ value }) => useRouteCard(value), {
      initialProps: { value: request },
    });
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.generate();
    });
    const signal = vi.mocked(generateRouteCard).mock.calls[0][1];
    rerender({ value: { ...request, theme: 'dark' } });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      if (settle === 'resolve') pending.resolve(blob);
      else pending.reject(new Error('Stale'));
      await operation;
    });
    expect(result.current.preview.status).toBe('idle');
    expect(create).not.toHaveBeenCalled();
  },
);

it('cancels a pending generation and ignores it while retry succeeds', async () => {
  const first = deferred();
  const second = deferred();
  const { result } = renderHook(() => useRouteCard(request));
  let old!: Promise<void>;
  let current!: Promise<void>;
  act(() => {
    old = result.current.generate();
  });
  const signal = vi.mocked(generateRouteCard).mock.calls[0][1];
  act(() => {
    result.current.cancel();
    current = result.current.generate();
  });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    first.resolve(blob);
    await old;
  });
  expect(result.current.preview.status).toBe('generating');
  await act(async () => {
    second.resolve(blob);
    await current;
  });
  expect(result.current.preview.status).toBe('ready');
});

it('shows current failures and permits retry', async () => {
  vi.mocked(generateRouteCard)
    .mockRejectedValueOnce(new Error('No route remains visible. Reduce the privacy radius.'))
    .mockResolvedValueOnce(blob);
  const { result } = renderHook(() => useRouteCard(request));
  await act(async () => {
    await result.current.generate();
  });
  expect(result.current.preview).toMatchObject({
    status: 'error',
    message: 'No route remains visible. Reduce the privacy radius.',
  });
  await act(async () => {
    await result.current.generate();
  });
  expect(result.current.preview.status).toBe('ready');
});

it('aborts on unmount without creating an obsolete URL', async () => {
  const pending = deferred();
  const { result, unmount } = renderHook(() => useRouteCard(request));
  let operation!: Promise<void>;
  act(() => {
    operation = result.current.generate();
  });
  const signal = vi.mocked(generateRouteCard).mock.calls[0][1];
  unmount();
  expect(signal.aborted).toBe(true);
  pending.resolve(blob);
  await operation;
  expect(create).not.toHaveBeenCalled();
});

it('debounces design changes only after generation, keeps privacy and format changes manual', async () => {
  vi.useFakeTimers();
  vi.mocked(generateRouteCard).mockResolvedValue(blob);
  const { result, rerender, unmount } = renderHook(({ value }) => useRouteCard(value, true), {
    initialProps: { value: request },
  });
  const dark = { ...request, theme: 'dark' as const };
  rerender({ value: dark });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(generateRouteCard).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.generate();
  });
  rerender({ value: { ...dark, title: 'A' } });
  rerender({ value: { ...dark, title: 'Final title', accent: 'blue' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(349);
  });
  expect(generateRouteCard).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(generateRouteCard).toHaveBeenCalledTimes(2);
  expect(generateRouteCard).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: 'Final title', accent: 'blue' }),
    expect.any(AbortSignal),
  );
  rerender({ value: { ...dark, privacyRadius: 500 } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(result.current.preview.status).toBe('idle');
  expect(generateRouteCard).toHaveBeenCalledTimes(2);
  rerender({ value: { ...dark, privacyRadius: 500, format: 'story' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(generateRouteCard).toHaveBeenCalledTimes(2);
  unmount();
});

it('cancels scheduled refreshes and cleans timers on unmount', async () => {
  vi.useFakeTimers();
  vi.mocked(generateRouteCard).mockResolvedValue(blob);
  const { result, rerender, unmount } = renderHook(({ value }) => useRouteCard(value, true), {
    initialProps: { value: request },
  });
  await act(async () => {
    await result.current.generate();
  });
  rerender({ value: { ...request, title: 'Changed' } });
  act(() => result.current.cancel());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(generateRouteCard).toHaveBeenCalledOnce();
  rerender({ value: { ...request, title: 'Another' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(generateRouteCard).toHaveBeenCalledOnce();
  await act(async () => {
    await result.current.generate();
  });
  rerender({ value: { ...request, title: 'Unmounted' } });
  unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(generateRouteCard).toHaveBeenCalledTimes(2);
});
