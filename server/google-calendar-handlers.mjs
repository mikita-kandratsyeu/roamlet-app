import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { connectorLogger, logConnectorFailure } from './connector-logging.mjs';
import { headers, json, redirect, requestLifetime, sameOrigin } from './github-http.mjs';
import { object } from './google-drive-client.mjs';
import {
  ConnectorError,
  createGoogleCalendarClient,
  SCOPES,
  validScopes,
} from './google-calendar-client.mjs';
import { readPublication } from './google-calendar-contract.mjs';
import {
  cookie,
  equalState,
  googleCalendarConfig,
  openCookie,
  seal,
  SESSION_SECONDS,
  STATE_SECONDS,
  TARGET_SECONDS,
} from './google-calendar-session.mjs';
const ACTIONS = {
  session: ['GET', []],
  start: ['GET', []],
  logout: ['POST', []],
  publish: ['POST', []],
  callback: [
    'GET',
    [
      'code',
      'state',
      'iss',
      'error',
      'error_description',
      'error_uri',
      'scope',
      'authuser',
      'prompt',
    ],
  ],
};
function parse(req) {
  if (
    typeof req.url !== 'string' ||
    req.url.length > 4096 ||
    !req.url.startsWith('/api/google-calendar?')
  )
    throw new ConnectorError('configuration', 400);
  const url = new URL(req.url, 'https://unused.invalid');
  const action = url.searchParams.get('action');
  if (url.pathname !== '/api/google-calendar' || !Object.hasOwn(ACTIONS, action))
    throw new ConnectorError('configuration', 400);
  const keys = [...url.searchParams.keys()];
  const allowed = new Set(['action', ...ACTIONS[action][1]]);
  if (new Set(keys).size !== keys.length || keys.some((key) => !allowed.has(key)))
    throw new ConnectorError('configuration', 400);
  return { action, params: url.searchParams };
}
export function createGoogleCalendarHandler({
  getConfig = googleCalendarConfig,
  fetcher = globalThis.fetch,
  now = Date.now,
  timeoutMs,
  logger = connectorLogger,
} = {}) {
  const client = createGoogleCalendarClient(fetcher);
  return async function googleCalendarHandler(req, res) {
    const started = performance.now();
    headers(res);
    const lifetime = requestLifetime(req, res, timeoutMs);
    let config;
    let callback = false;
    let actionName = 'invalid';
    let stage = 'request';
    const responseCookies = new Map();
    const setCookies = (values) => {
      for (const value of Array.isArray(values) ? values : [values])
        responseCookies.set(value.split('=')[0], value);
      const all = [...responseCookies.values()];
      res.setHeader('Set-Cookie', all.length === 1 ? all[0] : all);
    };
    try {
      callback =
        typeof req.url === 'string' &&
        new URL(req.url, 'https://unused.invalid').searchParams
          .getAll('action')
          .includes('callback');
      config = getConfig();
      const { action, params } = parse(req);
      actionName = action;
      if (req.method !== ACTIONS[action][0]) {
        res.setHeader('Allow', ACTIONS[action][0]);
        throw new ConnectorError('configuration', 405);
      }
      if (!config) {
        if (action === 'session') return json(res, 200, { available: false, connected: false });
        throw new ConnectorError('unavailable', 503);
      }
      if (
        req.headers?.host !== new URL(config.origin).host ||
        (action !== 'callback' && !sameOrigin(req, config, req.method === 'POST'))
      )
        throw new ConnectorError('permission', 403);
      const session = openCookie(req, config, 'session', now());
      if (action === 'session') {
        if (!session) setCookies(cookie(config, 'session', '', 0));
        return json(res, 200, {
          available: true,
          connected: Boolean(session),
          ...(session
            ? { email: session.email, accountId: session.accountId, expiresAt: session.expiresAt }
            : {}),
        });
      }
      if (action === 'start') {
        const issuedAt = now();
        const state = randomBytes(32).toString('base64url');
        const verifier = randomBytes(32).toString('base64url');
        setCookies(
          cookie(
            config,
            'state',
            seal(config, 'state', {
              state,
              verifier,
              issuedAt,
              expiresAt: issuedAt + STATE_SECONDS * 1000,
            }),
            STATE_SECONDS,
          ),
        );
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: config.callback,
          response_type: 'code',
          scope: SCOPES,
          access_type: 'online',
          include_granted_scopes: 'false',
          state,
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
        }).toString();
        return redirect(res, url.href);
      }
      if (action === 'callback') {
        stage = 'state';
        setCookies(cookie(config, 'state', '', 0));
        const state = openCookie(req, config, 'state', now());
        const code = params.get('code');
        if (
          !state ||
          !equalState(state.state, params.get('state')) ||
          params.has('error') ||
          (params.has('iss') && params.get('iss') !== 'https://accounts.google.com') ||
          (params.has('scope') && !validScopes(params.get('scope'))) ||
          typeof code !== 'string' ||
          !/^[\x21-\x7e]{1,1024}$/.test(code)
        )
          throw new ConnectorError('auth', 401);
        const issuedAt = now();
        stage = 'token-exchange';
        const access = object(await client.exchange(config, code, state.verifier, lifetime.signal));
        stage = 'token-validation';
        if (
          typeof access.access_token !== 'string' ||
          !/^[\x21-\x7e]{1,1024}$/.test(access.access_token) ||
          typeof access.token_type !== 'string' ||
          access.token_type.toLowerCase() !== 'bearer' ||
          !Number.isSafeInteger(access.expires_in) ||
          access.expires_in <= 0 ||
          !validScopes(access.scope)
        )
          throw new ConnectorError('auth', 401);
        stage = 'identity';
        const identity = await client.identity(access.access_token, lifetime.signal);
        const expiresAt = issuedAt + Math.min(SESSION_SECONDS, access.expires_in) * 1000;
        if (expiresAt <= now() || lifetime.signal.aborted) throw new ConnectorError('auth', 401);
        setCookies([
          cookie(config, 'state', '', 0),
          cookie(
            config,
            'session',
            seal(config, 'session', {
              token: access.access_token,
              ...identity,
              issuedAt,
              expiresAt,
            }),
            Math.floor((expiresAt - now()) / 1000),
          ),
        ]);
        return redirect(res, '/?connectors=google-calendar&calendar=connected');
      }
      if (action === 'logout') {
        // Google revocation may revoke a shared grant and break Drive; disconnect locally only.
        setCookies([cookie(config, 'session', '', 0), cookie(config, 'state', '', 0)]);
        return json(res, 200, {});
      }
      if (!session) throw new ConnectorError('auth', 401);
      const event = await readPublication(req, lifetime.signal);
      stage = 'identity';
      const identity = await client.identity(session.token, lifetime.signal);
      if (identity.accountId !== session.accountId) throw new ConnectorError('auth', 401);
      let target = openCookie(req, config, 'target', now());
      if (!target || target.accountId !== session.accountId) {
        stage = 'create-calendar';
        const calendarId = await client.createCalendar(session.token, lifetime.signal);
        const issuedAt = now();
        target = {
          calendarId,
          accountId: session.accountId,
          issuedAt,
          expiresAt: issuedAt + TARGET_SECONDS * 1000,
        };
        // Persist before event insertion so retries reuse the calendar after uncertain event responses.
        setCookies(cookie(config, 'target', seal(config, 'target', target), TARGET_SECONDS));
      }
      stage = 'publish';
      return json(
        res,
        200,
        await client.publish(target.calendarId, event, session.token, lifetime.signal),
      );
    } catch (error) {
      const safe = error instanceof ConnectorError ? error : new ConnectorError();
      logConnectorFailure(
        logger,
        'google-calendar',
        actionName,
        stage,
        'failed',
        safe,
        safe.status,
        started,
      );
      if (callback) {
        if (config) setCookies(cookie(config, 'state', '', 0));
        return redirect(res, '/?connectors=google-calendar&calendar=error');
      }
      if (config && safe.code === 'auth') setCookies(cookie(config, 'session', '', 0));
      return json(res, safe.status, {
        error: { code: safe.code, message: 'Google Calendar connector request failed.' },
      });
    } finally {
      lifetime.cleanup();
    }
  };
}
export const googleCalendarHandler = createGoogleCalendarHandler();
