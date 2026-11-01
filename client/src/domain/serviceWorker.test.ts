import { expect, it, vi } from 'vitest';
import source from '../../public/sw.js?raw';
function worker() {
  const handlers = new Map<
    string,
    (event: {
      data?: { type: string };
      request?: { url: string; method: string; mode: string };
      waitUntil?: (promise: Promise<unknown>) => void;
      respondWith?: (promise: Promise<unknown>) => void;
    }) => void
  >();
  const self = {
    location: { origin: 'https://roamlet.example' },
    addEventListener: (
      name: string,
      handler: typeof handlers extends Map<string, infer H> ? H : never,
    ) => handlers.set(name, handler),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const shell = new Response('<script src="/assets/main.js"></script>');
  const cache = {
    put: vi.fn().mockResolvedValue(undefined),
    addAll: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockResolvedValue(shell),
  };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    match: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
  };
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      url === '/'
        ? shell.clone()
        : new Response(
            JSON.stringify({
              main: { file: 'assets/main.js' },
              lazy: { file: 'assets/Library.js' },
              statistics: { file: 'assets/Statistics.js' },
              worker: { file: 'assets/gpxImport.worker-test.js' },
            }),
          ),
    ),
  );
  new Function('self', 'caches', 'fetch', source)(self, caches, fetch);
  return { handlers, self, cache, caches, fetch, shell };
}
it('precaches not-yet-opened lazy panels from the same-origin manifest', async () => {
  const { handlers, cache } = worker();
  let installed!: Promise<unknown>;
  handlers.get('install')!({
    waitUntil: (promise) => {
      installed = promise;
    },
  });
  await installed;
  expect(cache.addAll.mock.calls.flat(2)).toContain('/assets/Library.js');
  expect(cache.addAll.mock.calls.flat(2)).toContain('/assets/Statistics.js');
  expect(cache.addAll.mock.calls.flat(2)).toContain('/assets/gpxImport.worker-test.js');
});
const installAssets = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/github-mark.png',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];
it('precaches the install manifest and every platform icon', async () => {
  const { handlers, cache } = worker();
  let installed!: Promise<unknown>;
  handlers.get('install')!({
    waitUntil: (promise) => {
      installed = promise;
    },
  });
  await installed;
  expect(cache.addAll.mock.calls.flat(2)).toEqual(expect.arrayContaining(installAssets));
});
it.each(installAssets)(
  'serves cached installation asset %s without network access',
  async (path) => {
    const { handlers, caches, fetch } = worker();
    const cached = new Response('cached installation asset');
    caches.match.mockResolvedValue(cached);
    let response!: Promise<unknown>;
    handlers.get('fetch')!({
      request: { url: `https://roamlet.example${path}`, method: 'GET', mode: 'cors' },
      respondWith: (promise) => {
        response = promise;
      },
    });
    expect(response).toBeDefined();
    expect(await response).toBe(cached);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it('does not activate without an explicit message or mix a newer navigation shell', async () => {
  const { handlers, self, fetch, shell } = worker();
  expect(self.skipWaiting).not.toHaveBeenCalled();
  handlers.get('message')!({ data: { type: 'OTHER' } });
  expect(self.skipWaiting).not.toHaveBeenCalled();
  handlers.get('message')!({ data: { type: 'SKIP_WAITING' } });
  expect(self.skipWaiting).toHaveBeenCalledOnce();
  let navigation!: Promise<unknown>;
  handlers.get('fetch')!({
    request: { url: 'https://roamlet.example/', method: 'GET', mode: 'navigate' },
    respondWith: (promise) => {
      navigation = promise;
    },
  });
  expect(await navigation).toBe(shell);
  expect(fetch).not.toHaveBeenCalled();
  const respondWith = vi.fn();
  handlers.get('fetch')!({
    request: { url: 'https://external.example/map', method: 'GET', mode: 'cors' },
    respondWith,
  });
  expect(respondWith).not.toHaveBeenCalled();
});
