import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getGitHubRepositories,
  getGitHubSession,
  logoutGitHub,
  type GitHubRepository,
  type GitHubSession,
} from '../services/connectors/githubSession';
import { ConnectorError, type ConnectorErrorCode } from '../services/connectors/types';
const CHANGE_KEY = 'roamlet-github-session-change';
export function useGitHubSession(open: boolean) {
  const [session, setSession] = useState<GitHubSession | null>(null);
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ConnectorErrorCode | null>(null);
  const request = useRef<AbortController | null>(null);
  const broadcast = useRef<BroadcastChannel | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const next = await getGitHubSession(controller.signal);
      if (request.current !== controller || controller.signal.aborted) return;
      setSession(next);
      if (!next.connected) setRepositories([]);
    } catch (failure) {
      if (request.current === controller && !controller.signal.aborted)
        setError(failure instanceof ConnectorError ? failure.code : 'network');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    if (!open) {
      request.current?.abort();
      request.current = null;
      setLoading(false);
      return;
    }
    void refresh();
    const updated = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === CHANGE_KEY) updated();
    };
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANGE_KEY);
      broadcast.current = channel;
      channel.onmessage = updated;
    }
    window.addEventListener('focus', updated);
    document.addEventListener('visibilitychange', updated);
    window.addEventListener('storage', storage);
    return () => {
      request.current?.abort();
      request.current = null;
      broadcast.current?.close();
      broadcast.current = null;
      window.removeEventListener('focus', updated);
      document.removeEventListener('visibilitychange', updated);
      window.removeEventListener('storage', storage);
    };
  }, [open, refresh]);
  async function loadRepositories() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const values = await getGitHubRepositories(controller.signal);
      if (request.current === controller && !controller.signal.aborted) setRepositories(values);
    } catch (failure) {
      if (request.current === controller && !controller.signal.aborted)
        setError(failure instanceof ConnectorError ? failure.code : 'network');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }
  async function disconnect() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      await logoutGitHub(controller.signal);
      if (request.current !== controller || controller.signal.aborted) return false;
      setSession((value) => (value ? { ...value, connected: false, login: undefined } : value));
      setRepositories([]);
      broadcast.current?.postMessage('changed');
      try {
        localStorage.setItem(CHANGE_KEY, String(Date.now()));
      } catch {
        /* Cookie still clears if local storage is unavailable. */
      }
      return true;
    } catch (failure) {
      if (request.current === controller && !controller.signal.aborted)
        setError(failure instanceof ConnectorError ? failure.code : 'network');
      return false;
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }
  return { session, repositories, loading, error, refresh, loadRepositories, disconnect };
}
