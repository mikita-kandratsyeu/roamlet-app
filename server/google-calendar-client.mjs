import { abortable, GithubError as ConnectorError } from './github-http.mjs';
import { createGoogleDriveClient, object } from './google-drive-client.mjs';
import { validCalendarId } from './google-calendar-session.mjs';
export { ConnectorError };
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const SCOPES = `openid email ${CALENDAR_SCOPE}`;
const API = 'https://www.googleapis.com/calendar/v3/calendars';
const MARKER = 'roamlet';
export function validScopes(scope) {
  if (typeof scope !== 'string' || scope.length > 4096) return false;
  const scopes = scope.split(/\s+/).filter(Boolean);
  const email = ['email', 'https://www.googleapis.com/auth/userinfo.email'];
  return (
    scopes.includes(CALENDAR_SCOPE) &&
    scopes.includes('openid') &&
    scopes.some((item) => email.includes(item)) &&
    scopes.every((item) => ['openid', CALENDAR_SCOPE, ...email].includes(item))
  );
}
export function eventLink(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096) throw new Error();
    const url = new URL(value);
    if (
      !['https://www.google.com', 'https://calendar.google.com'].includes(url.origin) ||
      url.pathname !== '/calendar/event' ||
      !url.search ||
      url.username ||
      url.password ||
      value.includes('#') ||
      url.href !== value ||
      [...value].some(
        (character) => character.codePointAt(0) <= 32 || character.codePointAt(0) === 127,
      )
    )
      throw new Error();
    const keys = [...url.searchParams.keys()];
    if (
      !url.searchParams.get('eid') ||
      keys.some((key) => !['eid', 'sf', 'output'].includes(key)) ||
      new Set(keys).size !== keys.length ||
      !/^[A-Za-z0-9_=-]{1,2048}$/.test(url.searchParams.get('eid')) ||
      (url.searchParams.has('sf') && url.searchParams.get('sf') !== 'true') ||
      (url.searchParams.has('output') && url.searchParams.get('output') !== 'xml')
    )
      throw new Error();
    return value;
  } catch {
    throw new ConnectorError('invalid-data');
  }
}
function upstreamError(status) {
  if (status === 401) return new ConnectorError('auth', 401);
  if (status === 403) return new ConnectorError('permission', 403);
  if (status === 404) return new ConnectorError('not-found', 404);
  if (status === 429) return new ConnectorError('quota', 429);
  if ([409, 412].includes(status)) return new ConnectorError('conflict', 409);
  return new ConnectorError('unavailable', 502);
}
export function createGoogleCalendarClient(fetcher = globalThis.fetch) {
  const google = createGoogleDriveClient(fetcher);
  async function request(url, { token, signal, method = 'GET', body, etag } = {}) {
    let reader;
    try {
      if (signal.aborted) throw signal.reason;
      const response = await abortable(
        Promise.resolve().then(() =>
          fetcher(url, {
            method,
            signal,
            credentials: 'omit',
            redirect: 'error',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
              ...(etag ? { 'If-Match': etag } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        ),
        signal,
      );
      const limit = 32 * 1024;
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
        void response.body?.cancel().catch(() => {});
        throw new ConnectorError('too-large', 413);
      }
      const chunks = [];
      let size = 0;
      reader = response.body?.getReader();
      if (reader)
        for (;;) {
          const { value, done } = await abortable(reader.read(), signal);
          if (done) break;
          size += value.byteLength;
          if (size > limit) throw new ConnectorError('too-large', 413);
          chunks.push(Buffer.from(value));
        }
      const bytes = Buffer.concat(chunks);
      let payload;
      try {
        payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        if (response.ok) throw new ConnectorError('invalid-data');
      }
      if (!response.ok) {
        if (
          response.status === 403 &&
          Array.isArray(payload?.error?.errors) &&
          payload.error.errors.some((item) =>
            [
              'rateLimitExceeded',
              'userRateLimitExceeded',
              'dailyLimitExceeded',
              'quotaExceeded',
            ].includes(item?.reason),
          )
        )
          throw new ConnectorError('quota', 429);
        throw upstreamError(response.status);
      }
      const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
      if (
        length !== null &&
        (!encoding || encoding === 'identity') &&
        Number(length) !== bytes.length
      )
        throw new ConnectorError('invalid-data');
      return object(payload);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError('network', 502);
    } finally {
      if (reader) {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }
  function result(value, id) {
    if (
      value.id !== id ||
      value.status === 'cancelled' ||
      value.extendedProperties?.private?.[MARKER] !== id
    )
      throw new ConnectorError('invalid-data');
    return { eventId: id, htmlLink: eventLink(value.htmlLink) };
  }
  return {
    exchange: google.exchange,
    identity: google.identity,
    async createCalendar(token, signal) {
      const calendar = await request(API, {
        token,
        signal,
        method: 'POST',
        body: { summary: 'Roamlet' },
      });
      if (!validCalendarId(calendar.id) || calendar.id === 'primary')
        throw new ConnectorError('invalid-data');
      return calendar.id;
    },
    async publish(calendarId, event, token, signal) {
      if (!validCalendarId(calendarId) || calendarId === 'primary')
        throw new ConnectorError('invalid-data');
      const url = `${API}/${encodeURIComponent(calendarId)}/events`;
      const body = {
        id: event.eventId,
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: {
          ...event.start,
          dateTime: event.start.dateTime.replace(/T(\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/, 'T$1:00$2'),
        },
        end: {
          ...event.end,
          dateTime: event.end.dateTime.replace(/T(\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/, 'T$1:00$2'),
        },
        reminders: {
          useDefault: false,
          overrides: [{ method: 'popup', minutes: event.reminderMinutes }],
        },
        extendedProperties: { private: { [MARKER]: event.eventId } },
      };
      try {
        return result(
          await request(`${url}?sendUpdates=none`, { token, signal, method: 'POST', body }),
          event.eventId,
        );
      } catch (error) {
        if (!(error instanceof ConnectorError) || error.code !== 'conflict') throw error;
      }
      const existing = await request(`${url}/${event.eventId}`, { token, signal });
      if (
        existing.id !== event.eventId ||
        existing.status === 'cancelled' ||
        existing.extendedProperties?.private?.[MARKER] !== event.eventId ||
        typeof existing.etag !== 'string' ||
        !/^"[\x21\x23-\x7e]{1,250}"$/.test(existing.etag)
      )
        throw new ConnectorError('conflict', 409);
      // PATCH preserves unrelated provider fields; If-Match prevents overwriting concurrent edits.
      const changes = { ...body };
      delete changes.id;
      const privateProperties = existing.extendedProperties.private;
      changes.extendedProperties = { private: { ...privateProperties, [MARKER]: event.eventId } };
      return result(
        await request(`${url}/${event.eventId}?sendUpdates=none`, {
          token,
          signal,
          method: 'PATCH',
          body: changes,
          etag: existing.etag,
        }),
        event.eventId,
      );
    },
  };
}
