import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import googleDriveApi from '../api/google-drive.mjs';
import { cookie as githubCookie, seal as githubSeal } from './github-session.mjs';
import { MAGIC, TRANSPORT_LIMIT } from './github-http.mjs';
import { ConnectorError, DRIVE_SCOPE, SCOPES } from './google-drive-client.mjs';
import { createGoogleDriveHandler } from './google-drive-handlers.mjs';
import {
  cookie,
  cookieName,
  googleDriveConfig,
  openCookie,
  seal,
  SESSION_SECONDS,
  STATE_SECONDS,
} from './google-drive-session.mjs';

const NOW = 1_800_000_000_000;
const TOKEN = 'synthetic-google-access-token-not-for-clients';
const SECRET = 'synthetic-google-client-secret-not-for-clients';
const NAME = '12345678-1234-4123-8123-123456789abc.roamlet';
const ID = 'synthetic_google-file_123';
const FOLDER_ID = 'synthetic_canonical-app-folder_123';
const ORIGIN = 'https://roamlet.example';
const USER = { sub: 'google-stable-sub-123', email: 'alice@example.com', email_verified: true };
const env = () => ({
  GOOGLE_DRIVE_CLIENT_ID: '123-synthetic.apps.googleusercontent.com',
  GOOGLE_DRIVE_CLIENT_SECRET: SECRET,
  GOOGLE_DRIVE_CALLBACK_URL: `${ORIGIN}/api/google-drive?action=callback`,
  GOOGLE_DRIVE_SESSION_SECRET: Buffer.alloc(32, 11).toString('base64'),
});
const config = () => googleDriveConfig(env());
const data = (size = 60) => {
  const bytes = Buffer.alloc(size, 0xff);
  MAGIC.copy(bytes);
  return bytes;
};
const entry = (overrides = {}) => ({
  id: ID,
  name: NAME,
  size: '60',
  parents: ['appDataFolder'],
  appProperties: { roamlet: 'backup-v1' },
  mimeType: 'application/octet-stream',
  ...overrides,
});
function sessionCookie(overrides = {}, cfg = config()) {
  return cookie(
    cfg,
    'session',
    seal(cfg, 'session', {
      token: TOKEN,
      accountId: USER.sub,
      email: USER.email,
      issuedAt: NOW - 1000,
      expiresAt: NOW + 60_000,
      ...overrides,
    }),
    60,
  ).split(';')[0];
}
const mutation = {
  origin: ORIGIN,
  'x-roamlet-request': '1',
  'content-type': 'application/octet-stream',
};
function fixture(overrides = {}, options = {}) {
  const calls = [];
  const defaults = {
    token: {
      access_token: TOKEN,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: SCOPES,
      refresh_token: 'must-be-discarded',
    },
    user: USER,
    probe: { files: [] },
    folder: { id: FOLDER_ID },
    list: { files: [entry({ parents: [options.folderParent ?? FOLDER_ID] })] },
    metadata: entry({ parents: [options.folderParent ?? FOLDER_ID] }),
    media: () => new Response(data()),
    revoke: () => new Response(null, { status: 200 }),
    upload: (_url, init) => {
      const body = init.body;
      const boundary = init.headers['Content-Type'].split('boundary=')[1];
      assert.ok(Buffer.isBuffer(body));
      const marker = Buffer.from(`\r\n--${boundary}\r\n`);
      const separator = body.indexOf(marker);
      const metadataStart = body.indexOf(Buffer.from('\r\n\r\n')) + 4;
      const metadata = JSON.parse(body.subarray(metadataStart, separator).toString('utf8'));
      const binaryStart = body.indexOf(Buffer.from('\r\n\r\n'), separator + marker.length) + 4;
      const binaryEnd = body.length - Buffer.byteLength(`\r\n--${boundary}--\r\n`);
      assert.deepEqual(metadata, {
        name: metadata.name,
        parents: ['appDataFolder'],
        mimeType: 'application/octet-stream',
        appProperties: { roamlet: 'backup-v1' },
      });
      assert.match(metadata.name, /^[0-9a-f-]{14}4[0-9a-f-]{21}\.roamlet$/);
      assert.deepEqual(body.subarray(binaryStart, binaryEnd), options.bytes ?? data());
      options.onUpload?.();
      return entry({
        name: metadata.name,
        size: String(binaryEnd - binaryStart),
        parents: [options.folderParent ?? FOLDER_ID],
      });
    },
    ...overrides,
  };
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const parsed = new URL(url);
    let key;
    if (url === 'https://oauth2.googleapis.com/token') key = 'token';
    else if (url === 'https://oauth2.googleapis.com/revoke') key = 'revoke';
    else if (url === 'https://openidconnect.googleapis.com/v1/userinfo') key = 'user';
    else {
      assert.equal(parsed.origin, 'https://www.googleapis.com');
      if (parsed.pathname === '/upload/drive/v3/files') key = 'upload';
      else if (parsed.pathname === '/drive/v3/files')
        key = parsed.searchParams.get('pageSize') === '1' ? 'probe' : 'list';
      else if (parsed.pathname === '/drive/v3/files/appDataFolder') {
        assert.equal(parsed.search, '?fields=id');
        key = 'folder';
      } else if (parsed.pathname === `/drive/v3/files/${ID}`)
        key = parsed.searchParams.get('alt') === 'media' ? 'media' : 'metadata';
      else assert.fail(`Unexpected fixed-path request ${parsed.pathname}`);
    }
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.signal.aborted, false);
    if (!['token', 'revoke'].includes(key))
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    let payload = defaults[key];
    if (typeof payload === 'function') payload = await payload(url, init, calls);
    return payload instanceof Response ? payload : Response.json(payload);
  };
  return {
    handler: createGoogleDriveHandler({
      fetcher,
      getConfig: () => config(),
      now: () => NOW,
      ...options,
    }),
    calls,
  };
}
async function invoke(
  handler,
  action = 'session',
  { method = 'GET', query = '', headers = {}, body, req: supplied, onResponse } = {},
) {
  const req = supplied ?? new EventEmitter();
  Object.assign(req, {
    method,
    url: `/api/google-drive?action=${action}${query}`,
    headers: { host: 'roamlet.example', cookie: sessionCookie(), ...headers },
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
  onResponse?.(res, req);
  await handler(req, res);
  assert.equal(responseHeaders['cache-control'], 'no-store');
  assert.equal(responseHeaders['referrer-policy'], 'no-referrer');
  assert.equal(responseHeaders['x-content-type-options'], 'nosniff');
  assert.equal(responseHeaders['access-control-allow-origin'], undefined);
  for (const sensitive of [TOKEN, SECRET, 'must-be-discarded']) {
    assert.ok(!JSON.stringify(responseHeaders).includes(sensitive));
    assert.ok(!String(res.raw).includes(sensitive));
  }
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
const download = `&id=${ID}&size=60`;
async function oauth(fx, query = '', stateCookie) {
  const start = await invoke(fx.handler, 'start');
  const value = stateCookie ?? start.headers['set-cookie'].split(';')[0];
  const state = new URL(start.headers.location).searchParams.get('state');
  return invoke(fx.handler, 'callback', {
    query: `&code=4%2Fsynthetic-code&state=${state}${query}`,
    headers: { cookie: value, 'sec-fetch-site': 'cross-site' },
  });
}
function assertError(response, code, status) {
  assert.equal(response.status, status);
  assert.deepEqual(response.data, {
    error: { code, message: 'Google Drive connector request failed.' },
  });
}

test('config requires canonical 32-byte base64, exact callback, HTTPS or local loopback', () => {
  assert.equal(config().secure, true);
  for (const change of [
    { GOOGLE_DRIVE_CLIENT_ID: '' },
    { GOOGLE_DRIVE_CLIENT_ID: 'invalid id' },
    { GOOGLE_DRIVE_CLIENT_SECRET: 'bad\nsecret' },
    { GOOGLE_DRIVE_SESSION_SECRET: Buffer.alloc(31).toString('base64') },
    { GOOGLE_DRIVE_SESSION_SECRET: Buffer.alloc(32).toString('base64').replace(/=$/, '') },
    ...[
      'http://remote/api/google-drive?action=callback',
      'https://x/api/github?action=callback',
      'https://x/api/google-drive?action=start',
      'https://x/api/google-drive?action=callback&x=1',
      'https://x/api/google-drive?action=callback#fragment',
      'https://user:pass@x/api/google-drive?action=callback',
    ].map((url) => ({ GOOGLE_DRIVE_CALLBACK_URL: url })),
  ])
    assert.equal(googleDriveConfig({ ...env(), ...change }), null);
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const cfg = googleDriveConfig({
      ...env(),
      GOOGLE_DRIVE_CALLBACK_URL: `http://${host}:5173/api/google-drive?action=callback`,
    });
    assert.equal(cfg.secure, false);
    assert.ok(!cookie(cfg, 'state', 'value', 1).includes('Secure'));
    assert.ok(!cookieName(cfg, 'session').startsWith('__Host-'));
  }
});

test('missing config and thin entrypoint reveal only availability', async () => {
  const fx = fixture({}, { getConfig: () => null });
  assert.deepEqual((await invoke(fx.handler)).data, { available: false, connected: false });
  assertError(await invoke(fx.handler, 'check'), 'unavailable', 503);
  assert.equal(fx.calls.length, 0);
  assert.equal(typeof googleDriveApi, 'function');
});

test('session is local, fixed expiry, provider-distinct and origin/client/key/purpose bound', async () => {
  const fx = fixture();
  const good = await invoke(fx.handler);
  assert.deepEqual(good.data, {
    available: true,
    connected: true,
    email: USER.email,
    accountId: USER.sub,
  });
  assert.equal(good.headers['set-cookie'], undefined);
  assert.equal(fx.calls.length, 0);
  const valid = sessionCookie();
  const gh = { ...config(), slug: 'synthetic' };
  const ghCookie = githubCookie(
    gh,
    'session',
    githubSeal(gh, 'session', {
      token: TOKEN,
      login: 'alice',
      userId: 1,
      issuedAt: NOW,
      expiresAt: NOW + 1000,
    }),
    1,
  ).split(';')[0];
  for (const value of [
    '',
    `${valid}; ${valid}`,
    valid.slice(0, -2) + 'AA',
    ghCookie,
    sessionCookie({ expiresAt: NOW }),
    sessionCookie({ issuedAt: NOW + 1 }),
    sessionCookie({ expiresAt: NOW + SESSION_SECONDS * 1000 }),
    sessionCookie({ token: 'bad\nvalue' }),
    sessionCookie({ accountId: '' }),
    sessionCookie({ email: '' }),
    sessionCookie({}, { ...config(), origin: 'https://other.example' }),
    sessionCookie({}, { ...config(), clientId: 'another-client' }),
    sessionCookie({}, { ...config(), key: Buffer.alloc(32, 12) }),
    `${cookieName(config(), 'session')}=${ghCookie.split('=')[1]}`,
  ]) {
    const response = await invoke(fx.handler, 'session', { headers: { cookie: value } });
    assert.deepEqual(response.data, { available: true, connected: false });
    assert.match(
      response.headers['set-cookie'],
      /^__Host-roamlet-google-drive-session=.*Max-Age=0;/,
    );
  }
  assert.equal(openCookie({ headers: { cookie: valid } }, config(), 'state', NOW), null);
});

test('session polling during OAuth does not erase the state cookie needed by the callback', async () => {
  const fx = fixture();
  const start = await invoke(fx.handler, 'start');
  const stateCookie = start.headers['set-cookie'].split(';')[0];
  const session = await invoke(fx.handler, 'session', { headers: { cookie: stateCookie } });
  assert.deepEqual(session.data, { available: true, connected: false });
  assert.equal(typeof session.headers['set-cookie'], 'string');
  assert.ok(session.headers['set-cookie'].startsWith(`${cookieName(config(), 'session')}=`));
  assert.ok(!session.headers['set-cookie'].includes(cookieName(config(), 'state')));
  const check = await invoke(fx.handler, 'check', { headers: { cookie: stateCookie } });
  assertError(check, 'auth', 401);
  assert.ok(check.headers['set-cookie'].startsWith(`${cookieName(config(), 'session')}=`));
  assert.ok(!check.headers['set-cookie'].includes(cookieName(config(), 'state')));
  const state = new URL(start.headers.location).searchParams.get('state');
  const callback = await invoke(fx.handler, 'callback', {
    query: `&code=4%2Fsynthetic-code&state=${state}`,
    headers: { cookie: stateCookie, 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(callback.headers.location, '/?connectors=google-drive&google=connected');
});

test('Google OAuth uses online-only exact scopes, PKCE S256, browser state and fixed form exchange', async () => {
  const fx = fixture();
  const start = await invoke(fx.handler, 'start');
  const url = new URL(start.headers.location);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), SCOPES);
  assert.equal(url.searchParams.get('access_type'), 'online');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), config().callback);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('include_granted_scopes'), false);
  assert.equal(url.searchParams.has('refresh_token'), false);
  const stateCookie = start.headers['set-cookie'].split(';')[0];
  assert.match(
    start.headers['set-cookie'],
    /^__Host-roamlet-google-drive-state=.*Max-Age=600; HttpOnly; SameSite=Lax; Secure$/,
  );
  const state = openCookie({ headers: { cookie: stateCookie } }, config(), 'state', NOW);
  assert.equal(
    createHash('sha256').update(state.verifier).digest('base64url'),
    url.searchParams.get('code_challenge'),
  );
  const response = await invoke(fx.handler, 'callback', {
    query: `&code=4%2Fsynthetic-code&state=${state.state}&iss=https%3A%2F%2Faccounts.google.com&scope=${encodeURIComponent(SCOPES)}&authuser=0&prompt=consent`,
    headers: { cookie: stateCookie, 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(response.headers.location, '/?connectors=google-drive&google=connected');
  assert.equal(response.status, 303);
  assert.equal(fx.calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(fx.calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(fx.calls[0].init.body)), {
    client_id: config().clientId,
    client_secret: SECRET,
    redirect_uri: config().callback,
    grant_type: 'authorization_code',
    code: '4/synthetic-code',
    code_verifier: state.verifier,
  });
  assert.equal(fx.calls[1].url, 'https://openidconnect.googleapis.com/v1/userinfo');
  assert.equal(new URL(fx.calls[2].url).searchParams.get('spaces'), 'appDataFolder');
  assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
  assert.match(response.headers['set-cookie'][1], /Max-Age=3600; HttpOnly; SameSite=Lax; Secure/);
  const saved = openCookie(
    { headers: { cookie: response.headers['set-cookie'][1].split(';')[0] } },
    config(),
    'session',
    NOW,
  );
  assert.deepEqual(saved, {
    token: TOKEN,
    accountId: USER.sub,
    email: USER.email,
    issuedAt: NOW,
    expiresAt: NOW + 3600_000,
  });
  const replay = await invoke(fx.handler, 'callback', {
    query: `&code=code&state=${state.state}`,
    headers: { cookie: response.headers['set-cookie'][1].split(';')[0] },
  });
  assert.equal(replay.headers.location, '/?connectors=google-drive&google=error');
  assert.equal(fx.calls.length, 3);
});

test('callback consumes state on denial, tamper, expired/missing state and malformed/duplicate parameters', async () => {
  const fx = fixture();
  const start = await invoke(fx.handler, 'start');
  const value = start.headers['set-cookie'].split(';')[0];
  const state = openCookie({ headers: { cookie: value } }, config(), 'state', NOW);
  const expired = cookie(
    config(),
    'state',
    seal(config(), 'state', { ...state, issuedAt: NOW - STATE_SECONDS * 1000, expiresAt: NOW }),
    600,
  ).split(';')[0];
  for (const [suffix, saved] of [
    [`&code=code&state=${state.state}`, ''],
    [`&code=code&state=${state.state}`, expired],
    [`&code=code&state=${state.state}`, value.slice(0, -2) + 'AA'],
    [`&code=code&state=${'a'.repeat(43)}`, value],
    [`&error=access_denied&error_description=secret&state=${state.state}`, value],
    [`&code=code&code=other&state=${state.state}`, value],
    [`&code=code&state=${state.state}&state=${state.state}`, value],
    [`&code=code&state=${state.state}&iss=https://evil.example`, value],
    [`&code=code&state=${state.state}&redirect=https://evil.example`, value],
    [`&code=&state=${state.state}`, value],
    [`&code=%0A&state=${state.state}`, value],
    [`&code=${'a'.repeat(1025)}&state=${state.state}`, value],
    [`&action=callback&code=code&state=${state.state}`, value],
  ]) {
    const response = await invoke(fx.handler, 'callback', {
      query: suffix,
      headers: { cookie: saved },
    });
    assert.equal(response.headers.location, '/?connectors=google-drive&google=error');
    assert.match(response.headers['set-cookie'], /Max-Age=0/);
    assert.equal(response.raw, undefined);
  }
  assert.equal(fx.calls.length, 0);
});

test('callback rejects missing/invalid expiry, scope, tokens and invalid userinfo; refresh tokens discarded', async () => {
  for (const changes of [
    { expires_in: undefined },
    { expires_in: 0 },
    { expires_in: -1 },
    { expires_in: '3600' },
    { expires_in: 0.5 },
    { access_token: '' },
    { access_token: 'bad\nvalue' },
    { token_type: 'MAC' },
    { token_type: 42 },
    { scope: 'openid email' },
    { scope: null },
    { scope: `${DRIVE_SCOPE}.other` },
  ]) {
    const fx = fixture({
      token: {
        access_token: TOKEN,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: SCOPES,
        ...changes,
      },
    });
    const response = await oauth(fx);
    assert.equal(response.headers.location, '/?connectors=google-drive&google=error');
    assert.equal(fx.calls.length, 1);
  }
  for (const user of [
    null,
    [],
    { ...USER, sub: '' },
    { ...USER, sub: 'a'.repeat(256) },
    { ...USER, sub: 1 },
    { ...USER, email: '' },
    { ...USER, email: 'a'.repeat(255) + '@example.com' },
    { ...USER, email: 'bad\n@example.com' },
    { ...USER, email_verified: false },
    { ...USER, email_verified: 'true' },
    { sub: USER.sub },
  ]) {
    const response = await oauth(fixture({ user }));
    assert.equal(response.headers.location, '/?connectors=google-drive&google=error');
  }
  for (const expires_in of [60, 7200]) {
    const fx = fixture({ token: { access_token: TOKEN, token_type: 'bearer', expires_in } });
    const response = await oauth(fx);
    assert.equal(response.headers.location, '/?connectors=google-drive&google=connected');
    assert.match(
      response.headers['set-cookie'][1],
      new RegExp(`Max-Age=${Math.min(3600, expires_in)};`),
    );
    assert.equal(fx.calls.length, 3);
  }
  const deniedProbe = fixture({
    token: { access_token: TOKEN, token_type: 'bearer', expires_in: 3600 },
    probe: new Response('{}', { status: 403 }),
  });
  assert.equal(
    (await oauth(deniedProbe)).headers.location,
    '/?connectors=google-drive&google=error',
  );
});

test('exchange/body time is deducted from session lifetime; already-expired exchange fails', async () => {
  for (const elapsed of [10_000, 60_000]) {
    let clock = NOW;
    const fx = fixture(
      {
        user: () => {
          clock += elapsed;
          return USER;
        },
        token: { access_token: TOKEN, token_type: 'bearer', expires_in: 60, scope: SCOPES },
      },
      { now: () => clock },
    );
    const response = await oauth(fx);
    if (elapsed === 60_000)
      assert.equal(response.headers.location, '/?connectors=google-drive&google=error');
    else {
      assert.match(response.headers['set-cookie'][1], /Max-Age=50;/);
      const payload = openCookie(
        { headers: { cookie: response.headers['set-cookie'][1].split(';')[0] } },
        config(),
        'session',
        clock,
      );
      assert.equal(payload.expiresAt, NOW + 60_000);
    }
  }
});

test('exact Origin and marker required for mutations; reads/start reject cross-site and host mismatch', async () => {
  const fx = fixture();
  for (const headers of [
    {},
    { origin: ORIGIN },
    { 'x-roamlet-request': '1' },
    { ...mutation, origin: 'https://evil.example' },
    { ...mutation, origin: `${ORIGIN}:443` },
    { ...mutation, 'x-roamlet-request': '2' },
    { ...mutation, 'sec-fetch-site': 'cross-site' },
  ]) {
    for (const action of ['upload', 'logout'])
      assertError(
        await invoke(fx.handler, action, { method: 'POST', headers, body: data() }),
        'permission',
        403,
      );
  }
  for (const action of ['session', 'start', 'check', 'list', 'download']) {
    for (const headers of [
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
      { host: 'evil.example' },
    ])
      assertError(
        await invoke(fx.handler, action, { query: action === 'download' ? download : '', headers }),
        'permission',
        403,
      );
  }
  assert.equal(fx.calls.length, 0);
});

test('methods, actions and query parameters are allowlisted; no arbitrary URL forwarding', async () => {
  const fx = fixture();
  for (const action of ['session', 'start', 'check', 'list', 'download', 'upload', 'logout']) {
    const wrong = ['upload', 'logout'].includes(action) ? 'GET' : 'POST';
    const response = await invoke(fx.handler, action, { method: wrong });
    assertError(response, 'configuration', 405);
    assert.equal(response.headers.allow, wrong === 'GET' ? 'POST' : 'GET');
  }
  for (const [action, query] of [
    ['unknown', ''],
    ['list', '&url=https://evil.example'],
    ['session', '&action=session'],
    ['check', '&owner=alice'],
    ['download', `${download}&size=60`],
  ])
    assertError(await invoke(fx.handler, action, { query }), 'configuration', 400);
  assert.equal(fx.calls.length, 0);
});

test('check verifies current token identity and actual Drive appDataFolder access', async () => {
  const fx = fixture();
  assert.deepEqual((await invoke(fx.handler, 'check')).data, {});
  assert.equal(fx.calls.length, 2);
  assert.equal(new URL(fx.calls[1].url).searchParams.get('pageSize'), '1');
  const changed = fixture({ user: { ...USER, sub: 'other-account' } });
  const rejected = await invoke(changed.handler, 'check');
  assertError(rejected, 'auth', 401);
  assert.equal(changed.calls.length, 1);
  assert.match(rejected.headers['set-cookie'], /^__Host-roamlet-google-drive-session=.*Max-Age=0;/);
  const expired = await invoke(fx.handler, 'check', {
    headers: { cookie: sessionCookie({ expiresAt: NOW }) },
  });
  assertError(expired, 'auth', 401);
});

test('list queries owned snapshots, fixed fields and preserves createdTime-desc provider order across pages', async () => {
  const fx = fixture({
    list: (url) =>
      new URL(url).searchParams.has('pageToken')
        ? { files: [entry({ id: 'second', name: '00000000-0000-4000-8000-000000000000.roamlet' })] }
        : { files: [entry()], nextPageToken: 'opaque_page-token=' },
  });
  const response = await invoke(fx.handler, 'list');
  assert.deepEqual(response.data, {
    backups: [
      { id: ID, name: NAME, size: 60 },
      { id: 'second', name: '00000000-0000-4000-8000-000000000000.roamlet', size: 60 },
    ],
  });
  const listCalls = fx.calls.filter(({ url }) => new URL(url).pathname === '/drive/v3/files');
  assert.equal(listCalls.length, 2);
  for (const { url } of listCalls) {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://www.googleapis.com/drive/v3/files');
    assert.equal(parsed.searchParams.get('spaces'), 'appDataFolder');
    assert.equal(
      parsed.searchParams.get('q'),
      "trashed = false and appProperties has { key='roamlet' and value='backup-v1' }",
    );
    assert.equal(
      parsed.searchParams.get('fields'),
      'files(id,name,size,parents,appProperties,mimeType),nextPageToken',
    );
    assert.equal(parsed.searchParams.get('pageSize'), '100');
    assert.equal(parsed.searchParams.get('orderBy'), 'createdTime desc');
  }
  assert.equal(new URL(listCalls[1].url).searchParams.get('pageToken'), 'opaque_page-token=');
});

test('pagination rejects duplicate ids, malformed/repeated tokens and never silently truncates', async () => {
  for (const nextPageToken of ['', null, 3, 'https://evil.example', '../page', 'a'.repeat(1025)]) {
    const fx = fixture({ list: { files: [], nextPageToken } });
    assertError(await invoke(fx.handler, 'list'), 'invalid-data', 502);
    assert.equal(fx.calls.length, 2);
  }
  for (const payload of [
    { files: [entry(), entry()] },
    { files: [entry()], nextPageToken: 'again' },
    { files: [], nextPageToken: 'again' },
    { files: null },
  ]) {
    assertError(await invoke(fixture({ list: payload }).handler, 'list'), 'invalid-data', 502);
  }
  const tooMany = fixture({
    list: { files: Array.from({ length: 101 }, (_, i) => entry({ id: `id_${i}` })) },
  });
  assertError(await invoke(tooMany.handler, 'list'), 'too-large', 413);
  for (const continued of [false, true]) {
    let page = 0;
    const fx = fixture({
      list: () => {
        const current = page++;
        return {
          files: Array.from({ length: 100 }, (_, i) => entry({ id: `id_${current}_${i}` })),
          ...(continued || current < 9 ? { nextPageToken: `page_${current + 1}` } : {}),
        };
      },
    });
    const result = await invoke(fx.handler, 'list');
    if (continued) assertError(result, 'too-large', 413);
    else assert.equal(result.data.backups.length, 1000);
    assert.equal(fx.calls.length, 12);
  }
});

test('untrusted file metadata fails closed in both listings and download preflight', async () => {
  for (const changes of [
    { id: '' },
    { id: '../file' },
    { id: 'https://evil.example' },
    { id: 'a'.repeat(201) },
    { name: 'foreign.roamlet' },
    { name: NAME.replace('-4123-', '-1123-') },
    { parents: [] },
    { parents: ['other-folder'] },
    { parents: 'appDataFolder' },
    { parents: ['appDataFolder', 1] },
    { mimeType: 'application/vnd.google-apps.folder' },
    { appProperties: {} },
    { appProperties: { roamlet: 'foreign' } },
    { appProperties: null },
    { trashed: true },
    { size: '060' },
    { size: '0' },
    { size: '51' },
    { size: 60 },
    { size: '60.0' },
    { size: '-1' },
  ]) {
    const fx = fixture({ list: { files: [entry(changes)] }, metadata: entry(changes) });
    assertError(await invoke(fx.handler, 'list'), 'invalid-data', 502);
    assertError(await invoke(fx.handler, 'download', { query: download }), 'invalid-data', 502);
    assert.ok(!fx.calls.some(({ url }) => url.includes('alt=media')));
  }
  const fx = fixture({ list: { files: [entry({ size: String(TRANSPORT_LIMIT + 1) })] } });
  assertError(await invoke(fx.handler, 'list'), 'too-large', 413);
});

test('upload preserves raw ciphertext bytes, generates distinct immutable names and validates returned identity/size', async () => {
  const fx = fixture();
  const first = await invoke(fx.handler, 'upload', {
    method: 'POST',
    headers: { ...mutation, 'content-length': '60' },
    body: data(),
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.backup.id, ID);
  assert.equal(first.data.backup.size, 60);
  const second = await invoke(fx.handler, 'upload', {
    method: 'POST',
    headers: mutation,
    body: data(),
    req: undefined,
  });
  assert.notEqual(first.data.backup.name, second.data.backup.name);
  const uploads = fx.calls.filter(({ url }) => url.includes('/upload/'));
  assert.notEqual(uploads[0].init.headers['Content-Type'], uploads[1].init.headers['Content-Type']);
  const url = new URL(uploads[0].url);
  assert.equal(url.searchParams.get('uploadType'), 'multipart');
  assert.equal(url.searchParams.get('fields'), 'id,name,size,parents,appProperties,mimeType');
  for (const upload of [
    entry(),
    entry({ size: '61' }),
    entry({ parents: ['other'] }),
    entry({ size: String(TRANSPORT_LIMIT + 1) }),
  ]) {
    const rejected = await invoke(fixture({ upload }).handler, 'upload', {
      method: 'POST',
      headers: mutation,
      body: data(),
    });
    assert.equal(rejected.status, upload.size === String(TRANSPORT_LIMIT + 1) ? 413 : 502);
  }
});

test('upload supports Vercel Buffer and local streams, min/max cipher sizes and exact content length', async () => {
  for (const size of [52, TRANSPORT_LIMIT]) {
    const bytes = data(size);
    const fx = fixture({}, { bytes });
    assert.equal(
      (
        await invoke(fx.handler, 'upload', {
          method: 'POST',
          headers: { ...mutation, 'content-length': String(size) },
          body: bytes,
        })
      ).status,
      200,
    );
  }
  const stream = Readable.from([data().subarray(0, 17), data().subarray(17)]);
  assert.equal(
    (await invoke(fixture().handler, 'upload', { method: 'POST', headers: mutation, req: stream }))
      .status,
    200,
  );
  for (const [body, headers, code, status] of [
    [data(51), mutation, 'invalid-data', 400],
    [Buffer.alloc(60), mutation, 'invalid-data', 400],
    [data(TRANSPORT_LIMIT + 1), mutation, 'too-large', 413],
    [data(), { ...mutation, 'content-length': '61' }, 'invalid-data', 400],
    [data(), { ...mutation, 'content-length': String(TRANSPORT_LIMIT + 1) }, 'too-large', 413],
    [data(), { ...mutation, 'content-type': 'application/json' }, 'invalid-data', 415],
    ['ROAMLET', mutation, 'invalid-data', 400],
  ]) {
    const fx = fixture();
    assertError(
      await invoke(fx.handler, 'upload', { method: 'POST', headers, body }),
      code,
      status,
    );
    assert.equal(fx.calls.length, 0);
  }
  const oversize = Readable.from([data(TRANSPORT_LIMIT), Buffer.alloc(1)]);
  assertError(
    await invoke(fixture().handler, 'upload', { method: 'POST', headers: mutation, req: oversize }),
    'too-large',
    413,
  );
});

test('download validates id/size before transport, then metadata, binary length and cipher magic', async () => {
  const fx = fixture();
  const response = await invoke(fx.handler, 'download', { query: download });
  assert.equal(response.status, 200);
  assert.deepEqual(response.raw, data());
  assert.equal(response.headers['content-type'], 'application/octet-stream');
  assert.equal(response.headers['content-length'], 60);
  assert.equal(
    fx.calls[1].url,
    `https://www.googleapis.com/drive/v3/files/${ID}?fields=id%2Cname%2Csize%2Cparents%2CappProperties%2CmimeType`,
  );
  assert.equal(
    fx.calls[2].url,
    'https://www.googleapis.com/drive/v3/files/appDataFolder?fields=id',
  );
  assert.equal(fx.calls[3].url, `https://www.googleapis.com/drive/v3/files/${ID}?alt=media`);
  for (const query of [
    '&id=../file&size=60',
    '&id=https://evil.example&size=60',
    `&id=${'a'.repeat(201)}&size=60`,
    `&id=${ID}&size=060`,
    `&id=${ID}&size=0`,
    `&id=${ID}&size=51`,
    `&id=${ID}`,
  ]) {
    const rejected = fixture();
    assertError(await invoke(rejected.handler, 'download', { query }), 'invalid-data', 400);
    assert.equal(rejected.calls.length, 0);
  }
  assertError(
    await invoke(fixture().handler, 'download', { query: `&id=${ID}&size=${TRANSPORT_LIMIT + 1}` }),
    'too-large',
    413,
  );
  for (const overrides of [
    { metadata: entry({ id: 'another' }) },
    { metadata: entry({ size: '61' }) },
    { media: () => new Response(data(59)) },
    { media: () => new Response(Buffer.alloc(60)) },
  ])
    assertError(
      await invoke(fixture(overrides).handler, 'download', { query: download }),
      'invalid-data',
      502,
    );
  assertError(
    await invoke(fixture({ media: () => new Response(data(61)) }).handler, 'download', {
      query: download,
    }),
    'too-large',
    413,
  );
  assert.equal(
    (
      await invoke(
        fixture({
          metadata: entry({ size: String(TRANSPORT_LIMIT) }),
          media: () => new Response(data(TRANSPORT_LIMIT)),
        }).handler,
        'download',
        { query: `&id=${ID}&size=${TRANSPORT_LIMIT}` },
      )
    ).raw.length,
    TRANSPORT_LIMIT,
  );
});

test('logout uses fixed form revocation and always clears both cookies, even on failure/timeout', async () => {
  for (const overrides of [
    {},
    {
      revoke: () => {
        throw new Error('private provider failure');
      },
    },
    { revoke: new Response('{}', { status: 500 }) },
    { revoke: () => new Promise(() => {}) },
  ]) {
    const fx = fixture(overrides, { timeoutMs: 15 });
    const response = await invoke(fx.handler, 'logout', { method: 'POST', headers: mutation });
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, {});
    assert.equal(response.headers['set-cookie'].length, 2);
    assert.ok(
      response.headers['set-cookie'].every((item) =>
        /Max-Age=0; HttpOnly; SameSite=Lax; Secure/.test(item),
      ),
    );
    assert.equal(fx.calls[0].url, 'https://oauth2.googleapis.com/revoke');
    assert.equal(fx.calls[0].init.headers.Authorization, undefined);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(fx.calls[0].init.body)), {
      token: TOKEN,
    });
  }
  const fx = fixture();
  assert.equal(
    (await invoke(fx.handler, 'logout', { method: 'POST', headers: { ...mutation, cookie: '' } }))
      .status,
    200,
  );
  assert.equal(fx.calls.length, 0);
});

test('upstream failures use safe ConnectorError codes, no provider messages or tokens', async () => {
  for (const [status, code, expected] of [
    [401, 'auth', 401],
    [403, 'permission', 403],
    [404, 'not-found', 404],
    [429, 'quota', 429],
    [409, 'conflict', 409],
    [500, 'unavailable', 502],
  ]) {
    const fx = fixture({
      list: new Response(JSON.stringify({ error: { message: `${TOKEN} ${SECRET}` } }), { status }),
    });
    assertError(await invoke(fx.handler, 'list'), code, expected);
  }
  const quota = fixture({
    list: Response.json(
      { error: { errors: [{ reason: 'storageQuotaExceeded' }] } },
      { status: 403 },
    ),
  });
  assertError(await invoke(quota.handler, 'list'), 'quota', 429);
  assertError(
    await invoke(
      fixture({
        user: () => {
          throw new Error(TOKEN);
        },
      }).handler,
      'check',
    ),
    'network',
    502,
  );
  const malformed = fixture({ list: new Response('not-json') });
  assertError(await invoke(malformed.handler, 'list'), 'invalid-data', 502);
  assert.ok(new ConnectorError('timeout', 504) instanceof Error);
});

test('bounded response consumption rejects headers, actual overflows and length mismatches; cancels reader', async () => {
  for (const list of [
    new Response('{}', { headers: { 'content-length': String(256 * 1024 + 1) } }),
    new Response('{}', { headers: { 'content-length': 'invalid' } }),
    new Response('a'.repeat(256 * 1024 + 1)),
  ])
    assertError(await invoke(fixture({ list }).handler, 'list'), 'too-large', 413);
  assertError(
    await invoke(
      fixture({ list: new Response('{}', { headers: { 'content-length': '3' } }) }).handler,
      'list',
    ),
    'invalid-data',
    502,
  );
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.alloc(256 * 1024 + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  assertError(
    await invoke(fixture({ list: new Response(stream) }).handler, 'list'),
    'too-large',
    413,
  );
  assert.equal(cancelled, true);
});

test('deadline covers fetch, upstream bodies and local upload stream; cancellation cleans lifetime listeners', async () => {
  let signal;
  const fetchTimeout = fixture(
    {},
    {
      timeoutMs: 15,
      fetcher: (_url, init) => {
        signal = init.signal;
        return new Promise(() => {});
      },
    },
  );
  const result = await invoke(fetchTimeout.handler, 'check');
  assertError(result, 'timeout', 504);
  assert.equal(signal.aborted, true);
  assert.equal(result.req.listenerCount('aborted'), 0);
  assert.equal(result.res.listenerCount('close'), 0);
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('{'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const bodyTimeout = fixture({ list: new Response(stream) }, { timeoutMs: 15 });
  assertError(await invoke(bodyTimeout.handler, 'list'), 'timeout', 504);
  assert.equal(cancelled, true);
  const req = new EventEmitter();
  req.resume = () => {};
  const waitingUpload = await invoke(fixture({}, { timeoutMs: 15 }).handler, 'upload', {
    method: 'POST',
    headers: mutation,
    req,
  });
  assertError(waitingUpload, 'timeout', 504);
  for (const event of ['data', 'end', 'error', 'aborted'])
    assert.equal(req.listenerCount(event), 0);
  for (const event of ['aborted', 'close']) {
    let pendingReq;
    let pendingRes;
    const handler = createGoogleDriveHandler({
      getConfig: () => config(),
      now: () => NOW,
      fetcher: (_url, init) => {
        if (event === 'aborted') pendingReq.emit('aborted');
        else pendingRes.emit('close');
        signal = init.signal;
        return new Promise(() => {});
      },
    });
    const cancelledResponse = await invoke(handler, 'check', {
      onResponse: (res, request) => {
        pendingRes = res;
        pendingReq = request;
      },
    });
    assertError(cancelledResponse, 'network', 499);
    assert.equal(signal.aborted, true);
  }
});

test('real local HTTP streams ciphertext through shared handler without UTF-8 conversion', async (t) => {
  const fx = fixture();
  const server = createServer((req, res) => {
    void fx.handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path: '/api/google-drive?action=upload',
        method: 'POST',
        headers: { ...mutation, host: 'roamlet.example', cookie: sessionCookie() },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          }),
        );
        res.on('error', reject);
      },
    );
    request.on('error', reject);
    request.write(data().subarray(0, 11));
    request.end(data().subarray(11));
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.backup.size, 60);
  assert.equal(fx.calls.length, 4);
});

test('OAuth exchange streams are bounded and timed out with sanitized callback redirect and state deletion', async () => {
  for (const token of [
    new Response('a'.repeat(16 * 1024 + 1)),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('{'));
        },
      }),
    ),
    new Response('{}', { status: 400 }),
  ]) {
    const fx = fixture({ token }, { timeoutMs: 15 });
    const response = await oauth(fx);
    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/?connectors=google-drive&google=error');
    assert.match(response.headers['set-cookie'], /Max-Age=0/);
    assert.equal(fx.calls.length, 1);
  }
});

test('maximum valid identity/token fits encrypted cookie budget and invalid byte lengths fail closed', () => {
  const payload = {
    token: 'a'.repeat(1024),
    accountId: 's'.repeat(255),
    email: 'a'.repeat(242) + '@example.com',
    issuedAt: NOW,
    expiresAt: NOW + 3600_000,
  };
  const value = cookie(config(), 'session', seal(config(), 'session', payload), 3600);
  assert.ok(value.length < 4096);
  assert.deepEqual(
    openCookie({ headers: { cookie: value.split(';')[0] } }, config(), 'session', NOW),
    payload,
  );
  for (const email of ['a\0@example.com', 'a\x7f@example.com', 'é'.repeat(130) + '@example.com'])
    assert.equal(
      openCookie({ headers: { cookie: sessionCookie({ email }) } }, config(), 'session', NOW),
      null,
    );
  for (const callback of [
    'https://roamlet.example/api/google-drive?action=callback#',
    'https://roamlet.example:443/api/google-drive?action=callback',
  ])
    assert.equal(googleDriveConfig({ ...env(), GOOGLE_DRIVE_CALLBACK_URL: callback }), null);
});

test('upload preflight refuses 1000 existing backups without a provider POST', async () => {
  let page = 0;
  const fx = fixture({
    list: () => {
      const current = page++;
      return {
        files: Array.from({ length: 100 }, (_, i) => entry({ id: `full_${current}_${i}` })),
        ...(current < 9 ? { nextPageToken: `full_page_${current + 1}` } : {}),
      };
    },
  });
  const result = await invoke(fx.handler, 'upload', {
    method: 'POST',
    headers: mutation,
    body: data(),
  });
  assertError(result, 'too-large', 413);
  assert.equal(page, 10);
  assert.ok(fx.calls.every(({ init }) => init.method === 'GET'));
  assert.equal(fx.calls.length, 12);
});

test('upload preflight allows 999 existing backups and creates one new immutable snapshot', async () => {
  let page = 0;
  const fx = fixture({
    list: () => {
      const current = page++;
      return {
        files: Array.from({ length: current === 9 ? 99 : 100 }, (_, i) =>
          entry({ id: `almost_full_${current}_${i}` }),
        ),
        ...(current < 9 ? { nextPageToken: `page_${current + 1}` } : {}),
      };
    },
  });
  const result = await invoke(fx.handler, 'upload', {
    method: 'POST',
    headers: mutation,
    body: data(),
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.backup.size, 60);
  assert.equal(page, 10);
  assert.equal(fx.calls.length, 13);
  const uploads = fx.calls.filter(({ init }) => init.method === 'POST');
  assert.equal(uploads.length, 1);
  assert.equal(new URL(uploads[0].url).pathname, '/upload/drive/v3/files');
  assert.equal(fx.calls.at(-1), uploads[0]);
  assert.equal(uploads[0].init.body.includes(Buffer.from('almost_full_')), false);
});

test('upload preflight reuses bounded listing and rejects duplicate IDs, repeated tokens and oversized metadata', async () => {
  for (const list of [
    { files: [entry(), entry()] },
    { files: [], nextPageToken: 'repeated_page' },
    { files: [entry()], nextPageToken: 'duplicate_id_page' },
    new Response('a'.repeat(256 * 1024 + 1)),
    { files: [], nextPageToken: 'https://evil.example/page' },
  ]) {
    const fx = fixture({ list });
    const result = await invoke(fx.handler, 'upload', {
      method: 'POST',
      headers: mutation,
      body: data(),
    });
    assertError(
      result,
      list instanceof Response ? 'too-large' : 'invalid-data',
      list instanceof Response ? 413 : 502,
    );
    assert.ok(fx.calls.every(({ init }) => init.method === 'GET'));
    assert.ok(fx.calls.length <= 4);
  }
});

test('upload preflight shares the original operation deadline and never writes after a stalled listing', async () => {
  let signal;
  const fx = fixture(
    {
      list: (_url, init) => {
        signal = init.signal;
        return new Promise(() => {});
      },
    },
    { timeoutMs: 15 },
  );
  const result = await invoke(fx.handler, 'upload', {
    method: 'POST',
    headers: mutation,
    body: data(),
  });
  assertError(result, 'timeout', 504);
  assert.equal(signal.aborted, true);
  assert.equal(fx.calls.length, 2);
  assert.ok(fx.calls.every(({ init }) => init.signal === signal && init.method === 'GET'));
});

test('canonical appDataFolder parents work for listing, upload and download with one local resolution', async () => {
  for (const action of ['list', 'upload', 'download']) {
    const fx = fixture({}, { folderParent: FOLDER_ID });
    const result = await invoke(
      fx.handler,
      action,
      action === 'upload'
        ? { method: 'POST', headers: mutation, body: data() }
        : { query: action === 'download' ? download : '' },
    );
    assert.equal(result.status, 200);
    const folderCalls = fx.calls.filter(
      ({ url }) => url === 'https://www.googleapis.com/drive/v3/files/appDataFolder?fields=id',
    );
    assert.equal(folderCalls.length, 1);
    assert.equal(folderCalls[0].init.method, 'GET');
    if (action === 'download') assert.deepEqual(result.raw, data());
    if (action === 'upload') assert.equal(result.data.backup.size, 60);
    if (action === 'list')
      assert.deepEqual(result.data.backups, [{ id: ID, name: NAME, size: 60 }]);
  }
});

test('missing appDataFolder never prevents empty listing or first upload; resolve canonical parent after creation', async () => {
  let created = false;
  const fx = fixture(
    {
      list: { files: [] },
      folder: () => (created ? { id: FOLDER_ID } : new Response('{}', { status: 404 })),
    },
    {
      folderParent: FOLDER_ID,
      onUpload: () => {
        created = true;
      },
    },
  );
  assert.deepEqual((await invoke(fx.handler, 'list')).data, { backups: [] });
  assert.equal(
    fx.calls.some(({ url }) => url.includes('/appDataFolder?')),
    false,
  );
  const result = await invoke(fx.handler, 'upload', {
    method: 'POST',
    headers: mutation,
    body: data(),
  });
  assert.equal(result.status, 200);
  assert.equal(created, true);
  const post = fx.calls.findIndex(({ init }) => init.method === 'POST');
  const folder = fx.calls.findIndex(({ url }) => url.includes('/appDataFolder?'));
  assert.ok(post >= 0 && folder > post);
  assert.equal(fx.calls.filter(({ url }) => url.includes('/appDataFolder?')).length, 1);
});

test('canonical parent validation rejects foreign folders and invalid folder resolution without media or upload', async () => {
  for (const folder of [
    { id: '' },
    { id: '../folder' },
    { id: 'a'.repeat(201) },
    null,
    { id: 'foreign-folder' },
  ]) {
    for (const action of ['list', 'upload', 'download']) {
      const fx = fixture({ folder }, { folderParent: FOLDER_ID });
      const result = await invoke(
        fx.handler,
        action,
        action === 'upload'
          ? { method: 'POST', headers: mutation, body: data() }
          : { query: action === 'download' ? download : '' },
      );
      assertError(result, 'invalid-data', 502);
      assert.ok(fx.calls.every(({ init }) => init.method === 'GET'));
      assert.ok(!fx.calls.some(({ url }) => url.includes('alt=media')));
    }
  }
});

test('folder resolution shares operation deadline and bounded response reader', async () => {
  for (const folder of [() => new Promise(() => {}), new Response('a'.repeat(16 * 1024 + 1))]) {
    const fx = fixture({ folder }, { timeoutMs: 15, folderParent: FOLDER_ID });
    const result = await invoke(fx.handler, 'upload', {
      method: 'POST',
      headers: mutation,
      body: data(),
    });
    assertError(
      result,
      folder instanceof Response ? 'too-large' : 'timeout',
      folder instanceof Response ? 413 : 504,
    );
    assert.ok(fx.calls.every(({ init }) => init.method === 'GET'));
  }
});
