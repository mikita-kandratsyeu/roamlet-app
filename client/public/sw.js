const CACHE = 'roamlet-shell-__BUILD_REVISION__';
const COMPLETION_MARKER = '/__roamlet_offline_complete__';
const INSTALL_ASSETS = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/github-mark.png',
  '/google-drive-2026.png',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'OFFLINE_STATUS' && event.ports[0]) {
    event.waitUntil(
      (async () => {
        let ready = false;
        try {
          const cache = await caches.open(CACHE);
          const marker = await cache.match(COMPLETION_MARKER);
          if (marker) {
            const completion = await marker.json();
            if (
              completion.revision === CACHE &&
              Array.isArray(completion.assets) &&
              completion.assets.includes('/') &&
              INSTALL_ASSETS.every((asset) => completion.assets.includes(asset)) &&
              completion.assets.every((asset) => typeof asset === 'string')
            ) {
              const assets = await Promise.all(
                completion.assets.map((asset) => cache.match(asset)),
              );
              ready = assets.every((asset) => !!asset);
            }
          }
        } catch {
          // Cache failures must not be reported as a usable offline shell.
        }
        event.ports[0].postMessage({ type: 'OFFLINE_STATUS', ready });
      })(),
    );
  }
});
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Stage the full installation without damaging a still-usable active shell.
      const staging = `${CACHE}-installing`;
      await caches.delete(staging);
      const cache = await caches.open(staging);
      try {
        const response = await fetch('/');
        if (!response.ok) throw new Error('App shell could not be cached');
        const html = await response.clone().text();
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+)"/g)].map(
          (match) => match[1],
        );
        const manifestResponse = await fetch('/assets/manifest.json', { cache: 'no-store' });
        if (!manifestResponse.ok) throw new Error('App asset manifest could not be cached');
        const manifest = await manifestResponse.json();
        for (const entry of Object.values(manifest)) {
          for (const path of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
            const url = new URL(path, self.location.origin);
            if (url.origin === self.location.origin && url.pathname.startsWith('/assets/'))
              assets.push(url.pathname);
          }
        }
        await cache.put('/', response);
        await cache.addAll([...new Set([...INSTALL_ASSETS, ...assets])]);
        // Fonts referenced by the stylesheet must also survive the first offline visit.
        const fonts = [];
        for (const asset of assets.filter((path) => path.endsWith('.css'))) {
          const stylesheet = await cache.match(asset);
          const css = await stylesheet.text();
          for (const match of css.matchAll(/url\(["']?([^\s)"']+\.woff2)["']?\)/g)) {
            const font = new URL(match[1], new URL(asset, self.location.origin));
            if (font.origin === self.location.origin && font.pathname.startsWith('/assets/')) {
              fonts.push(font.pathname);
            }
          }
        }
        await cache.addAll([...new Set(fonts)]);
        const completeAssets = [...new Set(['/', ...INSTALL_ASSETS, ...assets, ...fonts])];
        const destination = await caches.open(CACHE);
        for (const asset of completeAssets) {
          const cached = await cache.match(asset);
          if (!cached) throw new Error('App shell cache is incomplete');
          await destination.put(asset, cached);
        }
        await destination.put(
          COMPLETION_MARKER,
          new Response(JSON.stringify({ revision: CACHE, assets: completeAssets })),
        );
      } finally {
        await caches.delete(staging);
      }
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window' });
      // Other open tabs can still need their old, not-yet-loaded chunks.
      if (windows.length <= 1) {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) => key.startsWith('roamlet-shell-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        );
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  // OAuth navigations and callbacks must reach the server, never the cached app shell.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    // Keep HTML and chunks together until the successor activates on a later app startup.
    event.respondWith(
      caches.open(CACHE).then(async (cache) => (await cache.match('/')) || fetch(event.request)),
    );
  } else if (url.pathname.startsWith('/assets/') || INSTALL_ASSETS.includes(url.pathname)) {
    // Same-origin shell assets are identical regardless of Origin headers.
    event.respondWith(
      caches.match(event.request, { ignoreVary: true }).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
            }
            return response;
          }),
      ),
    );
  }
});
