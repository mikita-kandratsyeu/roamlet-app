import { beforeEach, expect, it } from 'vitest';
import { loadCalendarPublication, saveCalendarPublication } from './calendarPreferences';
beforeEach(() => localStorage.clear());
it('persists event references independently by account and route, including pending IDs', () => {
  const pending = { eventId: 'a'.repeat(32), timeZone: 'Europe/Warsaw', reminderMinutes: 30 };
  saveCalendarPublication('user-one', 'route-one', pending);
  expect(loadCalendarPublication('user-one', 'route-one')).toEqual(pending);
  expect(loadCalendarPublication('user-two', 'route-one')).toBeNull();
  expect(loadCalendarPublication('user-one', 'route-two')).toBeNull();
  const complete = { ...pending, fingerprint: 'confirmed event content', htmlLink: 'https://www.google.com/calendar/event?eid=example' };
  saveCalendarPublication('user-one', 'route-one', complete);
  expect(loadCalendarPublication('user-one', 'route-one')).toEqual(complete);
});
it('fails closed for corrupted references rather than silently creating a duplicate', () => {
  localStorage.setItem('roamlet-calendar-event:user-one:route-one', JSON.stringify({ eventId: 'invalid' }));
  expect(() => loadCalendarPublication('user-one', 'route-one')).toThrow();
});
it('rejects untrusted link targets in persisted references', () => {
  localStorage.setItem('roamlet-calendar-event:user-one:route-one', JSON.stringify({
    eventId: 'a'.repeat(32), timeZone: 'UTC', reminderMinutes: 30, htmlLink: 'https://evil.test/calendar/event?eid=example',
  }));
  expect(() => loadCalendarPublication('user-one', 'route-one')).toThrow();
});
