# Third-party dependencies and geographic data

Dependency versions were verified against the installed direct packages on 28 October 2026, except the agreed replacement of Mapbox GL JS by maplibre-gl 5.x documented here. `yarn.lock` pins exact versions; this documentation-only update does not verify installation of the replacement. This document identifies dependencies and upstream notices; retain the license/NOTICE files supplied in packages when distributing bundled builds. Dependencies are not relicensed by this application. Check transitive notices too before distribution.

## Runtime libraries

| Dependency         | Version           | License and upstream notice                                                                              |
| ------------------ | ----------------- | -------------------------------------------------------------------------------------------------------- |
| React / React DOM  | 19.3.1            | [MIT](https://github.com/facebook/react/blob/main/LICENSE)                                               |
| MapLibre GL JS (`maplibre-gl`) | 5.x (agreed migration) | [BSD-3-Clause and bundled notices](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt) |
| Dexie              | 4.4.7             | [Apache-2.0](https://github.com/dexie/Dexie.js/blob/master/LICENSE)                                      |
| Turf distance      | 7.4.0             | [MIT](https://github.com/Turfjs/turf/blob/master/LICENSE)                                                |
| fast-xml-parser    | 5.11.2            | [MIT](https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/LICENSE)                        |
| Lucide React icons | 0.468.0           | [ISC, with included derived-icon notices](https://github.com/lucide-icons/lucide/blob/main/LICENSE)      |

The wordmark and winding-path app icon follow the user-supplied Roamlet brand reference. Typography uses self-hosted [Onest from Google Fonts](https://fonts.google.com/specimen/Onest), supplied by Fontsource Variable 5.3.1 and licensed under [SIL Open Font License 1.1](https://openfontlicense.org/); its license is retained in `client/public/onest-license.txt` and shipped with the production build. Google Fonts’ metadata confirms Latin/Cyrillic subsets and variable weights 100–900. Onest is used throughout the interface for consistent multilingual readability. No externally hosted fonts are requested.

Internationalization uses i18next 25.10.10 and react-i18next 16.6.6, both MIT-licensed; retain their bundled license notices.

UI components are generated from [shadcn/ui](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md) under MIT; its copyright and license are retained in `client/src/components/ui/LICENSE`. Accessible primitives use [Radix UI](https://github.com/radix-ui/primitives/blob/main/LICENSE), and elevation charts use [Recharts](https://github.com/recharts/recharts/blob/main/LICENSE), both MIT-licensed. Class composition uses class-variance-authority (Apache-2.0), clsx (MIT), and tailwind-merge (MIT); retain the notices shipped in those packages. Styling uses Tailwind CSS and its Vite plugin (MIT). Exact dependency versions are pinned in `yarn.lock`.

## Development libraries

- TypeScript 5.9.3: [Apache-2.0](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt).
- Vite 7.3.7 / React plugin 5.2.0: [MIT](https://github.com/vitejs/vite/blob/main/LICENSE), [plugin MIT](https://github.com/vitejs/vite-plugin-react/blob/main/LICENSE).
- Vitest 3.2.7: [MIT](https://github.com/vitest-dev/vitest/blob/main/LICENSE.md).
- Testing Library React 16.3.3, DOM 10.4.2, jest-dom 6.9.1: MIT ([React](https://github.com/testing-library/react-testing-library/blob/main/LICENSE), [DOM](https://github.com/testing-library/dom-testing-library/blob/main/LICENSE), [jest-dom](https://github.com/testing-library/jest-dom/blob/main/LICENSE)).
- jsdom 26.1.0: [MIT](https://github.com/jsdom/jsdom/blob/main/LICENSE.txt).
- fake-indexeddb 6.2.6: [Apache-2.0](https://github.com/dumbmatter/fakeIndexedDB/blob/master/LICENSE).
- Playwright test 1.64.1: [Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE). Downloaded browser binaries have their own bundled notices.
- ESLint 9.39.5 and @eslint/js: [MIT](https://github.com/eslint/eslint/blob/main/LICENSE).
- typescript-eslint 8.72.1: [MIT](https://github.com/typescript-eslint/typescript-eslint/blob/main/LICENSE).
- eslint-plugin-react-hooks 5.2.0: [MIT](https://github.com/facebook/react/blob/main/LICENSE).
- globals 16.5.0: [MIT](https://github.com/sindresorhus/globals/blob/main/license).
- Prettier 3.9.10 and eslint-config-prettier 10.1.8: MIT (retain bundled licenses).
- Yarn 4.18.1: BSD-2-Clause, bundled project launcher; see [Yarn license](https://github.com/yarnpkg/berry/blob/master/LICENSE.md).
- React type definitions: [DefinitelyTyped MIT](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE).

## Map data and tiles

Map data © OpenStreetMap contributors, licensed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). See [OSM copyright and attribution](https://www.openstreetmap.org/copyright) and [attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines). The interactive map shows a visible attribution link on desktop and mobile. Derived database redistribution may trigger ODbL share-alike requirements; a software library's license does not replace the geographic data license.

Maps use MapLibre GL JS (`maplibre-gl` 5.x) with [OpenFreeMap](https://openfreemap.org/) Liberty by default (`https://tiles.openfreemap.org/styles/liberty`); the alternate style is labeled Light (`https://tiles.openfreemap.org/styles/bright`). `VITE_MAP_STYLE` optionally supplies an http(s) or root-relative style URL, not a `mapbox://` URL. OpenFreeMap requires OpenStreetMap and [OpenMapTiles](https://openmaptiles.org/) attribution supplied by the style sources; keep these linked credits visible on desktop and mobile. No Mapbox renderer logo is required. Retain applicable OpenMapTiles [license and attribution notices](https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md) and any custom style/source notices; the renderer's BSD-3-Clause license does not replace data or service terms.

OpenFreeMap's public service requires no Mapbox token and offers no SLA. Styles, fonts, sprites and tiles are browser-direct network requests to OpenFreeMap or the configured style's providers. No backend or offline basemaps are added, and the service worker does not cache or intercept basemap resources for offline use. `VITE_MAPBOX_ACCESS_TOKEN` remains solely for browser-direct Mapbox Directions walking/cycling; a missing token disables routing, not the map. No Google or Apple map content is used.

The documented mode uses coordinates or map clicks/draggable pins only; address/place search APIs, paid geocoding and terrain services are not used. There is no replacement search provider, new API or proxy.

## Routing and imported GPX elevations

New routes use [Mapbox Directions v5](https://docs.mapbox.com/api/navigation/directions/) profiles `mapbox/cycling` and `mapbox/walking`, with 2–25 input points. These profiles are not certified gravel/trail access recommendations. Directions does not provide a target-length loop request; the app routes triangular intermediate-point candidates, adjusts radius, and makes at most six Directions calls for two candidate orientations. Length and uniqueness are approximate; avoiding steps or guaranteeing surface/access suitability is not supported.

Terrain-RGB fetching, decoding, sampling and caching are entirely excluded. Directions routes have no elevation enrichment: Mapbox routes hide ascent/descent statistics and the elevation chart, including older saved Mapbox snapshots with sampled heights. Only imported GPX with complete heights at every track/route point and at least two samples retains elevation statistics/chart, including saved GPX snapshots. GPX with missing or partial heights hides these controls; existing heights are preserved for export, never filled or treated as zero. GPX height accuracy and any redistribution permissions depend on the imported data’s source. Surface breakdown is unavailable.

IndexedDB storage version 2 intentionally deletes legacy records with a `source` other than `mapbox` or `gpx` on first open, with explicit user approval; Mapbox/GPX records remain. New online snapshots use `source: mapbox`. GPX exports use Mapbox/OSM attribution only and do not relabel Mapbox results as ODbL-licensed data. **Before publication independently verify Mapbox terms for permanent storage, caching, GPX export/redistribution and commercial use, plus Belarus account/payment eligibility.** The product owner's local-save/export and legacy-cleanup decisions and the renderer/basemap migration are not provider permission or Directions redistribution rights. [Mapbox terms](https://www.mapbox.com/legal/tos), [product terms](https://www.mapbox.com/legal/product-terms), [pricing](https://www.mapbox.com/pricing) and [payment information](https://docs.mapbox.com/accounts/faq/how-do-i-pay-for-mapbox-services/) should be checked for the deployed account. Usage alerts do not provide a hard spending cap.

## Privacy

Routes stay in local IndexedDB. The last map center/zoom/bearing/pitch, selected interface language, and light/dark/system theme preference stay in localStorage. Translations and Onest fonts are bundled locally; language switching and font rendering do not contact translation services or font CDNs. A first-visit starting region is heuristically selected from browser timezone/language settings without IP lookup, external inference services, or an automatic geolocation permission request; it is not a measured user location. User-selected route points for Directions go browser-direct to `https://api.mapbox.com` with a public `pk.*` token. Basemap style/font/sprite/tile requests go browser-direct to OpenFreeMap or the configured style's providers without using the Mapbox token. No address/place searches or terrain elevation requests are sent. Mapbox receives routing requests and the browser's network address; basemap providers receive map-resource requests and the browser's network address. Their respective privacy policies apply. There is no application backend or proxy processing route data. Hosting-platform access logs/privacy policies are the deployer's responsibility. Optional location access occurs only when requested. The app adds no analytics telemetry, authentication, OAuth or cloud route synchronization. Mapbox GL JS renderer session/billing traffic is removed with its replacement by MapLibre GL JS; Mapbox Directions traffic remains.

The application deploys as static frontend assets with SPA fallback at the origin root, not as a server API. Configure `VITE_MAPBOX_ACCESS_TOKEN` (`pk.*`) only if routing is needed, and optional `VITE_MAP_STYLE` (http(s) or root-relative style URL) in `client/.env` or `client/.env.local`. Missing the Mapbox token leaves the map available but disables routing. The token is intentionally public in the bundle and request URLs; use minimal scopes and permitted-URL restrictions. Never place a secret `sk.*` token into public Vite settings. No application server-side rate limits or secret-token protection exist, and a browser token cannot hide or prevent quota abuse. The offline service worker supports only the static shell, local library and GPX workflows, not basemap or provider-response caching.

Review current Directions limits in the Mapbox account dashboard and linked pricing/terms; routing access is not a production availability, future eligibility or unlimited-free-use guarantee. OpenFreeMap's public basemap service has no SLA. No quota-management or HTTP 429-specific features are exposed in the UI. Successful requests and the renderer/basemap migration do not establish permanent Directions storage, caching or GPX export/redistribution rights. This documentation-only migration update does not verify corresponding application changes or make new live-check claims.
