import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCalendarPublication } from './useCalendarPublication';
import { buildCalendarEvent } from '../domain/calendar';
import { loadCalendarPublication } from '../domain/calendarPreferences';
import { publishCalendarEvent } from '../services/connectors/googleCalendar';
vi.mock('../services/connectors/googleCalendar', async (original) => ({
  ...(await original<typeof import('../services/connectors/googleCalendar')>()),
  publishCalendarEvent: vi.fn(),
}));
const event = () =>
  buildCalendarEvent({
    eventId: 'a'.repeat(32),
    name: 'Ride',
    description: '',
    departureLocal: '2026-11-07T10:00',
    durationSeconds: 3600,
    timeZone: 'Europe/Warsaw',
    reminderMinutes: 30,
  });
function pending() {
  let resolve!: (value: { eventId: string; htmlLink: string }) => void;
  const promise = new Promise<{ eventId: string; htmlLink: string }>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  localStorage.clear();
  vi.mocked(publishCalendarEvent).mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('persists an ID before transport starts and restores it without any automatic publication', async () => {
  vi.mocked(publishCalendarEvent).mockImplementation(async (value) => {
    expect(loadCalendarPublication('account', 'route')?.eventId).toBe(value.eventId);
    return {
      eventId: value.eventId,
      htmlLink: 'https://www.google.com/calendar/event?eid=example',
    };
  });
  const first = renderHook(() => useCalendarPublication('account', 'route', true));
  expect(publishCalendarEvent).not.toHaveBeenCalled();
  await act(async () => {
    expect(await first.result.current.publish(event())).toBe(true);
  });
  first.unmount();
  const second = renderHook(() => useCalendarPublication('account', 'route', true));
  expect(second.result.current.record?.htmlLink).toContain('eid=example');
  expect(publishCalendarEvent).toHaveBeenCalledOnce();
});
it('does not send data when local storage cannot preserve an idempotent reference', async () => {
  const { result } = renderHook(() => useCalendarPublication('account', 'route', true));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Unavailable');
  });
  await act(async () => {
    expect(await result.current.publish(event())).toBe(false);
  });
  expect(result.current.error).toBe('local');
  expect(publishCalendarEvent).not.toHaveBeenCalled();
});
it.each(['account', 'route', 'disconnect'] as const)(
  'cancels stale publication on %s change',
  async (change) => {
    const old = pending();
    vi.mocked(publishCalendarEvent).mockReturnValueOnce(old.promise);
    const { result, rerender } = renderHook(
      ({ account, route, connected }) => useCalendarPublication(account, route, connected),
      { initialProps: { account: 'account', route: 'route', connected: true } },
    );
    let request!: Promise<boolean>;
    act(() => {
      request = result.current.publish(event());
    });
    rerender({
      account: change === 'account' ? 'other' : 'account',
      route: change === 'route' ? 'other' : 'route',
      connected: change !== 'disconnect',
    });
    expect(vi.mocked(publishCalendarEvent).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => {
      old.resolve({
        eventId: event().eventId,
        htmlLink: 'https://www.google.com/calendar/event?eid=example',
      });
      expect(await request).toBe(false);
    });
    expect(loadCalendarPublication('account', 'route')?.htmlLink).toBeUndefined();
  },
);
it('aborts transport on unmount and ignores completion', async () => {
  const old = pending();
  vi.mocked(publishCalendarEvent).mockReturnValueOnce(old.promise);
  const { result, unmount } = renderHook(() => useCalendarPublication('account', 'route', true));
  let request!: Promise<boolean>;
  act(() => {
    request = result.current.publish(event());
  });
  unmount();
  expect(vi.mocked(publishCalendarEvent).mock.calls[0][1]?.aborted).toBe(true);
  await act(async () => {
    old.resolve({
      eventId: event().eventId,
      htmlLink: 'https://www.google.com/calendar/event?eid=example',
    });
    await request;
  });
  expect(loadCalendarPublication('account', 'route')?.htmlLink).toBeUndefined();
});
