# Third-party dependencies and geographic data

Verified against the installed direct packages on 28 October 2026. `yarn.lock` pins exact versions. This document identifies dependencies and upstream notices; retain the license/NOTICE files supplied in packages when distributing bundled builds. Dependencies are not relicensed by this application. Check transitive notices too before distribution.

## Runtime libraries

| Dependency         | Installed version | License and upstream notice                                                                                           |
| ------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| React / React DOM  | 19.3.1            | [MIT](https://github.com/facebook/react/blob/main/LICENSE)                                                            |
| MapLibre GL JS     | 5.24.0            | [BSD-3-Clause, including embedded upstream notices](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt) |
| Dexie              | 4.4.7             | [Apache-2.0](https://github.com/dexie/Dexie.js/blob/master/LICENSE)                                                   |
| Turf distance      | 7.4.0             | [MIT](https://github.com/Turfjs/turf/blob/master/LICENSE)                                                             |
| fast-xml-parser    | 5.11.2            | [MIT](https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/LICENSE)                                     |
| Lucide React icons | 0.468.0           | [ISC, with included derived-icon notices](https://github.com/lucide-icons/lucide/blob/main/LICENSE)                   |

The wordmark and winding-path app icon follow the user-supplied Roamlet brand reference. Typography uses self-hosted Manrope Variable 5.3.0 via Fontsource, licensed under [SIL Open Font License 1.1](https://openfontlicense.org/); its license is retained in `client/public/manrope-license.txt` and shipped with the production build. The image does not name its exact typeface, so Manrope is a visually similar choice with Latin and Cyrillic support. No externally hosted fonts are requested.

Internationalization uses i18next 25.10.10 and react-i18next 16.6.6, both MIT-licensed; retain their bundled license notices.

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

Default raster tiles use `https://tile.openstreetmap.org/{z}/{x}/{y}.png` only for low-traffic development/personal use, subject to the [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/). Browser requests use the normal browser User-Agent and Referer, browser-managed HTTP caching, and HTTPS. There is no prefetch, bulk download, offline region caching, or tile service-worker interception. Availability is best-effort, not guaranteed. A production deployment must select an appropriately licensed/capacity-backed hosted tile provider, configure `VITE_TILE_URL`, `VITE_TILE_MAX_ZOOM`, and its required attribution, and satisfy its commercial terms. No Google or Apple map content is used.

Nominatim was evaluated but intentionally **not used**. Its [public-service policy](https://operations.osmfoundation.org/policies/nominatim/) restricts traffic application-wide, prohibits autocomplete, and places additional constraints on generated apps. Place search uses the configured ORS geocoding service only, on explicit submission.

## Routing, geocoding, and elevation

Routing and geocoding use the hosted [OpenRouteService / HeiGIT](https://openrouteservice.org) API and OSM data. [ORS source code](https://github.com/GIScience/openrouteservice/blob/main/LICENSE) is GPL-3.0; Roamlet calls its hosted HTTP API and does not bundle or modify the routing engine. Hosting/modifying that engine is a separate licensing decision. API access is governed by the provider account/service terms, not by the engine source license. Check the current terms and permitted commercial use in [HeiGIT Account](https://account.heigit.org) before deploying; historical website policy URLs currently return 404, so no unverified commercial permission is asserted here.

Profiles: `cycling-regular` and `foot-hiking`. Cycling is general cycling, not certified gravel routing. Round trips use documented [`options.round_trip`](https://github.com/GIScience/openrouteservice/blob/main/docs/api-reference/endpoints/directions/routing-options.md) with target length, point count, and seeds. Provider quotas apply to each request, including each alternative. Consult [current quotas](https://account.heigit.org) and the [quota FAQ](https://github.com/GIScience/openrouteservice/blob/main/docs/frequently-asked-questions.md); do not treat published historical daily limits as an SLA.

Elevation is requested from the routing provider (`elevation: true`), then gain/loss is derived from its returned coordinates. [ORS elevation configuration](https://github.com/GIScience/openrouteservice/blob/main/docs/run-instance/configuration/engine/elevation.md) documents multi/CGIAR/SRTM terrain providers. The specific live deployment dataset is not verified; no surveyed elevation accuracy or independent dataset redistribution rights are asserted. GPX elevation comes from the user's file. Missing/partial elevation is labeled unavailable. Surface breakdown is not supplied by this MVP.

## Privacy

Routes stay in local IndexedDB. The last map center/zoom/bearing/pitch and selected interface language stay in localStorage. Translations and Manrope fonts are bundled locally; language switching and font rendering do not contact translation services or font CDNs. A first-visit starting region is heuristically selected from browser timezone/language settings without IP lookup, external inference services, or an automatic geolocation permission request; it is not a measured user location. User-selected route points and submitted searches pass through the application's same-origin server proxy to ORS; viewport tile requests still go directly to the configured tile provider. The proxy therefore processes route/search data and client socket IPs for ephemeral rate limiting; it does not persist the route library. Hosting-platform access logs/privacy policies are the deployer's responsibility. Optional location access occurs only when requested. No telemetry, authentication, OAuth, or cloud route synchronization is implemented. Provider privacy policies still apply to their requests.

The Node.js proxy uses native Node HTTP/fetch/filesystem APIs and adds no third-party runtime dependencies. `ORS_API_KEY` and `ORS_URL` belong only to the server environment (`proxy/.env`), not Vite settings or the browser bundle. Public map-provider browser tokens, if required by a selected tile service, remain subject to that provider's origin/domain restrictions; do not put a private map credential into a client tile URL.
