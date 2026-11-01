import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGitHubSession } from './useGitHubSession';
import {
  getGitHubSession,
  getGitHubRepositories,
  logoutGitHub,
  type GitHubSession,
} from '../services/connectors/githubSession';
import { ConnectorError } from '../services/connectors/types';
vi.mock('../services/connectors/githubSession', () => ({
  getGitHubSession: vi.fn(),
  getGitHubRepositories: vi.fn(),
  logoutGitHub: vi.fn(),
}));
const session = { available: true, connected: true, login: 'example' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.mocked(getGitHubSession).mockReset().mockResolvedValue(session);
  vi.mocked(getGitHubRepositories)
    .mockReset()
    .mockResolvedValue([{ owner: 'example', name: 'backups' }]);
  vi.mocked(logoutGitHub).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('does not contact the session or list repositories while the page is closed', async () => {
  const { result } = renderHook(() => useGitHubSession(false));
  expect(getGitHubSession).not.toHaveBeenCalled();
  expect(result.current.session).toBeNull();
});
it('ignores stale session results after another tab causes refresh', async () => {
  const old = deferred<GitHubSession>();
  vi.mocked(getGitHubSession).mockReturnValueOnce(old.promise);
  const { result } = renderHook(() => useGitHubSession(true));
  const signal = vi.mocked(getGitHubSession).mock.calls[0][0];
  vi.mocked(getGitHubSession).mockResolvedValue({ available: true, connected: false });
  await act(async () => {
    await result.current.refresh();
  });
  await act(async () => {
    old.resolve(session);
  });
  expect(signal?.aborted).toBe(true);
  expect(result.current.session?.connected).toBe(false);
});
it('aborts and ignores a repository listing on unmount', async () => {
  const waiting = deferred<{ owner: string; name: string }[]>();
  vi.mocked(getGitHubRepositories).mockReturnValue(waiting.promise);
  const { result, unmount } = renderHook(() => useGitHubSession(true));
  await act(async () => {});
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.loadRepositories();
  });
  const signal = vi.mocked(getGitHubRepositories).mock.calls[0][0];
  unmount();
  expect(signal?.aborted).toBe(true);
  waiting.resolve([]);
  await loading;
});
it('does not let a stale session refresh undo logout', async () => {
  const waiting = deferred<GitHubSession>();
  const { result } = renderHook(() => useGitHubSession(true));
  await act(async () => {});
  vi.mocked(getGitHubSession).mockReturnValueOnce(waiting.promise);
  let stale!: Promise<void>;
  act(() => {
    stale = result.current.refresh();
  });
  await act(async () => {
    expect(await result.current.disconnect()).toBe(true);
  });
  await act(async () => {
    waiting.resolve(session);
    await stale;
  });
  expect(result.current.session?.connected).toBe(false);
});
it('reports failed logout without falsely changing authentication', async () => {
  const { result } = renderHook(() => useGitHubSession(true));
  await act(async () => {});
  vi.mocked(logoutGitHub).mockRejectedValueOnce(new ConnectorError('network'));
  await act(async () => {
    expect(await result.current.disconnect()).toBe(false);
  });
  expect(result.current.session?.connected).toBe(true);
  expect(result.current.error).toBe('network');
});
it('rechecks session on browser focus and cleans up listeners when closed', async () => {
  const { rerender } = renderHook(({ open }) => useGitHubSession(open), {
    initialProps: { open: true },
  });
  await act(async () => {});
  expect(getGitHubSession).toHaveBeenCalledOnce();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(getGitHubSession).toHaveBeenCalledTimes(2);
  rerender({ open: false });
  window.dispatchEvent(new Event('focus'));
  expect(getGitHubSession).toHaveBeenCalledTimes(2);
});
