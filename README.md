# Roamlet

An account-free, local-first cycling and hiking route planner. The initial project was empty (only an unrelated `.codemie` folder); no existing application was replaced.

## Implementation plan

1. Create a strict React/TypeScript/Vite foundation and responsive map-first interface.
2. Integrate MapLibre with attributed real map tiles and OpenRouteService cycling/hiking profiles, search, and round trips.
3. Preserve actual geometry through GPX import/export and IndexedDB route management.
4. Add useful failure states, an offline app shell, accessibility, tests, and provider/license documentation.

Implementation and verification follow this sequence. See the setup and limitations below (expanded with final verification results).

## Development

Use Yarn Classic and the standard npm registry (`.yarnrc` configures it):

```sh
yarn install --registry https://registry.npmjs.org
cp .env.example .env.local
# Set VITE_ORS_API_KEY in .env.local, then:
yarn dev
```

Obtain a browser-appropriate OpenRouteService API key through [HeiGIT Account](https://account.heigit.org/signup), currently linked from [openrouteservice.org](https://openrouteservice.org). Check your account's quotas and terms. Vite `VITE_*` variables are PUBLIC, embedded in the browser bundle; never use a private server secret. Restart Vite after editing the environment. Without a key, the map, local library, and GPX workflows work; online routing and search report a configuration error.

```sh
yarn typecheck
yarn lint
yarn test
yarn build
yarn preview
yarn test:e2e
```
