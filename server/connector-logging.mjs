import { performance } from 'node:perf_hooks';

const CODES = new Set([
  'auth',
  'configuration',
  'conflict',
  'invalid-data',
  'local',
  'network',
  'not-found',
  'permission',
  'quota',
  'timeout',
  'too-large',
  'unavailable',
]);

export const connectorLogger = (entry) => console.warn(JSON.stringify(entry));

export function logConnectorFailure(logger, provider, action, stage, reason, error, status, started) {
  try {
    logger({
      event: 'connector_failure',
      provider,
      action,
      stage,
      reason,
      code: CODES.has(error?.code) ? error.code : 'unexpected',
      status,
      durationMs: Math.round(performance.now() - started),
    });
  } catch {
    // Logging must never change an API response.
  }
}
