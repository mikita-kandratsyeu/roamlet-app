import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGoogleCalendarSession, CALENDAR_CONNECTION_KEY, CALENDAR_SESSION_CHANGE } from './useGoogleCalendarSession';
import { getGoogleCalendarSession, logoutGoogleCalendar, type GoogleCalendarSession } from '../services/connectors/googleCalendar';
import { ConnectorError } from '../services/connectors/types';
vi.mock('../services/connectors/googleCalendar', async (original) => ({
  ...await original<typeof import('../services/connectors/googleCalendar')>(),
  getGoogleCalendarSession: vi.fn(), logoutGoogleCalendar: vi.fn(),
}));
const session = () => ({ available: true, connected: true, email: 'user@example.test', accountId: 'user-one', expiresAt: Date.now() + 3600000 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.mocked(getGoogleCalendarSession).mockReset().mockResolvedValue(session());
  vi.mocked(logoutGoogleCalendar).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('does not request before enabled and cancels on unmount', async () => {
  const pending = deferred<GoogleCalendarSession>();
  vi.mocked(getGoogleCalendarSession).mockReturnValue(pending.promise);
  const { rerender, unmount } = renderHook(({ enabled }) => useGoogleCalendarSession(enabled), { initialProps: { enabled: false } });
  expect(getGoogleCalendarSession).not.toHaveBeenCalled();
  rerender({ enabled: true });
  const signal = vi.mocked(getGoogleCalendarSession).mock.calls[0][0];
  unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(session()));
});
it('keeps remembered actions on expiry but removes them on explicit disconnect', async () => {
  const { result } = renderHook(() => useGoogleCalendarSession(true));
  await act(async () => {});
  expect(result.current.knownConnected).toBe(true);
  vi.mocked(getGoogleCalendarSession).mockResolvedValue({ available: true, connected: false });
  await act(async () => result.current.refresh());
  expect(result.current.session?.connected).toBe(false);
  expect(result.current.knownConnected).toBe(true);
  await act(async () => { expect(await result.current.disconnect()).toBe(true); });
  expect(result.current.knownConnected).toBe(false);
  expect(localStorage.getItem(CALENDAR_CONNECTION_KEY)).toBe('0');
});
it('ignores stale refresh responses after logout', async () => {
  const { result } = renderHook(() => useGoogleCalendarSession(true));
  await act(async () => {});
  const old = deferred<GoogleCalendarSession>();
  vi.mocked(getGoogleCalendarSession).mockReturnValueOnce(old.promise);
  let pending!: Promise<void>;
  act(() => { pending = result.current.refresh(); });
  vi.mocked(getGoogleCalendarSession).mockResolvedValue({ available: true, connected: false });
  await act(async () => { await result.current.disconnect(); });
  await act(async () => { old.resolve(session()); await pending; });
  expect(result.current.session?.connected).toBe(false);
});
it('preserves connection on transient errors and failed logout with retry', async () => {
  const { result } = renderHook(() => useGoogleCalendarSession(true));
  await act(async () => {});
  vi.mocked(getGoogleCalendarSession).mockRejectedValueOnce(new ConnectorError('network'));
  await act(async () => result.current.refresh());
  expect(result.current.session?.connected).toBe(true);
  expect(result.current.knownConnected).toBe(true);
  vi.mocked(logoutGoogleCalendar).mockRejectedValueOnce(new ConnectorError('network'));
  await act(async () => { expect(await result.current.disconnect()).toBe(false); });
  expect(result.current.session?.connected).toBe(true);
  vi.mocked(getGoogleCalendarSession).mockResolvedValue({ available: true, connected: false });
  await act(async () => { expect(await result.current.disconnect()).toBe(true); });
  expect(result.current.knownConnected).toBe(false);
});
it('updates another mounted consumer immediately after local disconnect', async () => {
  const first = renderHook(() => useGoogleCalendarSession(true));
  const second = renderHook(() => useGoogleCalendarSession(true));
  await act(async () => {});
  vi.mocked(getGoogleCalendarSession).mockResolvedValue({ available: true, connected: false });
  await act(async () => { await first.result.current.disconnect(); });
  expect(second.result.current.knownConnected).toBe(false);
  expect(second.result.current.session?.connected).toBe(false);
});
it('rechecks on storage changes and removes listeners when disabled', async () => {
  const { rerender } = renderHook(({ enabled }) => useGoogleCalendarSession(enabled), { initialProps: { enabled: true } });
  await act(async () => {});
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: CALENDAR_SESSION_CHANGE })));
  expect(getGoogleCalendarSession).toHaveBeenCalledTimes(2);
  rerender({ enabled: false });
  window.dispatchEvent(new Event('focus'));
  expect(getGoogleCalendarSession).toHaveBeenCalledTimes(2);
});
it('expires on a timer rather than waiting for focus', async () => {
  vi.useFakeTimers();
  const expiresAt = Date.now() + 1000;
  vi.mocked(getGoogleCalendarSession).mockResolvedValueOnce({ ...session(), expiresAt })
    .mockResolvedValue({ available: true, connected: false });
  const { result } = renderHook(() => useGoogleCalendarSession(true));
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(result.current.session?.connected).toBe(false);
  expect(result.current.knownConnected).toBe(true);
});
