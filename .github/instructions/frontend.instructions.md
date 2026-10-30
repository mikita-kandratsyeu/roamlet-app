---
description: 'Use when creating or changing Roamlet React/TypeScript UI, components, hooks, styles, localization or route editor behavior.'
applyTo: 'client/src/**/*.ts,client/src/**/*.tsx,client/src/**/*.css,client/src/locales/*.json'
---

# React, TypeScript and UI

- Reuse existing [UI primitives](../../client/src/components/ui/), styles and tokens. Do not introduce another UI library or a parallel theme mechanism.
- Keep JSX declarative and avoid duplicating derived values in state. Put routing, GPX and calculations in domain/services rather than components; avoid expanding App with logic that belongs in an existing hook.
- Preserve strict TypeScript. Validate unknown data at boundaries; do not conceal errors with any, unjustified non-null assertions or double type casts. Reuse domain types and represent mutually exclusive states explicitly.
- Use effects to synchronize with external systems. Clean up listeners, timers and subscriptions; maintain correct dependencies without suppressing react-hooks lint. Add useMemo/useCallback for a concrete need, not by default.
- Preserve cancellation and stale-result protection: an old request must not overwrite a newer route, loading/error state or toast. Handle unmount and retry; cancellation is not a user-visible error.
- Add user-visible copy through [i18n](../../client/src/i18n.ts) to both en/ru locales, including aria-labels and errors. Reuse number/unit formatting; do not insert HTML from untrusted translations or external data.
- Use semantic elements, accessible names, keyboard interaction, visible focus and existing dialog focus management. Do not substitute clickable divs for buttons.
- Check applicable mobile/desktop, light/dark, en/ru, long-copy, loading/empty/error/success and disabled states. Do not hide essential actions or map attribution to fix layout.
- Treat MapLibre as an external resource with its own lifecycle; do not recreate the map on every render. Preserve cleanup, layer management and WebGL/network failure handling.
- Manual routes must not trigger online routing. Imported/saved routes are snapshots; geometry replacement must use the existing explicit confirmation flow.
