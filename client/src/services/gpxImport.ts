import type { PlannedRoute } from '../domain/types';
import i18n from '../i18n';
import type { GpxImportRequest } from '../workers/gpxImport.protocol';

const FAILURE_MESSAGE = 'Something went wrong. Please try again.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isImportedRoute(value: unknown): value is PlannedRoute {
  // Geometry is validated by the domain parser in our worker. Check the transport
  // envelope here without traversing up to 100,000 coordinates on the UI thread.
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    value.activity === 'hiking' &&
    value.source === 'gpx' &&
    Array.isArray(value.segments) &&
    Array.isArray(value.waypoints) &&
    isRecord(value.stats) &&
    typeof value.stats.distance === 'number' &&
    Number.isFinite(value.stats.distance) &&
    typeof value.stats.duration === 'number' &&
    Number.isFinite(value.stats.duration) &&
    (value.stats.ascent === undefined ||
      (typeof value.stats.ascent === 'number' && Number.isFinite(value.stats.ascent))) &&
    (value.stats.descent === undefined ||
      (typeof value.stats.descent === 'number' && Number.isFinite(value.stats.descent)))
  );
}

export function importGpxFile(file: File, signal?: AbortSignal): Promise<PlannedRoute> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let settled = false;
    const finish = (route?: PlannedRoute, error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      if (route) resolve(route);
      else reject(error ?? new Error(FAILURE_MESSAGE));
    };
    const abort = () => finish(undefined, new DOMException('GPX import cancelled.', 'AbortError'));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    try {
      worker = new Worker(new URL('../workers/gpxImport.worker.ts', import.meta.url), {
        type: 'module',
      });
      // Abort can occur during construction before worker is assigned.
      if (settled || signal?.aborted) {
        worker.terminate();
        abort();
        return;
      }
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const response = event.data;
        if (
          isRecord(response) &&
          response.status === 'success' &&
          isImportedRoute(response.route)
        ) {
          finish(response.route);
        } else if (
          isRecord(response) &&
          response.status === 'error' &&
          typeof response.message === 'string' &&
          response.message.length > 0
        ) {
          finish(undefined, new Error(response.message));
        } else finish(undefined, new Error(FAILURE_MESSAGE));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(undefined, new Error(FAILURE_MESSAGE));
      };
      worker.onmessageerror = () => finish(undefined, new Error(FAILURE_MESSAGE));
      const request: GpxImportRequest = {
        file,
        language: i18n.resolvedLanguage === 'ru' ? 'ru' : 'en',
      };
      worker.postMessage(request);
    } catch {
      finish(undefined, new Error(FAILURE_MESSAGE));
    }
  });
}
