import type { RouteCardRequest } from '../domain/routeCard';

const FAILURE = 'Could not generate the image. Please try again.';
const abortError = () => new DOMException('Image generation cancelled.', 'AbortError');

export function generateRouteCard(request: RouteCardRequest, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let settled = false;
    let fallbackStarted = false;
    const timeout = setTimeout(() => finish(undefined, new Error(FAILURE)), 30_000);
    const releaseWorker = () => {
      if (!worker) return;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = undefined;
    };
    const finish = (blob?: Blob, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      releaseWorker();
      if (blob) resolve(blob);
      else reject(error ?? new Error(FAILURE));
    };
    const abort = () => finish(undefined, abortError());
    const fallback = async () => {
      if (settled || fallbackStarted) return;
      fallbackStarted = true;
      releaseWorker();
      let canvas: HTMLCanvasElement | undefined;
      try {
        // Give the busy state a paint opportunity before the compatibility path.
        await new Promise<void>((yes) => setTimeout(yes, 0));
        if (settled) return;
        const { renderRouteCard } = await import('../domain/routeCard');
        if (settled) return;
        canvas = document.createElement('canvas');
        const blob = await renderRouteCard(request, canvas);
        finish(blob);
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error(FAILURE));
      } finally {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    if (typeof Worker === 'undefined') {
      void fallback();
      return;
    }
    try {
      worker = new Worker(new URL('../workers/routeCard.worker.ts', import.meta.url), {
        type: 'module',
      });
      if (settled || signal.aborted) {
        releaseWorker();
        abort();
        return;
      }
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (typeof data !== 'object' || data === null || !('status' in data)) {
          finish(undefined, new Error(FAILURE));
        } else if (data.status === 'unsupported') {
          void fallback();
        } else if (
          data.status === 'success' &&
          'blob' in data &&
          data.blob instanceof Blob &&
          data.blob.type === 'image/png' &&
          data.blob.size > 0
        ) {
          finish(data.blob);
        } else if (
          data.status === 'error' &&
          'message' in data &&
          typeof data.message === 'string' &&
          data.message
        ) {
          finish(undefined, new Error(data.message));
        } else finish(undefined, new Error(FAILURE));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(undefined, new Error(FAILURE));
      };
      worker.onmessageerror = () => finish(undefined, new Error(FAILURE));
      worker.postMessage(request);
    } catch {
      void fallback();
    }
  });
}
