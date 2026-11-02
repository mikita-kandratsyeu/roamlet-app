const CACHE = 'roamlet-shell-__BUILD_REVISION__';
const COMPLETION_MARKER = '/__roamlet_offline_complete__';
const INSTALL_ASSETS = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/github-mark.png',
  '/google-drive-2026.png',
  '/ai-connector.svg',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];
let cacheWork = Promise.resolve();
let repairSequence = 0;
function serialize(work) {
  const next = cacheWork.then(work);
  cacheWork = next.catch(() => {});
  return next;
}
function completionCache(cache, completion) {
  return typeof completion?.cacheName === 'string' &&
    completion.cacheName.startsWith(`${CACHE}-repair-`)
    ? caches.open(completion.cacheName)
    : cache;
}
async function currentShellCache() {
  const cache = await caches.open(CACHE);
  try {
    const marker = await cache.match(COMPLETION_MARKER);
    if (marker) return completionCache(cache, await marker.json());
  } catch {
    // Keep any existing navigation shell available when metadata cannot be read.
  }
  return cache;
}
async function offlineReady() {
  try {
    const cache = await caches.open(CACHE);
    const marker = await cache.match(COMPLETION_MARKER);
    if (!marker) return false;
    const completion = await marker.json();
    if (
      completion.revision !== CACHE ||
      !Array.isArray(completion.assets) ||
      !completion.assets.includes('/') ||
      !INSTALL_ASSETS.every((asset) => completion.assets.includes(asset)) ||
      !completion.assets.every((asset) => typeof asset === 'string')
    )
      return false;
    const shell = await completionCache(cache, completion);
    const assets = await Promise.all(completion.assets.map((asset) => shell.match(asset)));
    return assets.every((asset) => !!asset);
  } catch {
    return false;
  }
}
async function verifyDeployedRevision(signal) {
  const response = await fetch('/sw.js', { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Worker revision could not be verified');
  const source = await response.text();
  // Read only the literal declaration; never evaluate server-provided JavaScript.
  const declaration = source.match(/^\s*const\s+CACHE\s*=\s*(['"])([^'"\r\n]+)\1\s*;/);
  if (declaration?.[2] !== CACHE) throw new Error('Worker revision changed');
}
async function repairOffline() {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, 8000);
  });
  const staging = `${CACHE}-repair-${Date.now()}-${++repairSequence}`;
  const work = (async () => {
    let committed = false;
    try {
      await verifyDeployedRevision(controller.signal);
      const { completeAssets } = await downloadShell(staging, controller.signal);
      // Deployment can change while the shell is downloading.
      await verifyDeployedRevision(controller.signal);
      if (controller.signal.aborted) throw new Error('Offline repair timed out');
      const destination = await caches.open(CACHE);
      let previousCacheName;
      try {
        const marker = await destination.match(COMPLETION_MARKER);
        if (marker) previousCacheName = (await marker.json()).cacheName;
      } catch {
        // Missing or damaged metadata is precisely what repair is allowed to replace.
      }
      if (controller.signal.aborted) throw new Error('Offline repair timed out');
      // CacheStorage has no rename/transaction: atomically publish the completed cache
      // through one marker write instead of deleting or overwriting the old shell.
      await destination.put(
        COMPLETION_MARKER,
        new Response(
          JSON.stringify({
            revision: CACHE,
            assets: completeAssets,
            cacheName: staging,
          }),
        ),
      );
      committed = true;
      if (typeof previousCacheName === 'string' && previousCacheName.startsWith(`${CACHE}-repair-`))
        await caches.delete(previousCacheName).catch(() => {});
      return true;
    } finally {
      if (!committed) await caches.delete(staging);
    }
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  const type = event.data?.type;
  if ((type === 'OFFLINE_STATUS' || type === 'REPAIR_OFFLINE') && event.ports?.[0]) {
    event.waitUntil(
      serialize(async () => {
        let ready = false;
        try {
          ready = type === 'REPAIR_OFFLINE' ? await repairOffline() : await offlineReady();
        } catch {
          /* Failed repair leaves the previous cache and marker untouched. */
        }
        event.ports[0].postMessage({ type, ready });
      }),
    );
  }
});
async function downloadShell(staging, signal) {
  const cache = await caches.open(staging);
  const response = await fetch('/', { cache: 'no-store', signal });
  if (!response.ok) throw new Error('App shell could not be cached');
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+)"/g)].map((match) => match[1]);
  const manifestResponse = await fetch('/assets/manifest.json', { cache: 'no-store', signal });
  if (!manifestResponse.ok) throw new Error('App asset manifest could not be cached');
  const manifest = await manifestResponse.json();
  for (const entry of Object.values(manifest)) {
    for (const path of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
      const url = new URL(path, self.location.origin);
      if (url.origin === self.location.origin && url.pathname.startsWith('/assets/'))
        assets.push(url.pathname);
    }
  }
  const cacheAssets = async (paths) => {
    if (!signal) return cache.addAll(paths);
    for (const path of paths) {
      const asset = await fetch(path, { cache: 'no-store', signal });
      if (!asset.ok) throw new Error('App asset could not be cached');
      await cache.put(path, asset);
    }
  };
  await cache.put('/', response);
  await cacheAssets([...new Set([...INSTALL_ASSETS, ...assets])]);
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
  await cacheAssets([...new Set(fonts)]);
  const completeAssets = [...new Set(['/', ...INSTALL_ASSETS, ...assets, ...fonts])];
  const cachedAssets = await Promise.all(completeAssets.map((asset) => cache.match(asset)));
  if (cachedAssets.some((asset) => !asset)) throw new Error('App shell cache is incomplete');
  return { cache, completeAssets };
}
self.addEventListener('install', (event) => {
  event.waitUntil(
    serialize(async () => {
      const staging = `${CACHE}-installing`;
      await caches.delete(staging);
      try {
        const { cache, completeAssets } = await downloadShell(staging);
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
    }),
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
      serialize(async () => {
        const cache = await currentShellCache();
        return (await cache.match('/')) || fetch(event.request);
      }),
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
              event.waitUntil(
                serialize(async () => {
                  const cache = await currentShellCache();
                  await cache.put(event.request, copy);
                }),
              );
            }
            return response;
          }),
      ),
    );
  }
});
