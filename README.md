# Roamlet

An account-free, local-first cycling and hiking route planner.

## Implementation plan

1. Create a strict React/TypeScript/Vite foundation and responsive map-first interface.
2. Integrate Mapbox GL JS maps, Mapbox cycling/walking directions, permanent address search, Terrain-RGB elevations, and application-generated loops.
3. Preserve actual geometry through GPX import/export and IndexedDB route management.
4. Add useful failure states, an offline app shell, accessibility, tests, and provider/license documentation.

All four implementation steps are implemented. See verification results and service-dependent limitations below.

## Development

Use Yarn 4.18.1 (the latest stable release verified on 28 October 2026), pinned in `packageManager` and bundled in `.yarn/releases`. `.yarnrc.yml` selects the standard npm registry and the familiar `node_modules` linker. Corepack uses the pin; existing Yarn Classic installations forward to the bundled release via `.yarnrc`. Without either launcher, use `node .yarn/releases/yarn-4.18.1.cjs` instead of `yarn`:

```sh
yarn install --immutable
cp proxy/.env.example proxy/.env
# Set MAPBOX_ACCESS_TOKEN in proxy/.env (server routing/search/terrain token)
cp client/.env.example client/.env.local
# Set VITE_MAPBOX_ACCESS_TOKEN to a PUBLIC pk.* map token with URL restrictions
yarn dev
```

Requires Node.js 24+ in every workspace and the pinned Yarn release. `.nvmrc` selects Node.js 24 LTS (`nvm install && nvm use`); newer Node.js versions are also supported. Yarn’s default install-script restrictions remain in place; only esbuild’s required build script is explicitly allowed via `dependenciesMeta`. Create a [Mapbox account](https://account.mapbox.com/auth/signup/) and check quotas, billing, country/payment eligibility and service terms. Store `MAPBOX_ACCESS_TOKEN` only in `proxy/.env` or server secret settings; the browser never receives that token. Configure a separate public `pk.*` token as `VITE_MAPBOX_ACCESS_TOKEN` for Mapbox GL JS; this token is intentionally visible in the built client and must use minimal scopes and permitted-URL restrictions. Restart the proxy after changing server settings; restart Vite or rebuild after changing public map settings. Missing server credentials disable routing/search/terrain; missing public credentials disable the basemap. Local library and GPX remain usable. Permanent geocoding requires the appropriate paid-account access; a card-free trial may support routing/maps but reject permanent search.

`yarn dev` starts two workspace processes: Vite at `http://127.0.0.1:5173` and the proxy at `http://127.0.0.1:3001`. Vite forwards `/api` to the proxy; the client always uses same-origin relative URLs. Client public settings live in `client/.env.local`; old root `.env.local`, `ORS_API_KEY`, `ORS_URL`, `VITE_ORS_API_KEY` and `VITE_TILE_*` settings are no longer used. Do not copy old provider keys or secret Mapbox tokens into the client workspace. `.env` files in both workspaces are gitignored.

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

The interface and app icon follow the supplied `Roamlet.png`: forest green, sage accents, warm ivory, and a winding-path symbol. Typography uses [Onest from Google Fonts](https://fonts.google.com/specimen/Onest), a readable sans-serif with native Latin and Cyrillic support and variable weights 100–900. It is self-hosted through Fontsource under SIL Open Font License 1.1, so the interface, forms, and map controls use one family without external font requests. Brand colors are CSS custom properties. English and Russian interface copy uses concise route terminology, actionable empty states and errors, and clear save/import/export guidance rather than generic adventure slogans. The browser title and page description follow the selected language.

English and Russian translations use i18next and react-i18next with JSON dictionaries in `client/src/locales/en.json` and `client/src/locales/ru.json`. Edit these files to update translations; keep their keys and interpolation placeholders aligned. Both dictionaries are statically bundled, so translation loading works offline without extra network requests. The header uses one visually grouped split button: “New route” remains a direct primary action, while its adjacent menu opens the route library, language selection, and help. It supports keyboard navigation (arrows, Home/End, type-ahead, Escape/Tab), outside-click dismissal, and focus restoration; unsaved-route confirmation is preserved. Select the language in this menu; the choice is stored locally and updates the document language, interface, accessibility labels, and locale-aware statistics. First visits use the browser language with English fallback. User-entered route names/descriptions and geographic place names are not translated. Changing language does not recalculate routes or reset the map. Translations and font assets remain available in the offline app shell.

UI controls use [shadcn/ui](https://ui.shadcn.com/) with Radix accessible primitives and Tailwind CSS: buttons, text fields, labels, activity/route-style toggle groups, the distance slider, dropdown menus, dialogs, cards, notifications, loading skeletons, and the interactive elevation chart. Components live in `client/src/components/ui`; `client/components.json` configures the registry. Mapbox GL JS supplies map rendering, required attribution/logo, and draggable geographic markers; zoom/location/fit controls use shadcn buttons. The planner uses clearer segmented controls, metric cards, an unsaved-changes badge, and larger touch targets while retaining route editing, GPX, and local-library workflows.

The header menu offers light, dark, and system themes. System appearance is the default and follows OS changes; explicit choices persist under `roamlet-theme` in localStorage. Theme initialization runs before the application paints to avoid a light-theme flash. All surfaces, forms, menus, dialogs, charts, notifications, and map overlays share theme tokens; dark mode reduces raster brightness/saturation and highlights route lines without changing geographic data or requesting different tiles. Switching appearance does not recalculate routes or reset map position. If localStorage is blocked, appearance switching still works for the current session.

Motion is intentionally restrained: short eased surface reveals, lightly staggered metric cards, subtle press feedback, smooth theme-color changes, and an animated mobile sheet. There are no decorative looping animations. `client/src/motion.css` centralizes the timings; `prefers-reduced-motion` disables UI transitions/animations and map-camera movement animation.

Focus indicators use a consistent high-contrast 2 px ring: search inputs draw a single ring on their container, while standalone fields, keyboard-focused buttons/links, menu items, and map controls retain visible focus. Map/menu rings are inset to avoid clipping, and forced-colors mode uses a system highlight. Radix dialogs initially focus the relevant field (or safe Cancel action), contain keyboard focus, and restore the opener without scrolling; inline library editors/confirmations restore their originating action or the search field if a route was deleted.

ESLint checks code quality; Prettier handles consistent formatting. `eslint-config-prettier` prevents conflicting formatting rules. Use `yarn lint:fix` and `yarn format` before submitting changes; use `yarn lint` and `yarn format:check` for validation.

## Implemented workflows

- Mapbox GL JS vector map (Outdoors style by default) with required Mapbox/OSM attribution, zoom/pan, fit-to-route, optional user location, click-to-add, and draggable waypoint pins.
- Initial viewport priority: opened route → locally saved map view → approximate browser timezone/locale region → world overview. Known IANA timezones select a regional view, other supported continent timezones select a wider view; otherwise locale country/language is a fallback. Browser settings are **not actual geolocation** and may be unrelated to the user's position. No IP lookup, inference API, or automatic location permission prompt is used.
- Completed map movements save center, zoom, bearing and pitch under `roamlet:map-view:v1` in localStorage. Saved views take priority on reload, while opening/importing a route still fits its geometry. Malformed stored views are ignored; blocked/quota-limited storage does not prevent map use and shows a nonfatal save notice. Clearing site data resets the preference.
- Manual routing with up to 25 stops; replacement search, reorder, remove, reverse, automatic cancellable recalculation, and Mapbox cycling/walking profiles. Existing longer GPX/ORS snapshots remain readable/exportable, but editing online requires reducing their stops to the new limit.
- Loop discovery with a 2–100 km target: triangular intermediate points, two orientations and at most three routing attempts per orientation (six Directions requests). Candidates are actual routed geometry, deduplicated, closure-checked within 100 m, and ranked by proximity to target distance. Target length and distinct alternatives are not guaranteed.
- Place/address search on explicit submission via Mapbox Geocoding v6 with `permanent=true`, not temporary Search Box results. A `latitude, longitude` input works without a token.
- Geometry-derived distance, estimated moving time, available elevation gain/loss and elevation chart. Unavailable data is labeled honestly.
- Local IndexedDB library: save, name/description edits, reopen, duplicate, filter, and confirmed deletion; unsaved route-discard warnings.
- GPX tracks/routes/waypoints import (file selection or drop), segment/point/elevation preservation, original-geometry display, and full geometry export with escaped metadata and sensible filenames.
- Responsive desktop panel and mobile collapsible sheet, keyboard-focusable shadcn controls, Radix modal focus handling, persisted light/dark/system themes, useful loading/error states.
- Installable manifest and production service-worker app shell. Saved routes and GPX export work offline after the initial online visit; map and routing do not.

## Configuration and providers

| Variable                    | Meaning                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `MAPBOX_ACCESS_TOKEN`       | **Proxy only**: token for Directions, Permanent Geocoding and Terrain-RGB; never bundled in the browser |
| `MAPBOX_URL`                | **Proxy only**: trusted Mapbox-compatible origin without path; default `https://api.mapbox.com`         |
| `PROXY_PORT` / `PROXY_HOST` | Proxy listening address, defaults `3001` / `127.0.0.1`                                                  |
| `VITE_MAPBOX_ACCESS_TOKEN`  | **Public** `pk.*` map token; minimal permissions and URL restrictions                                   |
| `VITE_MAPBOX_STYLE`         | Mapbox GL style; default `mapbox://styles/mapbox/outdoors-v12`                                          |

The client API uses `POST /api/directions/cycling/geojson`, `POST /api/directions/walking/geojson`, `GET /api/geocode/search`, `GET /api/terrain/{z}/{x}/{y}.pngraw` and `GET /api/health`. The proxy injects its token into fixed Mapbox Directions v5, Geocoding v6 and Terrain-RGB requests and normalizes route/search responses to the app's GeoJSON contract; it is not a generic URL forwarder. Health reports configured credentials, not account permissions or connectivity. Maps/styles/fonts/tiles use the separate public token directly from Mapbox GL JS; changing the renderer to Mapbox does not route map traffic through the private proxy.

The proxy validates profile, point count, coordinate bounds, terrain tile coordinates and search parameters; caps request/response sizes, applies per-socket-IP rate limits, rejects cross-origin browser requests, supports request cancellation/timeouts, and returns sanitized failures. No inbound Authorization header is forwarded. API responses are not cached by the service worker. These controls protect basic deployments but **are not authentication**: a public endpoint can still be called by non-browser clients. Before broad release add ingress-level abuse protection and global/provider-budget limits. Rate limits are process-local; behind an ingress, socket IP limits may be shared by all visitors. Forwarded IP headers are not trusted automatically.

### Provider evaluation

Mapbox now supplies the map, cycling/walking routes, permanent geocoding and terrain. Directions does not supply target-distance loops or route elevations: loops are application-generated; heights are sampled from Terrain-RGB at zoom 12. Each route uses at most 64 unique terrain tiles with four concurrent fetches and a 32-tile decoded memory cache. Missing tiles, water/no-data, decoding errors or excessive tile coverage leave all elevations unavailable, rather than fabricating zeros. Gain/loss sums sampled height differences and is an estimate, not a surveyed measurement. Loop candidate searches request no elevation until the best routes are selected.

Routing caches exact input/profile responses for five minutes (20 entries); permanent search caches 30 explicit queries. API calls have a 25-second timeout; terrain fetch/decode has a 10-second deadline. Cancellation, credential, quota, network and service errors remain explicit; no straight-line fallback is used. Map loads, Directions requests, permanent geocoding and terrain usage have distinct account-dependent billing. Mapbox spending alerts are not a hard spending cap; use ingress/global budgets before public launch.

**Before publication verify Mapbox account/payment eligibility for Belarus, commercial terms, storage and GPX redistribution permissions, permanent-geocoding access, usage budgets and attribution.** User approval to preserve storage/export is a product decision, not a legal grant from Mapbox. No valid Mapbox credentials were supplied for live-account verification. Browser tests use local synthetic styles/geometry, never production fallback data. See [third-party licenses and data policies](./THIRD_PARTY_LICENSES.md). Nominatim is intentionally not used.

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
- Mapbox GL JS requires WebGL and a public map token. A missing token or map outage is reported, never replaced by fake production content. On small screens, the route sheet scrolls/collapses to keep the map accessible.
- Production output includes a large map/vendor JavaScript chunk; further lazy loading is a sensible optimization before broader launch.
- Deploy at the origin root with SPA fallback; base-path deployments need corresponding asset/service-worker path configuration.

## Verification history (before Mapbox migration)

The results below describe earlier ORS/MapLibre revisions, not live Mapbox-account validation.

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
