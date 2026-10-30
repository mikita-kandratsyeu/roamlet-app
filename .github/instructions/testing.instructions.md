---
description: 'Use when writing or modifying Roamlet Vitest, Testing Library, Node test runner, Playwright, layout or offline regression tests.'
applyTo: 'client/src/**/*.test.ts,client/src/**/*.test.tsx,client/src/**/*.layout.test.mjs,client/tests/**/*.ts,client/playwright*.config.ts,client/src/test-setup.ts,server/**/*.test.mjs,scripts/**/*.test.mjs'
---

# Testing standards

- Use existing runners: Vitest/Testing Library for client units and components, node:test for server and standalone layout checks, Playwright for browser workflows, and the separate production offline configuration for service-worker behavior.
- Assert observable behavior and domain contracts, not incidental implementation details. Prefer accessible role/name selectors and user-event for component interactions; reuse established browser helpers.
- For a bug fix, reproduce the failure with a focused regression test before changing behavior when feasible. Verify it fails for the relevant reason, then passes after the fix.
- Cover relevant success, failure and boundary cases. Async changes require cancellation, stale-result, retry and unmount coverage where applicable; persistence changes require save/reload and compatibility checks.
- Mock external provider/network boundaries with synthetic responses and non-real keys. Do not mock the logic under test or replace production failure handling with test fixtures.
- Keep tests deterministic: isolate localStorage/IndexedDB, restore mocks, clean up rendered components and use controlled time when needed. Avoid arbitrary sleeps; wait for observable readiness or state transitions.
- Preserve map loader/viewport readiness and existing drag helpers. Browser tests must keep mobile/desktop behavior, keyboard focus and relevant language/theme coverage.
- Do not weaken assertions, skip failing tests or inflate timeouts to hide a defect. Distinguish environmental failures from regressions using evidence.
- Select commands from the [verification reference](../skills/roamlet-verification/references/commands.md). Start with related selectors in one runner; do not run the entire regression suite for every small change.
- Documentation-only changes do not require application tests unless documentation checks exist. Validate customization metadata, paths and links instead.
