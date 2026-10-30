---
name: roamlet-ui
description: 'Implement or refine Roamlet React/TypeScript UI. Use when adding components, changing planner layouts, dialogs, map controls, accessibility, responsive behavior or localization.'
---

# Implement a UI change

1. Establish the requested behavior and acceptance criteria. Ask for clarification when interaction or scope is ambiguous; do not invent product requirements.
2. Read the affected component, its hook/domain dependencies and nearby tests. Load [frontend instructions](../../instructions/frontend.instructions.md); find reusable UI primitives, tokens, translation keys and layout patterns before editing.
3. Choose the smallest appropriate ownership boundary. Keep calculations/transport out of JSX and avoid duplicating state or extending App unnecessarily. Preserve local-first workflows and confirmation before geometry replacement.
4. Implement the complete interaction, not only its appearance. Include applicable loading, empty, error, success, disabled and retry states; preserve cancellation, keyboard operation and dialog focus.
5. Update both English/Russian locale entries for new copy. Check long text, accessible names, responsive layout and light/dark styling using existing conventions.
6. Add focused behavior tests. For layout/map controls, also select relevant browser or standalone layout checks using the [verification skill](../roamlet-verification/SKILL.md). Inspect the UI with available browser tools when useful; do not claim visual validation when no browser check was performed.
7. Review the diff for unrelated changes, new dependencies, production fixture fallbacks and lost attribution. Report the result, checks actually run and any unverified states in Russian.
