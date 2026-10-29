import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { Readable } from 'node:stream';
import { createServer, request as httpRequest } from 'node:http';
import { routeHandler, configHandler } from './routing.mjs';
import routeApi from '../api/route.mjs';
import configApi from '../api/routing-config.mjs';

const SECRET = 'server-only-secret-DO-NOT-REFLECT';
const body = () => ({
  profile: 'cycling-regular', coordinates: [[13, 52], [13.1, 52.1]],
  instructions: false, elevation: true,
});
const geojson = () => ({
  type: 'FeatureCollection', metadata: { key: SECRET }, bbox: [SECRET],
  features: [{
    type: 'Feature', id: SECRET,
    geometry: { type: 'LineString', coordinates: [[13, 52, 123], [13.1, 52.1, 125]], secret: SECRET },
    properties: { summary: { distance: 1000, duration: 200, key: SECRET }, segments: [SECRET] },
  }],
});
const cleanGeojson = () => ({
  type: 'FeatureCollection', features: [{
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[13, 52, 123], [13.1, 52.1, 125]] },
    properties: { summary: { distance: 1000, duration: 200 } },
  }],
});

beforeEach((t) => {
  const previous = process.env.ORS_API_KEY;
  process.env.ORS_API_KEY = `  ${SECRET} \n`;
  t.after(() => {
    if (previous === undefined) delete process.env.ORS_API_KEY;
    else process.env.ORS_API_KEY = previous;
  });
  t.mock.method(globalThis, 'fetch', async () => Response.json(geojson()));
});

async function invoke(handler = routeHandler, overrides = {}) {
  const req = {
    method: handler === configHandler || handler === configApi ? 'GET' : 'POST',
    headers: { host: 'localhost:3000', 'content-type': 'application/json' },
    body: body(), ...overrides,
  };
  const headers = {};
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(value) { this.raw = value; },
  };
  await handler(req, res);
  assert.equal(headers['cache-control'], 'no-store');
  assert.match(headers['content-type'], /^application\/json/);
  assert.equal(headers['access-control-allow-origin'], undefined);
  assert.ok(!res.raw.includes(SECRET));
  return { status: res.statusCode, headers, data: JSON.parse(res.raw) };
}

function fetchCalls() { return globalThis.fetch.mock.calls; }

for (const handler of [configHandler, configApi]) {
  test(`${handler.name} reports only availability, never calls upstream`, async () => {
    assert.deepEqual((await invoke(handler)).data, { available: true });
    process.env.ORS_API_KEY = ' \n ';
    assert.deepEqual((await invoke(handler)).data, { available: false });
    delete process.env.ORS_API_KEY;
    assert.deepEqual((await invoke(handler)).data, { available: false });
    assert.equal(fetchCalls().length, 0);
  });
}

for (const profile of ['cycling-regular', 'cycling-road', 'cycling-mountain', 'foot-hiking']) {
  test(`forwards only known routing fields for ${profile}`, async () => {
    const input = {
      ...body(), profile, options: { avoid_features: ['ferries', 'steps'] },
      alternative_routes: { target_count: 2, weight_factor: 1.4, share_factor: 0.6 },
    };
    const result = await invoke(routeApi, {
      body: input,
      headers: { host: 'localhost:3000', 'content-type': 'application/json; charset=utf-8',
        authorization: 'incoming-key', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, cleanGeojson());
    const [url, options] = fetchCalls()[0].arguments;
    assert.equal(url, `https://api.heigit.org/openrouteservice/v2/directions/${profile}/geojson`);
    assert.ok(!url.includes(SECRET));
    assert.equal(options.headers.Authorization, SECRET);
    assert.equal(options.headers.Accept, 'application/geo+json');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal);
    const expected = { ...input };
    delete expected.profile;
    assert.deepEqual(JSON.parse(options.body), expected);
    assert.ok(!options.body.includes(SECRET));
    assert.ok(!JSON.stringify(options).includes('incoming-key'));
  });
}

test('supports optional omissions, each avoid feature, empty avoids, and 25 coordinates', async () => {
  for (const avoid_features of [undefined, [], ['steps'], ['ferries']]) {
    const input = { ...body(), coordinates: Array.from({ length: 25 }, () => [180, -90]) };
    if (avoid_features) input.options = { avoid_features };
    assert.equal((await invoke(routeHandler, { body: input })).status, 200);
  }
});

test('missing or whitespace key returns sanitized 503 without fetching', async () => {
  for (const key of [undefined, '', ' \n ']) {
    if (key === undefined) delete process.env.ORS_API_KEY;
    else process.env.ORS_API_KEY = key;
    const result = await invoke();
    assert.equal(result.status, 503);
    assert.deepEqual(result.data, {
      error: { code: 'ROUTING_NOT_CONFIGURED', message: 'The routing service is unavailable.' },
    });
  }
  assert.equal(fetchCalls().length, 0);
});

const invalidBodies = [
  null, [], {}, 'not json', { ...body(), key: SECRET }, { ...body(), authorization: SECRET },
  { ...body(), profile: 'driving-car' }, { ...body(), profile: '../cycling-road' },
  { ...body(), instructions: true }, { ...body(), instructions: undefined },
  { ...body(), elevation: false }, { ...body(), elevation: undefined },
  { ...body(), coordinates: [[0, 0]] },
  { ...body(), coordinates: Array.from({ length: 26 }, () => [0, 0]) },
  ...[[181, 0], [0, -91], [0, 0, 5], [0], ['0', 0], [NaN, 0], [Infinity, 0],
    Object.assign(new Array(2), { 0: 0 }), null].map((point) => ({ ...body(), coordinates: [[0, 0], point] })),
  ...[null, {}, [], { avoid_features: ['highways'] }, { avoid_features: ['ferries', 'ferries'] },
    { avoid_features: ['steps', 'ferries', 'steps'] }, { avoid_features: 'steps' },
    { avoid_features: [], profile_params: {} }, { avoid_features: [], avoid_polygons: {} },
    { avoid_features: [SECRET] }].map((options) => ({ ...body(), options })),
  ...[null, {}, { target_count: 3, weight_factor: 1.4, share_factor: 0.6 },
    { target_count: 2, weight_factor: 2, share_factor: 0.6 },
    { target_count: 2, weight_factor: 1.4, share_factor: 0.7 },
    { target_count: 2, weight_factor: 1.4, share_factor: 0.6, secret: SECRET },
  ].map((alternative_routes) => ({ ...body(), alternative_routes })),
];

test('rejects malformed bodies and all unknown fields/options before upstream', async () => {
  for (const input of invalidBodies) {
    assert.equal((await invoke(routeHandler, { body: input })).status, 400);
  }
  assert.equal(fetchCalls().length, 0);
});

test('methods and content types are restricted on both endpoints', async () => {
  for (const handler of [routeHandler, configHandler]) {
    for (const method of ['PUT', 'HEAD', 'OPTIONS', 'DELETE']) {
      const result = await invoke(handler, { method });
      assert.equal(result.status, 405);
      assert.equal(result.headers.allow, handler === routeHandler ? 'POST' : 'GET');
    }
  }
  for (const type of ['', 'text/plain', 'application/geo+json', 'application/jsonp']) {
    assert.equal((await invoke(routeHandler, {
      headers: { host: 'localhost:3000', 'content-type': type },
    })).status, 415);
  }
  assert.equal(fetchCalls().length, 0);
});

test('rejects cross-origin and cross-site requests without CORS; permits same-origin HTTPS', async () => {
  for (const handler of [routeHandler, configHandler]) {
    for (const extra of [
      { origin: 'https://evil.example' }, { origin: 'null' }, { origin: 'bad-url' },
      { origin: 'http://localhost:3000/' }, { origin: ['http://localhost:3000'] },
      { origin: 'https://localhost:3000' }, { 'sec-fetch-site': 'cross-site' },
      { origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' },
    ]) {
      assert.equal((await invoke(handler, { headers: {
        host: 'localhost:3000', 'content-type': 'application/json', ...extra,
      } })).status, 403);
    }
    assert.equal((await invoke(handler, { headers: {
      host: 'example.test', origin: 'https://example.test', 'x-forwarded-proto': 'https',
      'content-type': 'application/json',
    } })).status, 200);
  }
});

test('bounds parsed objects, buffers, and raw strings by UTF-8 bytes', async () => {
  for (const input of [JSON.stringify(body()), Buffer.from(JSON.stringify(body()))]) {
    assert.equal((await invoke(routeHandler, { body: input })).status, 200);
  }
  const json = JSON.stringify(body());
  assert.equal((await invoke(routeHandler, { body: json.padEnd(16 * 1024) })).status, 200);
  for (const input of [json.padEnd(16 * 1024 + 1), Buffer.alloc(16 * 1024 + 1),
    { ...body(), unknown: 'é'.repeat(9000) }]) {
    assert.equal((await invoke(routeHandler, { body: input })).status, 413);
  }
  assert.equal((await invoke(routeHandler, { headers: {
    host: 'localhost:3000', 'content-type': 'application/json', 'content-length': '16385',
  } })).status, 413);
});

test('Connect-style actual HTTP streams accept valid JSON and reject oversized or malformed streams', async (t) => {
  const server = createServer((req, res) => { void routeHandler(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function post(chunks) {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: server.address().port,
        method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(raw) }));
      });
      req.on('error', reject);
      for (const chunk of chunks) req.write(chunk);
      req.end();
    });
  }
  const json = JSON.stringify(body());
  for (const [chunks, status] of [[[json.slice(0, 20), json.slice(20)], 200],
    [[json.padEnd(16384)], 200], [['{bad'], 400], [[''], 400],
    [[' '.repeat(10000), ' '.repeat(10000)], 413]]) {
    const result = await post(chunks);
    assert.equal(result.status, status);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.ok(!JSON.stringify(result.data).includes(SECRET));
  }
});

test('handles aborted and errored incoming streams', async () => {
  for (const event of ['error', 'aborted']) {
    const req = new Readable({ read() {} });
    req.method = 'POST';
    req.headers = { 'content-type': 'application/json' };
    const headers = {};
    const res = { setHeader(k, v) { headers[k] = v; }, end(raw) { this.raw = raw; } };
    const result = routeHandler(req, res);
    req.emit(event, new Error(SECRET));
    await result;
    assert.equal(res.statusCode, 400);
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.ok(!res.raw.includes(SECRET));
  }
});

for (const status of [401, 403, 429, 500]) {
  test(`sanitizes upstream HTTP ${status} without leaking messages`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(SECRET, { status }));
    const result = await invoke();
    assert.equal(result.status, status === 500 ? 502 : status);
    assert.deepEqual(Object.keys(result.data.error), ['message']);
  });
}

for (const code of [2004, 2009, 2010]) {
  test(`preserves safe ORS code ${code} for client limit/no-route handling`, async (t) => {
    for (const status of [400, 404, 200]) {
      t.mock.method(globalThis, 'fetch', async () => Response.json({
        error: { code, message: SECRET }, secret: SECRET,
      }, { status }));
      const result = await invoke();
      assert.equal(result.status, status === 200 ? 502 : status);
      assert.equal(result.data.error.code, code);
    }
  });
}

test('unknown upstream codes and exception text are never returned or logged', async (t) => {
  const logs = ['log', 'warn', 'error', 'info', 'debug'].map((name) => t.mock.method(console, name, () => {}));
  for (const code of [SECRET, 'ROUTING_NOT_CONFIGURED']) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code, message: SECRET } }, { status: 400 }));
    assert.deepEqual(Object.keys((await invoke()).data.error), ['message']);
  }
  for (const error of [new TypeError(SECRET), new Error(SECRET)]) {
    t.mock.method(globalThis, 'fetch', async () => { throw error; });
    assert.equal((await invoke()).status, 502);
  }
  for (const log of logs) assert.equal(log.mock.calls.length, 0);
});

test('upstream timeout is 20 seconds and aborts even a noncooperative fetch', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  const pending = invoke();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.ok(signal);
  t.mock.timers.tick(19_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal((await pending).status, 504);
  assert.equal(signal.aborted, true);
});

test('timeout includes upstream response body consumption', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options.signal;
    return Promise.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  });
  const pending = invoke();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  t.mock.timers.tick(20_000);
  assert.equal((await pending).status, 504);
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test('sanitizes valid 2D geometry, multiple alternatives, and empty no-route collections', async (t) => {
  const data = geojson();
  data.features[0].geometry.coordinates = [[180, -90], [-180, 90]];
  data.features.push(structuredClone(data.features[0]));
  t.mock.method(globalThis, 'fetch', async () => Response.json(data));
  assert.equal((await invoke()).data.features.length, 2);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ type: 'FeatureCollection', features: [], key: SECRET }));
  assert.deepEqual((await invoke()).data, { type: 'FeatureCollection', features: [] });
});

test('rejects invalid GeoJSON type, geometry, statistics and excessive features', async (t) => {
  const invalid = [null, { type: 'FeatureCollection', features: {} }];
  for (const mutate of [
    (d) => { d.type = 'Feature'; }, (d) => { d.features[0].type = 'Point'; },
    (d) => { d.features[0].geometry.type = 'MultiLineString'; },
    (d) => { d.features[0].geometry.coordinates = [[0, 0]]; },
    (d) => { d.features[0].geometry.coordinates = [[0, 0], [181, 0]]; },
    (d) => { d.features[0].geometry.coordinates = [[0, 0], [0, 91]]; },
    (d) => { d.features[0].geometry.coordinates = [[0, 0], [0, 0, SECRET]]; },
    (d) => { d.features[0].geometry.coordinates = [[0, 0], [0, 0, 1, 2]]; },
    (d) => { d.features[0].properties.summary.distance = -1; },
    (d) => { d.features[0].properties.summary.duration = SECRET; },
    (d) => { delete d.features[0].properties.summary; },
    (d) => { d.features = Array(4).fill(d.features[0]); },
  ]) {
    const data = geojson(); mutate(data); invalid.push(data);
  }
  for (const data of invalid) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(data));
    assert.equal((await invoke()).status, 502);
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('{"type": "FeatureCollection", "features": [{"geometry": {"coordinates": [[1e999, 0]]}}]}'));
  assert.equal((await invoke()).status, 502);
});

test('caps upstream stream at 8 MiB and cancels oversized responses', async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  })));
  assert.equal((await invoke()).status, 502);
  assert.equal(cancelled, true);
  t.mock.method(globalThis, 'fetch', async () => new Response(SECRET, { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }));
  assert.equal((await invoke()).status, 502);
  t.mock.method(globalThis, 'fetch', async () => new Response(null));
  assert.equal((await invoke()).status, 502);
});
