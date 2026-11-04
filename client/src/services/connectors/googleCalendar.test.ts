import { afterEach, expect, it, vi } from 'vitest';
import { getGoogleCalendarSession, publishCalendarEvent, logoutGoogleCalendar } from './googleCalendar';
import { buildCalendarEvent } from '../../domain/calendar';
import { ConnectorError } from './types';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const event = () => buildCalendarEvent({ eventId: 'a'.repeat(32), name: 'Ride', description: 'Route', location: 'Park',
  departureLocal: '2026-11-07T10:00', durationSeconds: 3600, timeZone: 'Europe/Warsaw', reminderMinutes: 30 });
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
it('validates session metadata and keeps tokens server-only', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ available: true, connected: true, email: 'user@example.test', accountId: 'user-one', expiresAt: Date.now() + 3600000 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await getGoogleCalendarSession()).toMatchObject({ connected: true, accountId: 'user-one' });
  expect(fetcher).toHaveBeenCalledWith('/api/google-calendar?action=session', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' }));
  fetcher.mockResolvedValue(response({ available: true, connected: true, accountId: 'missing-email' }));
  await expect(getGoogleCalendarSession()).rejects.toMatchObject({ code: 'invalid-data' });
});
it('publishes explicit JSON and accepts only the matching event with a Google event link', async () => {
  const value = event();
  const fetcher = vi.fn().mockResolvedValue(response({ eventId: value.eventId, htmlLink: 'https://calendar.google.com/calendar/event?eid=example' }));
  vi.stubGlobal('fetch', fetcher);
  expect(await publishCalendarEvent(value)).toMatchObject({ eventId: value.eventId });
  const init = fetcher.mock.calls[0][1];
  expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Roamlet-Request': '1' } });
  expect(JSON.parse(new TextDecoder().decode(init.body))).toEqual(value);
  for (const data of [
    { eventId: 'b'.repeat(32), htmlLink: 'https://www.google.com/calendar/event?eid=example' },
    { eventId: value.eventId, htmlLink: 'https://evil.test/calendar/event?eid=example' },
    { eventId: value.eventId, htmlLink: 'javascript:alert(1)' },
  ]) {
    fetcher.mockResolvedValue(response(data));
    await expect(publishCalendarEvent(value)).rejects.toMatchObject({ code: 'invalid-data' });
  }
});
it('uses POST for local logout and translates provider errors without raw text', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ connected: false }));
  vi.stubGlobal('fetch', fetcher);
  await logoutGoogleCalendar();
  expect(fetcher).toHaveBeenCalledWith('/api/google-calendar?action=logout', expect.objectContaining({ method: 'POST' }));
  fetcher.mockResolvedValue(response({ error: { code: 'auth', message: 'private upstream details' } }, 401));
  await expect(publishCalendarEvent(event())).rejects.toEqual(new ConnectorError('auth'));
});
it('preserves explicit caller cancellation and bounds stalled requests', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetcher = vi.fn().mockReturnValue(new Promise(() => {}));
  vi.stubGlobal('fetch', fetcher);
  await expect(publishCalendarEvent(event(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
  vi.useFakeTimers();
  const pending = expect(publishCalendarEvent(event())).rejects.toMatchObject({ code: 'timeout' });
  await vi.advanceTimersByTimeAsync(65000);
  await pending;
});
