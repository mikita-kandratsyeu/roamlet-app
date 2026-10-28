const CACHE = 'roamlet-shell-v3';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch('/');
    if (!response.ok) throw new Error('App shell could not be cached');
    const html = await response.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+)"/g)].map(match => match[1]);
    await cache.put('/', response);
    await cache.addAll([...new Set(['/icon.svg', ...assets])]);
    // Fonts referenced by the stylesheet must also survive the first offline visit.
    const fonts = [];
    for (const asset of assets.filter(path => path.endsWith('.css'))) {
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
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('roamlet-shell-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put('/', copy))); }
      return response;
    }).catch(() => caches.match('/').then(response => response || Response.error())));
  } else if (url.pathname.startsWith('/assets/') || url.pathname === '/icon.svg') {
    // These same-origin, content-hashed files are identical regardless of Origin headers.
    event.respondWith(caches.match(event.request, { ignoreVary: true }).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
      return response;
    })));
  }
});
