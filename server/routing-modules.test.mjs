import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOrsClient } from './ors-client.mjs';
import { createRoutingHandlers } from './routing.mjs';
import { routingApiKey } from './routing-config.mjs';
import { reply } from './routing-http.mjs';

const body = () => ({
  profile: 'foot-hiking',
  coordinates: [
    [13, 52],
    [13.1, 52.1],
  ],
  instructions: false,
  elevation: true,
});
const geojson = () => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [13, 52],
          [13.1, 52.1],
        ],
      },
      properties: { summary: { distance: 1000, duration: 200 } },
    },
  ],
});
function response() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.raw = value;
    },
  };
}
async function invoke(handler, overrides = {}) {
  const req = {
    method: 'POST',
    headers: { host: 'localhost', 'content-type': 'application/json' },
    body: body(),
    ...overrides,
  };
  const res = response();
  await handler(req, res);
  return { ...res, data: JSON.parse(res.raw) };
}

test('configuration accepts an explicit environment without changing process state', () => {
  assert.equal(routingApiKey({ ORS_API_KEY: '  test-key\n' }), 'test-key');
  for (const value of [undefined, null, 123, '', ' \n']) {
    assert.equal(routingApiKey({ ORS_API_KEY: value }), '');
  }
});

test('handlers and ORS client work with isolated dependencies', async () => {
  const calls = [];
  const logs = [];
  const requestRoute = createOrsClient({
    fetcher: async (...args) => {
      calls.push(args);
      return Response.json(geojson());
    },
  });
  const handlers = createRoutingHandlers({
    getApiKey: () => 'injected-key',
    requestRoute,
    logger: (entry) => logs.push(entry),
  });
  const config = await invoke(handlers.configHandler, { method: 'GET' });
  assert.deepEqual(config.data, { available: true });
  assert.equal(calls.length, 0);
  const result = await invoke(handlers.routeHandler);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.data, geojson());
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].headers.Authorization, 'injected-key');
  assert.deepEqual(JSON.parse(calls[0][1].body).coordinates, body().coordinates);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].requestId, result.headers['x-request-id']);
  assert.match(logs[0].requestId, /^[\da-f-]{36}$/);
  assert.equal(logs[0].category, 'success');
  assert.ok(logs[0].durationMs >= 0);
  assert.ok(!JSON.stringify(logs).includes('injected-key'));
  assert.ok(!JSON.stringify(logs).includes('coordinates'));
});

test('validation and configuration failures do not call the provider', async () => {
  const { routeHandler } = createRoutingHandlers({
    getApiKey: () => '',
    requestRoute: () => {
      throw new Error('Must not call provider');
    },
    logger: () => {},
  });
  for (const [overrides, status, code] of [
    [{ body: {} }, 400, 'INVALID_REQUEST'],
    [{ method: 'GET' }, 405, 'METHOD_NOT_ALLOWED'],
    [{ headers: { 'content-type': 'text/plain' } }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403, 'FORBIDDEN'],
    [{ body: 'x'.repeat(16 * 1024 + 1) }, 413, 'REQUEST_TOO_LARGE'],
    [{}, 503, 'ROUTING_NOT_CONFIGURED'],
  ]) {
    const result = await invoke(routeHandler, overrides);
    assert.equal(result.statusCode, status);
    assert.equal(result.data.error.code, code);
  }
});

test('provider credentials and quota failures are service errors, not user authorization errors', async () => {
  for (const status of [401, 403, 429]) {
    let cancelled = false;
    const client = createOrsClient({
      fetcher: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status },
        ),
    });
    const result = await client({ profile: 'foot-hiking', upstream: {} }, 'injected-key');
    assert.equal(result.status, 503);
    assert.equal(
      result.category,
      status === 429 ? 'upstream_rate_limited' : 'upstream_credentials',
    );
    assert.equal(cancelled, true);
  }
});

test('injected timeout cancels provider requests and releases its timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const client = createOrsClient({
    timeout: 10,
    fetcher: (_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  const pending = client({ profile: 'foot-hiking', upstream: {} }, 'injected-key');
  t.mock.timers.tick(10);
  const result = await pending;
  assert.equal(result.status, 504);
  assert.equal(result.category, 'upstream_timeout');
  assert.equal(signal.aborted, true);
});

test('serialized response limit uses UTF-8 bytes and includes JSON overhead', () => {
  const limit = 4 * 1024 * 1024;
  const res = response();
  reply(res, 200, 'a'.repeat(limit - 2));
  assert.equal(res.statusCode, 200);
  assert.equal(Buffer.byteLength(res.raw), limit);
  for (const value of ['a'.repeat(limit - 1), 'я'.repeat(limit / 2)]) {
    const oversized = response();
    reply(oversized, 200, value);
    assert.equal(oversized.statusCode, 502);
    assert.equal(JSON.parse(oversized.raw).error.code, 'UPSTREAM_RESPONSE_TOO_LARGE');
    assert.ok(Buffer.byteLength(oversized.raw) < limit);
    assert.equal(oversized.headers['cache-control'], 'no-store');
  }
});

test('oversized valid geometry returns a bounded error and accurate metadata', async () => {
  const data = geojson();
  data.features[0].geometry.coordinates = Array(700_000).fill([0, 0]);
  const logs = [];
  const { routeHandler } = createRoutingHandlers({
    getApiKey: () => 'injected-key',
    requestRoute: createOrsClient({ fetcher: async () => Response.json(data) }),
    logger: (entry) => logs.push(entry),
  });
  const result = await invoke(routeHandler);
  assert.equal(result.statusCode, 502);
  assert.equal(result.data.error.code, 'UPSTREAM_RESPONSE_TOO_LARGE');
  assert.equal(logs[0].category, 'upstream_response_too_large');
  assert.equal(logs[0].status, 502);
});

test('logging failure cannot break a successful routing response', async () => {
  const { routeHandler } = createRoutingHandlers({
    getApiKey: () => 'injected-key',
    requestRoute: createOrsClient({ fetcher: async () => Response.json(geojson()) }),
    logger: () => {
      throw new Error('Logging unavailable');
    },
  });
  const result = await invoke(routeHandler);
  assert.equal(result.statusCode, 200);
});
