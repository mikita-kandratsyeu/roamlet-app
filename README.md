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
cp client/.env.example client/.env.local
# Set VITE_MAPBOX_ACCESS_TOKEN to a PUBLIC pk.* token with URL restrictions
# Optionally set VITE_MAPBOX_STYLE
yarn dev
```

Requires Node.js 24+ and the pinned Yarn release. `.nvmrc` selects Node.js 24 LTS (`nvm install && nvm use`); newer Node.js versions are also supported. Yarn’s default install-script restrictions remain in place; only esbuild’s required build script is explicitly allowed via `dependenciesMeta`. Create a [Mapbox account](https://account.mapbox.com/auth/signup/) and check quotas, billing, country/payment eligibility and service terms. Configure one public `pk.*` token as `VITE_MAPBOX_ACCESS_TOKEN` for maps, Directions, permanent Geocoding v6 and Terrain-RGB. It is intentionally visible in the built client and browser requests; use minimal scopes and permitted-URL restrictions. Never use a secret `sk.*` token in Vite settings. Restart Vite or rebuild after changing settings. Missing credentials disable online map/routing/search/terrain services; the local library, coordinate input and GPX remain usable. Permanent geocoding requires appropriate account permissions and terms; a card-free trial may support routing/maps but reject permanent search.

`yarn dev` starts only the client Vite development server at `http://127.0.0.1:5173`. Settings live in gitignored `client/.env` or `client/.env.local`, loaded by Vite. All Mapbox requests go browser-direct to `https://api.mapbox.com`; there is no application backend, server token or server API.

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

The interface follows the [Figma reference](https://www.figma.com/design/Bnb9WjC8w59XeZbZdfvtjl/Roamlet-App?node-id=0-1&p=f&t=8dArWhSgsLrTVNyz-0): 420px floating desktop planner, segmented activity/mode controls, detached desktop elevation profile, mobile bottom sheet, and route-library/save dialogs. `client/src/planner.css` supplies the responsive layout; `client/src/components/ui/shadcn.css` supplies the shared light/dark palette. Existing Roamlet artwork, wordmark, application icons, and provider logos remain unchanged. Map tiles, routes, markers, and elevations remain live geographic data rather than the reference's demonstration artwork. Bottom map actions share a wrapping toolbar; its measured height and provider attribution reserve space for the elevation panel and compact map controls. The compact style picker moves below the planner-reopen action after resizing, so map overlays do not cover each other or provider branding.

Roamlet uses a restrained forest-green accent, neutral light/dark surfaces, and a winding-path brand symbol. The desktop header exposes route creation and saved routes directly; on mobile, route creation joins preferences and help in the compact menu. The map fills the desktop workspace behind a collapsible floating planner. Mobile uses a separately scrollable bottom sheet, persistent save/export actions, and a one-tap collapse control, keeping the map usable. Typography uses [Onest from Google Fonts](https://fonts.google.com/specimen/Onest), a readable sans-serif with native Latin and Cyrillic support and variable weights 100–900. It is self-hosted through Fontsource under SIL Open Font License 1.1, so the interface, forms, and map controls use one family without external font requests. Brand colors are CSS custom properties. English and Russian interface copy uses concise route terminology, actionable empty states and errors, and clear save/import/export guidance rather than generic adventure slogans. The browser title and page description follow the selected language.

English and Russian translations use i18next and react-i18next with JSON dictionaries in `client/src/locales/en.json` and `client/src/locales/ru.json`. Edit these files to update translations; keep their keys and interpolation placeholders aligned. Both dictionaries are statically bundled, so translation loading works offline without extra network requests. The desktop header provides separate “New route”, “My routes”, and menu controls; mobile retains “My routes” and the menu, with “New route” available inside. The menu follows the Figma preference panel: centered library/help actions, section labels, right-aligned checks and highlighted selections, plus local-storage and map-context notes. It offers library access, language, appearance, and help. It supports keyboard navigation (arrows, Home/End, type-ahead, Escape/Tab), outside-click dismissal, and focus restoration; unsaved-route confirmation is preserved. Select the language in this menu; the choice is stored locally and updates the document language, interface, accessibility labels, and locale-aware statistics. First visits use the browser language with English fallback. User-entered route names/descriptions and geographic place names are not translated. Changing language does not recalculate routes or reset the map. Translations and font assets remain available in the offline app shell.

UI controls use [shadcn/ui](https://ui.shadcn.com/) with Radix accessible primitives and Tailwind CSS: buttons, text fields, labels, activity/route-style toggle groups, the distance slider, dropdown menus, dialogs, cards, notifications, loading skeletons, and the interactive elevation chart. Components live in `client/src/components/ui`; `client/components.json` configures the registry. Mapbox GL JS supplies map rendering, required attribution/logo, and draggable geographic markers; zoom/location/fit controls use shadcn buttons. The planner guides activity → routing mode → search/coordinates → stops → route overview → save/export. Stops can be dragged into order on desktop using the grip (pointer capture, highlighted drop target, edge scrolling, and Escape cancellation), or reordered with labeled up/down buttons. Releasing outside the stop list leaves the order unchanged; native drag events remain supported. Point-to-point routes still calculate automatically; a prominent calculate/update action also retries failed requests. Adding, moving, reordering, removing, or recalculating points preserves the map camera. Automatic route fitting is limited to opening/importing a route; “Fit route” remains an explicit action. “Use my location” only recenters the map and never adds a stop. Switching to a round trip confirms before dropping intermediate stops. A compact definition list presents real route metrics, and elevation details can be collapsed. The elevation profile is shown only when at least two samples have complete elevation data; otherwise the entire profile is hidden on both desktop and mobile. Its header has a dedicated chevron toggle; metre units appear on the chart axis rather than beside the toggle. Imported and saved snapshots show a geometry-preservation notice with a separate full-width outlined “Edit waypoints” action, matching the Figma reference. Empty routes show next-step guidance rather than meaningless metrics. The library uses a compact list with favorites, filtering, editing, duplication, deletion confirmation, and offline/device-storage management.

The header menu offers light, dark, and system themes. System appearance is the default and follows OS changes; explicit choices persist under `roamlet-theme` in localStorage. Theme initialization runs before the application paints to avoid a light-theme flash. All surfaces, forms, menus, dialogs, charts, notifications, and map overlays share theme tokens; dark mode reduces raster brightness/saturation and highlights route lines without changing geographic data or requesting different tiles. Switching appearance does not recalculate routes or reset map position. If localStorage is blocked, appearance switching still works for the current session.

Motion is intentionally restrained: short menu/dialog reveals, subtle press feedback, smooth theme-color changes, and an animated mobile sheet. Headings and metrics have no decorative entrance or stagger animations. There are no decorative looping animations. `client/src/motion.css` centralizes the timings; `prefers-reduced-motion` disables UI transitions/animations and map-camera movement animation.

Focus indicators use a consistent high-contrast 2 px ring: place search draws a single ring on its input and library search draws one on its container, while standalone fields, keyboard-focused buttons/links, menu items, and map controls retain visible focus. Map/menu rings are inset to avoid clipping, and forced-colors mode uses a system highlight. Radix dialogs initially focus the relevant field (or safe Cancel action), contain keyboard focus, and restore the opener without scrolling; inline library editors/confirmations restore their originating action or the search field if a route was deleted.

ESLint checks code quality; Prettier handles consistent formatting. `eslint-config-prettier` prevents conflicting formatting rules. Use `yarn lint:fix` and `yarn format` before submitting changes; use `yarn lint` and `yarn format:check` for validation.

## Implemented workflows

- Mapbox GL JS map with icon-labelled Outdoors and Streets style selection (plus the configured custom style when present). Satellite mode is not exposed. Switching styles preserves the camera and restores actual route geometry and numbered pins. Required Mapbox/OSM attribution, zoom/pan, fit-to-route, optional user location, click-to-add, and draggable waypoint pins remain available. Desktop route fitting accounts for the floating planner’s footprint. No unsupported map layers or offline basemap downloads are exposed.
- Initial viewport priority: opened route → locally saved map view → approximate browser timezone/locale region → world overview. Known IANA timezones select a regional view, other supported continent timezones select a wider view; otherwise locale country/language is a fallback. Browser settings are **not actual geolocation** and may be unrelated to the user's position. No IP lookup, inference API, or automatic location permission prompt is used.
- Completed map movements save center, zoom, bearing and pitch under `roamlet:map-view:v1` in localStorage. Saved views take priority on reload, while opening/importing a route still fits its geometry. Malformed stored views are ignored; blocked/quota-limited storage does not prevent map use and shows a nonfatal save notice. Clearing site data resets the preference.
- Manual routing with up to 25 stops; replacement search, reorder, remove, reverse, automatic cancellable recalculation, and Mapbox cycling/walking profiles. Existing longer Mapbox/GPX snapshots remain readable/exportable, but editing online requires reducing their stops to the new limit.
- Loop discovery with a 2–100 km target: triangular intermediate points, two orientations and at most three routing attempts per orientation (six Directions requests). Candidates are actual routed geometry, deduplicated, closure-checked within 100 m, and ranked by proximity to target distance. Target length and distinct alternatives are not guaranteed.
- Place/address search on explicit submission via Mapbox Geocoding v6 with `permanent=true`, not temporary Search Box results. A `latitude, longitude` input works without a token.
- Geometry-derived distance, estimated moving time, available elevation gain/loss and elevation chart. Unavailable data is labeled honestly.
- Local IndexedDB library: save, name/description edits, reopen, duplicate, filter, and confirmed deletion; unsaved route-discard warnings.
- GPX tracks/routes/waypoints import (file selection or drop), segment/point/elevation preservation, original-geometry display, and full geometry export with escaped metadata and sensible filenames.
- Responsive desktop panel and mobile collapsible sheet, keyboard-focusable shadcn controls, Radix modal focus handling, persisted light/dark/system themes, useful loading/error states.
- Installable manifest and production service-worker app shell. Saved routes and GPX export work offline after the initial online visit; map and routing do not.

## Configuration and providers

| Variable                   | Meaning                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `VITE_MAPBOX_ACCESS_TOKEN` | One **public** `pk.*` token for maps, Directions, permanent Geocoding v6 and Terrain-RGB; minimal scopes and URL restrictions |
| `VITE_MAPBOX_STYLE`        | Mapbox GL style; default `mapbox://styles/mapbox/outdoors-v12`                                                                |

All maps/styles/fonts/tiles, Directions v5, Geocoding v6 and Terrain-RGB requests go directly from the browser to `https://api.mapbox.com` using the same public token. The client normalizes routing/search responses to its domain contracts. There are no runtime application API endpoints or server credentials. The service worker caches only the static frontend shell, not provider requests.

A browser token cannot be hidden in source, bundles or request URLs. Permitted-URL restrictions and minimal scopes reduce exposure but cannot eliminate token reuse or quota abuse. There are no application server-side rate limits or secret-token protections; account permissions, quotas and billing remain Mapbox's responsibility.

### Provider evaluation

Mapbox now supplies the map, cycling/walking routes, permanent geocoding and terrain. Directions does not supply target-distance loops or route elevations: loops are application-generated; heights are sampled from Terrain-RGB at zoom 12. Each route uses at most 64 unique terrain tiles with four concurrent fetches and a 32-tile decoded memory cache. Missing tiles, water/no-data, decoding errors or excessive tile coverage leave all elevations unavailable, rather than fabricating zeros. Gain/loss sums sampled height differences and is an estimate, not a surveyed measurement. Loop candidate searches request no elevation until the best routes are selected.

Routing caches exact input/profile responses for five minutes (20 entries); permanent search caches 30 explicit queries. API calls have a 25-second timeout; terrain fetch/decode has a 10-second deadline. Cancellation, credential, quota, network and service errors remain explicit; no straight-line fallback is used. Map loads, Directions requests, permanent geocoding and terrain usage have distinct account-dependent billing. Mapbox spending alerts are not a hard spending cap; review account usage and billing before public launch. Browser-side request bounds and caches do not enforce a global usage budget.

**Before publication verify Mapbox account/payment eligibility for Belarus, commercial terms, storage and GPX redistribution permissions, permanent-geocoding access, usage budgets and attribution.** User approval to preserve storage/export is a product decision, not a legal grant from Mapbox. Live account verification with locally configured tokens returned HTTP 200 for cycling, walking, permanent geocoding and the Outdoors style. Terrain-RGB returned upstream HTTP 429; routes remain usable without heights until that account quota/access issue is resolved. Browser automation uses local synthetic styles/geometry, never production fallback data. See [third-party licenses and data policies](./THIRD_PARTY_LICENSES.md).

## Architecture

Yarn has one application workspace, `client/`. Root scripts delegate development, build, preview and tests to it; the deployed application is browser-only.

- `client/`: React/TypeScript/Vite app, browser tests, assets and public environment settings.
- `client/src/domain/`: typed route/provider contracts, geometry calculations, bounded GPX parsing/export and Dexie persistence.
- `client/src/services/routing.ts`: browser-direct Mapbox requests, routing profiles and bounded in-memory caches.
- `client/src/components/`: map, statistics, library and dialogs.
- `client/src/App.tsx`: editor/workflow state and public-token configuration handling.
- `client/public/sw.js`: static production app shell only; excludes all third-party map/routing requests.

IndexedDB storage version 2 intentionally deletes legacy records whose `source` is neither `mapbox` nor `gpx` on first open, as explicitly approved by the user. Mapbox and GPX snapshots are retained. GPX exports use Mapbox/OSM attribution only; no retired-provider metadata is retained.

Saved/imported routes open as snapshots and are never silently rerouted. Coordinates use `[longitude, latitude, elevation?]`, distances metres and durations seconds. GPX files are bounded to 10 MiB/100,000 points; segment boundaries and standalone waypoints are preserved. HTTPS or localhost is required for the service worker.

## Known limitations

- Latest live account checks returned HTTP 200 for the Mapbox style, cycling/walking routes and permanent search, but Terrain-RGB returned HTTP 429. Direct-browser routing/search is verified; successful service responses do not certify route quality or account/legal permissions.
- Mapbox cycling/walking profiles are not certified gravel/trail access recommendations. Access restrictions and surface quality depend on geographic data. Surface breakdown is unavailable; terrain elevations and travel times are estimates.
- Loop targets are approximate. The same network may yield one unique alternative or no viable loop. Loop geometry can be saved/exported unchanged; switching to manual editing recalculates a new route.
- Editing an imported GPX explicitly converts its start/finish into a newly routed path and replaces the original geometry after confirmation. Multi-track gaps are otherwise preserved. A waypoint-only file is importable/saveable/exportable but cannot be converted through this editor.
- GPX export preserves point order, segment boundaries, elevations, route name/description and standalone waypoints. It does not preserve every arbitrary vendor extension, original XML layout, per-point timestamps or separate track names; routes are exported as GPX tracks. Imported activity defaults to Hiking and can be changed.
- No navigation, tracking, cloud backup, direct Strava/Komoot publishing, offline maps or route surface analytics. There is no application backend. Use the destination app/device's officially supported GPX upload workflow.
- Local browser data can be removed by storage eviction, private browsing, or clearing site data; export important routes as backups.
- Mapbox GL JS requires WebGL and a public map token. A missing token or map outage is reported, never replaced by fake production content. On small screens, the route sheet scrolls/collapses to keep the map accessible.
- Production output includes a large map/vendor JavaScript chunk; further lazy loading is a sensible optimization before broader launch.
- Deploy at the origin root with SPA fallback; base-path deployments need corresponding asset/service-worker path configuration.

## Verification

Latest browser-only verification (28 October 2026): 108 targeted unit tests passed, along with typecheck, lint, formatting and production build. Eight desktop/mobile route/search/loop/import/export checks, all three static production offline checks and two map-view checks passed. Direct-browser Mapbox routing/search from the Vite module returned a 1.020 km Gomel route and five Minsk search results. Terrain-RGB still returned HTTP 429 due to provider quota.

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

Unit/component coverage should include routing/search/terrain failures, storage version 2 cleanup, Mapbox/GPX retention, GPX metadata, map-view persistence, language/theme state and keyboard focus. Browser checks should cover desktop/mobile route planning, save/reload/export and missing-token handling. Production offline checks should verify the static shell, local library and GPX workflows without caching external basemap or provider responses. Browser tests use synthetic styles/geometry only as test fixtures; production has no fixture fallback.

Latest live account checks returned HTTP 200 for cycling/walking routes, permanent place search and the Mapbox Outdoors style; Terrain-RGB returned HTTP 429. Successful service and browser checks do not establish country/payment eligibility, permanent-storage permission or GPX redistribution rights. Public credentials belong in gitignored client environment files and are expected to be visible in the built frontend and requests.
