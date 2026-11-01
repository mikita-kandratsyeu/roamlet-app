import { useCallback, useEffect, useRef, useState } from 'react';
import type { RouteCardRequest } from '../domain/routeCard';
import { generateRouteCard } from '../services/routeCard';

type PreviewState =
  | { status: 'idle' }
  | { status: 'generating'; request: RouteCardRequest }
  | { status: 'ready'; request: RouteCardRequest; blob: Blob; url: string }
  | { status: 'error'; request: RouteCardRequest; message: string };
const idle: PreviewState = { status: 'idle' };

export function useRouteCard(request: RouteCardRequest) {
  const latest = useRef(request);
  latest.current = request;
  const pending = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>(idle);
  const release = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);
  const cancel = useCallback(() => {
    release();
    setPreview(idle);
  }, [release]);
  useEffect(() => {
    cancel();
  }, [request, cancel]);
  useEffect(() => release, [release]);

  const generate = useCallback(async () => {
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

  return {
    preview: 'request' in preview && preview.request !== request ? idle : preview,
    generate,
    cancel,
  };
}
