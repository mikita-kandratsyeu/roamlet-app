import { createServer } from 'node:http';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BODY_LIMIT = 64 * 1024;
const RESPONSE_LIMIT = 10 * 1024 * 1024;
const TERRAIN_LIMIT = 2 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const defaultDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

class SafeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const invalid = () => new SafeError(400, 'INVALID_REQUEST', 'The request is invalid.');
const upstreamInvalid = () =>
  new SafeError(
    502,
    'INVALID_UPSTREAM_RESPONSE',
    'The routing service returned an invalid response.',
  );
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const hasControlCharacters = (value) =>
  [...value].some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });
function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some((name) => !allowed.includes(name))) throw invalid();
}
const coordinate = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every(finite) &&
  Math.abs(value[0]) <= 180 &&
  Math.abs(value[1]) <= 90;
function routePayload(value) {
  fields(value, ['coordinates', 'elevation', 'instructions']);
  if (
    !Array.isArray(value.coordinates) ||
    value.coordinates.length < 2 ||
    value.coordinates.length > 25 ||
    !value.coordinates.every(coordinate) ||
    value.instructions !== false ||
    ('elevation' in value && typeof value.elevation !== 'boolean')
  )
    throw invalid();
  return value;
}
function normalizeDirections(data) {
  if (data.code === 'NoRoute')
    throw new SafeError(422, 'NO_ROUTE', 'No route was found between these points.');
  if (data.code !== 'Ok' || !Array.isArray(data.routes) || !data.routes.length)
    throw upstreamInvalid();
  const route = data.routes[0];
  if (
    !object(route) ||
    !object(route.geometry) ||
    route.geometry.type !== 'LineString' ||
    !Array.isArray(route.geometry.coordinates) ||
    route.geometry.coordinates.length < 2 ||
    !route.geometry.coordinates.every(coordinate) ||
    !finite(route.distance) ||
    route.distance < 0 ||
    !finite(route.duration) ||
    route.duration < 0
  )
    throw upstreamInvalid();
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: route.geometry.coordinates },
        properties: { summary: { distance: route.distance, duration: route.duration } },
      },
    ],
  };
}
function normalizeGeocode(data) {
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw upstreamInvalid();
  return {
    type: 'FeatureCollection',
    features: data.features.map((feature) => {
      if (
        !object(feature) ||
        !object(feature.geometry) ||
        feature.geometry.type !== 'Point' ||
        !coordinate(feature.geometry.coordinates) ||
        !object(feature.properties) ||
        typeof feature.properties.full_address !== 'string' ||
        !feature.properties.full_address.trim() ||
        feature.properties.full_address.length > 1000 ||
        hasControlCharacters(feature.properties.full_address)
      )
        throw upstreamInvalid();
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: feature.geometry.coordinates },
        properties: { label: feature.properties.full_address },
      };
    }),
  };
}
function validPng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  let offset = 8;
  let imageData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > buffer.length) return false;
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) return false;
      const width = buffer.readUInt32BE(offset + 8);
      const height = buffer.readUInt32BE(offset + 12);
      if (!width || !height || width > 512 || height > 512) return false;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT') imageData = true;
    offset += length + 12;
    if (type === 'IEND') return length === 0 && imageData && offset === buffer.length;
  }
  return false;
}
function geocodeParams(params) {
  if (
    [...params.keys()].some((k) => !['text', 'size'].includes(k)) ||
    params.getAll('text').length !== 1 ||
    params.getAll('size').length > 1
  )
    throw invalid();
  const text = params.get('text').trim();
  const size = params.get('size') ?? '5';
  if (text.length < 3 || text.length > 200 || hasControlCharacters(text) || !/^[1-5]$/.test(size))
    throw invalid();
  return new URLSearchParams({ text, size });
}
function json(res, status, data, head = false) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
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
    const cleanup = () => {
      req.off('data', data);
      req.off('end', end);
      req.off('error', error);
      req.off('aborted', aborted);
    };
    const error = (err) => {
      cleanup();
      reject(err);
    };
    const aborted = () => error(invalid());
    const end = () => {
      cleanup();
      resolveBody();
    };
    const data = (chunk) => {
      total += chunk.length;
      if (total > BODY_LIMIT) {
        cleanup();
        req.resume();
        reject(new SafeError(413, 'BODY_TOO_LARGE', 'The request body exceeds 64 KB.'));
      } else chunks.push(chunk);
    };
    req.on('data', data).once('end', end).once('error', error).once('aborted', aborted);
  });
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw invalid();
  }
}
function sameOrigin(req, publicOrigin) {
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== req.headers.origin)
      return false;
    if (publicOrigin) return origin.origin === publicOrigin;
    const host = new URL(`http://${req.headers.host}`);
    return origin.host === host.host;
  } catch {
    return false;
  }
}
function positive(value, fallback, max) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > max)
    throw new Error('Invalid proxy limit configuration.');
  return number;
}
function within(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}
async function serveStatic(req, res, pathname, distPath) {
  if (!['GET', 'HEAD'].includes(req.method))
    throw new SafeError(405, 'METHOD_NOT_ALLOWED', 'The method is not allowed.');
  const missing = () => new SafeError(404, 'NOT_FOUND', 'The resource was not found.');
  const pieces = pathname.split('/');
  if (
    pieces.some((p) => p.startsWith('.') || ['src', 'source', 'node_modules'].includes(p)) ||
    pathname.includes('\\') ||
    hasControlCharacters(pathname) ||
    extname(pathname).toLowerCase() === '.map'
  )
    throw missing();
  let root;
  try {
    root = await realpath(distPath);
  } catch {
    throw missing();
  }
  // The root is a concrete app-shell resource, including service-worker precaching.
  // Only missing client-side routes below the root require an HTML navigation.
  let path = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
  if (!within(root, path)) throw missing();
  let info;
  try {
    path = await realpath(path);
    if (!within(root, path)) throw missing();
    info = await stat(path);
    if (!info.isFile()) throw new Error('Not a static file.');
  } catch (error) {
    if (error instanceof SafeError) throw error;
    const htmlNavigation = (req.headers.accept ?? '')
      .split(',')
      .some(
        (type) =>
          /^text\/html(?:\s*;|\s*$)/i.test(type.trim()) &&
          !/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(type),
      );
    if (!htmlNavigation || extname(pathname)) throw missing();
    try {
      path = await realpath(resolve(root, 'index.html'));
      if (!within(root, path)) throw missing();
      info = await stat(path);
      if (!info.isFile()) throw missing();
    } catch {
      throw missing();
    }
  }
  const extension = extname(path).toLowerCase();
  const immutable =
    pathname.startsWith('/assets/') &&
    extension !== '.html' &&
    !/(?:^|\/)(?:sw|service-worker)(?:[.-]|$)/i.test(pathname);
  res.writeHead(200, {
    'Content-Type': mime[extension] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(path), res);
}

export function createProxyServer({
  token = process.env.MAPBOX_ACCESS_TOKEN ?? '',
  base = process.env.MAPBOX_URL || 'https://api.mapbox.com',
  fetchImpl = globalThis.fetch,
  distPath = defaultDist,
  rateLimit = process.env.PROXY_RATE_LIMIT,
  rateWindowMs = process.env.PROXY_RATE_WINDOW_MS,
  maxRateEntries = 10000,
  timeoutMs = 25000,
  publicOrigin = process.env.PUBLIC_ORIGIN || '',
} = {}) {
  if (publicOrigin) {
    const origin = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== publicOrigin) {
      throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a path.');
    }
  }
  token = String(token).trim();
  let upstreamBase;
  try {
    upstreamBase = new URL(base);
  } catch {
    throw new Error('MAPBOX_URL must be an HTTP(S) service origin.');
  }
  if (
    !['http:', 'https:'].includes(upstreamBase.protocol) ||
    upstreamBase.username ||
    upstreamBase.password ||
    upstreamBase.search ||
    upstreamBase.hash ||
    !/^\/*$/.test(upstreamBase.pathname)
  )
    throw new Error('MAPBOX_URL must be an HTTP(S) service origin.');
  const limit = positive(rateLimit, 60, 100000);
  const windowMs = positive(rateWindowMs, 60000, 3600000);
  maxRateEntries = positive(maxRateEntries, 10000, 100000);
  timeoutMs = positive(timeoutMs, 25000, 25000);
  const clients = new Map();
  const cleanup = setInterval(
    () => {
      const now = Date.now();
      for (const [ip, entry] of clients) if (entry.until <= now) clients.delete(ip);
    },
    Math.min(windowMs, 60000),
  );
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
  async function forward(req, res, path, kind) {
    if (!token)
      throw new SafeError(
        503,
        'NOT_CONFIGURED',
        'Routing is not configured on the server. Ask the deployment administrator to set MAPBOX_ACCESS_TOKEN.',
      );
    const address = new URL(path, upstreamBase);
    address.searchParams.set('access_token', token);
    const terrain = kind === 'terrain';
    const responseLimit = terrain ? TERRAIN_LIMIT : RESPONSE_LIMIT;
    const controller = new AbortController();
    let timedOut = false;
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once('close', disconnect);
    req.once('aborted', disconnect);
    if (res.destroyed || req.aborted) controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let response;
    let reader;
    // Race each operation as well as sending an abort signal to the native fetch.
    const aborted = new Promise((_, reject) => {
      const fail = () => reject(new Error('Request aborted.'));
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener('abort', fail, { once: true });
    });
    const wait = (operation) => Promise.race([operation, aborted]);
    try {
      response = await wait(
        fetchImpl(address, {
          method: 'GET',
          headers: { Accept: terrain ? 'image/png' : 'application/json' },
          signal: controller.signal,
          redirect: 'error',
        }),
      );
      if (!response.ok) {
        if (terrain && response.status === 404)
          throw new SafeError(
            404,
            'TERRAIN_NOT_FOUND',
            'Elevation data is unavailable for this tile.',
          );
        if (response.status === 429)
          throw new SafeError(
            429,
            'UPSTREAM_RATE_LIMITED',
            'The routing service quota was reached. Please try again later.',
          );
        throw new SafeError(
          502,
          'UPSTREAM_ERROR',
          'The routing service could not complete the request.',
        );
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (
        !(terrain
          ? /^image\/png(?:\s*;|\s*$)/i.test(contentType)
          : /^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(contentType)) ||
        Number(response.headers.get('content-length')) > responseLimit ||
        !response.body
      )
        throw upstreamInvalid();
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await wait(reader.read());
        if (done) break;
        size += value.byteLength;
        if (size > responseLimit) throw upstreamInvalid();
        chunks.push(Buffer.from(value));
      }
      const buffer = Buffer.concat(chunks);
      if (terrain) {
        if (
          !validPng(buffer) ||
          [token, encodeURIComponent(token)].some((secret) => buffer.includes(Buffer.from(secret)))
        )
          throw upstreamInvalid();
        if (!res.destroyed && !res.writableEnded) {
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': buffer.length,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(buffer);
        }
        return;
      }
      let data;
      try {
        data = JSON.parse(buffer.toString('utf8'));
      } catch {
        throw upstreamInvalid();
      }
      if (!object(data)) throw upstreamInvalid();
      const normalized = kind === 'directions' ? normalizeDirections(data) : normalizeGeocode(data);
      // Normalization drops provider metadata; redact reflected credentials in retained labels too.
      if (kind === 'geocode') {
        for (const feature of normalized.features) {
          for (const secret of [token, encodeURIComponent(token)])
            feature.properties.label = feature.properties.label.split(secret).join('[redacted]');
        }
      }
      json(res, 200, normalized);
    } catch (error) {
      if (timedOut)
        throw new SafeError(
          504,
          'UPSTREAM_TIMEOUT',
          'The routing service took too long to respond. Please try again.',
        );
      if (error instanceof SafeError) throw error;
      throw new SafeError(
        502,
        'UPSTREAM_UNAVAILABLE',
        'The routing service is unavailable. Please try again later.',
      );
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
      if (!sameOrigin(req, publicOrigin) || req.headers['sec-fetch-site'] === 'cross-site')
        throw new SafeError(403, 'FORBIDDEN_ORIGIN', 'Cross-origin requests are not allowed.');
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw invalid();
      let pathname;
      try {
        pathname = decodeURIComponent(req.url.split('?')[0]);
      } catch {
        throw invalid();
      }
      if (pathname.includes('\\') || pathname.split('/').some((p) => p === '..' || p === '.'))
        throw new SafeError(404, 'NOT_FOUND', 'The resource was not found.');
      const url = new URL(req.url, 'http://localhost');
      if (pathname === '/api/health') {
        if (req.method !== 'GET')
          throw new SafeError(405, 'METHOD_NOT_ALLOWED', 'The method is not allowed.');
        if (url.search) throw invalid();
        json(res, 200, { configured: Boolean(token) });
      } else if (/^\/api\/directions\/(cycling|walking)\/geojson$/.test(pathname)) {
        if (req.method !== 'POST')
          throw new SafeError(405, 'METHOD_NOT_ALLOWED', 'The method is not allowed.');
        quota(req, res);
        if (
          url.search ||
          !/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] ?? '') ||
          (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')
        )
          throw invalid();
        const body = routePayload(await readBody(req));
        const profile = pathname.split('/')[3];
        const coordinates = body.coordinates.map((point) => point.join(',')).join(';');
        await forward(
          req,
          res,
          `/directions/v5/mapbox/${profile}/${coordinates}?geometries=geojson&overview=full&steps=false`,
          'directions',
        );
      } else if (pathname === '/api/geocode/search') {
        if (req.method !== 'GET')
          throw new SafeError(405, 'METHOD_NOT_ALLOWED', 'The method is not allowed.');
        quota(req, res);
        const params = geocodeParams(url.searchParams);
        const query = new URLSearchParams({
          q: params.get('text'),
          limit: params.get('size'),
          permanent: 'true',
          autocomplete: 'false',
        });
        await forward(req, res, `/search/geocode/v6/forward?${query}`, 'geocode');
      } else if (pathname.startsWith('/api/terrain/')) {
        if (req.method !== 'GET')
          throw new SafeError(405, 'METHOD_NOT_ALLOWED', 'The method is not allowed.');
        quota(req, res);
        const match =
          /^\/api\/terrain\/(0|[1-9]\d?)\/(0|[1-9]\d{0,4})\/(0|[1-9]\d{0,4})\.pngraw$/.exec(
            pathname,
          );
        if (!match || url.search) throw invalid();
        const [z, x, y] = match.slice(1).map(Number);
        if (z > 14 || x >= 2 ** z || y >= 2 ** z) throw invalid();
        await forward(req, res, `/v4/mapbox.terrain-rgb/${z}/${x}/${y}.pngraw`, 'terrain');
      } else if (pathname === '/api' || pathname.startsWith('/api/')) {
        throw new SafeError(404, 'NOT_FOUND', 'The resource was not found.');
      } else await serveStatic(req, res, pathname, distPath);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const safe =
        error instanceof SafeError
          ? error
          : new SafeError(500, 'INTERNAL_ERROR', 'The server could not complete the request.');
      json(
        res,
        safe.status,
        { error: { code: safe.code, message: safe.message } },
        req.method === 'HEAD',
      );
      req.resume();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on('close', () => clearInterval(cleanup));
  return server;
}
