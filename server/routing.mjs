import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createOrsClient } from './ors-client.mjs';
import { RequestError, validateBody } from './routing-contract.mjs';
import { routingApiKey } from './routing-config.mjs';
import { failure, header, readBody, reply, sameOrigin } from './routing-http.mjs';

export function createRoutingHandlers({
  getApiKey = routingApiKey,
  requestRoute = createOrsClient(),
  logger = (entry) => console.info(JSON.stringify(entry)),
} = {}) {
  async function configHandler(req, res) {
    if (!sameOrigin(req)) return failure(res, 403);
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return failure(res, 405);
    }
    return reply(res, 200, { available: Boolean(getApiKey()) });
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
      category = result.category;
      if (result.body) {
        reply(res, 200, result.body);
        if (res.statusCode !== 200) category = 'upstream_response_too_large';
        return;
      }
      return failure(res, result.status, result.code);
    } finally {
      // Only server-generated metadata is logged, never request/provider payloads.
      try {
        logger({
          event: 'routing_request',
          requestId,
          durationMs: Math.round(performance.now() - started),
          status: res.statusCode,
          category,
        });
      } catch {
        // Observability must not change the API response.
      }
    }
  }

  return { routeHandler, configHandler };
}

export const { routeHandler, configHandler } = createRoutingHandlers();
