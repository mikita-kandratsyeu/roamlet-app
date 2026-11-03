import { useCallback, useEffect, useRef, useState } from 'react';
import type { RouteCardRequest } from '../domain/routeCard';
import { generateRouteCard } from '../services/routeCard';

type PreviewState =
  | { status: 'idle' }
  | { status: 'generating'; request: RouteCardRequest }
  | { status: 'ready'; request: RouteCardRequest; blob: Blob; url: string }
  | { status: 'error'; request: RouteCardRequest; message: string };
const idle: PreviewState = { status: 'idle' };

export function useRouteCard(request: RouteCardRequest, autoRefresh = false) {
  const latest = useRef(request);
  latest.current = request;
  const pending = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshEnabled = useRef(false);
  const previous = useRef(request);
  const [preview, setPreview] = useState<PreviewState>(idle);
  const release = useCallback(() => {
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
    pending.current?.abort();
    pending.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);
  const cancel = useCallback(() => {
    refreshEnabled.current = false;
    release();
    setPreview(idle);
  }, [release]);
  useEffect(() => release, [release]);

  const generate = useCallback(async () => {
    refreshEnabled.current = true;
    release();
    const controller = new AbortController();
    const snapshot = latest.current;
    pending.current = controller;
    setPreview({ status: 'generating', request: snapshot });
    const current = () =>
      !controller.signal.aborted && pending.current === controller && latest.current === snapshot;
    try {
      const blob = await generateRouteCard(snapshot, controller.signal);
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      setPreview({ status: 'ready', request: snapshot, blob, url });
    } catch (error) {
      if (current())
        setPreview({
          status: 'error',
          request: snapshot,
          message:
            error instanceof Error
              ? error.message
              : 'Could not generate the image. Please try again.',
        });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [release]);

  useEffect(() => {
    const old = previous.current;
    previous.current = request;
    release();
    setPreview(idle);
    const lightweight =
      old !== request &&
      old.segments === request.segments &&
      old.format === request.format &&
      old.privacyRadius === request.privacyRadius;
    if (autoRefresh && refreshEnabled.current && lightweight) {
      refreshTimer.current = setTimeout(() => void generate(), 350);
    }
    return release;
  }, [request, autoRefresh, generate, release]);

  return {
    preview: 'request' in preview && preview.request !== request ? idle : preview,
    generate,
    cancel,
  };
}
