import { createServer } from 'node:http';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BODY_LIMIT = 64 * 1024;
const RESPONSE_LIMIT = 10 * 1024 * 1024;
const defaultDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

class SafeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const invalid = () => new SafeError(400, 'INVALID_REQUEST', 'The request is invalid.');
const upstreamInvalid = () => new SafeError(502, 'INVALID_UPSTREAM_RESPONSE', 'The routing service returned an invalid response.');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some(name => !allowed.includes(name))) throw invalid();
}
function routePayload(value) {
  fields(value, ['coordinates', 'elevation', 'instructions', 'options']);
  if (!Array.isArray(value.coordinates) || value.coordinates.length < 1 || value.coordinates.length > 50 ||
      !value.coordinates.every(c => Array.isArray(c) && c.length === 2 && c.every(finite) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90)) throw invalid();
  for (const name of ['elevation', 'instructions']) {
    if (name in value && typeof value[name] !== 'boolean') throw invalid();
  }
  if ('options' in value) {
    fields(value.options, ['round_trip', 'avoid_features']);
    if ('avoid_features' in value.options && (!Array.isArray(value.options.avoid_features) ||
        value.options.avoid_features.length > 1 || value.options.avoid_features.some(v => v !== 'steps'))) throw invalid();
    if ('round_trip' in value.options) {
      const loop = value.options.round_trip;
      fields(loop, ['length', 'points', 'seed']);
      if (!finite(loop.length) || loop.length < 2000 || loop.length > 100000 ||
          ('points' in loop && (!Number.isInteger(loop.points) || loop.points < 2 || loop.points > 10)) ||
          ('seed' in loop && (!Number.isInteger(loop.seed) || loop.seed < 0 || loop.seed > 2147483647))) throw invalid();
    }
  }
  return value;
}
function geocodeParams(params) {
  if ([...params.keys()].some(k => !['text', 'size'].includes(k)) || params.getAll('text').length !== 1 || params.getAll('size').length > 1) throw invalid();
  const text = params.get('text').trim();
  const size = params.get('size') ?? '5';
  if (text.length < 3 || text.length > 200 || /[\u0000-\u001f\u007f]/u.test(text) || !/^[1-5]$/.test(size)) throw invalid();
  return new URLSearchParams({ text, size });
}
function json(res, status, data, head = false) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(head ? undefined : body);
}
async function readBody(req) {
  const length = req.headers['content-length'];
  if (length && Number(length) > BODY_LIMIT) {
    req.resume();
    throw new SafeError(413, 'BODY_TOO_LARGE', 'The request body exceeds 64 KB.');
  }
  const chunks = [];
  let total = 0;
  // Do not destroy the socket on overflow: the caller still needs the 413 response.
  await new Promise((resolveBody, reject) => {
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted); };
    const error = err => { cleanup(); reject(err); };
    const aborted = () => error(invalid());
    const end = () => { cleanup(); resolveBody(); };
    const data = chunk => {
      total += chunk.length;
      if (total > BODY_LIMIT) {
        cleanup();
        req.resume();
        reject(new SafeError(413, 'BODY_TOO_LARGE', 'The request body exceeds 64 KB.'));
      } else chunks.push(chunk);
    };
    req.on('data', data).once('end', end).once('error', error).once('aborted', aborted);
  });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid(); }
}
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    const host = new URL(`http://${req.headers.host}`);
    return ['http:', 'https:'].includes(origin.protocol) && origin.origin === req.headers.origin && origin.host === host.host;
  } catch { return false; }
}
function positive(value, fallback, max) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error('Invalid proxy limit configuration.');
  return number;
}
function within(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}
async function serveStatic(req, res, pathname, distPath) {
  if (!['GET', 'HEAD'].includes(req.method)) throw new SafeError(405, 'METHOD_NOT_ALLOWED', 'The method is not allowed.');
  const missing = () => new SafeError(404, 'NOT_FOUND', 'The resource was not found.');
  const pieces = pathname.split('/');
  if (pieces.some(p => p.startsWith('.') || ['src', 'source', 'node_modules'].includes(p)) || pathname.includes('\\') || /[\u0000-\u001f\u007f]/u.test(pathname)) throw missing();
  let root;
  try { root = await realpath(distPath); } catch { throw missing(); }
  let path = resolve(root, `.${pathname}`);
  if (!within(root, path)) throw missing();
  let info;
  try {
    path = await realpath(path);
    if (!within(root, path)) throw missing();
    info = await stat(path);
    if (!info.isFile()) throw new Error('Not a static file.');
  } catch (error) {
    if (error instanceof SafeError) throw error;
    const htmlNavigation = (req.headers.accept ?? '').split(',').some(type => /^text\/html(?:\s*;|\s*$)/i.test(type.trim()) && !/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(type));
    if (!htmlNavigation || extname(pathname)) throw missing();
    try {
      path = await realpath(resolve(root, 'index.html'));
      if (!within(root, path)) throw missing();
      info = await stat(path);
      if (!info.isFile()) throw missing();
    } catch { throw missing(); }
  }
  const extension = extname(path).toLowerCase();
  const immutable = pathname.startsWith('/assets/') && extension !== '.html' && !/(?:^|\/)(?:sw|service-worker)(?:[.-]|$)/i.test(pathname);
  res.writeHead(200, {
    'Content-Type': mime[extension] ?? 'application/octet-stream', 'Content-Length': info.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(path), res);
}

export function createProxyServer({
  key = process.env.ORS_API_KEY ?? '', base = process.env.ORS_URL || 'https://api.openrouteservice.org',
  fetchImpl = globalThis.fetch, distPath = defaultDist,
  rateLimit = process.env.PROXY_RATE_LIMIT, rateWindowMs = process.env.PROXY_RATE_WINDOW_MS,
  maxRateEntries = 10000, timeoutMs = 25000,
} = {}) {
  key = String(key).trim();
  const upstreamBase = new URL(base);
  if (!['http:', 'https:'].includes(upstreamBase.protocol) || upstreamBase.username || upstreamBase.password || upstreamBase.search || upstreamBase.hash || !/^\/*$/.test(upstreamBase.pathname)) throw new Error('ORS_URL must be an HTTP(S) service origin.');
  const limit = positive(rateLimit, 60, 100000);
  const windowMs = positive(rateWindowMs, 60000, 3600000);
  maxRateEntries = positive(maxRateEntries, 10000, 100000);
  timeoutMs = positive(timeoutMs, 25000, 25000);
  const clients = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of clients) if (entry.until <= now) clients.delete(ip);
  }, Math.min(windowMs, 60000));
  cleanup.unref();
  function quota(req, res) {
    const now = Date.now();
    const ip = req.socket.remoteAddress ?? 'unknown';
    let entry = clients.get(ip);
    if (!entry || entry.until <= now) {
      if (!entry && clients.size >= maxRateEntries) {
        for (const [address, old] of clients) if (old.until <= now) clients.delete(address);
        if (clients.size >= maxRateEntries) {
          res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
          throw new SafeError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
        }
      }
      entry = { count: 0, until: now + windowMs };
      clients.set(ip, entry);
    }
    if (++entry.count > limit) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((entry.until - now) / 1000)));
      throw new SafeError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
    }
  }
  async function forward(req, res, path, body) {
    if (!key) throw new SafeError(503, 'NOT_CONFIGURED', 'Routing is not configured on the server. Ask the deployment administrator to set ORS_API_KEY.');
    const controller = new AbortController();
    let timedOut = false;
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', disconnect);
    req.once('aborted', disconnect);
    if (res.destroyed || req.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    let response;
    let reader;
    // Race each operation as well as sending an abort signal to the native fetch.
    const aborted = new Promise((_, reject) => {
      const fail = () => reject(new Error('Request aborted.'));
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener('abort', fail, { once: true });
    });
    const wait = operation => Promise.race([operation, aborted]);
    try {
      response = await wait(fetchImpl(new URL(path, upstreamBase), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: key, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal, redirect: 'error',
      }));
      if (!response.ok) {
        if (response.status === 429) throw new SafeError(429, 'UPSTREAM_RATE_LIMITED', 'The routing service quota was reached. Please try again later.');
        throw new SafeError(502, 'UPSTREAM_ERROR', 'The routing service could not complete the request.');
      }
      if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '') ||
          Number(response.headers.get('content-length')) > RESPONSE_LIMIT || !response.body) throw upstreamInvalid();
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await wait(reader.read());
        if (done) break;
        size += value.byteLength;
        if (size > RESPONSE_LIMIT) throw upstreamInvalid();
        chunks.push(Buffer.from(value));
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw upstreamInvalid(); }
      if (!object(data)) throw upstreamInvalid();
      // Redact even an accidental key reflection in an otherwise successful JSON response.
      const safe = JSON.parse(JSON.stringify(data).split(JSON.stringify(key).slice(1, -1)).join('[redacted]'));
      json(res, 200, safe);
    } catch (error) {
      if (timedOut) throw new SafeError(504, 'UPSTREAM_TIMEOUT', 'The routing service took too long to respond. Please try again.');
      if (error instanceof SafeError) throw error;
      throw new SafeError(502, 'UPSTREAM_UNAVAILABLE', 'The routing service is unavailable. Please try again later.');
    } finally {
      clearTimeout(timer);
      res.off('close', disconnect);
      req.off('aborted', disconnect);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
  }
  const server = createServer(async (req, res) => {
    try {
      if (!sameOrigin(req) || req.headers['sec-fetch-site'] === 'cross-site') throw new SafeError(403, 'FORBIDDEN_ORIGIN', 'Cross-origin requests are not allowed.');
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw invalid();
      let pathname;
      try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch { throw invalid(); }
      if (pathname.includes('\\') || pathname.split('/').some(p => p === '..' || p === '.')) throw new SafeError(404, 'NOT_FOUND', 'The resource was not found.');
      const url = new URL(req.url, 'http://localhost');
      if (pathname === '/api/health') {
        if (req.method !== 'GET') throw new SafeError(405, 'METHOD_NOT_ALLOWED', 'The method is not allowed.');
        if (url.search) throw invalid();
        json(res, 200, { configured: Boolean(key) });
      } else if (/^\/api\/directions\/(cycling-regular|foot-hiking)\/geojson$/.test(pathname)) {
        if (req.method !== 'POST') throw new SafeError(405, 'METHOD_NOT_ALLOWED', 'The method is not allowed.');
        quota(req, res);
        if (url.search || !/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] ?? '') || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) throw invalid();
        await forward(req, res, `/v2${pathname.slice(4)}`, routePayload(await readBody(req)));
      } else if (pathname === '/api/geocode/search') {
        if (req.method !== 'GET') throw new SafeError(405, 'METHOD_NOT_ALLOWED', 'The method is not allowed.');
        quota(req, res);
        await forward(req, res, `/geocode/search?${geocodeParams(url.searchParams)}`);
      } else if (pathname === '/api' || pathname.startsWith('/api/')) {
        throw new SafeError(404, 'NOT_FOUND', 'The resource was not found.');
      } else await serveStatic(req, res, pathname, distPath);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const safe = error instanceof SafeError ? error : new SafeError(500, 'INTERNAL_ERROR', 'The server could not complete the request.');
      json(res, safe.status, { error: { code: safe.code, message: safe.message } }, req.method === 'HEAD');
      req.resume();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on('close', () => clearInterval(cleanup));
  return server;
}
