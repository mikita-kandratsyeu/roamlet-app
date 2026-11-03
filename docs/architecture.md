# Architecture and API contracts

[Back to overview](../README.md)

## API implementation and error contract

The files in `api/` remain thin Vercel entry points. Shared implementation lives outside that directory:

- `server/routing.mjs`: HTTP handlers and metadata-only request logging; `createRoutingHandlers` accepts an API-key getter, ORS client and logger for isolated tests.
- `server/routing-contract.mjs`: input validation and sanitized GeoJSON output.
- `server/routing-http.mjs`: bounded body parsing, same-origin checks and JSON responses.
- `server/ors-client.mjs`: provider transport, bounded stream consumption and cancellation; `createOrsClient` accepts a fetch implementation and timeout.
- `server/routing-config.mjs`: server-only environment access.

Vite development/preview middleware and Vercel entry points use the same default handlers. Endpoint URLs and successful response shapes are unchanged. Errors use `{ "error": { "code": "…", "message": "…" } }`; ORS codes `2004`, `2009` and `2010` remain numeric for route-limit/no-route handling.

| HTTP status     | Application code                                                            | Meaning                                                                 |
| --------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 400 / 413 / 415 | `INVALID_REQUEST` / `REQUEST_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE`          | Rejected input                                                          |
| 403 / 405       | `FORBIDDEN` / `METHOD_NOT_ALLOWED`                                          | Origin or method rejected                                               |
| 400 / 404 / 422 | Safe numeric ORS code or `INVALID_REQUEST` / `UPSTREAM_REJECTED`            | Provider rejected the route request                                     |
| 502             | `UPSTREAM_UNAVAILABLE` / `UPSTREAM_RESPONSE_TOO_LARGE`                      | Provider/network/response failure                                       |
| 503             | `ROUTING_NOT_CONFIGURED` / `UPSTREAM_UNAVAILABLE` / `UPSTREAM_RATE_LIMITED` | Missing key, provider credentials rejected, or provider quota exhausted |
| 504             | `UPSTREAM_TIMEOUT`                                                          | Provider exceeded the time budget                                       |

Provider `401`/`403` responses are not forwarded as user authorization failures. Provider `429` becomes `503` with `UPSTREAM_RATE_LIMITED`; the browser still reports quota exhaustion and does not retry loop candidates. Firewall-generated `429` remains a separate deployment-level rate limit, handled by the browser by status regardless of response format.

Each route request returns a server-generated `X-Request-Id`. Structured function logs contain only the event name, that ID, duration in milliseconds, final HTTP status and a fixed outcome category. Coordinates, keys, request bodies and raw provider errors are excluded. Logging failures do not change the response. API caching remains disabled; no shared route cache or application database is introduced.

Connector handlers (GitHub, Google Drive) log only failures as `connector_failure` events with `provider`, `action`, `stage`, `reason`, `code`, `status` and `durationMs`. All fields use fixed allowlisted values; URLs, cookies, tokens, emails, repository names and provider responses are never included. Successful requests and unauthenticated session probes produce no log entries.

## Architecture

Yarn has one application workspace, `client/`. Root scripts delegate frontend development, build and browser tests to it; `yarn test` also runs server tests. The deployed frontend uses server-only routing functions.

- `client/`: React/TypeScript/Vite app, browser tests, assets and public environment settings.
- `client/src/domain/`: typed route/provider contracts, geometry calculations, bounded GPX parsing/export and Dexie persistence.
- `client/src/services/routing.ts`: same-origin proxy requests, routing profiles and bounded client-side caches.
- `api/`: Vercel routing and availability function entrypoints.
- `server/routing.mjs`: shared server-only validation, ORS requests and response sanitization, also used by Vite local middleware.
- `server/*.test.mjs`: Node tests for server handlers without real provider requests.
- `client/src/components/`: map, statistics, library and dialogs.
- `client/src/App.tsx`: composition of the planner, map, separate library screen and workflow dialogs.
- `client/src/hooks/`: serializable editor state/history, cancellable routing, draft autosaving and confirmed app updates.
- `client/public/sw.js`: revisioned production shell and same-origin assets, including library/statistics code; excludes all third-party map/routing requests.

IndexedDB version 3 adds favorites/tags and a separate draft store without deleting supported routes. The earlier version 2 cleanup removed unsupported retired sources, not supported snapshots. Supported sources are `openrouteservice`, legacy `mapbox`, `gpx` and `manual`; saving, duplicating and reopening retains each source and exact geometry. New ORS exports credit openrouteservice and OpenStreetMap contributors; legacy Mapbox exports retain Mapbox/OSM attribution. Manual/GPX exports make no routing-provider claim. No provider data is relabeled as ODbL-licensed.

Saved and imported routes open as snapshots and are never silently rerouted. Editing a manual snapshot is explicit and recalculates direct segments locally; converting GPX or online snapshots requires confirmation before replacing geometry. Coordinates use `[longitude, latitude, elevation?]`, distances metres and durations seconds. GPX files are bounded to 10 MiB/100,000 points; segment boundaries and standalone waypoints are preserved. HTTPS or localhost is required for the service worker.
