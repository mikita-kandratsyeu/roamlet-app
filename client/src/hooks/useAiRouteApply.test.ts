import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAiRouteApply } from './useAiRouteApply';
import { initialEditor } from '../domain/editorSnapshot';
import { routingProvider } from '../services/routing';
import type { RoutingResult } from '../domain/types';
vi.mock('../services/routing', () => ({ routingProvider: { calculateRoute: vi.fn() } }));
const snapshot = {
  ...initialEditor(),
  waypoints: [
    { id: 'a', name: 'Private start', coordinate: [11, 47] as [number, number] },
    { id: 'b', name: 'Private finish', coordinate: [12, 48] as [number, number] },
  ],
};
const calculated: RoutingResult = {
  segments: [
    [
      [11, 47],
      [12, 48],
    ],
  ],
  stats: { distance: 100, duration: 10 },
};
const proposal = { routingOptions: { avoidSteps: true }, explanation: 'Avoid steps' };
beforeEach(() =>
  vi.mocked(routingProvider.calculateRoute).mockReset().mockResolvedValue(calculated),
);
afterEach(() => cleanup());
it('commits route and options together only after successful real routing', async () => {
  const commit = vi.fn();
  const { result } = renderHook(() => useAiRouteApply(snapshot, commit));
  await act(async () => {
    expect(await result.current.apply(proposal)).toBe(true);
  });
  expect(routingProvider.calculateRoute).toHaveBeenCalledWith(
    snapshot.waypoints,
    'cycling',
    expect.any(AbortSignal),
    expect.objectContaining({ avoidSteps: true }),
  );
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({
      segments: calculated.segments,
      name: snapshot.name,
      routingOptions: expect.objectContaining({ avoidSteps: true }),
    }),
    expect.objectContaining({ avoidSteps: true }),
  );
});
it('keeps the editor untouched on routing failure and permits retry', async () => {
  const commit = vi.fn();
  vi.mocked(routingProvider.calculateRoute).mockRejectedValueOnce(new Error('Failed'));
  const { result } = renderHook(() => useAiRouteApply(snapshot, commit));
  await act(async () => {
    await expect(result.current.apply(proposal)).rejects.toThrow('Failed');
  });
  expect(commit).not.toHaveBeenCalled();
  await act(async () => {
    expect(await result.current.apply(proposal)).toBe(true);
  });
  expect(commit).toHaveBeenCalledTimes(1);
});
it('ignores late routing after snapshot changes or cancellation', async () => {
  let resolve!: (value: RoutingResult) => void;
  vi.mocked(routingProvider.calculateRoute).mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const commit = vi.fn();
  const { result, rerender } = renderHook(({ value }) => useAiRouteApply(value, commit), {
    initialProps: { value: snapshot },
  });
  let pending!: Promise<boolean>;
  act(() => {
    pending = result.current.apply(proposal);
  });
  rerender({ value: { ...snapshot, name: 'Changed' } });
  await act(async () => {
    resolve(calculated);
    expect(await pending).toBe(false);
  });
  expect(commit).not.toHaveBeenCalled();
  expect(vi.mocked(routingProvider.calculateRoute).mock.calls[0][2]?.aborted).toBe(true);
});
it('never routes manual drawings, snapshots or unsupported AI settings', async () => {
  const commit = vi.fn();
  const { result } = renderHook(() =>
    useAiRouteApply({ ...snapshot, planningMode: 'manual' }, commit),
  );
  await act(async () => {
    expect(await result.current.apply(proposal)).toBe(false);
  });
  expect(routingProvider.calculateRoute).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});
