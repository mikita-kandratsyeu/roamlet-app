# Production deployment

[Back to overview](../README.md)

## Production: Vercel static frontend and routing functions

```sh
yarn build
# Inspect the existing build locally:
yarn start
# Equivalent:
yarn preview
```

`yarn build` produces static assets in `client/dist`. Both `yarn start` and `yarn preview` run Vite preview at `http://127.0.0.1:4173`; they require an existing build and are local preview commands, not production hosting. Deploy the repository on Vercel at the origin root using `vercel.json`: Root Directory is the repository root, Node.js is 26.x (matching the package engines), and Output Directory is `client/dist`. Vercel deploys the root `api/*.mjs` functions alongside the static frontend; uploading only `client/dist` elsewhere does not include routing. No application database is needed. HTTPS is required outside localhost for the offline app shell.

## Server key and public API protection

1. Create an ORS key in the [HeiGIT account dashboard](https://account.heigit.org/).
2. In Vercel **Settings → Environment Variables**, add **Sensitive** `ORS_API_KEY` for Production, then redeploy. Use a separate key for Preview or leave routing disabled there. Remove any old `VITE_ORS_API_KEY`; rotate keys previously shipped in a browser build.
3. Before public access, configure **Vercel Firewall** rate limiting on path `/api/route`, method POST. Set per-client limits according to the account's current quotas; loop discovery can make up to six calls, and mixed routing can make multiple calls. Availability of Firewall rate-limiting rules depends on the Vercel plan; verify support before launch. This repository intentionally has no unreliable in-memory limiter and does not automatically configure Firewall.
4. Monitor aggregate ORS daily/per-minute usage and Vercel function usage; IP limits are not an account-wide budget. Restrict deployment access or disable the key if protection or quota monitoring is unavailable. Do not log coordinates, keys or raw upstream errors.
5. Verify two real deployments: service-worker update, draft recovery, routing and offline/manual workflows. Test the permanent production domain before users save routes; browser storage is origin-specific.

The proxy accepts only four cycling/hiking profiles, 2–50 longitude/latitude points, the supported ferry/step avoidance options and bounded point alternatives. It enforces a 16 KiB request-body limit, an 8 MiB upstream-body limit, a 4 MiB final serialized JSON response limit (leaving headroom for Vercel), and a 20-second timeout covering both the provider request and response-body consumption. It sanitizes responses/errors, disables API caching and rejects cross-origin browser requests. These checks protect the key and constrain requests, but **do not replace Firewall rate limits**. Maps and GPX stay client-side.
