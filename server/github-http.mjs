export const TRANSPORT_LIMIT = 3 * 1024 * 1024;
export const JSON_LIMIT = 4 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 20_000;
export const MAGIC = Buffer.from([82, 79, 65, 77, 76, 69, 84, 1]);

export class GithubError extends Error {
  constructor(code = 'unavailable', status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function failure(res, error) {
  const safe = error instanceof GithubError ? error : new GithubError();
  return json(res, safe.status, {
    error: { code: safe.code, message: 'GitHub connector request failed.' },
  });
}

export function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.end();
}

export function sameOrigin(req, config, mutation = false) {
  const origin = req.headers?.origin;
  const site = req.headers?.['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return false;
  if (origin !== undefined && origin !== config.origin) return false;
  return !mutation || (origin === config.origin && req.headers?.['x-roamlet-request'] === '1');
}

export function checkCiphertext(bytes) {
  if (bytes.length > TRANSPORT_LIMIT) throw new GithubError('too-large', 413);
  if (bytes.length < 52 || !bytes.subarray(0, 8).equals(MAGIC))
    throw new GithubError('invalid-data', 400);
}

export async function readUpload(req, signal) {
  const length = req.headers?.['content-length'];
  if (
    length !== undefined &&
    (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > TRANSPORT_LIMIT)
  ) {
    req.resume?.();
    throw new GithubError('too-large', 413);
  }
  let bytes;
  if (req.body !== undefined) {
    if (!(req.body instanceof Uint8Array)) throw new GithubError('invalid-data', 400);
    if (req.body.byteLength > TRANSPORT_LIMIT) throw new GithubError('too-large', 413);
    bytes = Buffer.from(req.body);
  } else {
    bytes = await new Promise((resolve, reject) => {
      const chunks = [];
      let count = 0;
      const cleanup = () => {
        for (const [event, fn] of [
          ['data', data],
          ['end', end],
          ['error', error],
          ['aborted', error],
        ])
          req.removeListener(event, fn);
        signal.removeEventListener('abort', abort);
      };
      const fail = (failure) => {
        cleanup();
        req.resume?.();
        reject(failure);
      };
      const error = () => fail(new GithubError('invalid-data', 400));
      const abort = () =>
        fail(
          signal.reason instanceof GithubError ? signal.reason : new GithubError('network', 499),
        );
      const data = (chunk) => {
        const buffer = Buffer.from(chunk);
        count += buffer.length;
        if (count > TRANSPORT_LIMIT) return fail(new GithubError('too-large', 413));
        chunks.push(buffer);
      };
      const end = () => {
        cleanup();
        resolve(Buffer.concat(chunks));
      };
      req.on('data', data);
      req.on('end', end);
      req.on('error', error);
      req.on('aborted', error);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else if (req.aborted || req.readableEnded) error();
    });
  }
  if (length !== undefined && Number(length) !== bytes.length)
    throw new GithubError('invalid-data', 400);
  checkCiphertext(bytes);
  return bytes;
}

export function requestLifetime(req, res, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new GithubError('network', 499));
  const close = () => {
    if (!res.writableEnded) cancel();
  };
  req.on?.('aborted', cancel);
  res.on?.('close', close);
  const timer = setTimeout(() => controller.abort(new GithubError('timeout', 504)), timeoutMs);
  if (req.aborted) cancel();
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      req.removeListener?.('aborted', cancel);
      res.removeListener?.('close', close);
    },
  };
}

export function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
