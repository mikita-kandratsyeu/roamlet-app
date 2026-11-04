import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import calendarApi from '../api/google-calendar.mjs';
import { createGoogleCalendarHandler } from './google-calendar-handlers.mjs';
import { CALENDAR_SCOPE, SCOPES, eventLink, validScopes } from './google-calendar-client.mjs';
import { BODY_LIMIT, publication } from './google-calendar-contract.mjs';
import {
  cookie,
  cookieName,
  googleCalendarConfig,
  openCookie,
  seal,
  TARGET_SECONDS,
} from './google-calendar-session.mjs';
import { cookie as driveCookie, seal as driveSeal } from './google-drive-session.mjs';
const NOW = 1800000000000;
const ORIGIN = 'https://roamlet.example';
const TOKEN = 'synthetic-calendar-token';
const SECRET = 'synthetic-calendar-secret';
const USER = { sub: 'synthetic-google-account', email: 'alice@example.com', email_verified: true };
const CALENDAR = 'synthetic-calendar@group.calendar.google.com';
const ID = '0123456789abcdefghijklmnopqrstuv';
const LINK = 'https://www.google.com/calendar/event?eid=c3ludGhldGlj';
const env = () => ({
  GOOGLE_CALENDAR_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
  GOOGLE_CALENDAR_CLIENT_SECRET: SECRET,
  GOOGLE_CALENDAR_CALLBACK_URL: `${ORIGIN}/api/google-calendar?action=callback`,
  GOOGLE_CALENDAR_SESSION_SECRET: Buffer.alloc(32, 17).toString('base64'),
});
const config = () => googleCalendarConfig(env());
const event = (overrides = {}) => ({
  eventId: ID,
  summary: 'Synthetic walk',
  description: 'Only explicitly supplied contents\nsecond line',
  location: 'Synthetic park',
  start: { dateTime: '2026-11-04T10:00:00+03:00', timeZone: 'Europe/Minsk' },
  end: { dateTime: '2026-11-04T12:00:00+03:00', timeZone: 'Europe/Minsk' },
  reminderMinutes: 30,
  ...overrides,
});
function encrypted(purpose, payload, cfg = config()) {
  return cookie(
    cfg,
    purpose,
    seal(cfg, purpose, { issuedAt: NOW - 1000, expiresAt: NOW + 60000, ...payload }),
    60,
  ).split(';')[0];
}
const session = (overrides = {}) =>
  encrypted('session', { token: TOKEN, accountId: USER.sub, email: USER.email, ...overrides });
const target = (overrides = {}) =>
  encrypted('target', { calendarId: CALENDAR, accountId: USER.sub, ...overrides });
const mutation = { origin: ORIGIN, 'x-roamlet-request': '1', 'content-type': 'application/json' };
const providerEvent = (overrides = {}) => ({
  id: ID,
  htmlLink: LINK,
  etag: '"synthetic-etag"',
  extendedProperties: { private: { roamlet: ID } },
  ...overrides,
});
function fixture(overrides = {}, options = {}) {
  const calls = [];
  const logs = [];
  const responses = {
    token: {
      access_token: TOKEN,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: SCOPES,
      refresh_token: 'synthetic-discard-refresh',
    },
    identity: USER,
    calendar: { id: CALENDAR },
    insert: providerEvent(),
    get: providerEvent(),
    update: providerEvent(),
    ...overrides,
  };
  const fetcher = async (url, init) => {
    const parsed = new URL(url);
    let key;
    if (url === 'https://oauth2.googleapis.com/token') key = 'token';
    else if (url === 'https://openidconnect.googleapis.com/v1/userinfo') key = 'identity';
    else {
      assert.equal(parsed.origin, 'https://www.googleapis.com');
      if (parsed.pathname === '/calendar/v3/calendars') key = 'calendar';
      else if (parsed.pathname === `/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events`)
        key = 'insert';
      else if (
        parsed.pathname === `/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events/${ID}`
      )
        key = init.method === 'GET' ? 'get' : 'update';
      else assert.fail(`Unexpected path ${parsed.pathname}`);
      assert.ok(!parsed.pathname.includes('calendarList'));
    }
    calls.push({ url, init, key });
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    if (key !== 'token') assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    const value =
      typeof responses[key] === 'function' ? await responses[key](url, init) : responses[key];
    return value instanceof Response ? value : Response.json(value);
  };
  return {
    calls,
    logs,
    handler: createGoogleCalendarHandler({
      getConfig: config,
      fetcher,
      now: () => NOW,
      logger: (entry) => logs.push(entry),
      ...options,
    }),
  };
}
async function invoke(
  handler,
  action = 'session',
  { method = 'GET', query = '', headers = {}, body, req: supplied } = {},
) {
  const req = supplied ?? new EventEmitter();
  Object.assign(req, {
    method,
    url: `/api/google-calendar?action=${action}${query}`,
    headers: { host: 'roamlet.example', cookie: session(), ...headers },
    ...(body === undefined ? {} : { body }),
  });
  const res = new EventEmitter();
  const out = {};
  res.setHeader = (name, value) => {
    out[name.toLowerCase()] = value;
  };
  res.end = (raw) => {
    res.raw = raw;
    res.writableEnded = true;
  };
  await handler(req, res);
  assert.equal(out['cache-control'], 'no-store');
  assert.equal(out['referrer-policy'], 'no-referrer');
  assert.equal(out['x-content-type-options'], 'nosniff');
  for (const secret of [TOKEN, SECRET, 'synthetic-discard-refresh']) {
    assert.ok(!JSON.stringify(out).includes(secret));
    assert.ok(!String(res.raw).includes(secret));
  }
  return { status: res.statusCode, headers: out, data: res.raw ? JSON.parse(res.raw) : undefined };
}
const publish = (fx, body = event(), headers = {}, options = {}) =>
  invoke(fx.handler, 'publish', {
    method: 'POST',
    body,
    headers: { ...mutation, ...headers },
    ...options,
  });
function error(response, code, status) {
  assert.equal(response.status, status);
  assert.deepEqual(response.data, {
    error: { code, message: 'Google Calendar connector request failed.' },
  });
}
async function oauth(fx, extra = '', cookies) {
  const start = await invoke(fx.handler, 'start');
  const url = new URL(start.headers.location);
  const state = url.searchParams.get('state');
  const saved = start.headers['set-cookie'].split(';')[0];
  return invoke(fx.handler, 'callback', {
    query: `&code=synthetic-code&state=${state}${extra}`,
    headers: { cookie: cookies ?? saved, 'sec-fetch-site': 'cross-site' },
  });
}
test('thin entrypoint, strict independent configuration and HTTPS cookies', async () => {
  assert.equal(typeof calendarApi, 'function');
  assert.ok(config().secure);
  for (const change of [
    { GOOGLE_CALENDAR_CLIENT_ID: '' },
    { GOOGLE_CALENDAR_CLIENT_ID: 'bad id' },
    { GOOGLE_CALENDAR_CLIENT_SECRET: 'bad\nsecret' },
    { GOOGLE_CALENDAR_SESSION_SECRET: Buffer.alloc(31).toString('base64') },
    { GOOGLE_CALENDAR_SESSION_SECRET: Buffer.alloc(32).toString('base64').replace(/=$/, '') },
    { GOOGLE_CALENDAR_CALLBACK_URL: `${ORIGIN}/api/google-drive?action=callback` },
    { GOOGLE_CALENDAR_CALLBACK_URL: `${ORIGIN}/api/google-calendar?action=callback#` },
    { GOOGLE_CALENDAR_CALLBACK_URL: 'http://remote.example/api/google-calendar?action=callback' },
    { GOOGLE_CALENDAR_CALLBACK_URL: `${ORIGIN}/api/google-calendar?action=callback&extra=1` },
  ])
    assert.equal(googleCalendarConfig({ ...env(), ...change }), null);
  assert.equal(
    googleCalendarConfig({
      ...env(),
      GOOGLE_CALENDAR_CALLBACK_URL: 'http://127.0.0.1:5173/api/google-calendar?action=callback',
    }).secure,
    false,
  );
  const response = await invoke(fixture({}, { getConfig: () => null }).handler);
  assert.deepEqual(response.data, { available: false, connected: false });
});
test('PKCE start requests only isolated Calendar access and encrypted 10 minute state', async () => {
  const fx = fixture();
  const response = await invoke(fx.handler, 'start');
  const url = new URL(response.headers.location);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), SCOPES);
  assert.equal(url.searchParams.get('access_type'), 'online');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.ok(!url.href.includes('drive.'));
  const saved = response.headers['set-cookie'];
  assert.match(
    saved,
    /__Host-roamlet-google-calendar-state=.*Max-Age=600; HttpOnly; SameSite=Lax; Secure/,
  );
  const state = openCookie({ headers: { cookie: saved } }, config(), 'state', NOW);
  assert.equal(state.state, url.searchParams.get('state'));
  assert.equal(
    createHash('sha256').update(state.verifier).digest('base64url'),
    url.searchParams.get('code_challenge'),
  );
  assert.equal(fx.calls.length, 0);
});
test('callback exchanges PKCE, verifies identity, discards refresh and caps expiry', async () => {
  const fx = fixture({
    token: {
      access_token: TOKEN,
      token_type: 'bearer',
      expires_in: 7200,
      scope: SCOPES,
      refresh_token: 'synthetic-discard-refresh',
    },
  });
  const result = await oauth(fx);
  assert.equal(result.headers.location, '/?connectors=google-calendar&calendar=connected');
  assert.deepEqual(
    fx.calls.map((call) => call.key),
    ['token', 'identity'],
  );
  const form = new URLSearchParams(fx.calls[0].init.body);
  assert.equal(form.get('redirect_uri'), config().callback);
  assert.match(form.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
  const saved = result.headers['set-cookie'][1];
  const decoded = openCookie({ headers: { cookie: saved } }, config(), 'session', NOW);
  assert.equal(decoded.expiresAt, NOW + 3600000);
  assert.equal(decoded.refresh_token, undefined);
  const status = await invoke(fx.handler, 'session', { headers: { cookie: saved } });
  assert.deepEqual(status.data, {
    available: true,
    connected: true,
    accountId: USER.sub,
    email: USER.email,
    expiresAt: NOW + 3600000,
  });
});
test('callback rejects invalid state, issuer, duplicate keys and provider errors without exchange', async () => {
  for (const extra of [
    '&iss=https://evil.example',
    '&error=access_denied',
    '&state=duplicate',
    '&code=duplicate',
    '&extra=1',
    '&scope=openid',
  ]) {
    const fx = fixture();
    assert.equal(
      (await oauth(fx, extra)).headers.location,
      '/?connectors=google-calendar&calendar=error',
    );
    assert.equal(fx.calls.length, 0);
  }
  const fx = fixture();
  assert.equal(
    (await oauth(fx, '', '')).headers.location,
    '/?connectors=google-calendar&calendar=error',
  );
  assert.equal(fx.calls.length, 0);
});
test('scope isolation rejects broad/shared grants and malformed tokens/identities', async () => {
  assert.ok(validScopes(`openid https://www.googleapis.com/auth/userinfo.email ${CALENDAR_SCOPE}`));
  for (const scope of [
    undefined,
    'openid email',
    `${SCOPES} https://www.googleapis.com/auth/drive.appdata`,
    `${SCOPES} https://www.googleapis.com/auth/calendar`,
    `${SCOPES} profile`,
  ]) {
    const fx = fixture({
      token: { access_token: TOKEN, token_type: 'Bearer', expires_in: 3600, scope },
    });
    assert.equal((await oauth(fx)).headers.location, '/?connectors=google-calendar&calendar=error');
    assert.deepEqual(
      fx.calls.map((call) => call.key),
      ['token'],
    );
  }
  for (const overrides of [
    { token: { access_token: TOKEN, token_type: 'Bearer', expires_in: 0, scope: SCOPES } },
    { identity: { ...USER, email_verified: false } },
    { identity: { ...USER, sub: '' } },
    { token: () => new Response('{}', { status: 400 }) },
  ])
    assert.equal(
      (await oauth(fixture(overrides))).headers.location,
      '/?connectors=google-calendar&calendar=error',
    );
});
test('cookies reject cross-provider/purpose/origin/client replay, duplicate, expiry, unknown fields and long targets', () => {
  const cfg = config();
  const payload = {
    token: TOKEN,
    accountId: USER.sub,
    email: USER.email,
    issuedAt: NOW,
    expiresAt: NOW + 60000,
  };
  const read = (raw, purpose = 'session', other = cfg) =>
    openCookie({ headers: { cookie: raw } }, other, purpose, NOW);
  const drive = driveCookie(cfg, 'session', driveSeal(cfg, 'session', payload), 60).split(';')[0];
  assert.equal(read(drive.replace('google-drive', 'google-calendar')), null);
  assert.equal(read(session(), 'target'), null);
  assert.equal(read(`${session()}; ${session()}`), null);
  assert.equal(read(session({ expiresAt: NOW })), null);
  assert.equal(read(session({ expiresAt: NOW + 3600001, issuedAt: NOW })), null);
  assert.equal(read(session({ extra: 'not allowed' })), null);
  assert.equal(read(session(), 'session', { ...cfg, origin: 'https://other.example' }), null);
  assert.equal(read(session(), 'session', { ...cfg, clientId: 'other' }), null);
  assert.equal(
    read(target({ issuedAt: NOW, expiresAt: NOW + TARGET_SECONDS * 1000 + 1 }), 'target'),
    null,
  );
  assert.equal(read(target({ token: TOKEN }), 'target'), null);
  assert.ok(read(target(), 'target'));
  assert.notEqual(cookieName(cfg, 'session'), cookieName(cfg, 'target'));
});
test('first publish creates app-owned calendar and emits token-free account-bound reusable target', async () => {
  const fx = fixture();
  const result = await publish(fx);
  assert.deepEqual(result.data, { eventId: ID, htmlLink: LINK });
  assert.deepEqual(
    fx.calls.map((call) => call.key),
    ['identity', 'calendar', 'insert'],
  );
  assert.deepEqual(JSON.parse(fx.calls[1].init.body), { summary: 'Roamlet' });
  const sent = JSON.parse(fx.calls[2].init.body);
  assert.deepEqual(sent, {
    id: ID,
    summary: event().summary,
    description: event().description,
    location: event().location,
    start: event().start,
    end: event().end,
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
    extendedProperties: { private: { roamlet: ID } },
  });
  const saved = result.headers['set-cookie'];
  const decoded = openCookie({ headers: { cookie: saved } }, config(), 'target', NOW);
  assert.deepEqual(decoded, {
    calendarId: CALENDAR,
    accountId: USER.sub,
    issuedAt: NOW,
    expiresAt: NOW + TARGET_SECONDS * 1000,
  });
  assert.match(saved, /Max-Age=31536000/);
  const next = await publish(fx, event(), { cookie: `${session()}; ${saved.split(';')[0]}` });
  assert.equal(next.status, 200);
  assert.equal(fx.calls.filter((call) => call.key === 'calendar').length, 1);
});
test('target survives local disconnect and reauthorization, without revoking shared Drive grants', async () => {
  const fx = fixture();
  const result = await invoke(fx.handler, 'logout', { method: 'POST', headers: mutation });
  assert.equal(result.status, 200);
  assert.equal(fx.calls.length, 0);
  assert.equal(result.headers['set-cookie'].length, 2);
  assert.ok(
    result.headers['set-cookie'].every(
      (value) => !value.includes('-target') && !value.includes('drive'),
    ),
  );
  const connected = await oauth(fx);
  await publish(fx, event(), {
    cookie: `${connected.headers['set-cookie'][1].split(';')[0]}; ${target()}`,
  });
  assert.equal(fx.calls.filter((call) => call.key === 'calendar').length, 0);
});
test('target belongs to authenticated account, not client input; changed identities fail closed', async () => {
  const fx = fixture();
  await publish(fx, event(), {
    cookie: `${session()}; ${target({ accountId: 'different-account' })}`,
  });
  assert.equal(fx.calls.filter((call) => call.key === 'calendar').length, 1);
  const mismatch = fixture({ identity: { ...USER, sub: 'changed-account' } });
  error(await publish(mismatch), 'auth', 401);
  assert.deepEqual(
    mismatch.calls.map((call) => call.key),
    ['identity'],
  );
  const invalid = fixture();
  error(await publish(invalid, event({ calendarId: 'arbitrary' })), 'invalid-data', 400);
  assert.equal(invalid.calls.length, 0);
});
test('deterministic ID collision updates only marked own event with conditional ETag and no invitations', async () => {
  const fx = fixture({ insert: () => new Response('{}', { status: 409 }) });
  const result = await publish(fx, event({ summary: 'Explicit update' }), {
    cookie: `${session()}; ${target()}`,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(
    fx.calls.map((call) => call.key),
    ['identity', 'insert', 'get', 'update'],
  );
  const update = fx.calls.at(-1);
  assert.equal(update.init.method, 'PATCH');
  assert.equal(update.init.headers['If-Match'], '"synthetic-etag"');
  assert.equal(new URL(update.url).searchParams.get('sendUpdates'), 'none');
  assert.equal(JSON.parse(update.init.body).id, undefined);
  assert.equal(JSON.parse(update.init.body).summary, 'Explicit update');
});
test('conflicts never overwrite unmarked, mismatched, deleted or raced events', async () => {
  for (const existing of [
    providerEvent({ extendedProperties: {} }),
    providerEvent({ id: 'other' }),
    providerEvent({ etag: undefined }),
    providerEvent({ status: 'cancelled' }),
    providerEvent({ extendedProperties: { private: { roamlet: 'other' } } }),
  ]) {
    const fx = fixture({ insert: () => new Response('{}', { status: 409 }), get: existing });
    error(await publish(fx, event(), { cookie: `${session()}; ${target()}` }), 'conflict', 409);
    assert.ok(!fx.calls.some((call) => call.key === 'update'));
  }
  const fx = fixture({
    insert: () => new Response('{}', { status: 409 }),
    update: () => new Response('{}', { status: 412 }),
  });
  error(await publish(fx, event(), { cookie: `${session()}; ${target()}` }), 'conflict', 409);
  assert.equal(fx.calls.filter((call) => call.key === 'update').length, 1);
});
test('uncertain inserted event response retry reuses calendar and ID instead of duplicating event', async () => {
  let inserts = 0;
  const fx = fixture({
    insert: () => {
      if (++inserts === 1) throw new Error('synthetic uncertain write');
      return new Response('{}', { status: 409 });
    },
  });
  const first = await publish(fx);
  error(first, 'network', 502);
  const second = await publish(fx, event(), {
    cookie: `${session()}; ${first.headers['set-cookie'].split(';')[0]}`,
  });
  assert.equal(second.status, 200);
  assert.equal(fx.calls.filter((call) => call.key === 'calendar').length, 1);
  assert.equal(fx.calls.filter((call) => call.key === 'update').length, 1);
});
test('publication strictly validates fields, text bounds, dates, civil time, offsets and supported IANA zones', async () => {
  for (const change of [
    { eventId: 'w'.repeat(32) },
    { eventId: 'a'.repeat(31) },
    { summary: '' },
    { summary: 'x'.repeat(201) },
    { summary: 'bad\nsummary' },
    { description: 'x'.repeat(4001) },
    { location: 'x'.repeat(501) },
    { reminderMinutes: -1 },
    { reminderMinutes: 40321 },
    { reminderMinutes: 1.5 },
    { geometry: [] },
    { start: { ...event().start, extra: true } },
    { start: { dateTime: '2026-02-30T10:00:00+03:00', timeZone: 'Europe/Minsk' } },
    { start: { dateTime: '2026-11-04T24:00:00+03:00', timeZone: 'Europe/Minsk' } },
    { start: { dateTime: '2026-11-04T10:00:00', timeZone: 'Europe/Minsk' } },
    { start: { dateTime: '2026-11-04T10:00:00+02:00', timeZone: 'Europe/Minsk' } },
    { start: { dateTime: '2026-11-04T10:00:00+03:00', timeZone: 'Invalid/Zone' } },
    { start: { dateTime: '2026-03-08T02:30:00-05:00', timeZone: 'America/New_York' } },
    { end: event().start },
    { end: { dateTime: '2026-11-04T09:00:00+03:00', timeZone: 'Europe/Minsk' } },
  ]) {
    const fx = fixture();
    error(await publish(fx, event(change)), 'invalid-data', 400);
    assert.equal(fx.calls.length, 0);
  }
  for (const offset of ['-04:00', '-05:00'])
    assert.doesNotThrow(() =>
      publication(
        event({
          start: { dateTime: `2026-11-01T01:30:00${offset}`, timeZone: 'America/New_York' },
          end: { dateTime: '2026-11-01T03:00:00-05:00', timeZone: 'America/New_York' },
        }),
      ),
    );
  assert.doesNotThrow(() =>
    publication(
      event({
        summary: 'x'.repeat(200),
        description: 'x'.repeat(4000),
        location: 'x'.repeat(500),
        reminderMinutes: 40320,
      }),
    ),
  );
  assert.doesNotThrow(() =>
    publication(
      event({
        reminderMinutes: 0,
        start: { dateTime: '2026-11-04T07:00:00.123Z', timeZone: 'UTC' },
      }),
    ),
  );
});
test('only bounded canonical provider Calendar event URLs are returned', async () => {
  assert.equal(eventLink(LINK), LINK);
  assert.equal(
    eventLink('https://calendar.google.com/calendar/event?eid=c3ludGhldGlj'),
    'https://calendar.google.com/calendar/event?eid=c3ludGhldGlj',
  );
  assert.equal(eventLink(`${LINK}&sf=true&output=xml`), `${LINK}&sf=true&output=xml`);
  for (const link of [
    'https://evil.example/calendar/event?eid=a',
    'http://www.google.com/calendar/event?eid=a',
    `${LINK}#`,
    `${LINK}&redirect=https://evil.example`,
    'https://www.google.com/calendar/other?eid=a',
    `${LINK}&eid=a`,
    'https://user@www.google.com/calendar/event?eid=a',
    `${LINK}${'a'.repeat(5000)}`,
  ]) {
    const fx = fixture({ insert: providerEvent({ htmlLink: link }) });
    error(await publish(fx), 'invalid-data', 502);
  }
});
test('same-origin, methods, body limits, malformed JSON and unauthenticated requests fail before network', async () => {
  for (const headers of [
    { origin: 'https://evil.example' },
    { 'x-roamlet-request': undefined },
    { 'sec-fetch-site': 'cross-site' },
    { host: 'evil.example' },
  ]) {
    const fx = fixture();
    error(await publish(fx, event(), headers), 'permission', 403);
    assert.equal(fx.calls.length, 0);
  }
  error(await publish(fixture(), event(), { cookie: '' }), 'auth', 401);
  error(await invoke(fixture().handler, 'publish'), 'configuration', 405);
  error(await publish(fixture(), '{invalid'), 'invalid-data', 400);
  error(await publish(fixture(), event(), { 'content-type': 'text/plain' }), 'invalid-data', 415);
  error(await publish(fixture(), 'x'.repeat(BODY_LIMIT + 1)), 'too-large', 413);
  error(
    await publish(fixture(), event(), { 'content-length': String(BODY_LIMIT + 1) }),
    'too-large',
    413,
  );
});
test('provider errors are safe, bounded and metadata-only; no retries on permission/quota/outage', async () => {
  for (const [status, code, expected] of [
    [401, 'auth', 401],
    [403, 'permission', 403],
    [404, 'not-found', 404],
    [429, 'quota', 429],
    [500, 'unavailable', 502],
  ]) {
    const fx = fixture({
      insert: () => new Response(JSON.stringify({ secret: TOKEN, contents: event() }), { status }),
    });
    error(await publish(fx), code, expected);
    assert.equal(fx.calls.filter((call) => call.key === 'insert').length, 1);
    assert.ok(!JSON.stringify(fx.logs).includes(event().summary));
    assert.ok(!JSON.stringify(fx.logs).includes(TOKEN));
  }
  error(
    await publish(fixture({ insert: () => new Response('{', { status: 200 }) })),
    'invalid-data',
    502,
  );
  error(await publish(fixture({ calendar: { id: 'primary' } })), 'invalid-data', 502);
  error(
    await publish(
      fixture({
        insert: () => new Response('x'.repeat(32769), { headers: { 'content-encoding': 'gzip' } }),
      }),
    ),
    'too-large',
    413,
  );
  error(
    await publish(
      fixture({ insert: () => new Response('{}', { headers: { 'content-length': '32769' } }) }),
    ),
    'too-large',
    413,
  );
  error(
    await publish(
      fixture({
        insert: () =>
          new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } }),
      }),
    ),
    'permission',
    403,
  );
});
test('deadline includes fetch, response consumption and request body; cancellation stops further writes', async () => {
  const hanging = fixture({ insert: () => new Promise(() => {}) }, { timeoutMs: 15 });
  error(await publish(hanging), 'timeout', 504);
  const stream = fixture(
    {
      insert: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
            },
          }),
        ),
    },
    { timeoutMs: 15 },
  );
  error(await publish(stream), 'timeout', 504);
  const req = new Readable({ read() {} });
  const waiting = fixture({}, { timeoutMs: 15 });
  error(await publish(waiting, undefined, {}, { req, body: undefined }), 'timeout', 504);
  assert.equal(waiting.calls.length, 0);
  req.destroy();
  const aborted = new EventEmitter();
  aborted.aborted = true;
  const fx = fixture();
  error(await publish(fx, event(), {}, { req: aborted }), 'network', 499);
  assert.equal(fx.calls.length, 0);
});

test('stream and raw body byte counts, UTF-8 and operation bounds are enforced', async () => {
  const bytes = Buffer.from(JSON.stringify(event()));
  const fx = fixture();
  const valid = await publish(
    fx,
    undefined,
    { 'content-length': String(bytes.length) },
    { req: Readable.from([bytes]), body: undefined },
  );
  assert.equal(valid.status, 200);
  error(
    await publish(
      fixture(),
      undefined,
      { 'content-length': String(bytes.length + 1) },
      { req: Readable.from([bytes]), body: undefined },
    ),
    'invalid-data',
    400,
  );
  error(
    await publish(fixture(), bytes, { 'content-length': String(bytes.length + 1) }),
    'invalid-data',
    400,
  );
  error(await publish(fixture(), Buffer.from([0xff])), 'invalid-data', 400);
  error(
    await publish(
      fixture(),
      undefined,
      {},
      { req: Readable.from([Buffer.alloc(BODY_LIMIT + 1)]), body: undefined },
    ),
    'too-large',
    413,
  );
  for (const change of [
    { start: { dateTime: '1899-11-04T07:00:00Z', timeZone: 'UTC' } },
    { end: { dateTime: '2101-11-04T07:00:00Z', timeZone: 'UTC' } },
    { end: { dateTime: '2026-12-03T10:00:00+03:00', timeZone: 'Europe/Minsk' } },
  ])
    error(await publish(fixture(), event(change)), 'invalid-data', 400);
  const normalized = fixture();
  assert.equal(
    (
      await publish(
        normalized,
        event({ start: { dateTime: '2026-11-04T10:00+03:00', timeZone: 'Europe/Minsk' } }),
      )
    ).status,
    200,
  );
  assert.equal(
    JSON.parse(normalized.calls.at(-1).init.body).start.dateTime,
    '2026-11-04T10:00:00+03:00',
  );
});
test('provider decoded Content-Length, quota reasons, callback expiry and response cancellation are bounded', async () => {
  const encoded = fixture({
    insert: () =>
      new Response(JSON.stringify(providerEvent()), {
        headers: { 'content-encoding': 'gzip', 'content-length': '1' },
      }),
  });
  assert.equal((await publish(encoded)).status, 200);
  const wrongLength = fixture({
    insert: () =>
      new Response(JSON.stringify(providerEvent()), { headers: { 'content-length': '1' } }),
  });
  error(await publish(wrongLength), 'invalid-data', 502);
  const quota = fixture({
    insert: () =>
      new Response(JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }), {
        status: 403,
      }),
  });
  error(await publish(quota), 'quota', 429);
  const timed = fixture({ token: () => new Promise(() => {}) }, { timeoutMs: 15 });
  assert.equal(
    (await oauth(timed)).headers.location,
    '/?connectors=google-calendar&calendar=error',
  );
  assert.equal(timed.logs[0].code, 'timeout');
  let time = NOW;
  const expired = fixture(
    {
      identity: () => {
        time += 3600001;
        return USER;
      },
    },
    { now: () => time },
  );
  assert.equal(
    (await oauth(expired)).headers.location,
    '/?connectors=google-calendar&calendar=error',
  );
});

test('event authorization failure preserves newly created target alongside cleared authorization', async () => {
  const fx = fixture({ insert: () => new Response('{}', { status: 401 }) });
  const result = await publish(fx);
  error(result, 'auth', 401);
  const saved = result.headers['set-cookie'].find((value) =>
    value.startsWith(`${cookieName(config(), 'target')}=`),
  );
  assert.ok(openCookie({ headers: { cookie: saved } }, config(), 'target', NOW));
  assert.ok(
    result.headers['set-cookie'].some(
      (value) =>
        value.startsWith(`${cookieName(config(), 'session')}=;`) && value.includes('Max-Age=0'),
    ),
  );
});
