import { useCallback, useEffect, useRef, useState } from 'react';
import { getGoogleCalendarSession, logoutGoogleCalendar, type GoogleCalendarSession } from '../services/connectors/googleCalendar';
import { ConnectorError, type ConnectorErrorCode } from '../services/connectors/types';

export const CALENDAR_CONNECTION_KEY = 'roamlet-google-calendar-connected';
export const CALENDAR_SESSION_CHANGE = 'roamlet-google-calendar-session-change';
function connectionHint() {
  try { return localStorage.getItem(CALENDAR_CONNECTION_KEY) === '1'; }
  catch { return false; }
}
function storeHint(connected: boolean) {
  try { localStorage.setItem(CALENDAR_CONNECTION_KEY, connected ? '1' : '0'); }
  catch { /* Session cookies remain authoritative when local storage is unavailable. */ }
}
export function useGoogleCalendarSession(enabled: boolean) {
  const [session, setSession] = useState<GoogleCalendarSession | null>(null);
  const [knownConnected, setKnownConnected] = useState(connectionHint);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ConnectorErrorCode | null>(null);
  const request = useRef<AbortController | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const value = await getGoogleCalendarSession(controller.signal);
      if (request.current !== controller || controller.signal.aborted) return;
      setSession(value);
      if (value.connected) {
        setKnownConnected(true);
        storeHint(true);
      }
    } catch (failure) {
      if (request.current === controller && !controller.signal.aborted)
        setError(failure instanceof ConnectorError ? failure.code : 'network');
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const updated = () => {
      const hint = connectionHint();
      setKnownConnected(hint);
      if (!hint) setSession((value) => value ? { available: value.available, connected: false } : value);
      if (document.visibilityState !== 'hidden') void refresh();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === CALENDAR_CONNECTION_KEY || event.key === CALENDAR_SESSION_CHANGE) updated();
    };
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(CALENDAR_SESSION_CHANGE);
      channel.current.onmessage = updated;
    }
    window.addEventListener(CALENDAR_SESSION_CHANGE, updated);
    window.addEventListener('focus', updated);
    document.addEventListener('visibilitychange', updated);
    window.addEventListener('storage', storage);
    return () => {
      request.current?.abort();
      request.current = null;
      channel.current?.close();
      channel.current = null;
      window.removeEventListener(CALENDAR_SESSION_CHANGE, updated);
      window.removeEventListener('focus', updated);
      document.removeEventListener('visibilitychange', updated);
      window.removeEventListener('storage', storage);
    };
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled || !session?.connected || !session.expiresAt) return;
    const timer = setTimeout(() => {
      setSession((value) => value ? { ...value, connected: false } : value);
      void refresh();
    }, Math.min(2_147_483_647, Math.max(0, session.expiresAt - Date.now())));
    return () => clearTimeout(timer);
  }, [enabled, session?.connected, session?.expiresAt, refresh]);
  async function disconnect() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      await logoutGoogleCalendar(controller.signal);
      if (request.current !== controller || controller.signal.aborted) return false;
      setSession({ available: sessionRef.current?.available ?? true, connected: false });
      setKnownConnected(false);
      storeHint(false);
      channel.current?.postMessage('changed');
      try { localStorage.setItem(CALENDAR_SESSION_CHANGE, String(Date.now())); } catch { /* Optional cross-tab signal. */ }
      window.dispatchEvent(new Event(CALENDAR_SESSION_CHANGE));
      return true;
    } catch (failure) {
      if (request.current === controller && !controller.signal.aborted)
        setError(failure instanceof ConnectorError ? failure.code : 'network');
      return false;
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }
  return { session, knownConnected, loading, error, refresh, disconnect };
}
