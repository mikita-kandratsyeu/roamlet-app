const CACHE = 'roamlet-shell-__BUILD_REVISION__';
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
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
          if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) assets.push(url.pathname);
        }
      }
      await cache.put('/', response);
      await cache.addAll([...new Set(['/icon.svg', ...assets])]);
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
        await Promise.all(keys.filter((key) => key.startsWith('roamlet-shell-') && key !== CACHE).map((key) => caches.delete(key)));
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    // Keep this worker's HTML and chunks together until the user approves its successor.
    event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match('/')) || fetch(event.request)));
  } else if (url.pathname.startsWith('/assets/') || url.pathname === '/icon.svg') {
    // These same-origin, content-hashed files are identical regardless of Origin headers.
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
