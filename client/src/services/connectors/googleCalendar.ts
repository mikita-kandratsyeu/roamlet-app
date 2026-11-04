import { connectorJson, connectorRequest } from './http';
import { ConnectorError, type ConnectorErrorCode } from './types';
import { validCalendarLink, type CalendarEventDraft } from '../../domain/calendar';

export interface GoogleCalendarSession {
  available: boolean;
  connected: boolean;
  accountId?: string;
  email?: string;
  expiresAt?: number;
}
export interface CalendarPublication {
  eventId: string;
  htmlLink: string;
}
export async function getGoogleCalendarSession(
  signal?: AbortSignal,
): Promise<GoogleCalendarSession> {
  const data = await connectorJson('google-calendar', 'session', {}, signal);
  if (
    typeof data.available !== 'boolean' ||
    typeof data.connected !== 'boolean' ||
    (data.connected &&
      (!data.available ||
        typeof data.accountId !== 'string' ||
        !/^[\x21-\x7e]{1,255}$/.test(data.accountId) ||
        typeof data.email !== 'string' ||
        data.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+$/.test(data.email) ||
        typeof data.expiresAt !== 'number' ||
        !Number.isSafeInteger(data.expiresAt)))
  )
    throw new ConnectorError('invalid-data');
  return {
    available: data.available,
    connected: data.connected,
    ...(data.connected
      ? {
          accountId: String(data.accountId),
          email: String(data.email),
          expiresAt: Number(data.expiresAt),
        }
      : {}),
  };
}
export async function logoutGoogleCalendar(signal?: AbortSignal): Promise<void> {
  await connectorJson('google-calendar', 'logout', {}, signal, null);
}
export async function publishCalendarEvent(
  event: CalendarEventDraft,
  signal?: AbortSignal,
): Promise<CalendarPublication> {
  const bytes = await connectorRequest(
    'google-calendar',
    'publish',
    {},
    signal,
    new TextEncoder().encode(JSON.stringify(event)),
    'application/json',
  );
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ConnectorError('invalid-data');
  }
  if (
    !data ||
    typeof data !== 'object' ||
    !('eventId' in data) ||
    data.eventId !== event.eventId ||
    !('htmlLink' in data) ||
    !validCalendarLink(data.htmlLink)
  )
    throw new ConnectorError('invalid-data');
  return { eventId: event.eventId, htmlLink: data.htmlLink };
}
export const googleCalendarErrors: Record<ConnectorErrorCode, string> = {
  configuration: 'Google Calendar connection settings are invalid. Please reconnect.',
  unavailable: 'Google Calendar is not configured. Local planning and ICS export remain available.',
  auth: 'Your Google Calendar session has expired. Sign in again.',
  permission: 'Allow access to the Roamlet calendar, then reconnect.',
  'not-found': 'The Roamlet calendar or event is no longer available. Reconnect and retry.',
  quota: 'Google Calendar request limit reached. Try again later.',
  network: 'Could not reach Google Calendar. Check your connection, then retry.',
  timeout: 'Google Calendar did not respond in time. Retry to check the same event.',
  'invalid-data': 'Google Calendar returned invalid data or the event details are invalid.',
  'too-large': 'Calendar event details exceed the supported size.',
  conflict: 'This calendar event changed elsewhere. Review it in Google Calendar before retrying.',
};
