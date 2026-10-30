---
name: roamlet-verification
description: 'Select and run focused Roamlet validation. Use when verifying code changes, choosing regression coverage, running unit/component/API/layout/browser/offline tests or preparing a change for review.'
---

# Verify a change

1. Inspect changed files and classify affected behavior: client logic/UI, server contract, layout, offline/persistence, configuration or documentation. Separate user changes from the task's edits.
2. Read [commands and coverage](./references/commands.md) and current package scripts/configuration. Use the pinned Yarn and existing tooling; do not add tooling just for validation.
3. Run the smallest checks covering the change. Combine related test-file selectors in one invocation. For TypeScript changes, include typecheck; lint/format only affected files first. Documentation-only work needs no application tests unless documentation checks exist.
4. Expand to adjacent tests or broader suites when shared contracts, build/runtime integration or failures require it. Use production offline tests for service-worker behavior; ordinary Vite development does not validate the production shell.
5. Inspect failures before retrying. Distinguish an actual regression from a missing tool, occupied port or unavailable browser. Install/restore dependencies only after a missing-dependency failure or an approved manifest change. Never terminate other users' processes or change assertions to hide failures.
6. Inspect the final diff and ensure the fix is saved, no temporary artifacts were added and user edits remain intact. For customizations, validate YAML frontmatter, discovery descriptions, file patterns, skill folder/name consistency and relative links.
7. Report in Russian: checks actually run, passing/failing results and checks not run with their reasons. Mocked browser/API tests do not establish live provider availability, production deployment behavior or coverage of untested browsers.
