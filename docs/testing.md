# Testing and verification

[Back to overview](../README.md)

## Lightweight CI

[GitHub Actions CI](../.github/workflows/ci.yml) runs lint, TypeScript checking and server/client unit tests on pushes and pull requests, using Node.js 26.x and the pinned Yarn release. It does not run production builds, layout, E2E or offline browser suites; the full regression command remains available locally.

CI caches Yarn's downloaded packages in `.yarn/cache`, keyed by the OS, Node runtime, lockfile, Yarn configuration/release and package manifests. A compatible older download cache can be reused, but `install --immutable` always runs; `node_modules` and install state are not cached.

ESLint uses a content-based cache in `.yarn/ci-eslint.cache`. Its key includes dependency manifests, the lockfile, ESLint configuration and commit SHA; compatible earlier results can be restored. Changed files are checked again. Unit tests and TypeScript checks always run on code-changing workflows; test results are not cached. Superseded runs on the same workflow/ref are cancelled.

Pushes and pull requests changing only Markdown files or files under `docs/` skip this workflow. Changes to code, configuration or `yarn.lock` still trigger it. If this CI is configured as a required status check, GitHub can leave documentation-only pull requests pending because the workflow was skipped; remove the path filters or use a separate always-reporting required gate before enabling that requirement.

## Validation commands

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
yarn test:layout
yarn test:e2e
yarn test:offline
# Complete regression gate (after Chromium is installed):
yarn test:regression
```

`yarn test:regression` runs lint, type checking, server/client units, the standalone Chromium layout checks, a production build, desktop/mobile E2E and production offline tests. `yarn test:layout` exposes the standalone layout tests that are outside Vitest's test selection. Browser suites exercise Chromium desktop/mobile layouts, English/Russian copy, light/dark themes, keyboard focus, touch targets, local library/GPX workflows and production service-worker recovery. Map and routing fixtures keep these checks deterministic; passing them does not verify live provider availability or Safari/Firefox. Browser checks wait for the global loader to release the editor and for responsive map controls to settle before interacting. Drag checks bring both endpoints into the planner's scroll viewport. Screenshots and retained failure traces use Playwright's output directory, not a developer-specific path. The complete runner separates `client/test-results/e2e` and `client/test-results/offline` so the offline run does not erase E2E evidence.

## Dependency security checks

After dependency updates, run `yarn install --immutable` and `yarn npm audit --all --recursive --no-deprecations`, then lint, typecheck, unit tests and a production build. The audit covers runtime and development dependencies in every workspace; `--no-deprecations` omits package deprecation notices, not security advisories. Use `yarn npm audit --all --recursive` to include those notices too.

MapLibre 6 uses named ESM exports and a separate worker. The application imports that worker as a Vite URL asset and configures it before rendering, so it is served locally in development and included in the production manifest/offline shell. After map dependency updates, run `yarn test:e2e map-view.spec.ts` and `yarn test:offline` to verify actual worker loading as well as mocked map units.

The root manifest overrides the ESLint/TypeScript tooling's Minimatch 10 ranges with patched Minimatch 11 releases. ESLint 10 avoids the older callable Minimatch 3 API; do not override that API with Minimatch 11. Remove the scoped overrides when upstream tooling requests patched versions itself. The React Hooks lint configuration retains the two existing checks without introducing React Compiler rules as part of a dependency update.

## Verification

Earlier browser-only verification (28 October 2026) covered the previous implementation, not live ORS access. Tests use synthetic hosted ORS responses and non-real keys; they do not establish current provider availability, account quotas or legal permissions. Validate OpenFreeMap Liberty/Bright and custom style URLs, manual planning and GPX availability without an ORS key, visible OpenStreetMap/OpenMapTiles attribution without a Mapbox renderer logo, coordinate/map-only input, absence of geocoding/terrain requests, and GPX-only elevation visibility.

Run targeted client tests for changed workflows, then the full validation commands as appropriate. Native departure-field layout coverage uses desktop/mobile Chromium and mobile WebKit emulation: `node --test client/src/components/RouteSchedule.layout.test.mjs`. If browser binaries are missing, restore them with `yarn workspace @roamlet/client exec playwright install chromium webkit`. Emulation does not replace checking the native picker on physical devices.

```sh
yarn test:client
yarn typecheck
yarn lint
yarn format:check
yarn build
yarn test:e2e
yarn test:offline
```

Unit/component coverage should include automatic routing failures, coordinate/map waypoint input, absence of geocoding/terrain requests, hidden ascent/descent/chart for manual routes, ORS, legacy Mapbox and incomplete GPX heights, retained elevation statistics/chart for complete imported GPX heights, storage cleanup with ORS/manual/legacy Mapbox/GPX retention, GPX metadata, map-view persistence, language/theme state and keyboard focus. Manual checks should cover adding/moving/reordering/deleting points, undo last point, the 1,000-point manual versus 50-stop Directions limits, exact direct-segment distance, estimated duration at 18 km/h cycling or 5 km/h hiking, no Directions requests, editable save/duplicate/reopen, exact-point GPX export without Mapbox routing attribution, and confirmed geometry-replacing mode switches with start-only loop activation. Browser checks should cover desktop/mobile route planning, both the ruler-icon button in `map-extra-controls` alongside zoom/geolocation/fit and the empty planner’s labelled manual-drawing action, absence of a Manual route-style tab, the hidden automatic “Point-to-point”/“Round trip” selector and short noninteractive straight-line/no-snapping planner hint while the manual tool is active, “Undo last point” immediately after the ruler in `map-extra-controls` only while manual mode is editable (order: +, −, locate, fit route, ruler, undo), ruler separation from navigation and pressed primary-theme styling, the informational-only map drawing hint remaining hidden in compact layouts, save/reload/export and missing-token handling. Production offline checks should verify the static shell, local library, GPX workflows and manual calculations without caching external basemap or provider responses; basemaps remain online-only. Browser tests use synthetic styles/geometry only as test fixtures; production has no fixture fallback.

Successful map/routing requests and browser checks do not establish provider availability guarantees, country/payment eligibility, permanent Directions storage permission or GPX redistribution rights. Public credentials belong in gitignored client environment files and are expected to be visible in the built frontend and requests.
