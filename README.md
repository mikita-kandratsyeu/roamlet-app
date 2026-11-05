# Roamlet

An account-free, local-first cycling and hiking route planner.

## Features

- Automatic point-to-point routes, round trips and mixed automatic/direct sections.
- Manual planning, GPX import/export and a local route library without a routing service.
- Route comparison, elevation profiles, climb analysis and personal time estimates.
- Departure schedules, waypoint pauses and optional weather forecasts.
- Optional Google Calendar events with explicit time zones and manual updates; offline ICS export.
- Draft recovery, undo/redo, local JSON backups and optional encrypted Google Drive/GitHub backups.
- PNG route cards and structured summaries for manually sharing with an AI chat.
- English/Russian, light/dark/system themes and responsive desktop/mobile layouts.
- Installable PWA with offline local workflows after the production shell is cached.

## Quick start

Use Node.js **26.x** (matching the package engines) and the bundled Yarn **4.18.1**. From the repository root:

```sh
node .yarn/releases/yarn-4.18.1.cjs install --immutable
cp client/.env.example client/.env.local
cp .env.example .env.local
node .yarn/releases/yarn-4.18.1.cjs dev
```

Open <http://127.0.0.1:5173>. For automatic routing, configure server-only `ORS_API_KEY` in root `.env.local`; never use a `VITE_` prefix or commit secrets. Without it, manual planning, the library and GPX remain available. See [development setup](docs/development.md) for details.

## Checks

```sh
yarn check:ci
```

[CI](.github/workflows/ci.yml) and the local Git commit/push hooks run the same checks; the hooks are enabled by `yarn install`. They do not build the app or run browser suites. See [testing and verification](docs/testing.md) for layout, E2E, production offline and full regression commands. [Deployment instructions](docs/deployment.md) cover Vercel, production variables and API protection.

## Important limits

Routes, drafts and preferences are browser-local, not permanent backups. Clearing site data or storage eviction can remove them; export important work regularly. Cloud copies are optional and manual, not automatic synchronization.

Maps, automatic routing, weather and cloud connections need internet. Offline support does not include map downloads, navigation or tracking. Manual lines do not validate road/trail access; time and elevation figures are planning estimates, and missing heights are not invented. See [known limitations](docs/planning.md#known-limitations) and [provider policies](docs/providers.md).

## Documentation

| Topic                                                     | Guide                                       |
| --------------------------------------------------------- | ------------------------------------------- |
| Planning, schedules, weather, comparison and estimates    | [Route planning](docs/planning.md)          |
| GPX, AI summaries and social images                       | [Exports and sharing](docs/exports.md)      |
| Drafts, history, library and JSON backups                 | [Local storage](docs/storage.md)            |
| Google Calendar, Drive/GitHub setup and sessions          | [Connections](docs/connections.md)          |
| Local tools, environment and dev server                   | [Development](docs/development.md)          |
| Vercel deployment, secrets and public API protection      | [Deployment](docs/deployment.md)            |
| Installation, offline readiness and app updates           | [PWA and offline behavior](docs/offline.md) |
| Layout, localization, themes and accessibility            | [Interface](docs/interface.md)              |
| Map configuration, routing and provider restrictions      | [Providers](docs/providers.md)              |
| Code organization, API errors and logging                 | [Architecture](docs/architecture.md)        |
| CI, test commands, coverage and release checks            | [Testing](docs/testing.md)                  |

Roamlet is protected by an [All Rights Reserved](LICENSE) license. Want to contribute? See [Contributing to Roamlet](CONTRIBUTING.md). Report vulnerabilities privately following the [security policy](SECURITY.md).

See [third-party licenses and geographic data policies](THIRD_PARTY_LICENSES.md) before distributing or publicly deploying the app.
