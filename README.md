# Roamlet

An account-free, local-first cycling and hiking route planner.

## Implementation plan

1. Create a strict React/TypeScript/Vite foundation and responsive map-first interface.
2. Integrate MapLibre GL JS (maplibre-gl 5.x) with OpenFreeMap basemaps, browser-direct hosted OpenRouteService cycling/hiking directions, coordinate/map waypoint input, application-generated loops, and local manual straight-line planning.
3. Preserve actual geometry through GPX import/export and IndexedDB route management.
4. Add useful failure states, an offline app shell, accessibility, tests, and provider/license documentation.

Automatic routing uses hosted OpenRouteService (ORS) directly from the browser. MapLibre GL JS with OpenFreeMap supplies basemaps; manual straight-line planning remains local and independent of ORS and its API key. No backend, proxy, external draw plugin or offline basemaps are added. Manual geometry uses the existing MapLibre GeoJSON rendering and statistics pipeline. See service-dependent limitations below.

## Development

Use Yarn 4.18.1 (the latest stable release verified on 28 October 2026), pinned in `packageManager` and bundled in `.yarn/releases`. `.yarnrc.yml` selects the standard npm registry and the familiar `node_modules` linker. Corepack uses the pin; existing Yarn Classic installations forward to the bundled release via `.yarnrc`. Without either launcher, use `node .yarn/releases/yarn-4.18.1.cjs` instead of `yarn`:

```sh
yarn install --immutable
cp client/.env.example client/.env.local
# For routing only, set VITE_ORS_API_KEY to your OpenRouteService API key (never commit actual keys)
# Optionally set VITE_MAP_STYLE to an http(s) or root-relative style URL
yarn dev
```

Requires Node.js 24+ and the pinned Yarn release. `.nvmrc` selects Node.js 24 LTS (`nvm install && nvm use`); newer Node.js versions are also supported. Yarn’s default install-script restrictions remain in place; only esbuild’s required build script is explicitly allowed via `dependenciesMeta`. OpenFreeMap basemaps require no routing key. Configure `VITE_ORS_API_KEY` solely for browser-direct hosted OpenRouteService routing. The value is trimmed and must be nonempty; no Mapbox `pk.*` prefix is required. Never commit actual API keys. Restart Vite or rebuild after changing settings. A missing key disables automatic routing and loop discovery only, not the map, manual planning, local library, coordinate/map input or GPX workflows. Create a key in the [HeiGIT account dashboard](https://account.heigit.org/) and review current quotas and service terms. Paid geocoding and terrain services are not used.

`yarn dev` starts only the client Vite development server at `http://127.0.0.1:5173`. Settings live in gitignored `client/.env` or `client/.env.local`, loaded by Vite. Basemap requests go browser-direct to OpenFreeMap or the configured style’s sources; routing requests go browser-direct to `https://api.heigit.org/openrouteservice`. There is no application backend, server key or server API.

### Production: static frontend

```sh
yarn build
# Inspect the existing build locally:
yarn start
# Equivalent:
yarn preview
```

`yarn build` produces static assets in `client/dist`. Both `yarn start` and `yarn preview` run Vite preview at `http://127.0.0.1:4173`; they require an existing build and are local preview commands, not production hosting. Deploy `client/dist` to static hosting at the origin root with SPA fallback to `index.html`. No application server or database is needed. HTTPS is required outside localhost for the offline app shell.

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
```

## Branding and languages

The interface follows the [Figma reference](https://www.figma.com/design/Bnb9WjC8w59XeZbZdfvtjl/Roamlet-App?node-id=0-1&p=f&t=8dArWhSgsLrTVNyz-0): 420px floating desktop planner, segmented activity/mode controls, detached desktop elevation profile, mobile bottom sheet, and route-library/save dialogs. `client/src/planner.css` supplies the responsive layout; `client/src/components/ui/shadcn.css` supplies the shared light/dark palette. Existing Roamlet artwork, wordmark and application icons remain unchanged. No Mapbox renderer logo is required; geographic data attribution remains visible. Map tiles, routes, markers, and elevations remain live geographic data rather than the reference's demonstration artwork. Bottom map actions share a wrapping toolbar; its measured height and provider attribution reserve space for the elevation panel and compact map controls. The compact style picker moves below the planner-reopen action after resizing, so map overlays do not cover each other or provider branding.

Roamlet uses a restrained forest-green accent, neutral light/dark surfaces, and a winding-path brand symbol. The desktop header exposes route creation and saved routes directly; on mobile, route creation joins preferences and help in the compact menu. The map fills the desktop workspace behind a collapsible floating planner. Mobile uses a separately scrollable bottom sheet, persistent save/export actions, and a one-tap collapse control, keeping the map usable. Typography uses [Onest from Google Fonts](https://fonts.google.com/specimen/Onest), a readable sans-serif with native Latin and Cyrillic support and variable weights 100–900. It is self-hosted through Fontsource under SIL Open Font License 1.1, so the interface, forms, and map controls use one family without external font requests. Brand colors are CSS custom properties. English and Russian interface copy uses concise route terminology, actionable empty states and errors, and clear save/import/export guidance rather than generic adventure slogans. The browser title and page description follow the selected language.

English and Russian translations use i18next and react-i18next with JSON dictionaries in `client/src/locales/en.json` and `client/src/locales/ru.json`. Edit these files to update translations; keep their keys and interpolation placeholders aligned. Both dictionaries are statically bundled, so translation loading works offline without extra network requests. The desktop header provides separate “New route”, “My routes”, and menu controls; mobile retains “My routes” and the menu, with “New route” available inside. The menu follows the Figma preference panel: centered library/help actions, section labels, right-aligned checks and highlighted selections, plus local-storage and map-context notes. It offers library access, language, appearance, and help. It supports keyboard navigation (arrows, Home/End, type-ahead, Escape/Tab), outside-click dismissal, and focus restoration; unsaved-route confirmation is preserved. Select the language in this menu; the choice is stored locally and updates the document language, interface, accessibility labels, and locale-aware statistics. First visits use the browser language with English fallback. User-entered route names/descriptions and geographic place names are not translated. Changing language does not recalculate routes or reset the map. Translations and font assets remain available in the offline app shell.

UI controls use [shadcn/ui](https://ui.shadcn.com/) with Radix accessible primitives and Tailwind CSS: buttons, text fields, labels, activity/route-style toggle groups, the distance slider, dropdown menus, dialogs, cards, notifications, loading skeletons, and the interactive elevation chart. Components live in `client/src/components/ui`; `client/components.json` configures the registry. MapLibre GL JS supplies map rendering, style-source attribution and draggable geographic markers; zoom/location/fit controls use shadcn buttons. OpenFreeMap requires OpenStreetMap/OpenMapTiles attribution supplied by the style sources, not a Mapbox renderer logo. The planner guides activity → routing mode → coordinates/map → stops → route overview → save/export. Stops can be dragged into order on desktop using the grip (pointer capture, highlighted drop target, edge scrolling, and Escape cancellation), or reordered with labeled up/down buttons. Releasing outside the stop list leaves the order unchanged; native drag events remain supported. Automatic point-to-point routes still calculate through Directions; a prominent calculate/update action also retries failed requests. Manual is a map tool, not a route-style tab: its sole activation control is a ruler-icon button in `map-extra-controls`, alongside zoom, geolocation and fit controls. While the manual tool is active, the automatic “Point-to-point”/“Round trip” selector is hidden and the planner shows a short, noninteractive straight-line/no-snapping hint. “Undo last point” appears immediately after the ruler in `map-extra-controls`, only while manual mode is editable. Control order is +, −, locate, fit route, ruler, undo; the ruler is visually separated from navigation and uses primary-theme styling when pressed. The map drawing hint is informational only and remains hidden in compact layouts. Help distinguishes manual straight lines from routed paths: manual planning supports up to 1,000 editable points, does not snap to roads/trails or validate network connectivity or access, and needs no Mapbox token. Adding, moving, reordering, removing, or recalculating points preserves the map camera. Automatic route fitting is limited to opening/importing a route; “Fit route” remains an explicit action. “Use my location” shows a blue location dot and recenters the map at zoom 14 without zooming out an already closer view; it never adds a stop. Repeated requests update the same dot, which remains visible when switching map styles. Mode switches that replace existing geometry require confirmation. Enabling a round trip retains only the start point after confirmation, as before. A compact definition list presents real route metrics. Ascent/descent statistics and the collapsible elevation profile are shown only for imported GPX geometry with complete heights at every track/route point and at least two samples, including its saved snapshots. Manual routes, Mapbox routes and GPX with missing or partial heights hide both elevation statistics and the entire chart on desktop and mobile; missing heights are never filled or treated as zero. Its header has a dedicated chevron toggle; metre units appear on the chart axis rather than beside the toggle. Imported GPX and saved Mapbox/GPX snapshots show a geometry-preservation notice with a separate full-width outlined “Edit waypoints” action, matching the Figma reference. Saved manual routes reopen with their exact points directly editable, without rerouting. Empty routes show next-step guidance rather than meaningless metrics. The library uses a compact list with favorites, filtering, editing, duplication, deletion confirmation, and offline/device-storage management.

The header menu offers light, dark, and system themes. System appearance is the default and follows OS changes; explicit choices persist under `roamlet-theme` in localStorage. Theme initialization runs before the application paints to avoid a light-theme flash. All surfaces, forms, menus, dialogs, charts, notifications, and map overlays share theme tokens; dark mode reduces raster brightness/saturation and highlights route lines without changing geographic data or requesting different tiles. Switching appearance does not recalculate routes or reset map position. If localStorage is blocked, appearance switching still works for the current session.

Motion is intentionally restrained: short menu/dialog reveals, subtle press feedback, smooth theme-color changes, and an animated mobile sheet. Headings and metrics have no decorative entrance or stagger animations. Initial map loading uses a full-screen branded overlay with an indeterminate orbit/progress animation, theme-aware colors and localized copy. It blocks background interaction and scrolling until the map's `load` event, then restores focus; map errors or a 30-second timeout release it so local workflows stay accessible. Reduced motion disables loader animation. There are no decorative looping animations outside loading states. `client/src/motion.css` centralizes the UI timings; `prefers-reduced-motion` disables UI transitions/animations and map-camera movement animation.

Focus indicators use a consistent high-contrast 2 px ring: coordinate input draws a single ring on its input and library filtering draws one on its container, while standalone fields, keyboard-focused buttons/links, menu items, and map controls retain visible focus. Map/menu rings are inset to avoid clipping, and forced-colors mode uses a system highlight. Radix dialogs initially focus the relevant field (or safe Cancel action), contain keyboard focus, and restore the opener without scrolling; inline library editors/confirmations restore their originating action or the search field if a route was deleted.

ESLint checks code quality; Prettier handles consistent formatting. `eslint-config-prettier` prevents conflicting formatting rules. Use `yarn lint:fix` and `yarn format` before submitting changes; use `yarn lint` and `yarn format:check` for validation.

## Implemented workflows

- MapLibre GL JS (maplibre-gl 5.x) map with OpenFreeMap Liberty by default (`https://tiles.openfreemap.org/styles/liberty`) and an alternate style labeled Light (`https://tiles.openfreemap.org/styles/bright`), plus the configured custom style when present. The picker order is Standard (Liberty, map icon), Light (Bright, sun icon), then Custom (layers icon); Russian labels are «Стандартная», «Светлая», and «Своя». Satellite mode is not exposed. Switching styles preserves the camera and restores actual route geometry and numbered pins. Required OpenStreetMap/OpenMapTiles style-source attribution, zoom/pan, fit-to-route, optional user location, click-to-add, and draggable waypoint pins remain available; no Mapbox renderer logo is needed. Desktop route fitting accounts for the floating planner’s footprint. No unsupported map layers or offline basemap downloads are exposed.
- Initial viewport priority: opened route → locally saved map view → approximate browser timezone/locale region → world overview. Known IANA timezones select a regional view, other supported continent timezones select a wider view; otherwise locale country/language is a fallback. Browser settings are **not actual geolocation** and may be unrelated to the user's position. No IP lookup, inference API, or automatic location permission prompt is used.
- Completed map movements save center, zoom, bearing and pitch under `roamlet:map-view:v1` in localStorage. Saved views take priority on reload, while opening/importing a route still fits its geometry. Malformed stored views are ignored; blocked/quota-limited storage does not prevent map use and shows a nonfatal save notice. Clearing site data resets the preference.
- Automatic point-to-point routing with up to 25 stops; coordinate/map replacement, reorder, remove, reverse, automatic cancellable recalculation, and ORS `cycling-regular` / `foot-hiking` profiles. The application retains its 25-point limit even if hosted ORS allows more. Existing longer ORS/legacy Mapbox/GPX snapshots remain readable/exportable, but automatic editing requires reducing stops to this limit.
- Manual planning is activated only by the ruler-icon button in `map-extra-controls`, alongside zoom, geolocation and fit; it is not an option in the planner’s route-style selector. While the manual tool is active, the automatic “Point-to-point”/“Round trip” selector is hidden and replaced by a short, noninteractive straight-line/no-snapping hint. “Undo last point” is immediately after the ruler in `map-extra-controls` and visible only while manual mode is editable, including on mobile. The contextual map drawing hint is informational only and hidden in compact layouts as before. Add, move, reorder or delete up to 1,000 points and undo the last point. Routes have `source: manual`; direct segments are calculated locally without routing requests or an ORS API key. There is no road/trail snapping, network connectivity or access validation, or invented elevation. Geometry-replacing mode switches require confirmation; enabling loops retains only the start point, as before.
- Loop discovery with a 2–100 km target: triangular intermediate points, two orientations and at most three routing attempts per orientation (six Directions requests). Candidates are actual routed geometry, deduplicated, closure-checked within 100 m, and ranked by proximity to target distance. Target length and distinct alternatives are not guaranteed.
- Waypoint input uses `latitude, longitude` coordinates or map clicks/draggable pins only. Coordinate input works without an API key; address/place search APIs are not used.
- Geometry-derived distance and estimated moving time. Manual distance is the sum of direct segment lengths; moving duration uses the existing estimates of 18 km/h for cycling and 5 km/h for hiking. Only imported GPX with complete heights retains ascent/descent statistics and the elevation chart, including saved GPX snapshots. Manual routes, ORS routes, legacy Mapbox routes and GPX without complete heights hide these controls; no terrain elevation fetching or height enrichment occurs.
- Local IndexedDB library: save, name/description edits, reopen, duplicate, filter, and confirmed deletion; unsaved route-discard warnings. Saved, duplicated and reopened manual routes retain their source and exact points and remain editable without Directions.
- GPX tracks/routes/waypoints import (file selection or drop), segment/point/elevation preservation, original-geometry display, and full geometry export with escaped metadata and sensible filenames. Manual exports contain exactly the manual points in order, without snapping, interpolated points, invented elevations or routing-provider attribution.
- Responsive desktop panel and mobile collapsible sheet, keyboard-focusable shadcn controls, Radix modal focus handling, persisted light/dark/system themes, useful loading/error states.
- Installable manifest and production service-worker app shell. Saved routes, GPX export and manual calculations work offline after the initial online visit; basemaps still require online resources, and automatic Directions routing and loop discovery require network access.

## Configuration and providers

| Variable           | Meaning                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_ORS_API_KEY` | Hosted OpenRouteService API key for browser-direct cycling/hiking routing; trimmed and nonempty, no `pk.*` prefix required. Visible in browser requests and built assets. |
| `VITE_MAP_STYLE`   | Optional http(s) or root-relative style URL; default `https://tiles.openfreemap.org/styles/liberty`                                                                       |

MapLibre GL JS uses OpenFreeMap Liberty by default; the alternate OpenFreeMap style is labeled Light (`https://tiles.openfreemap.org/styles/bright`). `VITE_MAP_STYLE` replaces the former Mapbox-specific style setting and accepts an `http://`, `https://` or root-relative URL (for example `/styles/custom.json`), not a `mapbox://` URL. Use HTTPS-compatible resources on HTTPS deployments. Styles and their tile/font/sprite sources load browser-direct from OpenFreeMap or the configured providers, independently of the ORS API key. Preserve OpenStreetMap/OpenMapTiles attribution supplied by OpenFreeMap style sources. OpenFreeMap's public service has no SLA; no offline basemap fallback is added.

Routing uses POST `https://api.heigit.org/openrouteservice/v2/directions/{cycling-regular|foot-hiking}/geojson` with headers `Accept: application/json`, `Content-Type: application/json`, and `Authorization: <API key>`. The JSON body is `{ "coordinates": [[longitude, latitude], ...], "instructions": false, "elevation": false }`. ORS returns a GeoJSON FeatureCollection with LineString geometry and `properties.summary.distance` / `duration` in metres/seconds. Existing geometry-derived distance and moving-time statistics are retained; no heights are requested or fabricated.

**Security and deployment:** The ORS API key is visible in browser developer tools, request headers and built assets; Vite environment variables are not secrets. Never commit actual keys. Direct browser access cannot prevent key reuse or account-wide quota abuse, and the app has no server-side rate limits or secret protection. Monitor daily/per-minute quotas in the [HeiGIT account dashboard](https://account.heigit.org/) and [ORS restrictions](https://openrouteservice.org/restrictions/). A production shared/public app should use a server proxy that keeps the key server-side and enforces rate limits; that proxy is recommended, not implemented in this browser-only scope.

### Provider scope

OpenFreeMap supplies basemaps rendered by MapLibre GL JS; hosted OpenRouteService supplies automatic cycling/hiking routes only. New online routes have `source: openrouteservice`. Manual routes have `source: manual` and use local direct segments, independent of routing or API-key configuration. They do not validate road/trail connectivity or access; basemap attribution remains visible, but manual GPX exports contain no routing-provider attribution. Loops remain application-generated with at most six requests. Address/place search is removed from this scope; use coordinates or map clicks/drags. Terrain-RGB fetching, decoding, sampling and caching are entirely excluded. Only imported GPX with complete heights supplies elevation statistics/chart; neither ORS nor legacy Mapbox routes display them, even if old snapshots contain sampled heights.

Automatic routing caches exact input/profile/API-key responses for five minutes (20 entries); requests have a 25-second timeout. Missing-key checks are not cached. Cancellation, credential, network and service failures remain actionable, with no automatic straight-line fallback. Manual is a separately selected planning mode, not a fallback for failed routing requests. HTTP 401/403 reports key/account-permission guidance; ORS code 2004 reports service limits. Only ORS codes 2009/2010 are recoverable no-route failures in loop search; code 2011 (incompatible parameters) and generic HTTP 400/422 are service failures, not retried as no-route results. There are no quota dashboards or quota-recovery controls. Browser-side bounds and caches do not enforce an account-wide budget. Routing availability, quotas and permitted use depend on the deployed account’s current [ORS terms](https://openrouteservice.org/terms-of-service/) and restrictions. OpenFreeMap’s public basemap service provides no SLA.

**Before publication verify current ORS terms, account eligibility, commercial use, local routing storage/caching, GPX export/redistribution permissions and attribution.** Local storage/export is a product feature, not a legal grant from the provider. Legacy Mapbox snapshots retain their original attribution and remain subject to [Mapbox terms](https://www.mapbox.com/legal/tos); migrating providers does not relicense them. Browser automation uses local synthetic styles/geometry, never production fallback data or real API keys. See [third-party licenses and data policies](./THIRD_PARTY_LICENSES.md).

## Architecture

Yarn has one application workspace, `client/`. Root scripts delegate development, build, preview and tests to it; the deployed application is browser-only.

- `client/`: React/TypeScript/Vite app, browser tests, assets and public environment settings.
- `client/src/domain/`: typed route/provider contracts, geometry calculations, bounded GPX parsing/export and Dexie persistence.
- `client/src/services/routing.ts`: browser-direct hosted OpenRouteService POST requests, routing profiles and bounded in-memory caches.
- `client/src/components/`: map, statistics, library and dialogs.
- `client/src/App.tsx`: editor/workflow state and browser-visible API-key configuration handling.
- `client/public/sw.js`: static production app shell only; excludes all third-party map/routing requests.

IndexedDB version 2 cleanup removes unsupported retired sources, not supported snapshots. Supported sources are `openrouteservice`, legacy `mapbox`, `gpx` and `manual`; saving, duplicating and reopening retains each source and exact geometry. New ORS exports credit openrouteservice and OpenStreetMap contributors; legacy Mapbox exports retain Mapbox/OSM attribution. Manual/GPX exports make no routing-provider claim. No provider data is relabeled as ODbL-licensed.

Saved ORS/legacy Mapbox/GPX and imported routes open as snapshots and are never silently rerouted. Manual routes reopen directly editable and recalculate direct segments locally. Coordinates use `[longitude, latitude, elevation?]`, distances metres and durations seconds. GPX files are bounded to 10 MiB/100,000 points; segment boundaries and standalone waypoints are preserved. HTTPS or localhost is required for the service worker.

## Known limitations

- OpenFreeMap's public basemap service has no SLA. Hosted OpenRouteService availability and quotas depend on the account's current terms; neither provider access nor the renderer migration guarantees route quality or storage/export permissions.
- ORS cycling-regular/foot-hiking profiles are not certified gravel/trail access recommendations. Access restrictions and surface quality depend on geographic data. Surface breakdown is unavailable; travel times are estimates. No terrain heights are fetched; GPX elevation accuracy depends on the imported file.
- Loop targets are approximate. The same network may yield one unique alternative or no viable loop. Loop geometry can be saved/exported unchanged; geometry-replacing mode switches require confirmation. Manual mode calculates new direct segments locally, whereas automatic editing uses Directions. Enabling loops retains only the start point.
- Editing an imported GPX through automatic Directions routing explicitly converts its start/finish into a newly routed path and replaces the original geometry after confirmation. Multi-track gaps are otherwise preserved. A waypoint-only file is importable/saveable/exportable but cannot be converted through this editor.
- GPX export preserves point order, segment boundaries, elevations, route name/description and standalone waypoints. It does not preserve every arbitrary vendor extension, original XML layout, per-point timestamps or separate track names; routes are exported as GPX tracks. Imported activity defaults to Hiking and can be changed.
- No navigation, tracking, cloud backup, direct Strava/Komoot publishing, offline maps or route surface analytics. There is no application backend. Use the destination app/device's officially supported GPX upload workflow.
- Local browser data can be removed by storage eviction, private browsing, or clearing site data; export important routes as backups.
- MapLibre GL JS requires WebGL and online basemap resources, but OpenFreeMap requires no routing API key. A missing ORS key disables only automatic routing and loop discovery; manual calculations work offline independently of the key. Manual routes use straight lines, not road/trail snapping or network/access validation; moving-time estimates are not validated travel times, and no elevations are invented. Map outages are reported, never replaced by fake production content or offline basemaps. On small screens, the route sheet scrolls/collapses to keep the map accessible.
- Production output includes a large map/vendor JavaScript chunk; further lazy loading is a sensible optimization before broader launch.
- Deploy at the origin root with SPA fallback; base-path deployments need corresponding asset/service-worker path configuration.

## Verification

Earlier browser-only verification (28 October 2026) covered the previous implementation, not live ORS access. Tests use synthetic hosted ORS responses and non-real keys; they do not establish current provider availability, account quotas or legal permissions. Validate OpenFreeMap Liberty/Bright and custom style URLs, manual planning and GPX availability without an ORS key, visible OpenStreetMap/OpenMapTiles attribution without a Mapbox renderer logo, coordinate/map-only input, absence of geocoding/terrain requests, and GPX-only elevation visibility.

Run targeted client tests for changed workflows, then the full validation commands as appropriate:

```sh
yarn test:client
yarn typecheck
yarn lint
yarn format:check
yarn build
yarn test:e2e
yarn test:offline
```

Unit/component coverage should include automatic routing failures, coordinate/map waypoint input, absence of geocoding/terrain requests, hidden ascent/descent/chart for manual routes, ORS, legacy Mapbox and incomplete GPX heights, retained elevation statistics/chart for complete imported GPX heights, storage cleanup with ORS/manual/legacy Mapbox/GPX retention, GPX metadata, map-view persistence, language/theme state and keyboard focus. Manual checks should cover adding/moving/reordering/deleting points, undo last point, the 1,000-point manual versus 25-stop Directions limits, exact direct-segment distance, estimated duration at 18 km/h cycling or 5 km/h hiking, no Directions requests, editable save/duplicate/reopen, exact-point GPX export without Mapbox routing attribution, and confirmed geometry-replacing mode switches with start-only loop activation. Browser checks should cover desktop/mobile route planning, the ruler-icon button in `map-extra-controls` as the sole manual activation control alongside zoom/geolocation/fit, absence of a Manual route-style tab, the hidden automatic “Point-to-point”/“Round trip” selector and short noninteractive straight-line/no-snapping planner hint while the manual tool is active, “Undo last point” immediately after the ruler in `map-extra-controls` only while manual mode is editable (order: +, −, locate, fit route, ruler, undo), ruler separation from navigation and pressed primary-theme styling, the informational-only map drawing hint remaining hidden in compact layouts, save/reload/export and missing-token handling. Production offline checks should verify the static shell, local library, GPX workflows and manual calculations without caching external basemap or provider responses; basemaps remain online-only. Browser tests use synthetic styles/geometry only as test fixtures; production has no fixture fallback.

Successful map/routing requests and browser checks do not establish provider availability guarantees, country/payment eligibility, permanent Directions storage permission or GPX redistribution rights. Public credentials belong in gitignored client environment files and are expected to be visible in the built frontend and requests.
