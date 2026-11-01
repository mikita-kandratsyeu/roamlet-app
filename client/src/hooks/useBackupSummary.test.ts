import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBackupSummary } from './useBackupSummary';
import { listRoutes } from '../domain/storage';
vi.mock('../domain/storage', () => ({ listRoutes: vi.fn() }));
beforeEach(() => vi.mocked(listRoutes).mockReset().mockResolvedValue([]));
afterEach(cleanup);
it('loads only when active and refreshes after a new revision', async () => {
  const { result, rerender } = renderHook(
    ({ active, revision }) => useBackupSummary(active, revision),
    { initialProps: { active: false, revision: '' } },
  );
  expect(listRoutes).not.toHaveBeenCalled();
  rerender({ active: true, revision: '' });
  await waitFor(() => expect(result.current.count).toBe(0));
  rerender({ active: true, revision: 'uploaded' });
  await waitFor(() => expect(listRoutes).toHaveBeenCalledTimes(2));
});
it('does not pretend an invalid partial library is a complete backup', async () => {
  vi.mocked(listRoutes).mockImplementationOnce(async (onInvalid) => {
    onInvalid?.(2);
    return [];
  });
  const { result } = renderHook(() => useBackupSummary(true, ''));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.count).toBeNull();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.count).toBe(0));
  expect(result.current.failed).toBe(false);
});
it('reports local read errors without trusting stale results after unmount', async () => {
  vi.mocked(listRoutes).mockRejectedValueOnce(new Error('Read failed'));
  const { result } = renderHook(() => useBackupSummary(true, ''));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.count).toBeNull();
  let resolve!: (value: []) => void;
  vi.mocked(listRoutes).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const next = renderHook(() => useBackupSummary(true, ''));
  next.unmount();
  await act(async () => resolve([]));
});
