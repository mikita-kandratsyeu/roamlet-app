# Third-party dependencies and geographic data

Verified against the installed direct packages on 28 October 2026. `yarn.lock` pins exact versions. This document identifies dependencies and upstream notices; retain the license/NOTICE files supplied in packages when distributing bundled builds. Dependencies are not relicensed by this application. Check transitive notices too before distribution.

## Runtime libraries

| Dependency         | Installed version | License and upstream notice                                                                              |
| ------------------ | ----------------- | -------------------------------------------------------------------------------------------------------- |
| React / React DOM  | 19.3.1            | [MIT](https://github.com/facebook/react/blob/main/LICENSE)                                               |
| Mapbox GL JS       | 3.33.0            | [Mapbox GL JS license and bundled notices](https://github.com/mapbox/mapbox-gl-js/blob/main/LICENSE.txt) |
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

Maps use Mapbox GL JS with `mapbox://styles/mapbox/outdoors-v12` by default, configurable through `VITE_MAPBOX_STYLE`. Keep Mapbox's required logo and linked attribution and the data credits supplied by the style. The public map token is restricted by permitted URLs and minimal scopes. Mapbox maps/styles/fonts/tiles are third-party network requests; no map regions are downloaded or intercepted by the app's service worker for offline use. Map loads are billed according to the account's terms; the software and OSM licenses do not grant unrestricted Mapbox-hosted data redistribution rights. No Google or Apple map content is used.

Place search uses Mapbox Geocoding v6 on explicit submission with `permanent=true` and `autocomplete=false`. [Geocoding documentation](https://docs.mapbox.com/api/search/geocoding/) distinguishes non-cacheable temporary results from permanently storable results. Permanent geocoding requires appropriate account access and terms; card-free trial access may be insufficient. Search Box temporary POI results are not silently substituted and saved.

## Routing, geocoding, and elevation

New routes use [Mapbox Directions v5](https://docs.mapbox.com/api/navigation/directions/) profiles `mapbox/cycling` and `mapbox/walking`, with 2–25 input points. These profiles are not certified gravel/trail access recommendations. Directions does not provide a target-length loop request; the app routes triangular intermediate-point candidates, adjusts radius, and makes at most six Directions calls for two candidate orientations. Length and uniqueness are approximate; avoiding steps or guaranteeing surface/access suitability is not supported.

Terrain-RGB PNG tiles are requested browser-direct from `https://api.mapbox.com` with the same public `VITE_MAPBOX_ACCESS_TOKEN` used for maps, Directions and permanent geocoding, and decoded using `-10000 + (R * 65536 + G * 256 + B) * 0.1` metres. Sampling uses zoom 12, four concurrent fetches, at most 64 tiles per route and a 32-tile decoded cache. This is a terrain estimate; sampled ascent/descent depends on route geometry and raster resolution, with no survey or independent redistribution rights asserted. Missing/partial terrain data yields unavailable elevation, never zero. Imported GPX retains its own elevations. Surface breakdown is unavailable.

IndexedDB storage version 2 intentionally deletes legacy records with a `source` other than `mapbox` or `gpx` on first open, with explicit user approval; Mapbox/GPX records remain. New online snapshots use `source: mapbox`. GPX exports use Mapbox/OSM attribution only and do not relabel Mapbox results as ODbL-licensed data. **Before publication independently verify Mapbox terms for permanent storage, caching, GPX export/redistribution and commercial use, plus Belarus account/payment eligibility.** The product owner's local-save/export and legacy-cleanup decisions are not provider permission. Permanent Geocoding permission does not establish Directions redistribution rights. [Mapbox terms](https://www.mapbox.com/legal/tos), [product terms](https://www.mapbox.com/legal/product-terms), [pricing](https://www.mapbox.com/pricing) and [payment information](https://docs.mapbox.com/accounts/faq/how-do-i-pay-for-mapbox-services/) should be checked for the deployed account. Usage alerts do not provide a hard spending cap.

## Privacy

Routes stay in local IndexedDB. The last map center/zoom/bearing/pitch, selected interface language, and light/dark/system theme preference stay in localStorage. Translations and Onest fonts are bundled locally; language switching and font rendering do not contact translation services or font CDNs. A first-visit starting region is heuristically selected from browser timezone/language settings without IP lookup, external inference services, or an automatic geolocation permission request; it is not a measured user location. User-selected route points, submitted searches, terrain tiles and map/style/font/tile requests go browser-direct to `https://api.mapbox.com` with one public token. Mapbox receives those requests and the browser's network address; there is no application backend processing route/search data. Hosting-platform access logs/privacy policies are the deployer's responsibility. Optional location access occurs only when requested. The app adds no analytics telemetry, authentication, OAuth or cloud route synchronization. Mapbox GL JS may make vendor session/billing requests according to its SDK behavior; Mapbox privacy policies apply to provider traffic.

The application deploys as static frontend assets with SPA fallback at the origin root, not as a server API. Configure `VITE_MAPBOX_ACCESS_TOKEN` (`pk.*`) and optional `VITE_MAPBOX_STYLE` in `client/.env` or `client/.env.local`. The token is intentionally public in the bundle and request URLs; use minimal scopes and permitted-URL restrictions. Never place a secret `sk.*` token into public Vite settings. No application server-side rate limits or secret-token protection exist, and a browser token cannot hide or prevent quota abuse. The offline service worker supports only the static shell, local library and GPX workflows, not basemap or provider-response caching.

Latest live account checks returned HTTP 200 for the Mapbox style, cycling/walking routes and permanent search, and HTTP 429 for Terrain-RGB. Browser-only verification is pending. Successful requests do not establish account eligibility, permanent-geocoding permissions or redistribution rights.
