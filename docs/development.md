# Development

[Back to overview](../README.md)

## Local setup

Use Yarn 4.18.1 (the latest stable release verified on 28 October 2026), pinned in `packageManager` and bundled in `.yarn/releases`. `.yarnrc.yml` selects the standard npm registry and the familiar `node_modules` linker. Corepack uses the pin; existing Yarn Classic installations forward to the bundled release via `.yarnrc`. Without either launcher, use `node .yarn/releases/yarn-4.18.1.cjs` instead of `yarn`:

```sh
yarn install --immutable
cp client/.env.example client/.env.local
cp .env.example .env.local
# For routing only, set ORS_API_KEY in root .env.local (never commit actual keys)
# Optionally set VITE_MAP_STYLE to an http(s) or root-relative style URL
yarn dev
```

Use Node.js 26.x, matching the root/client package engines and CI, and the pinned Yarn release. The existing `.nvmrc` still selects Node.js 24; with nvm, explicitly run `nvm install 26 && nvm use 26` for the declared runtime. Yarn’s default install-script restrictions remain in place; only esbuild’s required build script is explicitly allowed via `dependenciesMeta`. OpenFreeMap basemaps require no routing key. Configure server-only `ORS_API_KEY` in root `.env.local` for hosted OpenRouteService routing. Never use a `VITE_` prefix for secrets. The value is trimmed and must be nonempty; no Mapbox `pk.*` prefix is required. Never commit actual API keys. Restart Vite after changing the server key; on Vercel redeploy after changing server environment variables. Public `VITE_MAP_STYLE` changes require a restart or rebuild. A missing key disables automatic routing and loop discovery only, not the map, manual planning, local library, coordinate/map input or GPX workflows. Create a key in the [HeiGIT account dashboard](https://account.heigit.org/) and review current quotas and service terms. Paid geocoding and terrain services are not used.

`yarn dev` starts the client Vite server at `http://127.0.0.1:5173` with local API middleware using the same server handlers as Vercel. `yarn preview` includes this middleware too. Public map settings live in gitignored `client/.env.local`; the server key lives in root `.env.local` (or the process environment, which takes precedence). Basemaps remain browser-direct; routing goes through `/api/route`. `/api/routing-config` returns only `{ "available": true/false }` with no secret. No client-visible ORS key is needed.

## Contributing

Use the [pull request template](../.github/PULL_REQUEST_TEMPLATE.md) to summarize changes, report checks actually run and note local-data, localization and compatibility implications. Run the smallest relevant checks from [testing and verification](testing.md); builds and browser suites are not required for every change.

The issue chooser provides a [bug report form](../.github/ISSUE_TEMPLATE/bug_report.yml) and a [feature request form](../.github/ISSUE_TEMPLATE/feature_request.yml). Blank issues remain available for other topics. Use synthetic examples and redact credentials, private route coordinates and personal data from reports and screenshots.

[CODEOWNERS](../.github/CODEOWNERS) assigns the whole repository to `@mikita-kandratsyeu`. GitHub reads it from the pull request's base branch, and owners must have write access. Required code-owner approval must be enabled separately in branch protection or repository rules; the file alone does not enforce approval. Issue forms become available after they are merged into the default branch.
