import { RequestError } from './routing-contract.mjs';

const REQUEST_LIMIT = 16 * 1024;
const ERROR_CODES = new Set([2004, 2009, 2010]);
const FAILURE_CODES = new Map([
  [400, 'INVALID_REQUEST'],
  [403, 'FORBIDDEN'],
  [404, 'UPSTREAM_REJECTED'],
  [405, 'METHOD_NOT_ALLOWED'],
  [413, 'REQUEST_TOO_LARGE'],
  [415, 'UNSUPPORTED_MEDIA_TYPE'],
  [422, 'UPSTREAM_REJECTED'],
  [429, 'RATE_LIMITED'],
  [502, 'UPSTREAM_UNAVAILABLE'],
  [503, 'UPSTREAM_UNAVAILABLE'],
  [504, 'UPSTREAM_TIMEOUT'],
]);
const RESPONSE_LIMIT = 4 * 1024 * 1024;

export function reply(res, status, body) {
  const serialized = JSON.stringify(body);
  // Leave headroom below Vercel's buffered response limit.
  if (Buffer.byteLength(serialized, 'utf8') > RESPONSE_LIMIT) {
    return failure(res, 502, 'UPSTREAM_RESPONSE_TOO_LARGE');
  }
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(serialized);
}

export function failure(res, status, code) {
  const publicCode =
    ERROR_CODES.has(code) ||
    (status === 503 && ['ROUTING_NOT_CONFIGURED', 'UPSTREAM_RATE_LIMITED'].includes(code)) ||
    (status === 502 && code === 'UPSTREAM_RESPONSE_TOO_LARGE')
      ? code
      : (FAILURE_CODES.get(status) ?? 'UPSTREAM_UNAVAILABLE');
  return reply(res, status, {
    error: {
      code: publicCode,
      message:
        status === 400 || status === 413 || status === 415
          ? 'Invalid routing request.'
          : 'The routing service is unavailable.',
    },
  });
}

export function header(req, name) {
  const value = req.headers?.[name];
  return typeof value === 'string' ? value : '';
}

export function sameOrigin(req) {
  if (header(req, 'sec-fetch-site').toLowerCase() === 'cross-site') return false;
  if (req.headers?.origin === undefined) return true;
  const origin = header(req, 'origin');
  const host = header(req, 'host');
  const protocol = header(req, 'x-forwarded-proto') || (req.socket?.encrypted ? 'https' : 'http');
  if (!host || !['http', 'https'].includes(protocol)) return false;
  try {
    const source = new URL(origin);
    const target = new URL(`${protocol}://${host}`);
    return source.origin === origin && source.origin === target.origin;
  } catch {
    return false;
  }
}

export async function readBody(req) {
  const length = header(req, 'content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > REQUEST_LIMIT)) {
    req.resume?.();
    throw new RequestError(413);
  }
  let raw = req.body;
  if (raw === undefined) {
    raw = await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const cleanup = () => {
        req.removeListener('data', data);
        req.removeListener('end', end);
        req.removeListener('error', error);
        req.removeListener('aborted', aborted);
      };
      const error = () => {
        cleanup();
        reject(new RequestError(400));
      };
      const aborted = error;
      const data = (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > REQUEST_LIMIT) {
          cleanup();
          req.resume();
          reject(new RequestError(413));
        } else chunks.push(buffer);
      };
      const end = () => {
        cleanup();
        resolve(Buffer.concat(chunks));
      };
      req.on('data', data);
      req.on('end', end);
      req.on('error', error);
      req.on('aborted', aborted);
      if (req.aborted || req.readableEnded) error();
    });
  }
  try {
    if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
    const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (Buffer.byteLength(serialized, 'utf8') > REQUEST_LIMIT) throw new RequestError(413);
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400);
  }
}
