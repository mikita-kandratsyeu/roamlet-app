import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createOrsClient } from './ors-client.mjs';
import { RequestError, validateBody } from './routing-contract.mjs';
import { routingApiKey } from './routing-config.mjs';
import { failure, header, readBody, reply, sameOrigin } from './routing-http.mjs';

const ROUTE_FAILURE_CATEGORIES = new Set([
  'upstream_credentials',
  'upstream_rate_limited',
  'upstream_rejected',
  'upstream_failure',
  'upstream_timeout',
]);

function logFailure(logger, event, requestId, started, res, category) {
  if (res.statusCode < 400 || !Number.isInteger(res.statusCode)) return;
  try {
    logger({
      event,
      requestId,
      durationMs: Math.round(performance.now() - started),
      status: res.statusCode,
      category,
    });
  } catch {
    // Observability must not change the API response.
  }
}

export function createRoutingHandlers({
  getApiKey = routingApiKey,
  requestRoute = createOrsClient(),
  logger = (entry) => console.info(JSON.stringify(entry)),
} = {}) {
  async function configHandler(req, res) {
    const requestId = randomUUID();
    const started = performance.now();
    let category = 'invalid_request';
    try {
      if (!sameOrigin(req)) return failure(res, 403);
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return failure(res, 405);
      }
      return reply(res, 200, { available: Boolean(getApiKey()) });
    } catch {
      category = 'internal_failure';
      return failure(res, 502);
    } finally {
      logFailure(logger, 'routing_config_request', requestId, started, res, category);
    }
  }

  async function routeHandler(req, res) {
    const requestId = randomUUID();
    const started = performance.now();
    let category = 'invalid_request';
    res.setHeader('X-Request-Id', requestId);
    try {
      if (!sameOrigin(req)) return failure(res, 403);
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return failure(res, 405);
      }
      if (!/^application\/json\s*(?:;.*)?$/i.test(header(req, 'content-type')))
        return failure(res, 415);
      let request;
      try {
        request = validateBody(await readBody(req));
      } catch (error) {
        return failure(res, error instanceof RequestError ? error.status : 400);
      }
      const key = getApiKey();
      if (!key) {
        category = 'not_configured';
        return failure(res, 503, 'ROUTING_NOT_CONFIGURED');
      }
      const result = await requestRoute(request, key);
      category = ROUTE_FAILURE_CATEGORIES.has(result.category)
        ? result.category
        : 'upstream_failure';
      if (result.body) {
        reply(res, 200, result.body);
        if (res.statusCode !== 200) category = 'upstream_response_too_large';
        return;
      }
      return failure(res, result.status, result.code);
    } catch {
      category = 'internal_failure';
      return failure(res, 502);
    } finally {
      logFailure(logger, 'routing_request', requestId, started, res, category);
    }
  }

  return { routeHandler, configHandler };
}

export const { routeHandler, configHandler } = createRoutingHandlers();
