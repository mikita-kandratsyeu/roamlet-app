# Roamlet project guidelines

- Respond to the user in Russian. Write customization files, code identifiers and technical names in English.
- Before editing, read the nearest implementation, its tests and the relevant [README](../README.md) sections. Verify APIs, files and commands in the repository instead of assuming they exist.
- Preserve the user's uncommitted and staged changes. Do not commit, push, reset files or format unrelated files unless requested.
- Obtain approval before adding dependencies. Use Node.js 24+ and the Yarn version pinned in packageManager; do not introduce other package managers' lockfiles. Install only when needed, following README Development instructions.
- Deliver a complete, focused solution. Do not fix unrelated issues or introduce abstractions, configuration layers or generic components without a concrete use case.
- Keep responsibilities separate: App composes workflows; components render UI; hooks manage lifecycle and orchestration; domain owns models, calculations and local persistence; services handle transport; server implements server-only behavior; api contains thin entrypoints. Reuse existing solutions first.
- Preserve local-first behavior: manual planning, the library and GPX must not depend on ORS. Do not add accounts, analytics, cloud storage or external transmission of user data without an explicit requirement.
- Coordinates are [longitude, latitude, elevation?], distances are metres and durations are seconds. Never invent elevations or statistics from incomplete data; preserve saved geometry and GPX segment boundaries unless replacement is explicitly confirmed.
- Add or update relevant tests for behavior changes. Run the smallest checks covering the change; expand coverage when shared contracts or results require it. Never disable checks just to obtain a passing result.
- Update directly related documentation when contracts, commands or user-visible behavior change. Link to existing documentation rather than duplicating README.
- Report changes, checks actually run and limitations concisely. Never describe assumed or unexecuted checks as passing.

## Using these customizations

Project-wide guidelines apply to all work. [React/UI](./instructions/frontend.instructions.md), [API](./instructions/backend.instructions.md) and [testing](./instructions/testing.instructions.md) instructions have scoped file patterns.

Repeatable workflows are available as skills: `/roamlet-ui` for UI changes, `/roamlet-bugfix` for bug fixes and `/roamlet-verification` for selecting and running checks. Skills may also be discovered automatically through their descriptions; they do not replace tool-based validation.
