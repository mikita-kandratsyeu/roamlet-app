import { validDepartureLocal } from './schedule';

export interface CalendarEventDraft {
  eventId: string;
  summary: string;
  description: string;
  location: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  reminderMinutes: number;
}

export type CalendarDraftErrorCode =
  'time-zone' | 'departure' | 'ambiguous-time' | 'missing-time' | 'duration' | 'fields';

export class CalendarDraftError extends Error {
  constructor(
    public readonly code: CalendarDraftErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CalendarDraftError';
  }
}

const EVENT_ID = /^[a-v0-9]{32}$/;
const MAX_DURATION_SECONDS = 28 * 86400;
const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** Only Google's HTTPS event-view links are safe to persist or open. */
export function validCalendarLink(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    /[\s\\]/.test(value) ||
    !/^https:\/\/(?:www\.google\.com|calendar\.google\.com)\//i.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'www.google.com' || url.hostname === 'calendar.google.com') &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === '/calendar/event' &&
      Boolean(url.searchParams.get('eid')?.trim())
    );
  } catch {
    return false;
  }
}

function validText(value: unknown, limit: number, multiline = false): value is string {
  return (
    typeof value === 'string' &&
    [...value].length <= limit &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code !== 127 && (code >= 32 || (multiline && [9, 10, 13].includes(code)));
    })
  );
}

function validateFields(
  event: Pick<
    CalendarEventDraft,
    'eventId' | 'summary' | 'description' | 'location' | 'reminderMinutes'
  >,
): void {
  if (
    typeof event.eventId !== 'string' ||
    event.eventId.length !== 32 ||
    !EVENT_ID.test(event.eventId) ||
    !validText(event.summary, 200) ||
    !event.summary.trim() ||
    !validText(event.description, 4000, true) ||
    !validText(event.location, 500) ||
    !Number.isInteger(event.reminderMinutes) ||
    event.reminderMinutes < 0 ||
    event.reminderMinutes > 40320
  ) {
    throw new CalendarDraftError('fields', 'Invalid calendar fields or reminder.');
  }
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  // Named IANA zones only, not Intl's newer numeric-offset timezone extension.
  if (
    typeof timeZone !== 'string' ||
    timeZone.length > 100 ||
    !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)
  ) {
    throw new CalendarDraftError('time-zone', 'A supported IANA timezone is required.');
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    throw new CalendarDraftError('time-zone', 'Unsupported IANA timezone.');
  }
}

function wallTime(instant: number, format: Intl.DateTimeFormat): number {
  const parts = format.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
}

function offsetAt(instant: number, format: Intl.DateTimeFormat): number {
  return wallTime(instant, format) - instant;
}

function uniqueInstant(local: string, format: Intl.DateTimeFormat): number {
  const wall = Date.parse(`${local}:00Z`);
  const offsets = new Set<number>();
  // Probe both sides of transitions, including half-hour shifts and whole skipped days.
  // All IANA offsets in the supported years lie within this 48-hour window.
  for (let hour = -48; hour <= 48; hour++) {
    offsets.add(offsetAt(wall + hour * 3_600_000, format));
  }
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => wallTime(instant, format) === wall);
  if (candidates.length === 0) {
    throw new CalendarDraftError('missing-time', 'Departure falls in a skipped local time.');
  }
  if (candidates.length !== 1) {
    throw new CalendarDraftError(
      'ambiguous-time',
      'Departure occurs more than once in this timezone.',
    );
  }
  return candidates[0];
}

function zonedIso(instant: number, format: Intl.DateTimeFormat): string {
  const wall = wallTime(instant, format);
  const year = new Date(wall).getUTCFullYear();
  if (
    year < 1900 ||
    year > 2100 ||
    new Date(instant).getUTCFullYear() < 1900 ||
    new Date(instant).getUTCFullYear() > 2100
  ) {
    throw new CalendarDraftError(
      'departure',
      'Calendar dates must be within 1900–2100, locally and in UTC.',
    );
  }
  const offset = offsetAt(instant, format);
  // RFC3339 cannot represent historical IANA offsets with sub-minute precision.
  if (offset % 60_000 !== 0) {
    throw new CalendarDraftError('time-zone', 'Historical sub-minute UTC offsets are unsupported.');
  }
  const minutes = Math.abs(offset) / 60_000;
  return `${new Date(wall).toISOString().slice(0, 19)}${offset < 0 ? '-' : '+'}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Local and UTC dates are restricted to 1900–2100; historical sub-minute offsets are rejected.
 * Duration is elapsed time, at most 28 days, rounded to whole seconds (minimum one).
 * No geometry is included and no network or persistence operations are performed.
 */
export function buildCalendarEvent(input: {
  eventId: string;
  name: string;
  description?: string;
  departureLocal: string;
  durationSeconds: number;
  timeZone: string;
  reminderMinutes: number;
  location?: string;
}): CalendarEventDraft {
  const fields = {
    eventId: input.eventId,
    summary: input.name,
    description: input.description === undefined ? '' : input.description,
    location: input.location === undefined ? '' : input.location,
    reminderMinutes: input.reminderMinutes,
  };
  validateFields(fields);
  const format = formatter(input.timeZone);
  if (
    !validDepartureLocal(input.departureLocal) ||
    Number(input.departureLocal.slice(0, 4)) < 1900 ||
    Number(input.departureLocal.slice(0, 4)) > 2100
  ) {
    throw new CalendarDraftError(
      'departure',
      'A valid local departure within 1900–2100 is required.',
    );
  }
  if (
    typeof input.durationSeconds !== 'number' ||
    !Number.isFinite(input.durationSeconds) ||
    input.durationSeconds <= 0 ||
    input.durationSeconds > MAX_DURATION_SECONDS ||
    Math.round(input.durationSeconds) === 0
  ) {
    throw new CalendarDraftError(
      'duration',
      'Elapsed duration must be between one second and 28 days.',
    );
  }
  const start = uniqueInstant(input.departureLocal, format);
  const end = start + Math.round(input.durationSeconds) * 1000;
  return {
    ...fields,
    start: { dateTime: zonedIso(start, format), timeZone: input.timeZone },
    end: { dateTime: zonedIso(end, format), timeZone: input.timeZone },
  };
}

/** Canonical event content, excluding provider identity and generated timestamps. */
export function calendarEventFingerprint(event: CalendarEventDraft): string {
  return JSON.stringify({
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: { dateTime: event.start.dateTime, timeZone: event.start.timeZone },
    end: { dateTime: event.end.dateTime, timeZone: event.end.timeZone },
    reminderMinutes: event.reminderMinutes,
  });
}

export function createCalendarEventId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = '',
    octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (octets + size > 75) {
      lines.push(current);
      current = ' ';
      octets = 1;
    }
    current += character;
    octets += size;
  }
  lines.push(current);
  return lines.join('\r\n');
}

function draftInstant(value: CalendarEventDraft['start']): number {
  const format = formatter(value.timeZone);
  if (
    typeof value.dateTime !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value.dateTime)
  ) {
    throw new CalendarDraftError('departure', 'Expected an offset-qualified calendar datetime.');
  }
  const instant = Date.parse(value.dateTime);
  if (!Number.isFinite(instant) || zonedIso(instant, format) !== value.dateTime) {
    throw new CalendarDraftError('departure', 'Datetime does not match its timezone.');
  }
  return instant;
}

/** Deterministic RFC5545 download; DTSTAMP uses the start instant, not the current date.
 * Includes a display alarm, including a zero-minute reminder, and UTF-8 75-octet folding.
 */
export function calendarEventIcs(event: CalendarEventDraft): string {
  validateFields(event);
  const start = draftInstant(event.start),
    end = draftInstant(event.end);
  if (end <= start || end - start > MAX_DURATION_SECONDS * 1000) {
    throw new CalendarDraftError('duration', 'Invalid elapsed calendar duration.');
  }
  const utc = (instant: number) =>
    new Date(instant).toISOString().replace(/[-:]/g, '').replace('.000', '');
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Roamlet//Calendar//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${event.eventId}@roamlet`,
      `DTSTAMP:${utc(start)}`,
      `DTSTART:${utc(start)}`,
      `DTEND:${utc(end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      `LOCATION:${escapeText(event.location)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:-PT${event.reminderMinutes}M`,
      `DESCRIPTION:${escapeText(event.summary)}`,
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .map(foldLine)
      .join('\r\n') + '\r\n'
  );
}
