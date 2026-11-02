import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGoogleDriveSession } from './useGoogleDriveSession';
import {
  getGoogleDriveSession,
  logoutGoogleDrive,
  type GoogleDriveSession,
} from '../services/connectors/googleDriveSession';
import { ConnectorError } from '../services/connectors/types';
vi.mock('../services/connectors/googleDriveSession', () => ({
  getGoogleDriveSession: vi.fn(),
  logoutGoogleDrive: vi.fn(),
}));
const session = {
  available: true,
  connected: true,
  email: 'user@example.test',
  accountId: 'user123',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.mocked(getGoogleDriveSession).mockReset().mockResolvedValue(session);
  vi.mocked(logoutGoogleDrive).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('does not request a session before the catalog is opened', () => {
  renderHook(() => useGoogleDriveSession(false));
  expect(getGoogleDriveSession).not.toHaveBeenCalled();
});
it('ignores an old session after refresh sees an expired cookie', async () => {
  const old = deferred<GoogleDriveSession>();
  vi.mocked(getGoogleDriveSession).mockReturnValueOnce(old.promise);
  const { result } = renderHook(() => useGoogleDriveSession(true));
  const signal = vi.mocked(getGoogleDriveSession).mock.calls[0][0];
  vi.mocked(getGoogleDriveSession).mockResolvedValue({ available: true, connected: false });
  await act(async () => {
    await result.current.refresh();
    old.resolve(session);
  });
  expect(signal?.aborted).toBe(true);
  expect(result.current.session?.connected).toBe(false);
});
it('does not let a stale session response undo logout', async () => {
  const old = deferred<GoogleDriveSession>();
  const { result } = renderHook(() => useGoogleDriveSession(true));
  await act(async () => {});
  vi.mocked(getGoogleDriveSession).mockReturnValueOnce(old.promise);
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.refresh();
  });
  await act(async () => {
    expect(await result.current.disconnect()).toBe(true);
  });
  await act(async () => {
    old.resolve(session);
    await pending;
  });
  expect(result.current.session?.connected).toBe(false);
});
it('leaves the connection visible when logout fails and permits retry', async () => {
  const { result } = renderHook(() => useGoogleDriveSession(true));
  await act(async () => {});
  vi.mocked(logoutGoogleDrive).mockRejectedValueOnce(new ConnectorError('network'));
  await act(async () => {
    expect(await result.current.disconnect()).toBe(false);
  });
  expect(result.current.error).toBe('network');
  expect(result.current.session?.connected).toBe(true);
  await act(async () => {
    expect(await result.current.disconnect()).toBe(true);
  });
  expect(result.current.error).toBeNull();
});
it('rechecks on cross-tab changes and removes listeners on close', async () => {
  const { rerender } = renderHook(({ open }) => useGoogleDriveSession(open), {
    initialProps: { open: true },
  });
  await act(async () => {});
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'roamlet-google-drive-session-change',
        newValue: 'changed',
      }),
    );
  });
  expect(getGoogleDriveSession).toHaveBeenCalledTimes(2);
  rerender({ open: false });
  window.dispatchEvent(new Event('focus'));
  expect(getGoogleDriveSession).toHaveBeenCalledTimes(2);
});
it('aborts on unmount and suppresses late failures', async () => {
  const old = deferred<GoogleDriveSession>();
  vi.mocked(getGoogleDriveSession).mockReturnValue(old.promise);
  const { unmount } = renderHook(() => useGoogleDriveSession(true));
  const signal = vi.mocked(getGoogleDriveSession).mock.calls[0][0];
  unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => old.resolve(session));
});
