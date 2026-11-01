import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  createGithubClient,
  fileEntry,
  FOLDER,
  object,
  SNAPSHOT,
  validateRepository,
} from './github-client.mjs';
import {
  checkCiphertext,
  failure,
  GithubError,
  headers,
  json,
  readUpload,
  redirect,
  requestLifetime,
  sameOrigin,
  TRANSPORT_LIMIT,
} from './github-http.mjs';
import {
  cookie,
  equalState,
  githubConfig,
  openCookie,
  seal,
  SESSION_SECONDS,
  STATE_SECONDS,
  validLogin,
} from './github-session.mjs';

const ACTIONS = {
  session: ['GET', []],
  start: ['GET', []],
  callback: ['GET', ['code', 'state', 'error', 'error_description', 'error_uri']],
  repositories: ['GET', []],
  check: ['GET', ['owner', 'repository']],
  list: ['GET', ['owner', 'repository']],
  upload: ['POST', ['owner', 'repository']],
  download: ['GET', ['owner', 'repository', 'id', 'size']],
  logout: ['POST', []],
};

function parse(req) {
  if (typeof req.url !== 'string' || req.url.length > 2048 || !req.url.startsWith('/api/github?'))
    throw new GithubError('configuration', 400);
  const url = new URL(req.url, 'https://unused.invalid');
  if (url.pathname !== '/api/github') throw new GithubError('configuration', 400);
  const action = url.searchParams.get('action');
  if (!Object.hasOwn(ACTIONS, action)) throw new GithubError('configuration', 400);
  const allowed = new Set(['action', ...ACTIONS[action][1]]);
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some((key) => !allowed.has(key)))
    throw new GithubError('configuration', 400);
  return { action, params: url.searchParams };
}

export function createGithubHandler({
  getConfig = githubConfig,
  fetcher = globalThis.fetch,
  now = Date.now,
  timeoutMs,
} = {}) {
  const client = createGithubClient(fetcher);
  return async function githubHandler(req, res) {
    headers(res);
    const lifetime = requestLifetime(req, res, timeoutMs);
    let config;
    let callback = false;
    try {
      // Determine callback intent before parsing so even malformed OAuth parameters are removed.
      callback =
        typeof req.url === 'string' &&
        new URL(req.url, 'https://unused.invalid').searchParams.get('action') === 'callback';
      config = getConfig();
      const { action, params } = parse(req);
      if (req.method !== ACTIONS[action][0]) {
        res.setHeader('Allow', ACTIONS[action][0]);
        throw new GithubError('configuration', 405);
      }
      if (!config) {
        if (action === 'session') return json(res, 200, { available: false, connected: false });
        throw new GithubError('unavailable', 503);
      }
      if (action !== 'callback' && !sameOrigin(req, config, req.method === 'POST'))
        throw new GithubError('permission', 403);
      const session = openCookie(req, config, 'session', now());
      if (action === 'session') {
        if (!session) res.setHeader('Set-Cookie', cookie(config, 'session', '', 0));
        return json(res, 200, {
          available: true,
          connected: Boolean(session),
          installUrl: `https://github.com/apps/${config.slug}/installations/new`,
          ...(session ? { login: session.login } : {}),
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
        const url = new URL('https://github.com/login/oauth/authorize');
        url.search = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: config.callback,
          state,
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
          scope: 'offline_access',
        }).toString();
        return redirect(res, url.href);
      }
      if (action === 'callback') {
        res.setHeader('Set-Cookie', cookie(config, 'state', '', 0));
        const state = openCookie(req, config, 'state', now());
        const code = params.get('code');
        if (
          !state ||
          !equalState(state.state, params.get('state')) ||
          params.has('error') ||
          typeof code !== 'string' ||
          !/^[A-Za-z0-9_-]{1,512}$/.test(code)
        )
          throw new GithubError('auth', 401);
        const issuedAt = now();
        const access = object(
          await client.request('', {
            signal: lifetime.signal,
            method: 'POST',
            oauth: true,
            body: {
              client_id: config.clientId,
              client_secret: config.clientSecret,
              code,
              redirect_uri: config.callback,
              code_verifier: state.verifier,
            },
          }),
        );
        // Require expiring GitHub App user tokens; refresh tokens are deliberately discarded.
        if (
          typeof access.access_token !== 'string' ||
          !/^[\x21-\x7e]{1,1024}$/.test(access.access_token) ||
          access.token_type?.toLowerCase() !== 'bearer' ||
          !Number.isSafeInteger(access.expires_in) ||
          access.expires_in <= 0
        )
          throw new GithubError('auth', 401);
        const user = object(
          await client.request('/user', { token: access.access_token, signal: lifetime.signal }),
        );
        if (!validLogin(user.login) || !Number.isSafeInteger(user.id) || user.id <= 0)
          throw new GithubError('invalid-data');
        const seconds = Math.min(SESSION_SECONDS, access.expires_in);
        if (issuedAt + seconds * 1000 <= now()) throw new GithubError('auth', 401);
        const payload = {
          token: access.access_token,
          login: user.login,
          userId: user.id,
          issuedAt,
          expiresAt: issuedAt + seconds * 1000,
        };
        res.setHeader('Set-Cookie', [
          cookie(config, 'state', '', 0),
          cookie(
            config,
            'session',
            seal(config, 'session', payload),
            Math.floor((payload.expiresAt - now()) / 1000),
          ),
        ]);
        return redirect(res, '/?connectors=github&github=connected');
      }
      if (action === 'logout') {
        res.setHeader('Set-Cookie', [
          cookie(config, 'session', '', 0),
          cookie(config, 'state', '', 0),
        ]);
        if (session) {
          try {
            await client.request(`/applications/${config.clientId}/token`, {
              config,
              token: session.token,
              signal: lifetime.signal,
              method: 'DELETE',
              revoke: true,
              body: { access_token: session.token },
            });
          } catch {
            /* Local logout succeeds even if GitHub revocation is unavailable. */
          }
        }
        return json(res, 200, {});
      }
      if (!session) {
        res.setHeader('Set-Cookie', cookie(config, 'session', '', 0));
        throw new GithubError('auth', 401);
      }
      if (action === 'repositories') {
        const repositories = await client.repositories(config, session.token, lifetime.signal);
        return json(res, 200, {
          repositories: repositories.map(({ owner, name }) => ({ owner, name })),
        });
      }
      const owner = params.get('owner');
      const repository = params.get('repository');
      validateRepository(owner, repository);
      let bytes;
      if (action === 'upload') {
        if (!/^application\/octet-stream\s*(?:;.*)?$/i.test(req.headers?.['content-type'] ?? ''))
          throw new GithubError('invalid-data', 415);
        bytes = await readUpload(req, lifetime.signal);
      }
      let expected;
      if (action === 'download') {
        const id = params.get('id');
        const size = params.get('size');
        const name = id?.slice(FOLDER.length + 1);
        if (
          !name ||
          !SNAPSHOT.test(name) ||
          id !== `${FOLDER}/${name}` ||
          !/^[1-9][0-9]{0,7}$/.test(size ?? '')
        )
          throw new GithubError('invalid-data', 400);
        expected = fileEntry({ type: 'file', name, path: id, size: Number(size) });
      }
      const path = await client.verify(config, session.token, lifetime.signal, owner, repository);
      if (action === 'check') return json(res, 200, {});
      if (action === 'download') {
        const options = { token: session.token, signal: lifetime.signal };
        const metadata = object(
          await client.request(`${path}/contents/${expected.id}`, { ...options, metadata: true }),
        );
        const entry = fileEntry(metadata);
        if (
          entry.id !== expected.id ||
          entry.size !== expected.size ||
          typeof metadata.sha !== 'string' ||
          !/^[0-9a-f]{40}$/.test(metadata.sha)
        )
          throw new GithubError('invalid-data');
        // Raw Contents handles files >1MB; verify the Git blob hash to detect concurrent replacement.
        const raw = await client.request(`${path}/contents/${expected.id}`, {
          ...options,
          raw: true,
        });
        const sha = createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
        if (raw.length !== entry.size || raw.length > TRANSPORT_LIMIT || sha !== metadata.sha)
          throw new GithubError('invalid-data');
        checkCiphertext(raw);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', raw.length);
        return res.end(raw);
      }
      const directory = await client.directory(path, session.token, lifetime.signal);
      if (action === 'list') {
        const backups = directory
          .filter((item) => SNAPSHOT.test(item.name))
          .map(fileEntry)
          .sort((a, b) => a.name.localeCompare(b.name, 'en'));
        return json(res, 200, { backups });
      }
      if (directory.length >= 999) throw new GithubError('too-large', 413);
      const name = `${randomUUID()}.roamlet`;
      const id = `${FOLDER}/${name}`;
      const result = object(
        await client.request(`${path}/contents/${id}`, {
          token: session.token,
          signal: lifetime.signal,
          method: 'PUT',
          body: { message: 'Create encrypted Roamlet backup', content: bytes.toString('base64') },
        }),
      );
      const entry = fileEntry(result.content);
      if (entry.id !== id || entry.size !== bytes.length) throw new GithubError('invalid-data');
      return json(res, 200, { backup: entry });
    } catch (error) {
      if (callback) {
        if (config) res.setHeader('Set-Cookie', cookie(config, 'state', '', 0));
        return redirect(res, '/?connectors=github&github=error');
      }
      if (config && error instanceof GithubError && error.code === 'auth')
        res.setHeader('Set-Cookie', cookie(config, 'session', '', 0));
      return failure(res, error);
    } finally {
      lifetime.cleanup();
    }
  };
}

export const githubHandler = createGithubHandler();
