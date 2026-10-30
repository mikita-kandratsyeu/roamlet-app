# Validation commands

Run from the repository root with Node.js 24+ and the pinned Yarn. These commands reflect existing scripts; recheck package manifests/configs if they change. Replace example paths with the affected files.

## Focused checks

```sh
# Client units/components: selectors are relative to the client workspace.
yarn test:client src/hooks/useRoutingToast.test.ts src/hooks/usePointRouting.test.ts

# TypeScript project validation.
yarn typecheck

# Lint and formatting for the actual edited files, not the entire repository.
yarn exec eslint client/src/hooks/useRoutingToast.ts client/src/hooks/useRoutingToast.test.ts
yarn exec prettier --check client/src/hooks/useRoutingToast.ts client/src/hooks/useRoutingToast.test.ts

# Server units: select affected files using the existing Node runner.
node --test server/routing.test.mjs server/routing-modules.test.mjs scripts/local-routing-api.test.mjs

# Standalone layout tests are outside Vitest's include pattern.
yarn test:layout

# Browser workflows: select relevant specs; both configured projects run by default.
yarn test:e2e routing-tools.spec.ts preparation.spec.ts

# Production service worker, local shell and offline workflows.
yarn test:offline
```

Regular Playwright tests manage their own Vite server on port 4174 and use synthetic map/routing fixtures. Offline tests manage build/preview on port 4175. Do not start another server for these suites or kill an unrelated process occupying a port. Use retained failure traces and test output to diagnose failures.

## Coverage selection

| Change                           | Start with                                      | Add when relevant                                |
| -------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| Hook/domain calculation          | Affected Vitest files, typecheck, targeted lint | Adjacent contracts and caller tests              |
| Component interaction/copy       | Component tests, i18n tests for translations    | Related desktop/mobile browser specs             |
| Styling/map controls             | Related component and layout checks             | Browser layout, keyboard and responsive checks   |
| Routing API/transport            | Affected Node and client service tests          | Browser failure/cancellation flow                |
| Storage/draft/GPX                | Affected domain/hook tests                      | Save/reload/browser workflows and offline checks |
| Service worker/build integration | Relevant tests and production build             | Production offline suite                         |
| Documentation/customizations     | Metadata, paths, links and diff inspection      | Documentation tests only if present              |

## Broader checks

Use only when scope or results justify escalation:

```sh
yarn lint
yarn format:check
yarn test
yarn build
yarn test:regression
```

The full regression script includes lint, typecheck, server/client units, layout, build, regular E2E and offline suites. Do not run it alongside other browser suites sharing the same ports. Never run repository-wide format/fix commands over unrelated user edits.
