import { validCalendarLink } from './calendar';

export interface CalendarRoutePublication {
  eventId: string;
  timeZone: string;
  reminderMinutes: number;
  fingerprint?: string;
  htmlLink?: string;
}
function key(accountId: string, routeId: string) {
  return `roamlet-calendar-event:${encodeURIComponent(accountId)}:${encodeURIComponent(routeId)}`;
}
export function loadCalendarPublication(
  accountId: string,
  routeId: string,
): CalendarRoutePublication | null {
  const raw = localStorage.getItem(key(accountId, routeId));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    !('eventId' in value) ||
    typeof value.eventId !== 'string' ||
    !/^[a-v0-9]{32}$/.test(value.eventId) ||
    !('timeZone' in value) ||
    typeof value.timeZone !== 'string' ||
    value.timeZone.length > 100 ||
    !('reminderMinutes' in value) ||
    typeof value.reminderMinutes !== 'number' ||
    !Number.isInteger(value.reminderMinutes) ||
    value.reminderMinutes < 0 ||
    value.reminderMinutes > 40320 ||
    ('fingerprint' in value &&
      (typeof value.fingerprint !== 'string' || value.fingerprint.length > 12000)) ||
    ('htmlLink' in value && !validCalendarLink(value.htmlLink))
  )
    throw new Error('Invalid calendar publication');
  return {
    eventId: value.eventId,
    timeZone: value.timeZone,
    reminderMinutes: value.reminderMinutes,
    ...('fingerprint' in value ? { fingerprint: String(value.fingerprint) } : {}),
    ...('htmlLink' in value ? { htmlLink: String(value.htmlLink) } : {}),
  };
}
export function saveCalendarPublication(
  accountId: string,
  routeId: string,
  publication: CalendarRoutePublication,
) {
  localStorage.setItem(key(accountId, routeId), JSON.stringify(publication));
}
