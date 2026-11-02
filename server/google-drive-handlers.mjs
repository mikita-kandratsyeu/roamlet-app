import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { connectorLogger, logConnectorFailure } from './connector-logging.mjs';
import {
  headers,
  json,
  readUpload,
  redirect,
  requestLifetime,
  sameOrigin,
} from './github-http.mjs';
import {
  ConnectorError,
  createGoogleDriveClient,
  DRIVE_SCOPE,
  fileSize,
  object,
  SCOPES,
  validId,
} from './google-drive-client.mjs';
import {
  cookie,
  cookieName,
  equalState,
  googleDriveConfig,
  openCookie,
  seal,
  SESSION_SECONDS,
  STATE_SECONDS,
} from './google-drive-session.mjs';

const ACTIONS = {
  session: ['GET', []],
  start: ['GET', []],
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
  check: ['GET', []],
  list: ['GET', []],
  upload: ['POST', []],
  download: ['GET', ['id', 'size']],
  logout: ['POST', []],
};
function parse(req) {
  if (
    typeof req.url !== 'string' ||
    req.url.length > 4096 ||
    !req.url.startsWith('/api/google-drive?')
  )
    throw new ConnectorError('configuration', 400);
  const url = new URL(req.url, 'https://unused.invalid');
  const action = url.searchParams.get('action');
  if (url.pathname !== '/api/google-drive' || !Object.hasOwn(ACTIONS, action))
    throw new ConnectorError('configuration', 400);
  const keys = [...url.searchParams.keys()];
  const allowed = new Set(['action', ...ACTIONS[action][1]]);
  if (new Set(keys).size !== keys.length || keys.some((key) => !allowed.has(key)))
    throw new ConnectorError('configuration', 400);
  return { action, params: url.searchParams };
}
function clearSession(res, config) {
  res.setHeader('Set-Cookie', cookie(config, 'session', '', 0));
}
function clearAuthorization(res, config) {
  res.setHeader('Set-Cookie', [cookie(config, 'session', '', 0), cookie(config, 'state', '', 0)]);
}
export function createGoogleDriveHandler({
  getConfig = googleDriveConfig,
  fetcher = globalThis.fetch,
  now = Date.now,
  timeoutMs,
  logger = connectorLogger,
} = {}) {
  const client = createGoogleDriveClient(fetcher);
  return async function googleDriveHandler(req, res) {
    const started = performance.now();
    headers(res);
    const lifetime = requestLifetime(req, res, timeoutMs);
    let config;
    let callback = false;
    let actionName = 'invalid';
    let callbackStage = 'request';
    let callbackReason = 'failed';
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
      callbackStage = 'session';
      const session = openCookie(req, config, 'session', now());
      if (action === 'session') {
        if (!session) clearSession(res, config);
        return json(res, 200, {
          available: true,
          connected: Boolean(session),
          ...(session ? { email: session.email, accountId: session.accountId } : {}),
        });
      }
      if (action === 'start') {
        const issuedAt = now();
        const state = randomBytes(32).toString('base64url');
        const verifier = randomBytes(32).toString('base64url');
        res.setHeader(
          'Set-Cookie',
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
          state,
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
        }).toString();
        return redirect(res, url.href);
      }
      if (action === 'callback') {
        callbackStage = 'state';
        res.setHeader('Set-Cookie', cookie(config, 'state', '', 0));
        const state = openCookie(req, config, 'state', now());
        const code = params.get('code');
        if (
          !state ||
          !equalState(state.state, params.get('state')) ||
          params.has('error') ||
          (params.has('iss') && params.get('iss') !== 'https://accounts.google.com') ||
          typeof code !== 'string' ||
          !/^[\x21-\x7e]{1,1024}$/.test(code)
        ) {
          const cookieSent =
            typeof req.headers?.cookie === 'string' &&
            req.headers.cookie
              .split(';')
              .some((part) => part.trim().startsWith(`${cookieName(config, 'state')}=`));
          callbackReason = params.has('error')
            ? 'provider-denied'
            : !state
              ? cookieSent
                ? 'invalid-state-cookie'
                : 'missing-state-cookie'
              : !equalState(state.state, params.get('state'))
                ? 'state-mismatch'
                : params.has('iss') && params.get('iss') !== 'https://accounts.google.com'
                  ? 'invalid-issuer'
                  : 'invalid-code';
          throw new ConnectorError('auth', 401);
        }
        // Start the expiry clock before the exchange; never extend the provider's actual lifetime.
        const issuedAt = now();
        callbackStage = 'token-exchange';
        const access = object(await client.exchange(config, code, state.verifier, lifetime.signal));
        callbackStage = 'token-validation';
        if (
          typeof access.access_token !== 'string' ||
          !/^[\x21-\x7e]{1,1024}$/.test(access.access_token) ||
          typeof access.token_type !== 'string' ||
          access.token_type.toLowerCase() !== 'bearer' ||
          !Number.isSafeInteger(access.expires_in) ||
          access.expires_in <= 0 ||
          (access.scope !== undefined &&
            (typeof access.scope !== 'string' ||
              access.scope.length > 4096 ||
              !access.scope.split(/\s+/).includes(DRIVE_SCOPE)))
        )
          throw new ConnectorError('auth', 401);
        callbackStage = 'identity';
        const identity = await client.identity(access.access_token, lifetime.signal);
        callbackStage = 'drive-access';
        await client.probe(access.access_token, lifetime.signal);
        callbackStage = 'session';
        const expiresAt = issuedAt + Math.min(SESSION_SECONDS, access.expires_in) * 1000;
        if (expiresAt <= now() || lifetime.signal.aborted) throw new ConnectorError('auth', 401);
        const payload = { token: access.access_token, ...identity, issuedAt, expiresAt };
        res.setHeader('Set-Cookie', [
          cookie(config, 'state', '', 0),
          cookie(
            config,
            'session',
            seal(config, 'session', payload),
            Math.floor((expiresAt - now()) / 1000),
          ),
        ]);
        return redirect(res, '/?connectors=google-drive&google=connected');
      }
      if (action === 'logout') {
        clearAuthorization(res, config);
        if (session)
          try {
            await client.revoke(session.token, lifetime.signal);
          } catch {
            /* Clearing local authorization does not depend on provider availability. */
          }
        return json(res, 200, {});
      }
      if (!session) {
        clearSession(res, config);
        throw new ConnectorError('auth', 401);
      }
      let bytes;
      let id;
      let size;
      if (action === 'upload') {
        if ((req.headers?.['content-type'] ?? '').toLowerCase() !== 'application/octet-stream')
          throw new ConnectorError('invalid-data', 415);
        bytes = await readUpload(req, lifetime.signal);
      }
      if (action === 'download') {
        id = params.get('id');
        if (!validId(id)) throw new ConnectorError('invalid-data', 400);
        size = fileSize(params.get('size'), 400);
      }
      const identity = await client.identity(session.token, lifetime.signal);
      if (identity.accountId !== session.accountId) throw new ConnectorError('auth', 401);
      if (action === 'check') {
        await client.probe(session.token, lifetime.signal);
        return json(res, 200, {});
      }
      if (action === 'list')
        return json(res, 200, { backups: await client.list(session.token, lifetime.signal) });
      if (action === 'upload')
        return json(res, 200, {
          backup: await client.upload(bytes, session.token, lifetime.signal),
        });
      const raw = await client.download(id, size, session.token, lifetime.signal);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', raw.length);
      return res.end(raw);
    } catch (error) {
      const safe = error instanceof ConnectorError ? error : new ConnectorError();
      logConnectorFailure(
        logger,
        'google-drive',
        actionName,
        callback ? callbackStage : 'request',
        callback ? callbackReason : 'failed',
        safe,
        safe.status,
        started,
      );
      if (callback) {
        if (config) res.setHeader('Set-Cookie', cookie(config, 'state', '', 0));
        return redirect(res, '/?connectors=google-drive&google=error');
      }
      if (config && safe.code === 'auth') clearSession(res, config);
      return json(res, safe.status, {
        error: { code: safe.code, message: 'Google Drive connector request failed.' },
      });
    } finally {
      lifetime.cleanup();
    }
  };
}
export const googleDriveHandler = createGoogleDriveHandler();
