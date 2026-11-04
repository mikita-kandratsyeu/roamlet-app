import { useCallback, useEffect, useRef, useState } from 'react';
import { calendarEventFingerprint, type CalendarEventDraft } from '../domain/calendar';
import {
  loadCalendarPublication,
  saveCalendarPublication,
  type CalendarRoutePublication,
} from '../domain/calendarPreferences';
import { publishCalendarEvent } from '../services/connectors/googleCalendar';
import { ConnectorError, type ConnectorErrorCode } from '../services/connectors/types';

export function useCalendarPublication(
  accountId: string | undefined,
  routeId: string,
  connected: boolean,
) {
  const [record, setRecord] = useState<CalendarRoutePublication | null>(null);
  const [error, setError] = useState<ConnectorErrorCode | 'local' | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
  }, []);
  useEffect(() => {
    cancel();
    setRecord(null);
    setError(null);
    if (accountId) {
      try {
        setRecord(loadCalendarPublication(accountId, routeId));
      } catch {
        setError('local');
      }
    }
    return cancel;
  }, [accountId, routeId, cancel]);
  useEffect(() => {
    if (!connected) cancel();
  }, [connected, cancel]);
  async function publish(event: CalendarEventDraft) {
    if (!connected || !accountId || error === 'local') return false;
    cancel();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const pending: CalendarRoutePublication = {
        eventId: event.eventId,
        timeZone: event.start.timeZone,
        reminderMinutes: event.reminderMinutes,
        ...(record?.htmlLink ? { htmlLink: record.htmlLink, fingerprint: record.fingerprint } : {}),
      };
      // Persist the ID before sending: an interrupted response must not create another event on retry.
      saveCalendarPublication(accountId, routeId, pending);
      setRecord(pending);
      const result = await publishCalendarEvent(event, controller.signal);
      if (request.current !== controller || controller.signal.aborted) return false;
      const saved = {
        ...pending,
        htmlLink: result.htmlLink,
        fingerprint: calendarEventFingerprint(event),
      };
      saveCalendarPublication(accountId, routeId, saved);
      setRecord(saved);
      return true;
    } catch (failure) {
      if (request.current === controller && !controller.signal.aborted)
        setError(failure instanceof ConnectorError ? failure.code : 'local');
      return false;
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return { record, error, busy, publish, cancel };
}
