import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import aiApi from '../api/ai.mjs';
import { createAiHandler } from './ai-handlers.mjs';
import { RESPONSE_LIMIT } from './ai-client.mjs';
import { REQUEST_LIMIT } from './ai-http.mjs';
import { aiConfig, cookie, cookieName, openCookie, seal, SESSION_SECONDS } from './ai-session.mjs';
import {
  cookie as driveCookie,
  googleDriveConfig,
  seal as driveSeal,
} from './google-drive-session.mjs';

const NOW = 1800000000000;
const ORIGIN = 'https://roamlet.example';
const BASE = 'https://api.openai.com/v1';
const KEY = 'synthetic-ai-key-not-real';
const MODEL = 'synthetic-model';
const env = () => ({
  AI_ORIGIN: ORIGIN,
  AI_SESSION_SECRET: Buffer.alloc(32, 19).toString('base64'),
});
const config = () => aiConfig(env());
const settings = () => ({ baseUrl: BASE, model: MODEL, apiKey: KEY });
const input = () => ({
  prompt: 'Avoid ferries.',
  context: {
    activity: 'cycling',
    routingOptions: { cyclingProfile: 'cycling-regular', avoidFerries: false, avoidSteps: false },
  },
});
const output = () => ({
  routingOptions: { avoidFerries: true },
  explanation: 'Avoid ferries on future routing requests.',
});
const completion = (content = 'OK', overrides = {}) => ({
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  ...overrides,
});
const session = (overrides = {}, cfg = config(), purpose) =>
  cookie(
    cfg,
    seal(
      cfg,
      { ...settings(), issuedAt: NOW - 1000, expiresAt: NOW + 60000, ...overrides },
      purpose,
    ),
    60,
  ).split(';')[0];
function fixture({ fetcher, cfg = config(), timeoutMs, now = () => NOW } = {}) {
  const calls = [];
  return {
    calls,
    handler: createAiHandler({
      getConfig: () => cfg,
      now,
      timeoutMs,
      fetcher: async (url, init) => {
        calls.push({ url, init });
        return fetcher ? fetcher(url, init) : Response.json(completion(JSON.stringify(output())));
      },
    }),
  };
}
async function invoke(
  handler,
  action = 'session',
  {
    method = action === 'session' ? 'GET' : 'POST',
    headers = {},
    body = {},
    req = new EventEmitter(),
    url,
    onResponse,
  } = {},
) {
  Object.assign(req, {
    method,
    url: url ?? `/api/ai?action=${action}`,
    headers: {
      host: 'roamlet.example',
      origin: ORIGIN,
      'x-roamlet-request': '1',
      'content-type': 'application/json',
      cookie: session(),
      ...headers,
    },
  });
  if (body !== undefined) req.body = body;
  const res = new EventEmitter();
  const responseHeaders = {};
  res.setHeader = (name, value) => {
    responseHeaders[name.toLowerCase()] = value;
  };
  res.end = (value) => {
    res.raw = value;
    res.writableEnded = true;
  };
  onResponse?.(req, res);
  await handler(req, res);
  assert.equal(responseHeaders['cache-control'], 'no-store');
  assert.equal(responseHeaders['referrer-policy'], 'no-referrer');
  assert.equal(responseHeaders['x-content-type-options'], 'nosniff');
  assert.equal(responseHeaders['access-control-allow-origin'], undefined);
  assert.ok(!JSON.stringify(responseHeaders).includes(KEY));
  assert.ok(!String(res.raw).includes(KEY));
  return { status: res.statusCode, data: JSON.parse(res.raw), headers: responseHeaders, req, res };
}
function error(result, code, status) {
  assert.equal(result.status, status);
  assert.deepEqual(result.data, { error: { code, message: 'AI connector request failed.' } });
}

test('configuration requires canonical key, safe app origin and bounded admin HTTPS allowlist', () => {
  assert.ok(config());
  assert.deepEqual(config().providers, [BASE]);
  for (const change of [
    { AI_ORIGIN: undefined },
    { AI_ORIGIN: 'http://roamlet.example' },
    { AI_ORIGIN: `${ORIGIN}/` },
    { AI_ORIGIN: `${ORIGIN}/api/ai` },
    { AI_ORIGIN: `${ORIGIN}?x` },
    { AI_ORIGIN: `${ORIGIN}#x` },
    { AI_ORIGIN: 'https://user:password@roamlet.example' },
    { AI_SESSION_SECRET: '' },
    { AI_SESSION_SECRET: Buffer.alloc(31).toString('base64') },
    { AI_SESSION_SECRET: Buffer.alloc(32).toString('base64').replace(/=/g, '') },
  ])
    assert.equal(aiConfig({ ...env(), ...change }), null);
  for (const AI_ORIGIN of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'])
    assert.equal(aiConfig({ ...env(), AI_ORIGIN }).secure, false);
  for (const providers of [
    [],
    [BASE, BASE],
    Array.from({ length: 17 }, (_, i) => `https://provider${i}.example/v1`),
    ['http://public.example/v1'],
    ['https://localhost/v1'],
    ['https://localhost.example.local/v1'],
    ['https://127.0.0.1/v1'],
    ['https://2130706433/v1'],
    ['https://[::1]/v1'],
    ['https://10.0.0.1/v1'],
    ['https://169.254.169.254/v1'],
    ['https://192.168.1.1/v1'],
    ['https://provider.internal/v1'],
    ['https://user:secret@provider.example/v1'],
    [`${BASE}?key=x`],
    [`${BASE}#x`],
    ['https://provider.example/a/../v1'],
    ['https://provider.example/%2e%2e/v1'],
    ['https://provider.example:8443/v1'],
    ['https://provider/v1'],
    ['https://provider.example./v1'],
  ])
    assert.equal(aiConfig({ ...env(), AI_PROVIDER_URLS: JSON.stringify(providers) }), null);
  for (const AI_PROVIDER_URLS of ['not JSON', '{}', 'null', '[123]'])
    assert.equal(aiConfig({ ...env(), AI_PROVIDER_URLS }), null);
  const providers = ['https://provider.example', 'https://other.example/api/v1/'];
  assert.deepEqual(
    aiConfig({ ...env(), AI_PROVIDER_URLS: JSON.stringify(providers) }).providers,
    providers,
  );
});

test('session availability is local, provider list and connection metadata never expose key', async () => {
  const fx = fixture();
  assert.deepEqual((await invoke(fx.handler)).data, {
    available: true,
    connected: true,
    providers: [BASE],
    connection: { baseUrl: BASE, model: MODEL },
  });
  const disconnected = await invoke(fx.handler, 'session', { headers: { cookie: '' } });
  assert.deepEqual(disconnected.data, { available: true, connected: false, providers: [BASE] });
  assert.match(disconnected.headers['set-cookie'], /Max-Age=0/);
  assert.deepEqual((await invoke(fixture({ cfg: null }).handler)).data, {
    available: false,
    connected: false,
    providers: [],
  });
  error(
    await invoke(fixture({ cfg: null }).handler, 'connect', { body: settings() }),
    'unavailable',
    503,
  );
  assert.equal(fx.calls.length, 0);
});

test('session encryption is purpose/origin/key bound, capped at one hour and independent of Drive', () => {
  const cfg = config();
  assert.equal(openCookie({ headers: { cookie: session() } }, cfg, NOW)?.apiKey === KEY, true);
  for (const overrides of [
    { expiresAt: NOW },
    { issuedAt: NOW + 1 },
    { expiresAt: NOW + SESSION_SECONDS * 1000 },
    { issuedAt: NOW - 1000.5 },
    { expiresAt: 'future' },
    { apiKey: 'bad\nkey' },
    { baseUrl: 'https://unapproved.example/v1' },
    { model: '' },
    { extra: true },
  ])
    assert.equal(openCookie({ headers: { cookie: session(overrides) } }, cfg, NOW), null);
  for (const raw of [
    session({}, cfg, 'state'),
    `${session()}; ${session()}`,
    `${cookieName(cfg)}=invalid`,
    `${cookieName(cfg)}=${'a'.repeat(3801)}`,
    session().replace(/.$/, '!'),
  ])
    assert.equal(openCookie({ headers: { cookie: raw } }, cfg, NOW), null);
  for (const changed of [
    { ...cfg, origin: 'https://other.example' },
    { ...cfg, key: Buffer.alloc(32, 21) },
    { ...cfg, providers: ['https://other.example/v1'] },
  ])
    assert.equal(openCookie({ headers: { cookie: session() } }, changed, NOW), null);
  const drive = googleDriveConfig({
    GOOGLE_DRIVE_CLIENT_ID: 'synthetic',
    GOOGLE_DRIVE_CLIENT_SECRET: 'synthetic',
    GOOGLE_DRIVE_CALLBACK_URL: `${ORIGIN}/api/google-drive?action=callback`,
    GOOGLE_DRIVE_SESSION_SECRET: env().AI_SESSION_SECRET,
  });
  const alien = driveCookie(
    drive,
    'session',
    driveSeal(drive, 'session', { token: KEY, issuedAt: NOW, expiresAt: NOW + 1000 }),
    1,
  ).split(';')[0];
  assert.equal(openCookie({ headers: { cookie: alien } }, cfg, NOW), null);
  assert.match(
    cookie(cfg, '', 99999),
    /^__Host-roamlet-ai-session=; Path=\/; Max-Age=3600; HttpOnly; SameSite=Lax; Secure$/,
  );
});

test('connect verifies tiny fixed chat request then persists encrypted access without renewal', async () => {
  let time = NOW;
  const fx = fixture({
    now: () => time,
    fetcher: () => {
      time += 2000;
      return Response.json(completion());
    },
  });
  const result = await invoke(fx.handler, 'connect', { body: settings(), headers: { cookie: '' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { connected: true, connection: { baseUrl: BASE, model: MODEL } });
  assert.match(result.headers['set-cookie'], /Max-Age=3598; HttpOnly; SameSite=Lax; Secure/);
  const payload = openCookie({ headers: { cookie: result.headers['set-cookie'] } }, config(), time);
  assert.equal(payload.apiKey === KEY, true);
  assert.equal(payload.expiresAt, NOW + SESSION_SECONDS * 1000);
  assert.equal(fx.calls.length, 1);
  const { url, init } = fx.calls[0];
  assert.equal(url, `${BASE}/chat/completions`);
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.equal(init.credentials, 'omit');
  assert.deepEqual(Object.keys(init.headers).sort(), ['Accept', 'Authorization', 'Content-Type']);
  assert.equal(init.headers.Authorization === `Bearer ${KEY}`, true);
  const request = JSON.parse(init.body);
  assert.equal(request.model, MODEL);
  assert.equal(request.max_tokens, 8);
  assert.equal(request.n, 1);
  assert.equal(request.stream, false);
  assert.equal(request.messages.length, 2);
  assert.equal(request.response_format, undefined);
  const status = await invoke(fx.handler, 'session', {
    headers: { cookie: result.headers['set-cookie'] },
  });
  assert.equal(status.headers['set-cookie'], undefined);
  assert.equal(fx.calls.length, 1);
});

test('connect allowlist rejects arbitrary targets, credentials, headers and bad bounded fields before fetch', async () => {
  const fx = fixture();
  for (const body of [
    null,
    [],
    {},
    { ...settings(), baseUrl: 'https://unapproved.example/v1' },
    { ...settings(), baseUrl: `${BASE}/chat/completions` },
    { ...settings(), model: '' },
    { ...settings(), model: 'x'.repeat(129) },
    { ...settings(), model: 'bad model' },
    { ...settings(), apiKey: '' },
    { ...settings(), apiKey: 'x'.repeat(1025) },
    { ...settings(), apiKey: 'bad\r\nheader' },
    { ...settings(), headers: {} },
    { ...settings(), url: BASE },
  ])
    error(await invoke(fx.handler, 'connect', { body }), 'invalid-data', 400);
  assert.equal(fx.calls.length, 0);
  const cfg = aiConfig({ ...env(), AI_PROVIDER_URLS: '["https://compatible.example/custom/v1/"]' });
  const custom = fixture({ cfg, fetcher: () => Response.json(completion()) });
  assert.equal(
    (
      await invoke(custom.handler, 'connect', {
        body: { ...settings(), baseUrl: cfg.providers[0] },
      })
    ).status,
    200,
  );
  assert.equal(custom.calls[0].url, 'https://compatible.example/custom/v1/chat/completions');
});

test('method/query/CSRF checks precede paid requests; logout only clears AI cookie', async () => {
  const fx = fixture();
  for (const url of [
    '/api/ai',
    '/api/ai?action=nope',
    '/api/ai?action=session&action=session',
    '/api/ai?action=connect&url=x',
    '/api/ai?action=logout&extra=1',
    '/api/other?action=session',
  ])
    error(await invoke(fx.handler, 'session', { url }), 'configuration', 400);
  const result = await invoke(fx.handler, 'connect', { method: 'GET' });
  error(result, 'configuration', 405);
  assert.equal(result.headers.allow, 'POST');
  for (const headers of [
    { origin: 'https://evil.example' },
    { origin: undefined },
    { 'x-roamlet-request': undefined },
    { host: 'evil.example' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ])
    error(await invoke(fx.handler, 'connect', { headers, body: settings() }), 'permission', 403);
  error(
    await invoke(fx.handler, 'session', { headers: { origin: 'https://evil.example' } }),
    'permission',
    403,
  );
  assert.equal(
    (await invoke(fx.handler, 'session', { headers: { origin: undefined } })).status,
    200,
  );
  const logout = await invoke(fx.handler, 'logout');
  assert.deepEqual(logout.data, {});
  assert.match(logout.headers['set-cookie'], /^__Host-roamlet-ai-session=;.*Max-Age=0/);
  assert.ok(!logout.headers['set-cookie'].includes('google'));
  assert.ok(!logout.headers['set-cookie'].includes('github'));
  error(await invoke(fx.handler, 'logout', { body: { extra: true } }), 'invalid-data', 400);
  assert.equal(fx.calls.length, 0);
});

test('propose forwards only prompt and activity/options, returns validated partial suggestion', async () => {
  const fx = fixture();
  const result = await invoke(fx.handler, 'propose', { body: input() });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, output());
  const body = JSON.parse(fx.calls[0].init.body);
  assert.deepEqual(JSON.parse(body.messages[1].content), input());
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /Unsupported wishes must return empty routingOptions/);
  assert.match(body.messages[0].content, /Never change cyclingProfile for hiking/);
  assert.equal(body.max_tokens, 1024);
  assert.equal(body.response_format, undefined);
  const unsupported = { routingOptions: {}, explanation: 'Weather is not available.' };
  const hiking = fixture({ fetcher: () => Response.json(completion(JSON.stringify(unsupported))) });
  assert.deepEqual(
    (
      await invoke(hiking.handler, 'propose', {
        body: { ...input(), context: { ...input().context, activity: 'hiking' } },
      })
    ).data,
    unsupported,
  );
});

test('propose rejects unknown context/route data, invalid bounds and disconnected sessions', async () => {
  const fx = fixture();
  const original = input();
  for (const body of [
    { ...original, extra: true },
    { ...original, prompt: '' },
    { ...original, prompt: ' '.repeat(10) },
    { ...original, prompt: 'x'.repeat(2001) },
    { ...original, prompt: 'bad\u0000' },
    { ...original, context: { ...original.context, coordinates: [[0, 0]] } },
    { ...original, context: { ...original.context, name: 'Private route' } },
    { ...original, context: { ...original.context, library: [] } },
    { ...original, context: { ...original.context, activity: 'walking' } },
    ...[
      { avoidFerries: 1 },
      { avoidSteps: 'true' },
      { cyclingProfile: 'foot-hiking' },
      { elevation: true },
    ].map((change) => ({
      ...original,
      context: {
        ...original.context,
        routingOptions: { ...original.context.routingOptions, ...change },
      },
    })),
    { ...original, context: { ...original.context, routingOptions: {} } },
  ])
    error(await invoke(fx.handler, 'propose', { body }), 'invalid-data', 400);
  for (const raw of [
    '',
    session({ expiresAt: NOW }),
    session({ baseUrl: 'https://removed.example/v1' }),
  ]) {
    const result = await invoke(fx.handler, 'propose', {
      body: original,
      headers: { cookie: raw },
    });
    error(result, 'auth', 401);
    assert.match(result.headers['set-cookie'], /Max-Age=0/);
  }
  assert.equal(fx.calls.length, 0);
});

test('model JSON is strictly validated, never forwarded as raw content or applied for hiking', async () => {
  for (const content of [
    'not JSON',
    '```json\n{}\n```',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...output(), extra: true }),
    JSON.stringify({ ...output(), routingOptions: { coordinates: [[0, 0]] } }),
    JSON.stringify({ ...output(), routingOptions: { avoidFerries: 'yes' } }),
    JSON.stringify({ ...output(), routingOptions: { cyclingProfile: 'foot-hiking' } }),
    JSON.stringify({ ...output(), explanation: '' }),
    JSON.stringify({ ...output(), explanation: ' '.repeat(3) }),
    JSON.stringify({ ...output(), explanation: 'x'.repeat(2001) }),
  ])
    error(
      await invoke(
        fixture({ fetcher: () => Response.json(completion(content)) }).handler,
        'propose',
        { body: input() },
      ),
      'invalid-data',
      502,
    );
  const cycling = {
    routingOptions: { cyclingProfile: 'cycling-road', avoidSteps: true },
    explanation: 'Use road cycling.',
  };
  const fx = fixture({ fetcher: () => Response.json(completion(JSON.stringify(cycling))) });
  assert.deepEqual((await invoke(fx.handler, 'propose', { body: input() })).data, cycling);
  error(
    await invoke(fx.handler, 'propose', {
      body: { ...input(), context: { ...input().context, activity: 'hiking' } },
    }),
    'invalid-data',
    502,
  );
});

test('invalid upstream completions, refusals, tools and truncation fail closed', async () => {
  for (const payload of [
    {},
    { ...completion(), extra: true },
    completion('OK', { choices: [] }),
    completion('OK', {
      choices: [
        { index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'length' },
      ],
    }),
    ...[
      { role: 'user' },
      { content: null },
      { refusal: 'denied' },
      { tool_calls: [] },
      { annotations: [{}] },
      { extra: true },
    ].map((change) =>
      completion('OK', {
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'OK', ...change },
            finish_reason: 'stop',
          },
        ],
      }),
    ),
    completion('OK', { usage: { prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 } }),
  ])
    error(
      await invoke(fixture({ fetcher: () => Response.json(payload) }).handler, 'connect', {
        body: settings(),
      }),
      'invalid-data',
      502,
    );
  error(
    await invoke(
      fixture({ fetcher: () => Response.json(completion('Something else')) }).handler,
      'connect',
      { body: settings() },
    ),
    'invalid-data',
    502,
  );
});

test('upstream HTTP failures and network exceptions are sanitized with no retry', async () => {
  for (const [status, code, expected] of [
    [401, 'auth', 401],
    [403, 'permission', 403],
    [429, 'quota', 429],
    [500, 'unavailable', 502],
    [400, 'unavailable', 502],
    [302, 'unavailable', 502],
  ]) {
    const fx = fixture({
      fetcher: () => new Response(`Private provider error ${KEY}`, { status }),
    });
    const result = await invoke(fx.handler, 'propose', { body: input() });
    error(result, code, expected);
    assert.equal(fx.calls.length, 1);
    if (code === 'auth') assert.match(result.headers['set-cookie'], /Max-Age=0/);
  }
  const fx = fixture({
    fetcher: () => {
      throw new Error(`Private exception ${KEY}`);
    },
  });
  error(await invoke(fx.handler, 'connect', { body: settings() }), 'network', 502);
  assert.equal(fx.calls.length, 1);
});

test('decoded response bound, content length/JSON type integrity and stream cancellation', async () => {
  for (const response of [
    () => new Response('x'.repeat(RESPONSE_LIMIT + 1)),
    () => new Response('x', { headers: { 'content-length': String(RESPONSE_LIMIT + 1) } }),
    () => new Response('x', { headers: { 'content-length': 'bad' } }),
  ])
    error(
      await invoke(fixture({ fetcher: response }).handler, 'connect', { body: settings() }),
      'too-large',
      413,
    );
  for (const response of [
    () => new Response('not JSON', { headers: { 'content-type': 'application/json' } }),
    () => new Response(JSON.stringify(completion()), { headers: { 'content-type': 'text/html' } }),
    () =>
      new Response(JSON.stringify(completion()), {
        headers: { 'content-type': 'application/json', 'content-length': '1' },
      }),
  ])
    error(
      await invoke(fixture({ fetcher: response }).handler, 'connect', { body: settings() }),
      'invalid-data',
      502,
    );
  const compressed = fixture({
    fetcher: () =>
      new Response(JSON.stringify(completion()), {
        headers: {
          'content-type': 'application/json',
          'content-length': '1',
          'content-encoding': 'gzip',
        },
      }),
  });
  assert.equal((await invoke(compressed.handler, 'connect', { body: settings() })).status, 200);
  let cancelled = false;
  const streamed = fixture({
    fetcher: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(RESPONSE_LIMIT + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  error(await invoke(streamed.handler, 'connect', { body: settings() }), 'too-large', 413);
  assert.equal(cancelled, true);
});

test('20s-default lifetime covers fetch, stalled upstream body, incoming body and browser cancellation', async () => {
  const stalledFetch = fixture({ timeoutMs: 5, fetcher: () => new Promise(() => {}) });
  const timed = await invoke(stalledFetch.handler, 'connect', { body: settings() });
  error(timed, 'timeout', 504);
  assert.equal(stalledFetch.calls[0].init.signal.aborted, true);
  assert.equal(stalledFetch.calls.length, 1);
  let cancelled = false;
  const stalledBody = fixture({
    timeoutMs: 5,
    fetcher: () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  });
  error(await invoke(stalledBody.handler, 'connect', { body: settings() }), 'timeout', 504);
  assert.equal(cancelled, true);
  const incoming = fixture({ timeoutMs: 5 });
  const req = new EventEmitter();
  // Explicitly remove the helper's default parsed body to exercise the incoming stream.
  error(
    await invoke(incoming.handler, 'connect', {
      req,
      onResponse: (request) => {
        Object.defineProperty(request, 'body', { get: () => undefined, configurable: true });
      },
    }),
    'timeout',
    504,
  );
  assert.equal(req.listenerCount('data'), 0);
  assert.equal(req.listenerCount('end'), 0);
  assert.equal(req.listenerCount('aborted'), 0);
  for (const event of ['aborted', 'close']) {
    let target;
    const fx = fixture({
      fetcher: () => {
        queueMicrotask(() => target.emit(event));
        return new Promise(() => {});
      },
    });
    const result = await invoke(fx.handler, 'propose', {
      body: input(),
      onResponse: (request, response) => {
        target = event === 'close' ? response : request;
      },
    });
    error(result, 'network', 499);
    assert.equal(fx.calls[0].init.signal.aborted, true);
    assert.equal(result.req.listenerCount('aborted'), 0);
    assert.equal(result.res.listenerCount('close'), 0);
  }
});

test('bounded strict JSON parser accepts streamed input and rejects bad media, mismatch and size', async () => {
  const fx = fixture({ fetcher: () => Response.json(completion()) });
  for (const options of [
    { body: '{' },
    { body: 'x'.repeat(REQUEST_LIMIT + 1) },
    { body: settings(), headers: { 'content-length': '99999' } },
    { body: settings(), headers: { 'content-length': 'invalid' } },
    { body: JSON.stringify(settings()), headers: { 'content-length': '1' } },
    { body: settings(), headers: { 'content-type': 'text/plain' } },
  ]) {
    const result = await invoke(fx.handler, 'connect', options);
    assert.ok([400, 413, 415].includes(result.status));
  }
  assert.equal(fx.calls.length, 0);
  const raw = JSON.stringify(settings());
  const req = Readable.from([Buffer.from(raw.slice(0, 10)), Buffer.from(raw.slice(10))]);
  const result = await invoke(fx.handler, 'connect', {
    req,
    headers: { 'content-length': String(Buffer.byteLength(raw)) },
    onResponse: (request) => {
      Object.defineProperty(request, 'body', { get: () => undefined, configurable: true });
    },
  });
  assert.equal(result.status, 200);
  assert.equal(fx.calls.length, 1);
  assert.equal(req.listenerCount('data'), 0);
  const platformParsed = await invoke(fx.handler, 'connect', {
    body: settings(),
    headers: { 'content-length': String(Buffer.byteLength(JSON.stringify(settings(), null, 2))) },
  });
  assert.equal(platformParsed.status, 200);
});

test('maximum ordinary key fits encrypted browser cookie; escaped combined settings fail before fetch', async () => {
  const key = 's'.repeat(1024);
  const fx = fixture({ fetcher: () => Response.json(completion()) });
  const result = await invoke(fx.handler, 'connect', { body: { ...settings(), apiKey: key } });
  assert.equal(result.status, 200);
  assert.ok(Buffer.byteLength(result.headers['set-cookie'], 'utf8') < 4096);
  assert.equal(
    openCookie({ headers: { cookie: result.headers['set-cookie'] } }, config(), NOW)?.apiKey ===
      key,
    true,
  );
  const longBase = `https://provider.example/${'p'.repeat(470)}`;
  const cfg = aiConfig({ ...env(), AI_PROVIDER_URLS: JSON.stringify([longBase]) });
  const escaped = fixture({ cfg });
  error(
    await invoke(escaped.handler, 'connect', {
      body: { baseUrl: longBase, model: '"'.repeat(128), apiKey: '\\'.repeat(1024) },
    }),
    'too-large',
    413,
  );
  assert.equal(escaped.calls.length, 0);
});

test('failed connection preserves previous cookie; output exactly at explanation limit is valid', async () => {
  const fx = fixture({
    fetcher: () => Response.json({ error: { message: 'private' } }, { status: 401 }),
  });
  const result = await invoke(fx.handler, 'connect', { body: settings() });
  error(result, 'auth', 401);
  assert.equal(result.headers['set-cookie'], undefined);
  const explanation = 'e'.repeat(2000);
  const proposal = { routingOptions: {}, explanation };
  const valid = fixture({ fetcher: () => Response.json(completion(JSON.stringify(proposal))) });
  assert.deepEqual(
    (await invoke(valid.handler, 'propose', { body: { ...input(), prompt: 'p'.repeat(2000) } }))
      .data,
    proposal,
  );
});

test('body stream overflow/abort and invalid UTF-8 are bounded without provider calls', async () => {
  const fx = fixture();
  const req = Readable.from([Buffer.alloc(REQUEST_LIMIT + 1)]);
  error(
    await invoke(fx.handler, 'connect', {
      req,
      onResponse: (request) => {
        Object.defineProperty(request, 'body', { get: () => undefined, configurable: true });
      },
    }),
    'too-large',
    413,
  );
  assert.equal(req.listenerCount('data'), 0);
  error(await invoke(fx.handler, 'connect', { body: Buffer.from([0xff]) }), 'invalid-data', 400);
  const aborted = new EventEmitter();
  aborted.aborted = true;
  error(await invoke(fx.handler, 'connect', { req: aborted, body: settings() }), 'network', 499);
  assert.equal(fx.calls.length, 0);
  const upstream = fixture({
    fetcher: () =>
      new Response(Buffer.from([0xff]), { headers: { 'content-type': 'application/json' } }),
  });
  error(await invoke(upstream.handler, 'connect', { body: settings() }), 'invalid-data', 502);
});

test('thin Vercel entrypoint shares the default backend', () => {
  assert.equal(typeof aiApi, 'function');
});
