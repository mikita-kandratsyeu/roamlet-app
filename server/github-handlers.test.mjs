import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import githubApi from '../api/github.mjs';
import { createGithubHandler } from './github-handlers.mjs';
import {
  githubConfig,
  cookie,
  cookieName,
  openCookie,
  seal,
  SESSION_SECONDS,
  STATE_SECONDS,
} from './github-session.mjs';
import { MAGIC, TRANSPORT_LIMIT } from './github-http.mjs';

const TOKEN = 'synthetic-user-token-never-reflect';
const SECRET = 'synthetic-app-secret-never-reflect';
const NOW = 1_800_000_000_000;
const env = () => ({
  GITHUB_APP_CLIENT_ID: 'Iv1.synthetic',
  GITHUB_APP_CLIENT_SECRET: SECRET,
  GITHUB_APP_SLUG: 'roamlet-test',
  GITHUB_APP_CALLBACK_URL: 'https://roamlet.example/api/github?action=callback',
  GITHUB_SESSION_SECRET: Buffer.alloc(32, 7).toString('base64'),
});
const config = () => githubConfig(env());
const NAME = '12345678-1234-4123-8123-123456789abc.roamlet';
const ID = `roamlet-backups/${NAME}`;
const data = (size = 60) => {
  const bytes = Buffer.alloc(size, 9);
  MAGIC.copy(bytes);
  return bytes;
};
const sha = (bytes) =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const entry = (bytes = data()) => ({
  type: 'file',
  name: NAME,
  path: ID,
  size: bytes.length,
  sha: sha(bytes),
});
const repo = () => ({
  id: 25,
  name: 'backups',
  owner: { login: 'alice' },
  private: true,
  permissions: { push: true },
});
const install = () => ({
  id: 7,
  app_slug: 'roamlet-test',
  client_id: 'Iv1.synthetic',
  permissions: { contents: 'write', metadata: 'read' },
  suspended_at: null,
});
function sessionCookie(cfg = config(), overrides = {}) {
  return cookie(
    cfg,
    'session',
    seal(cfg, 'session', {
      token: TOKEN,
      login: 'alice',
      userId: 42,
      issuedAt: NOW - 1000,
      expiresAt: NOW + 60_000,
      ...overrides,
    }),
    60,
  ).split(';')[0];
}

function fixture(overrides = {}, options = {}) {
  const calls = [];
  const defaults = {
    '/user/installations': { total_count: 1, installations: [install()] },
    '/user/installations/7/repositories': { total_count: 1, repositories: [repo()] },
    '/repos/alice/backups': repo(),
    '/repos/alice/backups/contents/roamlet-backups': [entry()],
    [`/repos/alice/backups/contents/${ID}`]: entry(),
    '/user': { id: 42, login: 'alice' },
    '/login/oauth/access_token': {
      access_token: TOKEN,
      token_type: 'bearer',
      expires_in: 28800,
      refresh_token: 'discard-this-refresh-token',
    },
    '/applications/Iv1.synthetic/token': () => new Response(null, { status: 204 }),
    ...overrides,
  };
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const pathname = new URL(url).pathname;
    let payload = defaults[pathname];
    if (init.method === 'PUT' && payload === undefined) {
      const bytes = Buffer.from(JSON.parse(init.body).content, 'base64');
      const name = pathname.split('/').at(-1);
      payload = {
        content: { type: 'file', name, path: `roamlet-backups/${name}`, size: bytes.length },
      };
    }
    if (payload === undefined) throw new Error(`Unexpected synthetic request ${pathname}`);
    if (typeof payload === 'function') return payload(url, init);
    return payload instanceof Response ? payload : Response.json(payload);
  };
  const handler = createGithubHandler({
    getConfig: () => options.config ?? config(),
    fetcher,
    now: () => options.now ?? NOW,
    ...options,
  });
  return { handler, calls };
}

async function invoke(
  handler,
  action = 'session',
  { method = 'GET', query = '', headers = {}, body, req: supplied } = {},
) {
  const req = supplied ?? new EventEmitter();
  Object.assign(req, {
    method,
    url: `/api/github?action=${action}${query}`,
    headers: {
      host: 'roamlet.example',
      cookie: sessionCookie(),
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  });
  const res = new EventEmitter();
  const responseHeaders = {};
  res.setHeader = (name, value) => {
    responseHeaders[name.toLowerCase()] = value;
  };
  res.end = (raw) => {
    res.raw = raw;
    res.writableEnded = true;
  };
  await handler(req, res);
  assert.equal(responseHeaders['cache-control'], 'no-store');
  assert.equal(responseHeaders['referrer-policy'], 'no-referrer');
  assert.equal(responseHeaders['access-control-allow-origin'], undefined);
  assert.ok(!JSON.stringify(responseHeaders).includes(TOKEN));
  assert.ok(!String(res.raw).includes(TOKEN));
  assert.ok(!String(res.raw).includes(SECRET));
  return {
    status: res.statusCode,
    headers: responseHeaders,
    raw: res.raw,
    data: responseHeaders['content-type']?.startsWith('application/json')
      ? JSON.parse(res.raw)
      : undefined,
    req,
    res,
  };
}
const selection = '&owner=alice&repository=backups';
const mutationHeaders = {
  origin: 'https://roamlet.example',
  'x-roamlet-request': '1',
  'content-type': 'application/octet-stream',
};

test('configuration is fail-closed, callback exact and key canonical 32-byte base64', () => {
  assert.equal(config().secure, true);
  for (const changes of [
    { GITHUB_APP_CLIENT_ID: '' },
    { GITHUB_SESSION_SECRET: Buffer.alloc(31).toString('base64') },
    { GITHUB_SESSION_SECRET: Buffer.alloc(32).toString('base64').replace(/=$/, '') },
    ...[
      'http://roamlet.example/api/github?action=callback',
      'https://x/api/github?action=start',
      'https://x/api/github?action=callback&extra=1',
      'https://user:pass@x/api/github?action=callback',
      'https://x/api/github?action=callback#fragment',
    ].map((url) => ({ GITHUB_APP_CALLBACK_URL: url })),
  ]) {
    assert.equal(githubConfig({ ...env(), ...changes }), null);
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const local = githubConfig({
      ...env(),
      GITHUB_APP_CALLBACK_URL: `http://${host}:5173/api/github?action=callback`,
    });
    assert.equal(local.secure, false);
    assert.ok(!cookie(local, 'session', 'value', 1).includes('Secure'));
    assert.ok(!cookieName(local, 'session').startsWith('__Host-'));
  }
});

test('entrypoint and missing config session expose only availability', async () => {
  const handler = createGithubHandler({
    getConfig: () => null,
    fetcher: () => {
      throw new Error();
    },
  });
  assert.deepEqual((await invoke(handler)).data, { available: false, connected: false });
  assert.equal((await invoke(handler, 'check', { query: selection })).status, 503);
  assert.equal(typeof githubApi, 'function');
});

test('session survives reload without renewing cookie, expires at fixed TTL and rejects tamper/purpose/origin/key', async () => {
  const { handler, calls } = fixture();
  const valid = sessionCookie();
  const response = await invoke(handler);
  assert.deepEqual(response.data, {
    available: true,
    connected: true,
    login: 'alice',
    installUrl: 'https://github.com/apps/roamlet-test/installations/new',
  });
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(calls.length, 0);
  const invalid = [
    valid.slice(0, -1) + (valid.at(-1) === 'A' ? 'B' : 'A'),
    '',
    `${valid}; ${valid}`,
    sessionCookie(config(), { expiresAt: NOW }),
    sessionCookie(config(), { issuedAt: NOW + 1 }),
    sessionCookie(config(), { expiresAt: NOW + SESSION_SECONDS * 1000 }),
    sessionCookie({ ...config(), origin: 'https://other.example' }),
    sessionCookie({ ...config(), key: Buffer.alloc(32, 8) }),
  ];
  for (const value of invalid) {
    const result = await invoke(handler, 'session', { headers: { cookie: value } });
    assert.equal(result.data.connected, false);
    assert.match(result.headers['set-cookie'], /Max-Age=0/);
  }
  assert.equal(openCookie({ headers: { cookie: valid } }, config(), 'state', NOW), null);
});

test('authorization uses state browser binding and S256 PKCE; callback consumes state and sanitizes redirect', async () => {
  const { handler, calls } = fixture();
  const start = await invoke(handler, 'start');
  const location = new URL(start.headers.location);
  assert.equal(location.origin, 'https://github.com');
  assert.equal(location.searchParams.get('redirect_uri'), config().callback);
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(location.searchParams.get('scope'), 'offline_access');
  const stateCookie = start.headers['set-cookie'].split(';')[0];
  assert.match(start.headers['set-cookie'], /^__Host-roamlet-github-state=/);
  assert.match(start.headers['set-cookie'], /HttpOnly; SameSite=Lax; Secure/);
  assert.match(start.headers['set-cookie'], /Max-Age=600/);
  const state = openCookie({ headers: { cookie: stateCookie } }, config(), 'state', NOW);
  assert.equal(
    createHash('sha256').update(state.verifier).digest('base64url'),
    location.searchParams.get('code_challenge'),
  );
  const result = await invoke(handler, 'callback', {
    query: `&code=synthetic-code&state=${state.state}`,
    headers: { cookie: stateCookie, 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(result.status, 303);
  assert.equal(result.headers.location, '/?connectors=github&github=connected');
  assert.match(result.headers['set-cookie'][0], /Max-Age=0/);
  assert.match(result.headers['set-cookie'][1], /Max-Age=28800; HttpOnly; SameSite=Lax; Secure/);
  const exchanged = JSON.parse(calls[0].init.body);
  assert.equal(exchanged.code_verifier, state.verifier);
  assert.equal(exchanged.client_secret, SECRET);
  assert.equal(calls[0].url, 'https://github.com/login/oauth/access_token');
  const session = openCookie(
    { headers: { cookie: result.headers['set-cookie'][1].split(';')[0] } },
    config(),
    'session',
    NOW,
  );
  assert.equal(session.token, TOKEN);
  assert.equal(session.refresh_token, undefined);
  const replay = await invoke(handler, 'callback', {
    query: `&code=synthetic-code&state=${state.state}`,
    headers: { cookie: result.headers['set-cookie'][1].split(';')[0] },
  });
  assert.equal(replay.headers.location, '/?connectors=github&github=error');
  assert.equal(calls.length, 2);
});

test('callback rejects expired/tampered/missing state, denial, duplicate params and nonexpiring tokens', async () => {
  const { handler, calls } = fixture();
  const start = await invoke(handler, 'start');
  const value = start.headers['set-cookie'].split(';')[0];
  const state = openCookie({ headers: { cookie: value } }, config(), 'state', NOW);
  const expired = cookie(
    config(),
    'state',
    seal(config(), 'state', { ...state, issuedAt: NOW - STATE_SECONDS * 1000, expiresAt: NOW }),
    600,
  ).split(';')[0];
  for (const [query, stateCookie] of [
    [`&code=code&state=${state.state}`, ''],
    [`&code=code&state=${state.state}`, expired],
    [`&code=code&state=${'a'.repeat(43)}`, value],
    [`&error=access_denied&state=${state.state}`, value],
    [`&code=code&code=other&state=${state.state}`, value],
    [`&code=../evil&state=${state.state}`, value],
  ]) {
    const result = await invoke(handler, 'callback', { query, headers: { cookie: stateCookie } });
    assert.equal(result.headers.location, '/?connectors=github&github=error');
    assert.equal(result.raw, undefined);
  }
  assert.equal(calls.length, 0);
  for (const payload of [
    { access_token: TOKEN, token_type: 'bearer' },
    { access_token: TOKEN, token_type: 'bearer', expires_in: 0 },
    { error: 'synthetic-sensitive-error' },
  ]) {
    const rejected = fixture({ '/login/oauth/access_token': payload });
    const result = await invoke(rejected.handler, 'callback', {
      query: `&code=code&state=${state.state}`,
      headers: { cookie: value },
    });
    assert.equal(result.headers.location, '/?connectors=github&github=error');
    assert.equal(rejected.calls.length, 1);
  }
});

test('same-origin mutation requires exact trusted Origin and marker; safe reads/start reject cross-site fetches', async () => {
  const { handler, calls } = fixture();
  for (const headers of [
    {},
    { 'x-roamlet-request': '1' },
    { origin: 'https://roamlet.example' },
    { ...mutationHeaders, origin: 'https://evil.example' },
    { ...mutationHeaders, origin: 'https://roamlet.example:443' },
    { ...mutationHeaders, 'sec-fetch-site': 'cross-site' },
    { ...mutationHeaders, 'x-roamlet-request': '2' },
  ]) {
    assert.equal(
      (await invoke(handler, 'upload', { method: 'POST', query: selection, headers, body: data() }))
        .status,
      403,
    );
    assert.equal((await invoke(handler, 'logout', { method: 'POST', headers })).status, 403);
  }
  for (const action of ['session', 'start', 'repositories']) {
    assert.equal(
      (await invoke(handler, action, { headers: { 'sec-fetch-site': 'cross-site' } })).status,
      403,
    );
  }
  assert.equal(calls.length, 0);
});

test('logout revokes with Basic App credentials then clears cookies; revoked/network failures remain sanitized', async () => {
  for (const payload of [
    () => new Response(null, { status: 204 }),
    () => {
      throw new Error(TOKEN);
    },
  ]) {
    const { handler, calls } = fixture({ '/applications/Iv1.synthetic/token': payload });
    const result = await invoke(handler, 'logout', { method: 'POST', headers: mutationHeaders });
    assert.deepEqual(result.data, {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'DELETE');
    assert.equal(
      calls[0].init.headers.Authorization,
      `Basic ${Buffer.from(`Iv1.synthetic:${SECRET}`).toString('base64')}`,
    );
    assert.deepEqual(JSON.parse(calls[0].init.body), { access_token: TOKEN });
    for (const value of result.headers['set-cookie']) assert.match(value, /Max-Age=0/);
  }
});

test('repositories are private, writable, installed App accessible, sorted and never expose upstream fields', async () => {
  const other = { ...repo(), id: 26, name: 'aaa' };
  const { handler, calls } = fixture({
    '/user/installations/7/repositories': {
      total_count: 4,
      repositories: [
        repo(),
        other,
        { ...repo(), id: 27, private: false },
        { ...repo(), id: 28, permissions: { push: false } },
      ],
    },
  });
  assert.deepEqual((await invoke(handler, 'repositories')).data, {
    repositories: [
      { owner: 'alice', name: 'aaa' },
      { owner: 'alice', name: 'backups' },
    ],
  });
  for (const { url, init } of calls) {
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.equal(new URL(calls[1].url).search, '?per_page=100&page=1');
});

test('repository listing rejects truncation, hostile IDs/fields and wrong App permissions before writes', async () => {
  for (const overrides of [
    { '/user/installations': { total_count: 101, installations: [install()] } },
    { '/user/installations': { total_count: 2, installations: [install()] } },
    { '/user/installations': { total_count: 1, installations: [{ ...install(), id: '../evil' }] } },
    { '/user/installations/7/repositories': { total_count: 101, repositories: [repo()] } },
    { '/user/installations/7/repositories': { total_count: 2, repositories: [repo()] } },
    {
      '/user/installations/7/repositories': {
        total_count: 1,
        repositories: [{ ...repo(), owner: { login: '../evil' } }],
      },
    },
  ]) {
    const { handler, calls } = fixture(overrides);
    assert.ok((await invoke(handler, 'repositories')).status >= 400);
    assert.ok(calls.every(({ url }) => new URL(url).origin === 'https://api.github.com'));
  }
  for (const changes of [
    { app_slug: 'other' },
    { client_id: 'other' },
    { suspended_at: '2026-01-01' },
    { permissions: { contents: 'read', metadata: 'read' } },
  ]) {
    const { handler } = fixture({
      '/user/installations': { total_count: 1, installations: [{ ...install(), ...changes }] },
    });
    assert.equal((await invoke(handler, 'check', { query: selection })).status, 403);
  }
});

test('provider next-page links are rejected, never followed as arbitrary URLs', async () => {
  const { handler, calls } = fixture({
    '/user/installations': () =>
      Response.json(
        { total_count: 1, installations: [install()] },
        { headers: { Link: '<https://evil.example/secret>; rel="next"' } },
      ),
  });
  assert.equal((await invoke(handler, 'repositories')).status, 413);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).origin, 'https://api.github.com');
});

test('repository input is validated before upstream and privacy/push is rechecked each operation', async () => {
  const { handler, calls } = fixture();
  for (const query of [
    '&owner=../alice&repository=backups',
    '&owner=alice&repository=..',
    '&owner=alice&repository=evil%2Fpath',
    '&owner=alice&owner=bob&repository=backups',
    '&owner=alice&repository=backups&url=https://evil.example',
    selection + '&id=bad',
  ]) {
    assert.equal((await invoke(handler, 'check', { query })).status, 400);
  }
  assert.equal(calls.length, 0);
  assert.deepEqual((await invoke(handler, 'check', { query: selection })).data, {});
  assert.deepEqual((await invoke(handler, 'check', { query: selection })).data, {});
  assert.equal(
    calls.filter(({ url }) => new URL(url).pathname === '/repos/alice/backups').length,
    2,
  );
  for (const changes of [{ private: false }, { permissions: { push: false } }, { id: 999 }]) {
    const rejected = fixture({ '/repos/alice/backups': { ...repo(), ...changes } });
    assert.ok(
      (
        await invoke(rejected.handler, 'upload', {
          method: 'POST',
          query: selection,
          headers: mutationHeaders,
          body: data(),
        })
      ).status >= 400,
    );
    assert.equal(
      rejected.calls.some(({ init }) => init.method === 'PUT'),
      false,
    );
  }
});

test('list requires strict snapshot paths and directory total cap, preserves 999 entries boundary', async () => {
  const noise = { name: 'README', path: 'roamlet-backups/README', type: 'file', size: 10 };
  const { handler } = fixture({
    '/repos/alice/backups/contents/roamlet-backups': [noise, entry()],
  });
  assert.deepEqual((await invoke(handler, 'list', { query: selection })).data, {
    backups: [{ id: ID, name: NAME, size: 60 }],
  });
  for (const item of [
    { ...entry(), path: `other/${NAME}` },
    { ...entry(), target: 'elsewhere' },
    { ...entry(), type: 'symlink' },
    { ...entry(), size: TRANSPORT_LIMIT + 1 },
  ]) {
    const rejected = fixture({ '/repos/alice/backups/contents/roamlet-backups': [item] });
    assert.ok((await invoke(rejected.handler, 'list', { query: selection })).status >= 400);
  }
  for (const count of [999, 1000]) {
    const entries = Array.from({ length: count }, (_, i) => ({
      ...noise,
      name: `file${i}`,
      path: `roamlet-backups/file${i}`,
    }));
    const rejected = fixture({ '/repos/alice/backups/contents/roamlet-backups': entries });
    assert.equal(
      (await invoke(rejected.handler, 'list', { query: selection })).status,
      count === 999 ? 200 : 413,
    );
    assert.equal(
      (
        await invoke(rejected.handler, 'upload', {
          method: 'POST',
          query: selection,
          headers: mutationHeaders,
          body: data(),
        })
      ).status,
      413,
    );
    assert.equal(
      rejected.calls.some(({ init }) => init.method === 'PUT'),
      false,
    );
  }
});

test('upload relays only bounded ciphertext, creates unique immutable snapshots without sha or retries', async () => {
  const { handler, calls } = fixture();
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const result = await invoke(handler, 'upload', {
      method: 'POST',
      query: selection,
      headers: mutationHeaders,
      body: data(),
    });
    assert.equal(result.status, 200);
    assert.match(result.data.backup.id, /^roamlet-backups\/[0-9a-f-]{36}\.roamlet$/);
    ids.push(result.data.backup.id);
  }
  assert.notEqual(ids[0], ids[1]);
  const puts = calls.filter(({ init }) => init.method === 'PUT');
  assert.equal(puts.length, 2);
  for (const { init } of puts) {
    const body = JSON.parse(init.body);
    assert.deepEqual(Buffer.from(body.content, 'base64'), data());
    assert.equal(body.sha, undefined);
    assert.deepEqual(Object.keys(body).sort(), ['content', 'message']);
  }
  const failed = fixture({
    '/repos/alice/backups/contents/roamlet-backups': () => new Response(null, { status: 404 }),
  });
  assert.equal(
    (
      await invoke(failed.handler, 'upload', {
        method: 'POST',
        query: selection,
        headers: mutationHeaders,
        body: data(TRANSPORT_LIMIT),
      })
    ).status,
    200,
  );
});

test('upload rejects oversized declared/buffered/streamed bodies and plaintext before provider traffic', async () => {
  const { handler, calls } = fixture();
  for (const [body, headers, status] of [
    [data(), { ...mutationHeaders, 'content-length': String(TRANSPORT_LIMIT + 1) }, 413],
    [data(TRANSPORT_LIMIT + 1), mutationHeaders, 413],
    [Buffer.from('plaintext route backup'), mutationHeaders, 400],
    [data(51), mutationHeaders, 400],
    [data(), { ...mutationHeaders, 'content-type': 'application/json' }, 415],
    [data(), { ...mutationHeaders, 'content-length': '59' }, 400],
  ])
    assert.equal(
      (await invoke(handler, 'upload', { method: 'POST', query: selection, headers, body })).status,
      status,
    );
  const stream = Readable.from([data(TRANSPORT_LIMIT), Buffer.from([1])]);
  assert.equal(
    (
      await invoke(handler, 'upload', {
        method: 'POST',
        query: selection,
        headers: mutationHeaders,
        req: stream,
      })
    ).status,
    413,
  );
  assert.equal(calls.length, 0);
});

test('download validates path/size then metadata+raw Contents, supports >1MB and detects replacement', async () => {
  for (const size of [60, 1_100_000, TRANSPORT_LIMIT]) {
    const bytes = data(size);
    const { handler, calls } = fixture({
      [`/repos/alice/backups/contents/${ID}`]: (_url, init) =>
        init.headers.Accept === 'application/vnd.github.raw+json'
          ? new Response(bytes)
          : Response.json(entry(bytes)),
    });
    const result = await invoke(handler, 'download', {
      query: `${selection}&id=${ID}&size=${size}`,
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers['content-type'], 'application/octet-stream');
    assert.deepEqual(result.raw, bytes);
    assert.equal(calls.at(-2).init.headers.Accept, 'application/vnd.github.object+json');
    assert.equal(calls.at(-1).init.headers.Accept, 'application/vnd.github.raw+json');
  }
  for (const [query, overrides] of [
    [`${selection}&id=../${ID}&size=60`, {}],
    [`${selection}&id=${ID}&size=61`, {}],
    [`${selection}&id=${ID}&size=${TRANSPORT_LIMIT + 1}`, {}],
    [
      `${selection}&id=${ID}&size=60`,
      {
        [`/repos/alice/backups/contents/${ID}`]: (_url, init) =>
          init.headers.Accept === 'application/vnd.github.raw+json'
            ? new Response(data(61))
            : Response.json(entry()),
      },
    ],
    [
      `${selection}&id=${ID}&size=60`,
      {
        [`/repos/alice/backups/contents/${ID}`]: (_url, init) =>
          init.headers.Accept === 'application/vnd.github.raw+json'
            ? new Response(Buffer.alloc(60))
            : Response.json(entry()),
      },
    ],
  ])
    assert.ok((await invoke(fixture(overrides).handler, 'download', { query })).status >= 400);
});

test('provider auth/quota/redirect/JSON/network errors are safe and never retried', async () => {
  for (const [payload, code, status] of [
    [() => new Response(TOKEN, { status: 401 }), 'auth', 401],
    [() => new Response(SECRET, { status: 403 }), 'permission', 403],
    [() => new Response(TOKEN, { status: 429 }), 'quota', 429],
    [
      () => new Response(TOKEN, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
      'quota',
      429,
    ],
    [
      () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }),
      'unavailable',
      502,
    ],
    [() => new Response('{broken'), 'invalid-data', 502],
    [
      () => {
        throw new Error(SECRET);
      },
      'network',
      502,
    ],
  ]) {
    const { handler, calls } = fixture({ '/user/installations': payload });
    const result = await invoke(handler, 'repositories');
    assert.equal(result.status, status);
    assert.equal(result.data.error.code, code);
    assert.equal(calls.length, 1);
    if (code === 'auth') assert.match(result.headers['set-cookie'], /Max-Age=0/);
  }
});

test('bounded upstream body, stalled fetch/body timeout and client abort clean listeners and stop work', async () => {
  for (const response of [
    () => new Response('small', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }),
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.alloc(4 * 1024 * 1024 + 1));
            controller.close();
          },
        }),
      ),
  ]) {
    const { handler } = fixture({ '/user/installations': response });
    assert.equal((await invoke(handler, 'repositories')).status, 413);
  }
  for (const response of [
    () => new Promise(() => {}),
    () => new Response(new ReadableStream({ start() {} })),
  ]) {
    const { handler, calls } = fixture({ '/user/installations': response }, { timeoutMs: 10 });
    const result = await invoke(handler, 'repositories');
    assert.equal(result.status, 504);
    assert.equal(result.data.error.code, 'timeout');
    assert.equal(calls[0].init.signal.aborted, true);
    assert.equal(result.req.listenerCount('aborted'), 0);
    assert.equal(result.res.listenerCount('close'), 0);
  }
  const stalled = fixture({}, { timeoutMs: 10 });
  const bodyTimeout = await invoke(stalled.handler, 'upload', {
    method: 'POST',
    query: selection,
    headers: mutationHeaders,
    req: new Readable({ read() {} }),
  });
  assert.equal(bodyTimeout.status, 504);
  assert.equal(stalled.calls.length, 0);
  const aborted = new EventEmitter();
  aborted.aborted = true;
  const cancelled = fixture();
  const result = await invoke(cancelled.handler, 'repositories', { req: aborted });
  assert.equal(result.status, 499);
  assert.equal(result.req.listenerCount('aborted'), 0);
  assert.equal(cancelled.calls.length, 0);
});

test('actual HTTP octet-stream upload uses the shared handler and preserves ciphertext bytes', async (t) => {
  const { handler, calls } = fixture();
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  for (const [bytes, expected] of [
    [data(), 200],
    [Buffer.from('plaintext'), 400],
  ]) {
    const result = await new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: server.address().port,
          path: `/api/github?action=upload${selection}`,
          method: 'POST',
          headers: { ...mutationHeaders, cookie: sessionCookie(), 'content-length': bytes.length },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(bytes);
    });
    assert.equal(result.status, expected);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.ok(!result.body.includes(TOKEN));
  }
  assert.equal(calls.filter(({ init }) => init.method === 'PUT').length, 1);
});

test('Vercel-style lazy buffered octet-stream preserves bytes and rejects string/object coercion', async () => {
  const { handler, calls } = fixture();
  const req = new EventEmitter();
  req.readableEnded = true;
  Object.defineProperty(req, 'body', { get: () => data(TRANSPORT_LIMIT) });
  const result = await invoke(handler, 'upload', {
    method: 'POST',
    query: selection,
    headers: mutationHeaders,
    req,
  });
  assert.equal(result.status, 200);
  const put = calls.find(({ init }) => init.method === 'PUT');
  assert.deepEqual(Buffer.from(JSON.parse(put.init.body).content, 'base64'), data(TRANSPORT_LIMIT));
  assert.equal(req.listenerCount('data'), 0);
  const count = calls.length;
  for (const body of [data().toString('latin1'), { type: 'Buffer', data: [...data()] }]) {
    assert.equal(
      (
        await invoke(handler, 'upload', {
          method: 'POST',
          query: selection,
          headers: mutationHeaders,
          body,
        })
      ).status,
      400,
    );
  }
  assert.equal(calls.length, count);
});

test('logout without usable cookie or with stalled revocation always clears cookies after valid CSRF', async () => {
  for (const value of [
    '',
    '__Host-roamlet-github-session=invalid',
    sessionCookie(config(), { expiresAt: NOW }),
  ]) {
    const { handler, calls } = fixture();
    const result = await invoke(handler, 'logout', {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: value },
    });
    assert.deepEqual(result.data, {});
    assert.equal(result.status, 200);
    assert.equal(calls.length, 0);
    assert.equal(result.headers['set-cookie'].length, 2);
    for (const value of result.headers['set-cookie']) assert.match(value, /Max-Age=0/);
  }
  const { handler, calls } = fixture(
    { '/applications/Iv1.synthetic/token': () => new Promise(() => {}) },
    { timeoutMs: 10 },
  );
  const result = await invoke(handler, 'logout', { method: 'POST', headers: mutationHeaders });
  assert.deepEqual(result.data, {});
  assert.equal(result.status, 200);
  assert.equal(calls[0].init.signal.aborted, true);
  for (const value of result.headers['set-cookie']) assert.match(value, /Max-Age=0/);
});

test('OAuth callback and mutation trust configured origin, never forwarded attacker host', async () => {
  const { handler, calls } = fixture();
  const host = {
    host: 'evil.example',
    'x-forwarded-host': 'evil.example',
    'x-forwarded-proto': 'http',
  };
  const start = await invoke(handler, 'start', { headers: host });
  assert.equal(new URL(start.headers.location).searchParams.get('redirect_uri'), config().callback);
  assert.equal(
    (
      await invoke(handler, 'logout', {
        method: 'POST',
        headers: { ...mutationHeaders, ...host, origin: 'http://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await invoke(handler, 'logout', {
        method: 'POST',
        headers: { ...host, 'x-roamlet-request': '1' },
      })
    ).status,
    403,
  );
  assert.equal(calls.length, 0);
});

test('provider body cancellation cannot stall sanitized failures', async () => {
  for (const [status, headers, expected] of [
    [403, {}, 403],
    [200, { 'content-length': String(4 * 1024 * 1024 + 1) }, 413],
  ]) {
    const { handler } = fixture(
      {
        '/user/installations': () =>
          new Response(
            new ReadableStream({
              cancel() {
                return new Promise(() => {});
              },
            }),
            { status, headers },
          ),
      },
      { timeoutMs: 10 },
    );
    assert.equal((await invoke(handler, 'repositories')).status, expected);
  }
});

test('unknown actions/methods/extra query params are rejected without upstream', async () => {
  const { handler, calls } = fixture();
  for (const [action, options, status] of [
    ['session', { method: 'POST' }, 405],
    ['upload', { query: selection }, 405],
    ['unknown', {}, 400],
    ['session', { query: '&token=ignored' }, 400],
    ['session', { query: '&action=session' }, 400],
  ]) {
    assert.equal((await invoke(handler, action, options)).status, status);
  }
  assert.equal(calls.length, 0);
});
