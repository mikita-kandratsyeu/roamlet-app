# Roamlet

An account-free, local-first cycling and hiking route planner.

## Implementation plan

1. Create a strict React/TypeScript/Vite foundation and responsive map-first interface.
2. Integrate MapLibre with attributed real map tiles and OpenRouteService cycling/hiking profiles, search, and round trips.
3. Preserve actual geometry through GPX import/export and IndexedDB route management.
4. Add useful failure states, an offline app shell, accessibility, tests, and provider/license documentation.

All four implementation steps are implemented. See verification results and service-dependent limitations below.

## Development

Use Yarn 4.18.1 (the latest stable release verified on 28 October 2026), pinned in `packageManager` and bundled in `.yarn/releases`. `.yarnrc.yml` selects the standard npm registry and the familiar `node_modules` linker. Corepack uses the pin; existing Yarn Classic installations forward to the bundled release via `.yarnrc`. Without either launcher, use `node .yarn/releases/yarn-4.18.1.cjs` instead of `yarn`:

```sh
yarn install --immutable
cp proxy/.env.example proxy/.env
# Set ORS_API_KEY in proxy/.env (never in the client)
# Optional PUBLIC tile settings:
cp client/.env.example client/.env.local
yarn dev
```

Requires Node.js 24+ in every workspace and the pinned Yarn release. `.nvmrc` selects Node.js 24 LTS (`nvm install && nvm use`); newer Node.js versions are also supported. Yarn’s default install-script restrictions remain in place; only esbuild’s required build script is explicitly allowed via `dependenciesMeta`. Obtain an OpenRouteService API key through [HeiGIT Account](https://account.heigit.org/signup), currently linked from [openrouteservice.org](https://openrouteservice.org). Check your account's quotas and terms. Store `ORS_API_KEY` only in `proxy/.env` or the hosting platform's server secret settings. The browser receives route/search results, **never the provider key**. Restart the proxy after editing its environment. Without a key, the map, local library, and GPX still work; online routing/search show a server configuration error.

`yarn dev` starts two workspace processes: Vite at `http://127.0.0.1:5173` and the proxy at `http://127.0.0.1:3001`. Vite forwards `/api` to the proxy; the client always uses same-origin relative URLs. Client public settings live in `client/.env.local`; old root `.env.local` and `VITE_ORS_API_KEY` are no longer used. Do not copy old keys into the client workspace. `.env` files in both workspaces are gitignored.

### Production: one Node.js service

```sh
yarn build
yarn start
```

The proxy serves `client/dist` and `/api` at `http://127.0.0.1:3001`. Configure `PROXY_HOST=0.0.0.0` on hosting platforms that require external binding, set `PROXY_PORT` as needed, and terminate HTTPS at a trusted ingress. No separate browser CORS setup is needed. `yarn preview` is an alias for this production server and requires an existing build. The production service needs the built client directory alongside the proxy. No database or account service is added.

```sh
yarn typecheck
yarn lint
yarn format:check
# Apply automatic lint fixes and readable formatting:
yarn lint:fix
yarn format
yarn test
yarn build
yarn preview
# First browser test run only:
yarn workspace @roamlet/client playwright install chromium
yarn test:e2e
yarn test:offline
yarn test:integration
```

## Branding and languages

The interface and app icon follow the supplied `Roamlet.png`: forest green, sage accents, warm ivory, and a winding-path symbol. The image does not identify a font; self-hosted Manrope (SIL Open Font License, Latin and Cyrillic) provides a similar geometric sans-serif appearance without external font requests. Brand colors are CSS custom properties.

English and Russian translations use i18next and react-i18next with JSON dictionaries in `client/src/locales/en.json` and `client/src/locales/ru.json`. Edit these files to update translations; keep their keys and interpolation placeholders aligned. Both dictionaries are statically bundled, so translation loading works offline without extra network requests. The header uses one visually grouped split button: “New route” remains a direct primary action, while its adjacent menu opens the route library, language selection, and help. It supports keyboard navigation (arrows, Home/End, type-ahead, Escape/Tab), outside-click dismissal, and focus restoration; unsaved-route confirmation is preserved. Select the language in this menu; the choice is stored locally and updates the document language, interface, accessibility labels, and locale-aware statistics. First visits use the browser language with English fallback. User-entered route names/descriptions and geographic place names are not translated. Changing language does not recalculate routes or reset the map. Translations and font assets remain available in the offline app shell.

Focus indicators use a consistent high-contrast 2 px ring: search inputs draw a single ring on their container, while standalone fields, keyboard-focused buttons/links, menu items, and map controls retain visible focus. Map/menu rings are inset to avoid clipping, and forced-colors mode uses a system highlight. Dialogs initially focus the relevant field (or safe Cancel action), use native modal isolation with Tab/Shift+Tab wrapping, and restore the opener without scrolling; inline library editors/confirmations restore their originating action or the search field if a route was deleted.

ESLint checks code quality; Prettier handles consistent formatting. `eslint-config-prettier` prevents conflicting formatting rules. Use `yarn lint:fix` and `yarn format` before submitting changes; use `yarn lint` and `yarn format:check` for validation.

## Implemented workflows

- Real MapLibre raster map with visible OSM attribution, zoom/pan, fit-to-route, optional user location, click-to-add, and draggable waypoint pins.
- Initial viewport priority: opened route → locally saved map view → approximate browser timezone/locale region → world overview. Known IANA timezones select a regional view, other supported continent timezones select a wider view; otherwise locale country/language is a fallback. Browser settings are **not actual geolocation** and may be unrelated to the user's position. No IP lookup, inference API, or automatic location permission prompt is used.
- Completed map movements save center, zoom, bearing and pitch under `roamlet:map-view:v1` in localStorage. Saved views take priority on reload, while opening/importing a route still fits its geometry. Malformed stored views are ignored; blocked/quota-limited storage does not prevent map use and shows a nonfatal save notice. Clearing site data resets the preference.
- Manual routing with up to 50 stops; replacement search, reorder, remove, reverse, automatic cancellable recalculation, and distinct cycling/hiking profiles.
- Loop discovery with a 2–100 km target and two separately requested ORS round trips. Identical results are deduplicated; nonclosed responses are rejected.
- Place/address search on explicit submission via ORS geocoding. A `latitude, longitude` input works without a key.
- Geometry-derived distance, estimated moving time, available elevation gain/loss and elevation chart. Unavailable data is labeled honestly.
- Local IndexedDB library: save, name/description edits, reopen, duplicate, filter, and confirmed deletion; unsaved route-discard warnings.
- GPX tracks/routes/waypoints import (file selection or drop), segment/point/elevation preservation, original-geometry display, and full geometry export with escaped metadata and sensible filenames.
- Responsive desktop panel and mobile collapsible sheet, keyboard-focusable controls, native modal focus handling, useful loading/error states.
- Installable manifest and production service-worker app shell. Saved routes and GPX export work offline after the initial online visit; map and routing do not.

## Configuration and providers

| Variable                    | Meaning                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ORS_API_KEY`               | **Proxy only**: private ORS key for online directions/geocoding                                                                                                                                        |
| `ORS_URL`                   | **Proxy only**: trusted HeiGIT-compatible upstream origin (no path), default `https://api.heigit.org`                                                                                                  |
| `PROXY_PORT` / `PROXY_HOST` | Proxy listening address, defaults `3001` / `127.0.0.1`                                                                                                                                                 |
| `VITE_TILE_URL`             | Raster tile template; default OSM public tiles are only a low-traffic development choice                                                                                                               |
| `VITE_TILE_ATTRIBUTION`     | Provider-required legal credits, not marketing copy. Default: linked `© OpenStreetMap contributors`. Custom tile URLs require explicit provider attribution HTML from trusted deployment configuration |
| `VITE_TILE_MAX_ZOOM`        | Native raster tile maximum zoom, default 19                                                                                                                                                            |

The client calls only `POST /api/directions/cycling-regular/geojson`, `POST /api/directions/foot-hiking/geojson`, `GET /api/geocode/search` and `GET /api/health`. The proxy adds the private key and forwards to the fixed configured upstream (`/v2/directions/...`, `/geocode/search`); it is not a generic URL-forwarding endpoint. Health returns only whether routing is configured. A directions-only self-hosted instance still needs compatible geocoding; failures are shown honestly. Upstream browser CORS is no longer required because provider requests originate on the server.

The proxy validates profile, point count, coordinate bounds, round-trip options and search parameters; caps request/response sizes, applies per-socket-IP rate limits, rejects cross-origin browser requests, supports request cancellation/timeouts, and returns sanitized failures. No inbound Authorization header is forwarded. API responses are not cached by the service worker. These controls protect basic deployments but **are not authentication**: a public endpoint can still be called by non-browser clients. Before broad release add ingress-level abuse protection and global/provider-budget limits. Rate limits are process-local; behind an ingress, socket IP limits may be shared by all visitors. Forwarded IP headers are not trusted automatically.

### Provider evaluation

ORS was selected over car-only public OSRM services because it supplies actual general cycling and hiking profiles, terrain elevation and documented round-trip requests. Self-hosting is possible but would add infrastructure outside this MVP. Hosted quotas are account-dependent: two loop attempts consume two requests. Routing caches exact input/profile responses in memory for five minutes (up to 20 entries); search caches up to 30 explicit queries. Requests have a 25-second timeout, cancellation, and separate credential, rate-limit, service and network errors. No straight-line fallback is used.

The public ORS directions endpoint was probed and returned HTTP 401 without a key, confirming the dependency. The old ORS website policy/signup URLs currently return 404; the live home page points to HeiGIT Account. Current commercial service permissions/quotas must be confirmed through the provider account before launch; source-code licensing is not hosted-service permission. No live valid-key route response was available during verification.

Default OSM tiles comply with browser Referer/User-Agent and ordinary HTTP caching requirements. There is no custom bulk downloader or tile prefetch. **Before a public/commercial launch, configure an appropriate hosted map provider and its attribution, verify provider terms/capacity, and publish your contact/privacy information.** See [third-party licenses and data policies](./THIRD_PARTY_LICENSES.md). Nominatim is intentionally not used.

## Architecture

Yarn workspaces keep the application in two folders:

- `client/`: React/TypeScript/Vite app, browser tests, assets and public environment settings.
- `proxy/`: dependency-free Node.js HTTP API proxy, private environment settings and Node tests. Also serves the production client build.
- `scripts/dev.mjs`: starts both workspaces and terminates the sibling if either development process exits.
- `client/src/domain/`: typed route/provider contracts, geometry calculations, bounded GPX parsing/export and Dexie persistence.
- `client/src/services/routing.ts`: same-origin proxy requests, routing profiles and bounded in-memory caches; no provider keys or upstream URLs.
- `client/src/components/`: map, statistics, library and dialogs.
- `client/src/App.tsx`: editor/workflow state, including a non-secret proxy-health configuration check.
- `client/public/sw.js`: production app shell only; explicitly excludes `/api` and all third-party map/routing URLs.

Saved/imported routes open as snapshots and are never silently rerouted. Coordinates use `[longitude, latitude, elevation?]`, distances metres and durations seconds. GPX files are bounded to 10 MiB/100,000 points; segment boundaries and standalone waypoints are preserved. HTTPS or localhost is required for the service worker.

## Known limitations

- Real online route/search quality, valid-key authentication, live elevation and real round-trip alternatives were **not verified**: no valid ORS key was supplied. The app does not claim success without the service.
- ORS general cycling is not a dedicated gravel profile. Access restrictions and surface quality depend on OSM data. Surface breakdown is unavailable; terrain elevations and travel times are estimates.
- Loop targets are approximate. The same network may yield one unique alternative or no viable loop. Loop geometry can be saved/exported unchanged; switching to manual editing recalculates a new route.
- Editing an imported GPX explicitly converts its start/finish into a newly routed path and replaces the original geometry after confirmation. Multi-track gaps are otherwise preserved. A waypoint-only file is importable/saveable/exportable but cannot be converted through this editor.
- GPX export preserves point order, segment boundaries, elevations, route name/description and standalone waypoints. It does not preserve every arbitrary vendor extension, original XML layout, per-point timestamps or separate track names; routes are exported as GPX tracks. Imported activity defaults to Hiking and can be changed.
- No navigation, tracking, cloud backup, direct Strava/Komoot publishing, offline maps, dark theme or route surface analytics. The private-key API proxy is the only backend. Use the destination app/device's officially supported GPX upload workflow.
- Local browser data can be removed by storage eviction, private browsing, or clearing site data; export important routes as backups.
- MapLibre requires WebGL. A map/tile outage is reported, never replaced by fake map content. On very small screens, the route sheet scrolls/collapses to keep the map accessible.
- Production output currently includes a large MapLibre/vendor JavaScript chunk (Vite's size warning); builds pass, but further lazy loading is a sensible optimization before broader launch.
- Deploy at the origin root with SPA fallback; base-path deployments need corresponding asset/service-worker path configuration.

## Verification (28 October 2026)

Executed with Node 25.6.1, Yarn Classic 1.22.22 and public npm registry dependencies. Initial proxy migration verification:

- `yarn test`: **56 client tests + 15 proxy tests** passing: domain/persistence/GPX/routing/UI and actual HTTP proxy authentication, whitelist/validation, origin checks, quotas, cancellation, response bounds and static serving.
- `yarn test:e2e`: **10 passing** Chromium workflows across desktop and Pixel 7 mobile viewports: create/recalculate, save/reload/reopen/export, import/error handling, rename/duplicate/filter/delete, hiking/search/service failures and round trips.
- `yarn test:offline`: **3 passing** production browser checks: offline reload/library/GPX export, no external map caching, missing-key failure, waypoint-only GPX conversion handling.
- `yarn test:integration`: **1 passing** browser → real Node proxy → local test upstream flow. Search, route, save/reload/export pass; the upstream requires the server-only sentinel key and the browser/bundle has no provider key or ORS API URL.
- `yarn typecheck`, `yarn lint`, `yarn build`: passed; Vite reports the large-chunk optimization warning noted above.
- Dev server started through the VS Code `Roamlet: dev` task at `http://127.0.0.1:5173/`; HTTP response and real map tiles/attribution were inspected in the integrated browser.

Map-view follow-up verification: **15 targeted unit/component tests and 2 real-map Chromium desktop/mobile tests passed** for timezone/locale inference, corrupt/blocked storage, exact saved-view restoration and opened-route fit precedence. Type checking, lint and production build passed. Existing proxy-migration suites above were not rerun for this scoped map-only change.

Branding/i18n/Yarn follow-up verification with Yarn **4.18.1**: `yarn install --immutable`, `yarn format:check`, `yarn lint`, `yarn typecheck`, and `yarn build` passed. The complete unit suites passed (**81 client + 15 proxy tests**), including Russian switching/persistence, live notice translation, locale-aware statistics, unchanged route/map state, and correct tile-provider attribution. Browser suites passed (**12 desktop/mobile workflows + 3 offline checks + 1 proxy integration check**). The offline check verifies cached self-hosted font assets and no failed bundled-asset requests. The integrated browser confirmed the new logo/palette, Cyrillic Manrope, language switching, visible linked OpenStreetMap credits, and no horizontal overflow at 320 px and 1440 px. The existing vendor chunk-size warning remains; live valid-key ORS responses were not tested.

Browser planning tests use test-only HTTP fixtures, not real hosted routes. The integration suite uses an actual Node proxy and a local synthetic upstream with a test-only sentinel key; production code has no fixture fallback. Production offline/missing-key tests build without a provider key and run the real proxy/static server. Real valid-key ORS service responses remain unverified.

The IDE initially discovered no tests, so configured CLI runners were used. Chromium was installed through the client workspace's Playwright CLI. Migration verification caught a production service-worker bootstrap request to `/` using `Accept: */*`; the static server was fixed to serve the root index for that request while keeping other SPA fallback rules strict. Client keys and upstream URLs were removed from the frontend configuration; production browser testing asserts that the build and request headers do not contain them.
