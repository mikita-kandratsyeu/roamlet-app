---
name: roamlet-bugfix
description: 'Diagnose and fix Roamlet bugs with reproducible evidence and regression tests. Use for incorrect routes, stale requests, broken UI, persistence or GPX errors, routing failures and failing tests.'
---

# Evidence-based bug fixing

1. Establish expected versus actual behavior, reproduction steps and affected inputs. Use the reported failure and local evidence; ask for missing information only when it blocks diagnosis. Do not collect real API keys or private route data.
2. Inspect the working tree and preserve user edits. Run the smallest existing reproduction/test and record the failure; if reproduction is unavailable, label the hypothesis as unverified.
3. Trace the affected execution path through components/hooks/domain/services/server as needed. Identify the violated invariant and root cause before editing; do not patch symptoms by swallowing errors, adding arbitrary delays or disabling validation.
4. Add or adapt a regression test that demonstrates the defect. Run it against pre-fix behavior when feasible and confirm the failure is relevant. Select boundary cases tied to the cause, not a speculative checklist.
5. Apply a focused fix at the responsible boundary. For async bugs, examine abort, request identity, retry and unmount; for persistence/GPX bugs, preserve snapshots, units, segment boundaries and existing data compatibility. Do not introduce dependencies without approval.
6. Run the regression test and adjacent tests in one runner, followed by applicable checks from the [verification skill](../roamlet-verification/SKILL.md). For API contract changes, check affected client consumers as well as server tests.
7. Review the diff for regressions and update directly related documentation if behavior/contracts changed. Report root cause, fix, checks actually run and remaining uncertainty in Russian. Never describe a guessed cause or unexecuted test as verified.
