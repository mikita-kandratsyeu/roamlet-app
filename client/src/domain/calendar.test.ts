import { describe, expect, it, vi } from 'vitest';
import {
  buildCalendarEvent,
  CalendarDraftError,
  calendarEventFingerprint,
  calendarEventIcs,
  createCalendarEventId,
  validCalendarLink,
} from './calendar';
import type { CalendarDraftErrorCode, CalendarEventDraft } from './calendar';

const input = {
  eventId: '0123456789abcdef0123456789abcdef',
  name: 'Morning ride',
  departureLocal: '2026-01-15T09:30',
  durationSeconds: 3600,
  timeZone: 'Europe/Berlin',
  reminderMinutes: 15,
};
function expectError(run: () => unknown, code: CalendarDraftErrorCode) {
  expect(run).toThrow(CalendarDraftError);
  expect(run).toThrow(expect.objectContaining({ code }));
}
const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, '');

describe('calendar timezone conversion', () => {
  it.each([
    ['2026-01-15T09:30', '2026-01-15T09:30:00+01:00', '2026-01-15T10:30:00+01:00'],
    ['2026-07-15T09:30', '2026-07-15T09:30:00+02:00', '2026-07-15T10:30:00+02:00'],
    ['2026-03-29T01:30', '2026-03-29T01:30:00+01:00', '2026-03-29T03:30:00+02:00'],
    ['2026-10-25T01:30', '2026-10-25T01:30:00+02:00', '2026-10-25T02:30:00+02:00'],
    ['2026-12-31T23:30', '2026-12-31T23:30:00+01:00', '2027-01-01T00:30:00+01:00'],
  ])('preserves elapsed duration from %s', (departureLocal, start, end) => {
    const event = buildCalendarEvent({ ...input, departureLocal });
    expect(event.start).toEqual({ dateTime: start, timeZone: input.timeZone });
    expect(event.end).toEqual({ dateTime: end, timeZone: input.timeZone });
    expect(Date.parse(end) - Date.parse(start)).toBe(3600000);
  });
  it('crosses the autumn transition using actual time, not schedule wall arithmetic', () => {
    const event = buildCalendarEvent({
      ...input,
      departureLocal: '2026-10-25T01:30',
      durationSeconds: 7200,
    });
    expect(event.end.dateTime).toBe('2026-10-25T02:30:00+01:00');
    expect(Date.parse(event.end.dateTime) - Date.parse(event.start.dateTime)).toBe(7200000);
    expect(calendarEventIcs(event)).toContain('DTEND:20261025T013000Z\r\n');
  });
  it.each([
    ['Europe/Berlin', '2026-03-29T02:30', 'missing-time'],
    ['Europe/Berlin', '2026-10-25T02:30', 'ambiguous-time'],
    ['America/New_York', '2026-03-08T02:30', 'missing-time'],
    ['America/New_York', '2026-11-01T01:30', 'ambiguous-time'],
    ['Australia/Lord_Howe', '2026-10-04T02:15', 'missing-time'],
    ['Australia/Lord_Howe', '2026-04-05T01:45', 'ambiguous-time'],
    ['Pacific/Apia', '2011-12-30T12:00', 'missing-time'],
  ] as const)('rejects %s %s with %s', (timeZone, departureLocal, code) => {
    expectError(() => buildCalendarEvent({ ...input, timeZone, departureLocal }), code);
  });
  it.each([
    ['UTC', '2026-01-15T09:30:00+00:00'],
    ['Asia/Kathmandu', '2026-01-15T09:30:00+05:45'],
    ['America/St_Johns', '2026-01-15T09:30:00-03:30'],
    ['Pacific/Kiritimati', '2026-01-15T09:30:00+14:00'],
  ])('supports %s independently of the device timezone', (timeZone, start) => {
    expect(buildCalendarEvent({ ...input, timeZone }).start.dateTime).toBe(start);
  });
  it('counts Unicode code points consistently with backend field limits', () => {
    const event = buildCalendarEvent({
      ...input,
      name: '🚴'.repeat(200),
      description: '🚴'.repeat(4000),
      location: '🚴'.repeat(500),
    });
    expect([...event.summary]).toHaveLength(200);
    expect([...event.description]).toHaveLength(4000);
    expect([...event.location]).toHaveLength(500);
    expectError(() => buildCalendarEvent({ ...input, name: '🚴'.repeat(201) }), 'fields');
    expectError(() => buildCalendarEvent({ ...input, description: '🚴'.repeat(4001) }), 'fields');
    expectError(() => buildCalendarEvent({ ...input, location: '🚴'.repeat(501) }), 'fields');
  });
  it('supports seconds and rounds fractional elapsed estimates once', () => {
    expect(buildCalendarEvent({ ...input, durationSeconds: 59.6 }).end.dateTime).toBe(
      '2026-01-15T09:31:00+01:00',
    );
    expect(buildCalendarEvent({ ...input, durationSeconds: 1 }).end.dateTime).toBe(
      '2026-01-15T09:30:01+01:00',
    );
  });
  it('preserves text without truncation, with empty optional fields', () => {
    expect(buildCalendarEvent(input)).toEqual({
      eventId: input.eventId,
      summary: input.name,
      description: '',
      location: '',
      reminderMinutes: 15,
      start: { dateTime: '2026-01-15T09:30:00+01:00', timeZone: input.timeZone },
      end: { dateTime: '2026-01-15T10:30:00+01:00', timeZone: input.timeZone },
    });
    const event = buildCalendarEvent({
      ...input,
      name: 'x'.repeat(200),
      description: 'x'.repeat(4000),
      location: 'x'.repeat(500),
      reminderMinutes: 40320,
    });
    expect(event.summary).toHaveLength(200);
    expect(event.description).toHaveLength(4000);
    expect(event.location).toHaveLength(500);
  });
});

describe('calendar validation', () => {
  it.each([
    '2026-02-29T12:00',
    '2026-04-31T12:00',
    '2026-01-01T24:00',
    '2026-01-01T12:60',
    '2026-01-01T12:00Z',
    '2026-01-01T12:00:00',
    '1899-12-31T12:00',
    '2101-01-01T00:00',
    '0000-01-01T00:00',
    '',
    null,
    undefined,
  ])('rejects departure %s', (departureLocal) => {
    expectError(
      () => buildCalendarEvent({ ...input, departureLocal: departureLocal as string }),
      'departure',
    );
  });
  it.each([
    '',
    ' Europe/Berlin',
    'Europe/Berlin ',
    'Europe/Unknown',
    '../Berlin',
    '+02:00',
    'UTC\n',
    null,
    undefined,
  ])('rejects zone %s', (timeZone) => {
    expectError(() => buildCalendarEvent({ ...input, timeZone: timeZone as string }), 'time-zone');
  });
  it.each([0, -1, 0.1, NaN, Infinity, 28 * 86400 + 1, Number.MAX_VALUE, '3600', null, undefined])(
    'rejects duration %s',
    (durationSeconds) => {
      expectError(
        () => buildCalendarEvent({ ...input, durationSeconds: durationSeconds as number }),
        'duration',
      );
    },
  );
  it('accepts date/duration boundaries and rejects overflowing end dates', () => {
    expect(
      buildCalendarEvent({
        ...input,
        timeZone: 'UTC',
        departureLocal: '1900-01-01T00:00',
        durationSeconds: 1,
      }).start.dateTime,
    ).toBe('1900-01-01T00:00:00+00:00');
    expect(
      buildCalendarEvent({
        ...input,
        timeZone: 'UTC',
        departureLocal: '2100-12-31T23:59',
        durationSeconds: 59,
      }).end.dateTime,
    ).toBe('2100-12-31T23:59:59+00:00');
    expect(buildCalendarEvent({ ...input, durationSeconds: 28 * 86400 }).end.dateTime).toBe(
      '2026-02-12T09:30:00+01:00',
    );
    expectError(
      () =>
        buildCalendarEvent({
          ...input,
          timeZone: 'UTC',
          departureLocal: '2100-12-31T23:59',
          durationSeconds: 60,
        }),
      'departure',
    );
    expectError(
      () =>
        buildCalendarEvent({
          ...input,
          timeZone: 'Asia/Tokyo',
          departureLocal: '1900-01-01T00:00',
        }),
      'departure',
    );
  });
  it('rejects historical offsets that RFC3339 cannot represent without changing the instant', () => {
    expectError(
      () =>
        buildCalendarEvent({
          ...input,
          timeZone: 'Europe/Paris',
          departureLocal: '1900-06-01T12:00',
        }),
      'time-zone',
    );
  });
  it.each([
    { name: '' },
    { name: '   ' },
    { name: 'x'.repeat(201) },
    { name: null },
    { description: 'x'.repeat(4001) },
    { description: null },
    { location: 'x'.repeat(501) },
    { location: null },
    { reminderMinutes: -1 },
    { reminderMinutes: 0.5 },
    { reminderMinutes: 40321 },
    { reminderMinutes: NaN },
    { eventId: 'a'.repeat(31) },
    { eventId: 'w'.repeat(32) },
    { eventId: 'A'.repeat(32) },
    { eventId: `${input.eventId}\n` },
    { eventId: `${input.eventId}\r\nBEGIN:VEVENT` },
    { name: 'Ride\nInjected' },
    { location: 'Start\rInjected' },
    { description: 'Detail\u0000' },
    { description: 'Detail\u007f' },
  ])('rejects invalid fields %j', (fields) => {
    expectError(
      () => buildCalendarEvent({ ...input, ...fields } as Parameters<typeof buildCalendarEvent>[0]),
      'fields',
    );
  });
});

describe('calendar link validation', () => {
  it.each([
    'https://www.google.com/calendar/event?eid=abc',
    'https://calendar.google.com/calendar/event?eid=abc&ctz=Europe%2FBerlin',
  ])('accepts %s', (link) => expect(validCalendarLink(link)).toBe(true));
  it.each([
    '',
    null,
    undefined,
    12,
    'not a URL',
    'http://www.google.com/calendar/event?eid=abc',
    'https:calendar.google.com/calendar/event?eid=abc',
    'https://@calendar.google.com/calendar/event?eid=abc',
    'https://calendar.google.com:/calendar/event?eid=abc',
    'https://calendar.google.com/calendar\\event?eid=abc',
    'https://google.com/calendar/event?eid=abc',
    'https://www.google.com.evil.example/calendar/event?eid=abc',
    'https://calendar.google.com/calendar/eventual?eid=abc',
    'https://calendar.google.com/calendar/event/?eid=abc',
    'https://calendar.google.com/calendar/event',
    'https://calendar.google.com/calendar/event?eid=',
    'https://calendar.google.com/calendar/event?eid=%20',
    'https://user@calendar.google.com/calendar/event?eid=abc',
    'https://user:pass@calendar.google.com/calendar/event?eid=abc',
    'https://calendar.google.com:444/calendar/event?eid=abc',
    'https://calendar.google.com:443/calendar/event?eid=abc',
    ' https://calendar.google.com/calendar/event?eid=abc',
    `https://calendar.google.com/calendar/event?eid=${'x'.repeat(2048)}`,
  ])('rejects %s', (link) => expect(validCalendarLink(link)).toBe(false));
  it('accepts exactly 2048 characters, not 2049', () => {
    const prefix = 'https://calendar.google.com/calendar/event?eid=';
    const link = prefix + 'x'.repeat(2048 - prefix.length);
    expect(validCalendarLink(link)).toBe(true);
    expect(validCalendarLink(link + 'x')).toBe(false);
  });
});

describe('calendar identity and fingerprint', () => {
  it('uses 16 cryptographically random bytes, encoded as lowercase hex', () => {
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce((array) => {
      if (array instanceof Uint8Array) array.set(Array.from({ length: 16 }, (_, i) => i * 16));
      return array;
    });
    try {
      expect(createCalendarEventId()).toBe('00102030405060708090a0b0c0d0e0f0');
      expect(random).toHaveBeenCalledWith(expect.any(Uint8Array));
    } finally {
      random.mockRestore();
    }
    const ids = Array.from({ length: 100 }, () => createCalendarEventId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-v0-9]{32}$/);
  });
  it('keeps maximal escaped content within the local 12000-character fingerprint limit', () => {
    const event = buildCalendarEvent({
      ...input,
      name: '"'.repeat(200),
      description: '"'.repeat(4000),
      location: '"'.repeat(500),
      reminderMinutes: 40320,
    });
    expect(calendarEventFingerprint(event).length).toBeLessThanOrEqual(12000);
  });
  it('canonicalizes property order and excludes event identity', () => {
    const event = buildCalendarEvent(input);
    const reordered: CalendarEventDraft = {
      reminderMinutes: event.reminderMinutes,
      end: { timeZone: event.end.timeZone, dateTime: event.end.dateTime },
      start: { timeZone: event.start.timeZone, dateTime: event.start.dateTime },
      location: event.location,
      description: event.description,
      summary: event.summary,
      eventId: 'a'.repeat(32),
    };
    expect(calendarEventFingerprint(reordered)).toBe(calendarEventFingerprint(event));
    expect(calendarEventFingerprint(event)).not.toContain(event.eventId);
    for (const change of [
      { summary: 'Another ride' },
      { description: 'Details' },
      { location: 'Start' },
      { reminderMinutes: 0 },
      { start: { ...event.start, dateTime: event.end.dateTime } },
      { end: { ...event.end, timeZone: 'UTC' } },
    ])
      expect(calendarEventFingerprint({ ...event, ...change })).not.toBe(
        calendarEventFingerprint(event),
      );
  });
});

describe('RFC5545 calendar download', () => {
  it('produces deterministic UTC dates, UID and zero-minute display reminder', () => {
    const event = buildCalendarEvent({ ...input, reminderMinutes: 0, durationSeconds: 61 });
    const ics = calendarEventIcs(event);
    expect(ics).toContain(`UID:${input.eventId}@roamlet\r\n`);
    expect(ics).toContain(
      'DTSTAMP:20260115T083000Z\r\nDTSTART:20260115T083000Z\r\nDTEND:20260115T083101Z\r\n',
    );
    expect(ics).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT0M\r\n');
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/);
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(calendarEventIcs(event)).toBe(ics);
  });
  it('escapes text and all newline forms to prevent content-line injection', () => {
    const text = 'Ride, trail; back\\slash\r\nBEGIN:VEVENT\rLOCATION:fake\nEND:VCALENDAR';
    const singleLine = 'Ride, trail; back\\slash';
    const event = buildCalendarEvent({
      ...input,
      name: singleLine,
      description: text,
      location: singleLine,
    });
    const ics = unfold(calendarEventIcs(event));
    const escaped = 'Ride\\, trail\\; back\\\\slash\\nBEGIN:VEVENT\\nLOCATION:fake\\nEND:VCALENDAR';
    expect(ics).toContain(`DESCRIPTION:${escaped}\r\n`);
    for (const field of ['SUMMARY', 'LOCATION'])
      expect(ics).toContain(`${field}:Ride\\, trail\\; back\\\\slash\r\n`);
    expect(ics.split('\r\n').filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(ics.split('\r\n').filter((line) => line === 'END:VCALENDAR')).toHaveLength(1);
    expect(ics).toContain('TRIGGER:-PT15M\r\n');
  });
  it('folds every UTF-8 content line at 75 octets including continuation whitespace', () => {
    const description = 'Ж🚴é,;\\\n'.repeat(300);
    const event = buildCalendarEvent({
      ...input,
      name: '🚴'.repeat(80),
      description,
      location: 'Ж'.repeat(200),
    });
    const ics = calendarEventIcs(event);
    const encoder = new TextEncoder();
    for (const line of ics.split('\r\n')) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
      expect(line).not.toContain('\ufffd');
    }
    expect(ics).toContain('\r\n ');
    expect(unfold(ics)).toContain(`SUMMARY:${event.summary}\r\n`);
    expect(unfold(ics)).toContain(
      `DESCRIPTION:${description.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')}\r\n`,
    );
  });
  it('rejects forged draft IDs, dates, mismatched offsets and invalid intervals', () => {
    const event = buildCalendarEvent(input);
    expectError(() => calendarEventIcs({ ...event, eventId: 'bad\r\nBEGIN:VEVENT' }), 'fields');
    expectError(
      () =>
        calendarEventIcs({
          ...event,
          start: { ...event.start, dateTime: `${event.start.dateTime}\r\nLOCATION:fake` },
        }),
      'departure',
    );
    expectError(
      () =>
        calendarEventIcs({
          ...event,
          start: { ...event.start, dateTime: '2026-02-30T12:00:00+01:00' },
        }),
      'departure',
    );
    expectError(
      () =>
        calendarEventIcs({
          ...event,
          start: { ...event.start, dateTime: '2026-01-15T09:30:00+02:00' },
        }),
      'departure',
    );
    expectError(() => calendarEventIcs({ ...event, end: event.start }), 'duration');
  });
});
