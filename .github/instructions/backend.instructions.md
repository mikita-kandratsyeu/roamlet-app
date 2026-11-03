---
description: 'Use when changing Roamlet routing API, OpenRouteService transport, request validation, server configuration or client routing services.'
applyTo: 'api/**/*.mjs,server/**/*.mjs,scripts/local-routing-api*.mjs,client/src/services/**/*.ts'
---

# API and trust boundaries

- Keep [Vercel entrypoints](../../api/) thin and share implementation in [server](../../server/) between Vercel and local Vite middleware. Do not duplicate server logic in the browser.
- ORS_API_KEY is server-only; never prefix secrets with VITE_. The availability endpoint exposes availability, not configuration values. Do not read real environment files for examples or print secrets.
- Follow existing [validation](../../server/routing-contract.mjs), [HTTP limits](../../server/routing-http.mjs) and [transport](../../server/ors-client.mjs). Do not weaken body/response size limits, point bounds, supported profiles/options, same-origin checks, timeouts or API cache exclusion.
- Treat input and upstream JSON as untrusted: validate shape, ranges and finite numbers before use. Do not let input choose arbitrary upstream URLs or server headers.
- Preserve the { error: { code, message } } contract, HTTP statuses and numeric ORS codes used by the client. Never expose raw upstream errors, stack traces or internal configuration.
- Do not log coordinates, route contents, keys or complete request/response bodies. Use existing metadata-only logging for diagnostics.
- Cancellation and timeouts must cover both the request and response consumption. Do not introduce unbounded retries; account for quotas and cancelled requests.
- Preserve testability through existing injected fetch, key getter and logger. Tests must not call live ORS or use real credentials.
- Validate contract changes on both the server and affected client consumers. A missing key or provider outage must not block local workflows.
- Do not replace documented Vercel Firewall protection with an in-memory limiter or claim unit tests verify live availability or provider quotas. See [deployment protection](../../docs/deployment.md#server-key-and-public-api-protection) for limitations.
