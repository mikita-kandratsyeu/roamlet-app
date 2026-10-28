# @roamlet/proxy

Private, dependency-free Node.js >=24 ESM package. Run scripts from `proxy/`:

- `npm run dev`: watch mode, loading `.env` when present.
- `npm start`: production server, loading `.env` when present.
- `npm test`: native Node HTTP integration tests; no typecheck required.

Copy `.env.example` to `.env` and set **server-only** `ORS_API_KEY`. Never put the key in client environment variables or source. `ORS_URL` is an administrator-configured HTTP(S) HeiGIT-compatible service origin (default `https://api.heigit.org`), without a path and not a request parameter. Directions use `/openrouteservice/v2/directions/{profile}/geojson`; geocoding uses `/pelias/v1/search`. Existing ORS API keys remain valid. Leave `ORS_URL` empty to use the default, or replace any old `https://api.openrouteservice.org` override with `https://api.heigit.org` and restart the proxy. HTTP is intended for local upstream testing; use HTTPS in deployments. Defaults: `PROXY_HOST=127.0.0.1`, `PROXY_PORT=3001`, `PROXY_RATE_LIMIT=60`, `PROXY_RATE_WINDOW_MS=60000`. Rate limits apply to routing/search, by direct socket IP, with at most 10,000 tracked entries. Forwarded IP headers are ignored. Behind a reverse proxy, all requests from that proxy share a quota.

## API

- `POST /api/directions/cycling-regular/geojson`
- `POST /api/directions/foot-hiking/geojson`
- `GET /api/geocode/search?text=Innsbruck&size=5`
- `GET /api/health` → `{ "configured": true }` (or `false`).

Directions require JSON, capped at 64 KiB: `coordinates` (1–50 longitude/latitude pairs, bounded finite numbers), optional boolean `elevation`/`instructions`, and optional `options`. Only `avoid_features: ["steps"]` (or an empty array) and `round_trip: { length, points?, seed? }` are accepted. Loop length is 2,000–100,000 metres, points 2–10, seed 0–2,147,483,647. All other fields are rejected. Search text is trimmed, 3–200 characters; size is 1–5, default 5. Unknown parameters, profiles and API paths are rejected.

Errors have `{ "error": { "code": "...", "message": "..." } }`. Missing key returns 503 `NOT_CONFIGURED`; local quota returns 429 `RATE_LIMITED` with `Retry-After`; upstream quota returns 429 `UPSTREAM_RATE_LIMITED`; timeout returns 504 `UPSTREAM_TIMEOUT`; upstream failures return safe 502 errors. Upstream responses must be JSON objects and are capped at 10 MiB. Caller credentials and upstream headers/errors are never forwarded. Upstream requests time out after 25 seconds and abort on client disconnect. Redirects are not followed.

## Single-origin hosting

The same process serves `../client/dist` independently of its working directory. Build the client separately. GET/HEAD static files support MIME types, `nosniff`, immutable `/assets/` caching, and `no-cache` HTML/service workers. `/` explicitly serves `index.html` for any Accept header, so service-worker `fetch('/')` precaching succeeds. Other missing extensionless paths fall back only to `index.html` for requests accepting HTML; missing assets and API paths never fall back. No restrictive CSP is injected, allowing same-origin service workers and MapLibre blob workers. Dotfiles, source paths/maps, traversal and symlinks escaping the dist root are blocked. Keep the build directory limited to public build artifacts.

Browser origins must match the request Host (including Vite's preserved development Host/Origin); optionally set `PUBLIC_ORIGIN=https://app.example.org` to require that exact public origin behind a reverse proxy. Leave it empty for Host-based checks. Health is exempt from quota and works without a key. Cross-site Fetch Metadata is rejected. No CORS headers are emitted. Deploy client/API on one origin; development clients should use a same-origin development-server proxy. Origin checks are not user authentication. When using a TLS reverse proxy, configure it to validate/preserve the public Host; forwarded headers are not trusted here.

`createProxyServer({ key, base, fetchImpl, distPath, rateLimit, rateWindowMs, maxRateEntries, timeoutMs, publicOrigin })` exported from `src/index.js` returns an unbound native HTTP server. Imports do not start a listener. `timeoutMs` can be shortened for tests, never extended beyond 25 seconds.
