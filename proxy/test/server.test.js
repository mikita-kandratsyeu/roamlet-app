import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createProxyServer } from '../src/index.js';

const routing = '/api/directions/cycling-regular/geojson';
const payload = {
  coordinates: [
    [11.4, 47.26],
    [11.41, 47.27],
  ],
  elevation: true,
  instructions: false,
  options: { avoid_features: ['steps'] },
};
const search = '/api/geocode/search?text=Innsbruck';
const successful = () =>
  new Response('{"features":[]}', { headers: { 'content-type': 'application/json' } });
async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function proxy(t, options = {}) {
  return listen(
    t,
    createProxyServer({ key: 'private-test-key', fetchImpl: async () => successful(), ...options }),
  );
}
function post(url, body = payload, headers = {}) {
  return fetch(url + routing, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function raw(url, path, { method = 'GET', headers = {}, chunks = [] } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url + '/', { path, method, headers }, (res) => {
      const parts = [];
      res.on('data', (part) => parts.push(part));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(parts).toString(),
        }),
      );
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

test('injects only private auth into fixed upstream paths and strips upstream headers', async (t) => {
  const seen = [];
  const upstream = await listen(
    t,
    createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      seen.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(200, {
        'content-type': 'application/geo+json',
        Authorization: 'private-test-key',
        'set-cookie': 'secret=value',
        'access-control-allow-origin': '*',
      });
      res.end('{"features":[],"reflected":"private-test-key"}');
    }),
  );
  const url = await proxy(t, { base: upstream, fetchImpl: fetch });
  const response = await post(url, payload, {
    authorization: 'caller-secret',
    cookie: 'caller=cookie',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { features: [], reflected: '[redacted]' });
  for (const name of ['authorization', 'set-cookie', 'access-control-allow-origin'])
    assert.equal(response.headers.get(name), null);
  assert.equal(seen[0].url, '/openrouteservice/v2/directions/cycling-regular/geojson');
  assert.equal(seen[0].headers.authorization, 'private-test-key');
  assert.equal(seen[0].headers.cookie, undefined);
  assert.deepEqual(JSON.parse(seen[0].body), payload);
  assert.equal((await fetch(url + search + '&size=2')).status, 200);
  assert.equal(seen[1].url, '/pelias/v1/search?text=Innsbruck&size=2');
});

test('uses the HeiGIT directions endpoint for both supported profiles by default', async (t) => {
  const seen = [];
  const url = await proxy(t, {
    fetchImpl: async (address, options) => {
      seen.push({ url: String(address), options });
      return successful();
    },
  });
  for (const profile of ['cycling-regular', 'foot-hiking']) {
    const response = await fetch(url + `/api/directions/${profile}/geojson`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200);
    const request = seen.at(-1);
    assert.equal(
      request.url,
      `https://api.heigit.org/openrouteservice/v2/directions/${profile}/geojson`,
    );
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'private-test-key');
    assert.deepEqual(JSON.parse(request.options.body), payload);
  }
});

test('health contains only configured boolean; missing key has exact safe error', async (t) => {
  let called = false;
  const url = await proxy(t, {
    key: '  ',
    fetchImpl: () => {
      called = true;
      throw Error('should not fetch');
    },
  });
  assert.deepEqual(await (await fetch(url + '/api/health')).json(), { configured: false });
  for (const response of [await post(url), await fetch(url + search)]) {
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'NOT_CONFIGURED',
        message:
          'Routing is not configured on the server. Ask the deployment administrator to set ORS_API_KEY.',
      },
    });
  }
  assert.equal(called, false);
  const configured = await proxy(t);
  assert.deepEqual(await (await fetch(configured + '/api/health')).json(), { configured: true });
});

test('validates coordinates, booleans and exact nested whitelists; accepts existing loop payload', async (t) => {
  let count = 0;
  const url = await proxy(t, {
    rateLimit: 1000,
    fetchImpl: async () => {
      count++;
      return successful();
    },
  });
  const invalidBodies = [
    null,
    [],
    {},
    { ...payload, api_key: 'bad' },
    ...[
      [],
      Array(51).fill([0, 0]),
      [[181, 0]],
      [[0, -91]],
      [['1', 2]],
      [[0, 0, 0]],
      [[null, 0]],
    ].map((coordinates) => ({ ...payload, coordinates })),
    { ...payload, elevation: 'true' },
    { ...payload, instructions: 0 },
    ...[
      null,
      [],
      { avoid_polygons: {} },
      { avoid_features: ['ferries'] },
      { avoid_features: ['steps', 'steps'] },
      { round_trip: { length: 20000, url: 'https://example.org' } },
      { round_trip: {} },
      { round_trip: { length: 1 } },
      { round_trip: { length: 100001 } },
      { round_trip: { length: 20000, points: 1 } },
      { round_trip: { length: 20000, seed: -1 } },
      { round_trip: { length: 20000, seed: 1.5 } },
    ].map((options) => ({ ...payload, options })),
  ];
  for (const body of invalidBodies)
    assert.equal((await post(url, body)).status, 400, JSON.stringify(body));
  assert.equal(count, 0);
  assert.equal(
    (
      await post(url, {
        coordinates: [[-180, 90]],
        options: { round_trip: { length: 20000, points: 3, seed: 11 }, avoid_features: ['steps'] },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(url + '/api/directions/foot-hiking/geojson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    ).status,
    200,
  );
  assert.equal((await post(url, { coordinates: Array(50).fill([0.1, -0.2]) })).status, 200);
});

test('rejects malformed JSON, content types, encoded bodies, and both declared and chunked body overflow', async (t) => {
  const url = await proxy(t);
  for (const [body, headers] of [
    ['{', { 'content-type': 'application/json' }],
    ['{}', { 'content-type': 'text/plain' }],
    [JSON.stringify(payload), { 'content-type': 'application/json', 'content-encoding': 'gzip' }],
  ]) {
    assert.equal((await fetch(url + routing, { method: 'POST', body, headers })).status, 400);
  }
  const large = ' '.repeat(64 * 1024 + 1);
  assert.equal(
    (
      await fetch(url + routing, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: large,
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await raw(url, routing, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        chunks: [large.slice(0, 40000), large.slice(40000)],
      })
    ).status,
    413,
  );
});

test('geocoding validates length, size, duplicates and unknown parameters', async (t) => {
  const seen = [];
  const url = await proxy(t, {
    fetchImpl: async (address) => {
      seen.push(String(address));
      return successful();
    },
  });
  for (const query of [
    '',
    '?text=ab',
    '?text=' + 'x'.repeat(201),
    '?text=abc&size=0',
    '?text=abc&size=6',
    '?text=abc&size=1.5',
    '?text=abc&size=01',
    '?text=abc&url=https://example.org',
    '?text=abc&api_key=bad',
    '?text=abc&text=def',
    '?text=abc&size=1&size=2',
    '?text=abc%00',
  ]) {
    assert.equal((await fetch(url + '/api/geocode/search' + query)).status, 400, query);
  }
  assert.equal(seen.length, 0);
  assert.equal((await fetch(url + '/api/geocode/search?text=%20abc%20')).status, 200);
  assert.equal(seen[0], 'https://api.heigit.org/pelias/v1/search?text=abc&size=5');
});

test('only exposes enumerated APIs and methods; rejects cross-origin and does not emit CORS', async (t) => {
  const url = await proxy(t);
  for (const path of [
    '/api/directions/driving-car/geojson',
    '/api/proxy?url=https://example.org',
    '/api',
    '/api/health/',
  ])
    assert.equal((await fetch(url + path, { headers: { accept: 'text/html' } })).status, 404);
  assert.equal((await fetch(url + routing)).status, 405);
  assert.equal((await fetch(url + search, { method: 'POST' })).status, 405);
  assert.equal((await fetch(url + '/api/health', { method: 'HEAD' })).status, 405);
  for (const origin of ['https://evil.example', 'null', url + '/path', 'http://user@127.0.0.1']) {
    assert.equal((await fetch(url + search, { headers: { origin } })).status, 403);
  }
  assert.equal((await fetch(url + search, { headers: { origin: url } })).status, 200);
  assert.equal(
    (await fetch(url + search, { headers: { 'sec-fetch-site': 'cross-site' } })).status,
    403,
  );
  const preflight = await fetch(url + search, {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
});

test('preserved Vite Host/Origin and optional public origin support configuration health', async (t) => {
  const url = await proxy(t, { key: '', rateLimit: 1, publicOrigin: '' });
  for (const port of [5173, 4174]) {
    const headers = { host: `localhost:${port}`, origin: `http://localhost:${port}` };
    const health = await raw(url, '/api/health', { headers });
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { configured: false });
  }
  await fetch(url + search);
  await fetch(url + search);
  assert.equal(
    (
      await raw(url, '/api/health', {
        headers: { host: 'localhost:5173', origin: 'http://localhost:5173' },
      })
    ).status,
    200,
  );
  const publicUrl = await proxy(t, { publicOrigin: 'https://app.example.org' });
  assert.equal(
    (await fetch(publicUrl + '/api/health', { headers: { origin: 'https://app.example.org' } }))
      .status,
    200,
  );
  assert.equal(
    (await fetch(publicUrl + '/api/health', { headers: { origin: publicUrl } })).status,
    403,
  );
  assert.equal((await fetch(publicUrl + '/api/health')).status, 200);
  assert.throws(() => createProxyServer({ publicOrigin: 'https://app.example.org/path' }));
});

test('socket-IP quota ignores spoofed forwarding headers and resets after window', async (t) => {
  const url = await proxy(t, { rateLimit: 1, rateWindowMs: 80, maxRateEntries: 1 });
  assert.equal(
    (await fetch(url + search, { headers: { 'x-forwarded-for': '1.2.3.4' } })).status,
    200,
  );
  const limited = await fetch(url + search, {
    headers: { 'x-forwarded-for': '5.6.7.8', forwarded: 'for=5.6.7.8' },
  });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
  assert.equal(limited.headers.get('retry-after'), '1');
  assert.equal((await fetch(url + '/api/health')).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await fetch(url + search)).status, 200);
});

test('upstream errors and unexpected exceptions never leak private data', async (t) => {
  for (const status of [401, 403, 429, 500]) {
    const url = await proxy(t, {
      fetchImpl: async () =>
        new Response('private-test-key secret provider error', {
          status,
          headers: { Authorization: 'private-test-key' },
        }),
    });
    const response = await fetch(url + search);
    assert.equal(response.status, status === 429 ? 429 : 502);
    const body = await response.text();
    assert.equal(body.includes('private-test-key'), false);
    assert.equal(body.includes('provider error'), false);
    assert.equal(
      JSON.parse(body).error.code,
      status === 429 ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_ERROR',
    );
  }
  const url = await proxy(t, {
    fetchImpl: async () => {
      throw Error('private-test-key');
    },
  });
  assert.equal((await (await fetch(url + search)).json()).error.code, 'UPSTREAM_UNAVAILABLE');
});

test('bounds upstream JSON including chunked bodies and cancels invalid streams', async (t) => {
  for (const response of [
    new Response('{}', { headers: { 'content-type': 'text/html' } }),
    new Response('not JSON', { headers: { 'content-type': 'application/json' } }),
    new Response('[]', { headers: { 'content-type': 'application/json' } }),
    new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-length': 10 * 1024 * 1024 + 1 },
    }),
  ]) {
    const url = await proxy(t, { fetchImpl: async () => response });
    assert.equal(
      (await (await fetch(url + search)).json()).error.code,
      'INVALID_UPSTREAM_RESPONSE',
    );
  }
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(10 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
  const url = await proxy(t, { fetchImpl: async () => response });
  assert.equal((await fetch(url + search)).status, 502);
  assert.equal(cancelled, true);
});

test('timeout aborts upstream fetch and stalled response body, even when fetch ignores signal', async (t) => {
  for (const bodyStall of [false, true]) {
    let signal;
    const url = await proxy(t, {
      timeoutMs: 30,
      fetchImpl: async (_, options) => {
        signal = options.signal;
        return bodyStall
          ? new Response(new ReadableStream({}), {
              headers: { 'content-type': 'application/json' },
            })
          : new Promise(() => {});
      },
    });
    const response = await fetch(url + search);
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, 'UPSTREAM_TIMEOUT');
    assert.equal(signal.aborted, true);
  }
});

test('client disconnect cancels the native upstream request', async (t) => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let aborted;
  const cancelled = new Promise((resolve) => {
    aborted = resolve;
  });
  const upstream = await listen(
    t,
    createServer((req, res) => {
      res.once('close', aborted);
      started();
    }),
  );
  const url = await proxy(t, { base: upstream, fetchImpl: fetch, timeoutMs: 1000 });
  const client = request(url + search);
  client.on('error', () => {});
  client.end();
  await ready;
  client.destroy();
  await Promise.race([
    cancelled,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(Error('Upstream was not cancelled')), 500);
      timer.unref();
      cancelled.then(() => clearTimeout(timer));
    }),
  ]);
});

test('native fetch does not follow redirects carrying private authorization', async (t) => {
  let destinationCalled = false;
  const destination = await listen(
    t,
    createServer((req, res) => {
      destinationCalled = true;
      res.end('{}');
    }),
  );
  const upstream = await listen(
    t,
    createServer((req, res) => {
      res.writeHead(302, { location: destination });
      res.end();
    }),
  );
  const url = await proxy(t, { base: upstream, fetchImpl: fetch });
  assert.equal((await fetch(url + search)).status, 502);
  assert.equal(destinationCalled, false);
});

test('static SPA hosting supports HEAD, MIME/cache policy, and safe HTML-only fallback', async (t) => {
  const fixture = fileURLToPath(new URL(`./.fixtures-${process.pid}/`, import.meta.url));
  const dist = fixture + 'dist';
  await mkdir(dist + '/assets', { recursive: true });
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await Promise.all([
    writeFile(dist + '/index.html', '<!doctype html><h1>Roamlet</h1>'),
    writeFile(dist + '/assets/app-123.js', 'export const ready = true;'),
    writeFile(dist + '/sw.js', '/* service worker */'),
    writeFile(dist + '/.env', 'DO_NOT_EXPOSE'),
    writeFile(dist + '/assets/app-123.js.map', 'DO_NOT_EXPOSE'),
    writeFile(fixture + 'outside.txt', 'DO_NOT_EXPOSE'),
  ]);
  await symlink(fixture + 'outside.txt', dist + '/escape.txt');
  const url = await proxy(t, { distPath: dist });
  for (const path of ['/', '/planner/loop']) {
    const response = await fetch(url + path, { headers: { accept: 'text/html' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.match(await response.text(), /Roamlet/);
  }
  // Service-worker installation fetches the root with Accept: */*, not text/html.
  for (const headers of [{}, { accept: '*/*' }, { accept: 'application/json' }]) {
    const root = await fetch(url + '/', { headers });
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type'), /text\/html/);
    assert.equal(root.headers.get('cache-control'), 'no-cache');
    assert.equal(root.headers.get('content-security-policy'), null);
    assert.match(await root.text(), /Roamlet/);
  }
  const rootHead = await fetch(url + '/', { method: 'HEAD' });
  assert.equal(rootHead.status, 200);
  assert.equal(await rootHead.text(), '');
  const worker = await fetch(url + '/sw.js', {
    headers: { accept: '*/*', 'service-worker': 'script' },
  });
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get('content-type'), /text\/javascript/);
  assert.equal(worker.headers.get('cache-control'), 'no-cache');
  assert.equal(worker.headers.get('content-security-policy'), null);
  const asset = await fetch(url + '/assets/app-123.js', { method: 'HEAD' });
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /text\/javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal(asset.headers.get('content-length'), '26');
  assert.equal(await asset.text(), '');
  assert.equal((await fetch(url + '/sw.js')).headers.get('cache-control'), 'no-cache');
  for (const path of [
    '/missing.js',
    '/assets/missing.js',
    '/assets/app-123.js.map',
    '/.env',
    '/%2eenv',
    '/src/main.js',
    '/source/main.js',
    '/escape.txt',
    '/../outside.txt',
    '/%2e%2e/outside.txt',
    '/assets/%2e%2e/%2e%2e/outside.txt',
    '/..%5coutside.txt',
    '/%00',
    '/api/not-real',
  ]) {
    const result = await raw(url, path, { headers: { accept: 'text/html' } });
    assert.equal(result.status, 404, path);
    assert.equal(result.body.includes('DO_NOT_EXPOSE'), false);
    assert.equal(result.body.includes('Roamlet'), false);
  }
  assert.equal(
    (await fetch(url + '/planner', { headers: { accept: 'application/json' } })).status,
    404,
  );
  assert.equal(
    (await fetch(url + '/planner', { headers: { accept: 'text/html;q=0' } })).status,
    404,
  );
  assert.equal(
    (await fetch(url + '/planner', { method: 'POST', headers: { accept: 'text/html' } })).status,
    405,
  );
  assert.equal(
    (await fetch(url + '/planner', { method: 'HEAD', headers: { accept: 'text/html' } })).status,
    200,
  );
});

test('factory validates server-only base and bounds; missing dist stays safe', async (t) => {
  for (const base of [
    'file:///etc',
    'https://example.org/path',
    'https://user:pass@example.org',
    'https://example.org?key=secret',
    'https://example.org#fragment',
  ])
    assert.throws(() => createProxyServer({ base }));
  for (const options of [
    { rateLimit: 0 },
    { timeoutMs: 25001 },
    { rateWindowMs: -1 },
    { maxRateEntries: 0 },
  ])
    assert.throws(() => createProxyServer(options));
  const server = createProxyServer({ key: '' });
  assert.equal(server.listening, false);
  server.close();
  const url = await proxy(t, {
    distPath: fileURLToPath(new URL('./does-not-exist/', import.meta.url)),
  });
  assert.equal((await fetch(url, { headers: { accept: 'text/html' } })).status, 404);
});
