import { headers, json, requestLifetime, sameOrigin } from './github-http.mjs';
import { AiError, connection, object, proposalInput } from './ai-contract.mjs';
import { createAiClient } from './ai-client.mjs';
import { readJson } from './ai-http.mjs';
import { aiConfig, cookie, openCookie, seal, SESSION_SECONDS } from './ai-session.mjs';

const ACTIONS = { session: 'GET', connect: 'POST', logout: 'POST', propose: 'POST' };
function parse(req) {
  if (typeof req.url !== 'string' || req.url.length > 4096 || !req.url.startsWith('/api/ai?'))
    throw new AiError('configuration', 400);
  const url = new URL(req.url, 'https://unused.invalid');
  const action = url.searchParams.get('action');
  if (
    url.pathname !== '/api/ai' ||
    url.hash ||
    !Object.hasOwn(ACTIONS, action) ||
    [...url.searchParams.keys()].length !== 1
  )
    throw new AiError('configuration', 400);
  return action;
}
export function createAiHandler({
  getConfig = aiConfig,
  fetcher = globalThis.fetch,
  now = Date.now,
  timeoutMs,
} = {}) {
  const client = createAiClient(fetcher);
  return async function aiHandler(req, res) {
    headers(res);
    const lifetime = requestLifetime(req, res, timeoutMs);
    let config;
    let action;
    try {
      action = parse(req);
      if (req.method !== ACTIONS[action]) {
        res.setHeader('Allow', ACTIONS[action]);
        throw new AiError('configuration', 405);
      }
      config = getConfig();
      if (!config) {
        if (action === 'session')
          return json(res, 200, { available: false, connected: false, providers: [] });
        throw new AiError('unavailable', 503);
      }
      if (
        req.headers?.host !== new URL(config.origin).host ||
        !sameOrigin(req, config, req.method === 'POST')
      )
        throw new AiError('permission', 403);
      const session = openCookie(req, config, now());
      if (action === 'session') {
        if (!session) res.setHeader('Set-Cookie', cookie(config, '', 0));
        return json(res, 200, {
          available: true,
          connected: Boolean(session),
          providers: config.providers,
          ...(session ? { connection: { baseUrl: session.baseUrl, model: session.model } } : {}),
        });
      }
      const body = await readJson(req, lifetime.signal);
      if (action === 'logout') {
        object(body, []);
        res.setHeader('Set-Cookie', cookie(config, '', 0));
        return json(res, 200, {});
      }
      if (action === 'connect') {
        const settings = connection(body, config.providers);
        const issuedAt = now();
        await client.verify(config, settings, lifetime.signal);
        const expiresAt = issuedAt + SESSION_SECONDS * 1000;
        if (lifetime.signal.aborted) throw lifetime.signal.reason;
        if (expiresAt <= now()) throw new AiError('timeout', 504);
        res.setHeader(
          'Set-Cookie',
          cookie(
            config,
            seal(config, { ...settings, issuedAt, expiresAt }),
            Math.floor((expiresAt - now()) / 1000),
          ),
        );
        return json(res, 200, {
          connected: true,
          connection: { baseUrl: settings.baseUrl, model: settings.model },
        });
      }
      if (!session) throw new AiError('auth', 401);
      const input = proposalInput(body);
      return json(res, 200, await client.propose(config, session, input, lifetime.signal));
    } catch (error) {
      const safe = error instanceof AiError ? error : new AiError();
      if (config && safe.code === 'auth' && action !== 'connect')
        res.setHeader('Set-Cookie', cookie(config, '', 0));
      return json(res, safe.status, {
        error: { code: safe.code, message: 'AI connector request failed.' },
      });
    } finally {
      lifetime.cleanup();
    }
  };
}
export const aiHandler = createAiHandler();
