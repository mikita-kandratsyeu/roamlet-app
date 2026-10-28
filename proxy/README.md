# @roamlet/proxy

Private, dependency-free Node.js >=24 ESM package. From the repository root, run `yarn workspace @roamlet/proxy dev`, `yarn start`, or `yarn test:proxy`. Development/start scripts load `proxy/.env` when present.

Copy `.env.example` to `.env` and set **server-only** `MAPBOX_ACCESS_TOKEN`. Never put this token in browser environment variables, source, or public build artifacts. The renderer's separate public token is not this server credential. `MAPBOX_URL` is an administrator-configured trusted HTTP(S) origin (default `https://api.mapbox.com`), without credentials, path, query, or fragment; it is never a caller parameter. HTTP is intended only for local upstream testing; use HTTPS in deployments. Old ORS configuration is no longer used.

Defaults: `PROXY_HOST=127.0.0.1`, `PROXY_PORT=3001`, `PROXY_RATE_LIMIT=60`, `PROXY_RATE_WINDOW_MS=60000`. Routing, search, and terrain share a quota by direct socket IP, with at most 10,000 tracked entries. Forwarded IP headers are ignored. Behind a reverse proxy, all requests from that proxy share a quota.

## API

- `POST /api/directions/{cycling|walking}/geojson`: JSON capped at 64 KiB, containing `coordinates` (2–25 finite `[longitude, latitude]` pairs, longitude −180..180 and latitude −90..90), required `instructions: false`, and optional boolean `elevation`. All other fields, including ORS `options`, are rejected. No query parameters. Elevation is sampled separately on the client, not supplied by Directions.
- `GET /api/geocode/search?text=Innsbruck&size=5`: trimmed text 3–200 characters without control characters; size 1–5, default 5. Duplicates and unknown parameters are rejected.
- `GET /api/terrain/{z}/{x}/{y}.pngraw`: integer zoom 0–14, integer indices 0 through $2^z-1$, canonical decimal notation, no query parameters. Returns a bounded PNG as `image/png`; client decodes Terrain-RGB and samples height, using zoom **12** by default. Water/no-data provider 404 returns safe JSON 404 `TERRAIN_NOT_FOUND`, allowing the client to omit elevation without losing the route.
- `GET /api/health`: only `{ "configured": true }` or `{ "configured": false }`, no query parameters.

Upstream requests are GET only, built from validated input and the trusted origin:

- `/directions/v5/mapbox/{cycling|walking}/{lng,lat;...}?geometries=geojson&overview=full&steps=false&access_token=TOKEN`
- `/search/geocode/v6/forward?q=TEXT&limit=SIZE&permanent=true&autocomplete=false&access_token=TOKEN`
- `/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token=TOKEN`

Directions/search use `Accept: application/json`; terrain uses `Accept: image/png`. The token is URL-encoded and injected only server-side. Caller credentials are not forwarded. Directions normalize the first route to a GeoJSON `FeatureCollection` with a `LineString` feature and `properties.summary: { distance, duration }` (metres and seconds). Geocoding normalizes to Point features with `properties.label` from the provider's full address. Provider metadata is discarded; retained labels are credential-redacted. **Permanent geocoding is intentional and explicitly agreed for saved routes; review [Mapbox Geocoding terms and permanent-storage billing](https://docs.mapbox.com/api/search/geocoding/#temporary-and-permanent-geocoding) before publication. Permanent storage requires a valid credit card on file or an active enterprise contract.**

Errors have `{ "error": { "code": "...", "message": "..." } }`. Missing token returns 503 `NOT_CONFIGURED`; local quota returns 429 `RATE_LIMITED` with `Retry-After`; upstream quota returns 429 `UPSTREAM_RATE_LIMITED`; timeout returns 504 `UPSTREAM_TIMEOUT`; upstream failures return safe 502 errors. Mapbox HTTP 200 `code: "NoRoute"` returns 422 `NO_ROUTE`. Malformed provider data returns 502 `INVALID_UPSTREAM_RESPONSE`. JSON is capped at 10 MiB and terrain at 2 MiB (PNG structure and dimensions up to 512×512 are checked). Reflected token bytes in PNGs are rejected. Provider headers/errors and credential-bearing URLs are never returned or logged. All upstream requests time out after 25 seconds and abort on client disconnect, including stalled response bodies. Redirects are not followed.

## Single-origin hosting

The same process serves `../client/dist` independently of its working directory. Build the client separately. GET/HEAD static files support MIME types, `nosniff`, immutable `/assets/` caching, and `no-cache` HTML/service workers. `/` explicitly serves `index.html` for any Accept header, so service-worker `fetch('/')` precaching succeeds. Other missing extensionless paths fall back only to `index.html` for requests accepting HTML; missing assets and API paths never fall back. No restrictive CSP is injected, allowing same-origin service workers and MapLibre blob workers. Dotfiles, source paths/maps, traversal and symlinks escaping the dist root are blocked. Keep the build directory limited to public build artifacts.

Browser origins must match the request Host (including Vite's preserved development Host/Origin); optionally set `PUBLIC_ORIGIN=https://app.example.org` to require that exact public origin behind a reverse proxy. Leave it empty for Host-based checks. Health is exempt from quota and works without a key. Cross-site Fetch Metadata is rejected. No CORS headers are emitted. Deploy client/API on one origin; development clients should use a same-origin development-server proxy. Origin checks are not user authentication. When using a TLS reverse proxy, configure it to validate/preserve the public Host; forwarded headers are not trusted here.

`createProxyServer({ token, base, fetchImpl, distPath, rateLimit, rateWindowMs, maxRateEntries, timeoutMs, publicOrigin })` exported from `src/index.js` returns an unbound native HTTP server. `token` defaults to `MAPBOX_ACCESS_TOKEN`; `base` defaults to `MAPBOX_URL` or `https://api.mapbox.com`. Imports do not start a listener. `timeoutMs` can be shortened for tests, never extended beyond 25 seconds.
