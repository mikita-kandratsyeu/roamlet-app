import { sanitizeSuccess } from './routing-contract.mjs';

const RESPONSE_LIMIT = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT = 20_000;
const SAFE_CODES = new Set([2004, 2009, 2010]);

export function createOrsClient({
  fetcher = (...args) => globalThis.fetch(...args),
  timeout = UPSTREAM_TIMEOUT,
} = {}) {
  return async function requestRoute(request, key) {
    const controller = new AbortController();
    let timer;
    let timedOut = false;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(
            `https://api.heigit.org/openrouteservice/v2/directions/${request.profile}/geojson`,
            {
              method: 'POST',
              headers: {
                Authorization: key,
                'Content-Type': 'application/json',
                Accept: 'application/geo+json',
              },
              body: JSON.stringify(request.upstream),
              redirect: 'error',
              credentials: 'omit',
              signal: controller.signal,
            },
          );
          if ([401, 403, 429].includes(response.status)) {
            void response.body?.cancel().catch(() => {});
            return {
              status: 503,
              code: response.status === 429 ? 'UPSTREAM_RATE_LIMITED' : undefined,
              category: response.status === 429 ? 'upstream_rate_limited' : 'upstream_credentials',
            };
          }
          const data = await upstreamJson(response, controller.signal);
          if (
            !response.ok ||
            (data !== null && typeof data === 'object' && Object.hasOwn(data, 'error'))
          ) {
            return {
              status: [400, 404, 422].includes(response.status) ? response.status : 502,
              code: SAFE_CODES.has(data?.error?.code) ? data.error.code : undefined,
              category: 'upstream_rejected',
            };
          }
          return { status: 200, body: sanitizeSuccess(data), category: 'success' };
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error('Routing timeout.'));
          }, timeout);
        }),
      ]);
    } catch {
      controller.abort();
      return {
        status: timedOut ? 504 : 502,
        category: timedOut ? 'upstream_timeout' : 'upstream_failure',
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

async function upstreamJson(response, signal) {
  if (Number(response.headers.get('content-length')) > RESPONSE_LIMIT) {
    await response.body?.cancel();
    throw new Error('Invalid upstream response.');
  }
  if (!response.body) throw new Error('Invalid upstream response.');
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT) throw new Error('Invalid upstream response.');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    signal.removeEventListener('abort', cancel);
    // Cancel oversized or stalled streams as well as releasing the reader.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
