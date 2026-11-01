import { ConnectorError, type ConnectorErrorCode } from './types';
export const CONNECTOR_TRANSPORT_MAX_BYTES = 3 * 1024 * 1024;
const codes: ConnectorErrorCode[] = [
  'configuration',
  'unavailable',
  'auth',
  'permission',
  'not-found',
  'quota',
  'network',
  'timeout',
  'invalid-data',
  'too-large',
  'conflict',
];

export async function connectorRequest(
  endpoint: 'github' | 'google-drive',
  action: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
  body?: Uint8Array | null,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 65_000);
  let rejectAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const interrupted = () => rejectAbort(new DOMException('Cancelled', 'AbortError'));
  controller.signal.addEventListener('abort', interrupted, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const response = await Promise.race([
      fetch(`/api/${endpoint}?${new URLSearchParams({ action, ...params })}`, {
        method: body !== undefined ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers:
          body !== undefined
            ? { 'Content-Type': 'application/octet-stream', 'X-Roamlet-Request': '1' }
            : {},
        body: body ? new Uint8Array(body).buffer : undefined,
        signal: controller.signal,
      }),
      aborted,
    ]);
    const limit = CONNECTOR_TRANSPORT_MAX_BYTES;
    if (Number(response.headers.get('Content-Length')) > limit)
      throw new ConnectorError('too-large');
    if (!response.body) throw new ConnectorError('invalid-data');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new ConnectorError('too-large');
        }
        chunks.push(value);
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (!response.ok) {
      let code: ConnectorErrorCode =
        response.status === 401 ? 'auth' : response.status === 503 ? 'unavailable' : 'network';
      try {
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (
          value &&
          typeof value === 'object' &&
          'error' in value &&
          value.error &&
          typeof value.error === 'object' &&
          'code' in value.error &&
          typeof value.error.code === 'string'
        ) {
          const received = value.error.code;
          const known = codes.find((item) => item === received);
          if (known) code = known;
        }
      } catch {
        /* Ignore untrusted error bodies. */
      }
      throw new ConnectorError(code);
    }
    return bytes;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (timedOut) throw new ConnectorError('timeout');
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError('network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', interrupted);
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
export async function connectorJson(
  endpoint: 'github' | 'google-drive',
  action: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
  body?: null,
): Promise<Record<string, unknown>> {
  const bytes = await connectorRequest(endpoint, action, params, signal, body);
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ConnectorError('invalid-data');
  }
}
