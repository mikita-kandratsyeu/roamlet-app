import { useCallback, useEffect, useRef, useState } from 'react';
import { AiError, connectAi, disconnectAi, getAiSession, type AiConnection, type AiSession } from '../services/ai';
const EVENT = 'roamlet-ai-connection-change';
const CHANNEL = 'roamlet-ai-connection';
export function useAiConnection(active: boolean) {
  const [session, setSession] = useState<AiSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const run = useCallback(async (operation?: (signal: AbortSignal) => Promise<void>) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const current = ++revision.current;
    setLoading(true);
    setError(null);
    try {
      if (operation) await operation(abort.signal);
      const next = await getAiSession(abort.signal);
      if (abort.signal.aborted || current !== revision.current) return false;
      setSession(next);
      return true;
    } catch (failure) {
      if (!abort.signal.aborted && current === revision.current)
        setError(failure instanceof AiError ? failure.message : 'Could not reach the AI provider. Check your connection and retry.');
      return false;
    } finally { if (!abort.signal.aborted && current === revision.current) setLoading(false); }
  }, []);
  const refresh = useCallback(() => run(), [run]);
  const announce = useCallback(() => {
    window.dispatchEvent(new Event(EVENT));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage('changed');
      channel.close();
    }
  }, []);
  const connect = useCallback(async (value: AiConnection & { apiKey: string }) => {
    const done = await run((signal) => connectAi(value, signal));
    if (done) announce();
    return done;
  }, [run, announce]);
  const disconnect = useCallback(async () => {
    const done = await run(disconnectAi);
    if (done) announce();
    return done;
  }, [run, announce]);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const changed = () => { void refresh(); };
    const focus = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
    channel?.addEventListener('message', changed);
    window.addEventListener(EVENT, changed);
    window.addEventListener('focus', focus);
    window.addEventListener('online', changed);
    document.addEventListener('visibilitychange', focus);
    return () => {
      controller.current?.abort();
      setLoading(false);
      channel?.close();
      window.removeEventListener(EVENT, changed);
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', changed);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [active, refresh]);
  const cancel = () => { revision.current++; controller.current?.abort(); setLoading(false); };
  return { session, loading, error, refresh, connect, disconnect, cancel, dismissError: () => setError(null) };
}
