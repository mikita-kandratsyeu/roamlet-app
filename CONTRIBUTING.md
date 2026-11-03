# Contributing to Roamlet

Contributions to code, tests, documentation and English/Russian translations are welcome. Roamlet is a local-first cycling and hiking planner; changes should preserve local workflows and existing user data.

## Before starting

- Search existing issues and pull requests to avoid duplicate work.
- Use the [bug report form](.github/ISSUE_TEMPLATE/bug_report.yml) for reproducible problems or the [feature request form](.github/ISSUE_TEMPLATE/feature_request.yml) for improvements. Blank issues remain available for other topics.
- Discuss substantial features, new dependencies or changes to data formats before implementing them.
- Keep each contribution focused on one problem; avoid unrelated refactoring and formatting.

## Development setup

Use Node.js **26.x** and the pinned Yarn **4.18.1**, as declared in [package.json](package.json). Follow the [development guide](docs/development.md) for installation, environment files and the local server. Do not introduce another package manager's lockfile.

Fork and clone the repository if you do not have write access, then create a dedicated branch for your change. Read the nearest implementation and tests before editing; see [architecture and API contracts](docs/architecture.md) for ownership boundaries.

Automatic routing and cloud connectors are optional. Manual planning, the route library and GPX workflows must remain usable without provider credentials.

## Implementation expectations

- Reuse existing components, styles and domain/service boundaries.
- Preserve saved geometry, GPX segment boundaries and local storage compatibility. Document and test any intentional migration.
- Do not invent elevations or statistics when source data is incomplete.
- Keep user-visible copy in both [English](client/src/locales/en.json) and [Russian](client/src/locales/ru.json).
- For UI changes, consider keyboard access, mobile layouts, both languages and light/dark themes.
- Add regression coverage for behavior changes and update directly related documentation.
- Discuss any new external transmission of user data explicitly; do not add it as an incidental side effect.

## Verification

Run the smallest checks that cover the change, following [testing and verification](docs/testing.md). Include TypeScript checking for TypeScript changes. Expand to layout, E2E or production offline tests when the affected behavior requires them; builds and browser suites are not required for every change. Documentation-only changes need link and formatting checks, not application builds.

[CI](.github/workflows/ci.yml) runs lint, TypeScript checks and server/client unit tests only. Mocked tests do not verify live provider access or production deployment behavior.

Report exact commands and their results. Explain failures and checks not run; do not skip assertions or weaken tests to hide failures.

## Opening a pull request

Use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md):

1. Explain what changed and why, and link related issues.
2. List verification commands, results and remaining limitations.
3. Include redacted before/after screenshots for visible UI changes when useful.
4. Note any local-data, privacy, localization or compatibility implications.
5. Complete the checklist and respond to review feedback.

[CODEOWNERS](.github/CODEOWNERS) assigns the repository to `@mikita-kandratsyeu`. GitHub uses the file from the pull request's base branch, and owners must have write access. Required code-owner approval is configured separately through branch protection or repository rules; the file alone does not enforce it. Issue forms become available after they are merged into the default branch.

## Safe reports and examples

Report suspected vulnerabilities privately using the [security policy](SECURITY.md), not public issues or pull requests.

Use small synthetic routes and fixtures. Never include API keys, tokens, passwords, cookies, private coordinates or personal data in commits, issues, logs or screenshots. Redact diagnostic material before sharing, and back up important local routes before testing storage-clearing or recovery scenarios.

Preserve third-party attribution and notices. Consult [third-party licenses and data policies](THIRD_PARTY_LICENSES.md) when changing dependencies, geographic providers or export behavior.
