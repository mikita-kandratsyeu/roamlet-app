# Roamlet

An account-free, local-first cycling and hiking route planner. The initial project was empty (only an unrelated `.codemie` folder); no existing application was replaced.

## Implementation plan

1. Create a strict React/TypeScript/Vite foundation and responsive map-first interface.
2. Integrate MapLibre with attributed real map tiles and OpenRouteService cycling/hiking profiles, search, and round trips.
3. Preserve actual geometry through GPX import/export and IndexedDB route management.
4. Add useful failure states, an offline app shell, accessibility, tests, and provider/license documentation.

All four implementation steps are implemented. See verification results and service-dependent limitations below.

## Development

Use Yarn Classic and the standard npm registry (`.yarnrc` configures it):

```sh
yarn install --registry https://registry.npmjs.org
cp proxy/.env.example proxy/.env
# Set ORS_API_KEY in proxy/.env (never in the client)
# Optional PUBLIC tile settings:
cp client/.env.example client/.env.local
yarn dev
```

Requires Node.js 22+ and Yarn Classic. Obtain an OpenRouteService API key through [HeiGIT Account](https://account.heigit.org/signup), currently linked from [openrouteservice.org](https://openrouteservice.org). Check your account's quotas and terms. Store `ORS_API_KEY` only in `proxy/.env` or the hosting platform's server secret settings. The browser receives route/search results, **never the provider key**. Restart the proxy after editing its environment. Without a key, the map, local library, and GPX still work; online routing/search show a server configuration error.

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
yarn test
yarn build
yarn preview
# First browser test run only:
yarn workspace @roamlet/client playwright install chromium
yarn test:e2e
yarn test:offline
```

## Implemented workflows

- Real MapLibre raster map with visible OSM attribution, zoom/pan, fit-to-route, optional user location, click-to-add, and draggable waypoint pins.
- Manual routing with up to 50 stops; replacement search, reorder, remove, reverse, automatic cancellable recalculation, and distinct cycling/hiking profiles.
- Loop discovery with a 2–100 km target and two separately requested ORS round trips. Identical results are deduplicated; nonclosed responses are rejected.
- Place/address search on explicit submission via ORS geocoding. A `latitude, longitude` input works without a key.
- Geometry-derived distance, estimated moving time, available elevation gain/loss and elevation chart. Unavailable data is labeled honestly.
- Local IndexedDB library: save, name/description edits, reopen, duplicate, filter, and confirmed deletion; unsaved route-discard warnings.
- GPX tracks/routes/waypoints import (file selection or drop), segment/point/elevation preservation, original-geometry display, and full geometry export with escaped metadata and sensible filenames.
- Responsive desktop panel and mobile collapsible sheet, keyboard-focusable controls, native modal focus handling, useful loading/error states.
- Installable manifest and production service-worker app shell. Saved routes and GPX export work offline after the initial online visit; map and routing do not.

## Configuration and providers

| Variable | Meaning |
| --- | --- |
| `ORS_API_KEY` | **Proxy only**: private ORS key for online directions/geocoding |
| `ORS_URL` | **Proxy only**: trusted ORS-compatible upstream URL, default `https://api.openrouteservice.org` |
| `PROXY_PORT` / `PROXY_HOST` | Proxy listening address, defaults `3001` / `127.0.0.1` |
| `VITE_TILE_URL` | Raster tile template; default OSM public tiles are only a low-traffic development choice |
| `VITE_TILE_ATTRIBUTION` | Tile provider's required attribution HTML, from trusted deployment configuration |
| `VITE_TILE_MAX_ZOOM` | Native raster tile maximum zoom, default 19 |

The client directly calls `/v2/directions/cycling-regular/geojson`, `/v2/directions/foot-hiking/geojson`, and `/geocode/search`. A self-hosted directions-only ORS instance needs a compatible geocoding endpoint/proxy or place search will report an error; coordinate/map input still works. Custom services must permit browser CORS and the documented ORS request format. Hosted ORS requires a key; no credentials are committed or automatically created.

### Provider evaluation

ORS was selected over car-only public OSRM services because it supplies actual general cycling and hiking profiles, terrain elevation and documented round-trip requests. Self-hosting is possible but would add infrastructure outside this MVP. Hosted quotas are account-dependent: two loop attempts consume two requests. Routing caches exact input/profile responses in memory for five minutes (up to 20 entries); search caches up to 30 explicit queries. Requests have a 25-second timeout, cancellation, and separate credential, rate-limit, service and network errors. No straight-line fallback is used.

The public ORS directions endpoint was probed and returned HTTP 401 without a key, confirming the dependency. The old ORS website policy/signup URLs currently return 404; the live home page points to HeiGIT Account. Current commercial service permissions/quotas must be confirmed through the provider account before launch; source-code licensing is not hosted-service permission. No live valid-key route response was available during verification.

Default OSM tiles comply with browser Referer/User-Agent and ordinary HTTP caching requirements. There is no custom bulk downloader or tile prefetch. **Before a public/commercial launch, configure an appropriate hosted map provider and its attribution, verify provider terms/capacity, and publish your contact/privacy information.** See [third-party licenses and data policies](./THIRD_PARTY_LICENSES.md). Nominatim is intentionally not used.

## Architecture

- `src/domain/types.ts`: typed route/provider contract, `[longitude, latitude, elevation?]` coordinates, metres and seconds.
- `src/domain/stats.ts`: validated geospatial/elevation calculations without joining disconnected GPX segments.
- `src/domain/gpx.ts`: bounded XML parser/serializer; rejects DTD/entity declarations, malformed coordinates/XML and files over 10 MiB or 100,000 points. Imported standalone waypoints are separate from track segments. Display-only track endpoint pins never change exported GPX waypoints.
- `src/domain/storage.ts`: Dexie persistence, validation, fresh identifiers/timestamps for duplicates.
- `src/services/routing.ts`: provider interface implementation, request handling, caching, profiles, geocoding.
- `src/components/`: map lifecycle, statistics, library and dialogs.
- `src/App.tsx`: route editor and workflow orchestration. Saved/imported routes open as snapshots, never silently rerouted.
- `public/sw.js`: same-origin app-shell cache only; no tile/routing caching. Production installation caches HTML and its content-hashed JavaScript/CSS. HTTPS or localhost is required.

## Known limitations

- Real online route/search quality, valid-key authentication, live elevation and real round-trip alternatives were **not verified**: no valid ORS key was supplied. The app does not claim success without the service.
- ORS general cycling is not a dedicated gravel profile. Access restrictions and surface quality depend on OSM data. Surface breakdown is unavailable; terrain elevations and travel times are estimates.
- Loop targets are approximate. The same network may yield one unique alternative or no viable loop. Loop geometry can be saved/exported unchanged; switching to manual editing recalculates a new route.
- Editing an imported GPX explicitly converts its start/finish into a newly routed path and replaces the original geometry after confirmation. Multi-track gaps are otherwise preserved. A waypoint-only file is importable/saveable/exportable but cannot be converted through this editor.
- GPX export preserves point order, segment boundaries, elevations, route name/description and standalone waypoints. It does not preserve every arbitrary vendor extension, original XML layout, per-point timestamps or separate track names; routes are exported as GPX tracks. Imported activity defaults to Hiking and can be changed.
- No navigation, tracking, cloud backup, direct Strava/Komoot publishing, private server, offline maps, dark theme or route surface analytics. Use the destination app/device's officially supported GPX upload workflow.
- Local browser data can be removed by storage eviction, private browsing, or clearing site data; export important routes as backups.
- MapLibre requires WebGL. A map/tile outage is reported, never replaced by fake map content. On very small screens, the route sheet scrolls/collapses to keep the map accessible.
- Production output currently includes a large MapLibre/vendor JavaScript chunk (Vite's size warning); builds pass, but further lazy loading is a sensible optimization before broader launch.
- Deploy at the origin root with SPA fallback; base-path deployments need corresponding asset/service-worker path configuration.

## Verification (28 October 2026)

Executed with Node 25.6.1, Yarn Classic 1.22.22 and public npm registry dependencies:

- `yarn test`: **55 passing** domain, persistence, GPX, routing-adapter and component tests.
- `yarn test:e2e`: **10 passing** Chromium workflows across desktop and Pixel 7 mobile viewports: create/recalculate, save/reload/reopen/export, import/error handling, rename/duplicate/filter/delete, hiking/search/service failures and round trips.
- `yarn test:offline`: **3 passing** production browser checks: offline reload/library/GPX export, no external map caching, missing-key failure, waypoint-only GPX conversion handling.
- `yarn typecheck`, `yarn lint`, `yarn build`: passed; Vite reports the large-chunk optimization warning noted above.
- Dev server started through the VS Code `Roamlet: dev` task at `http://127.0.0.1:5173/`; HTTP response and real map tiles/attribution were inspected in the integrated browser.

Browser planning tests use clearly test-only HTTP fixtures, not real hosted routes, to exercise deterministic workflows. Production offline/missing-key tests build without a key and make no routing-success claims. The IDE's test runner initially reported no discovered tests, so the project's configured Vitest runner was used. Browser tests initially lacked Chromium; it was installed using `yarn playwright install chromium`. Failures found during verification (mobile icon accessible names, stale export behavior tests, first-load service-worker control and cached `Vary: Origin` assets) were fixed and retested.
