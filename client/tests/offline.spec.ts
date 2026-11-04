import { clickMapTool, mapTool } from './mapControls';
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';

let forbiddenRequests: string[] = [];
let allowUnavailableRoutingRequest = false;
let allowConnectorNavigation = false;
test.beforeEach(async ({ page }) => {
  forbiddenRequests = [];
  allowUnavailableRoutingRequest = false;
  allowConnectorNavigation = false;
  await page.route('**/*.mapbox.com/**', (route) => route.abort());
  await page.route('https://api.openrouteservice.org/**', (route) => route.abort());
  await page.route('https://api.heigit.org/**', (route) => route.abort());
  const mapStyle = {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8efe7' } }],
  };
  await page.route('**/osm-standard.json', (route) => route.fulfill({ json: mapStyle }));
  await page.route('**/*.openfreemap.org/**', (route) => route.fulfill({ json: mapStyle }));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com' ||
      url.hostname === 'api.openrouteservice.org' ||
      url.hostname === 'api.heigit.org' ||
      url.hostname === 'api.github.com' ||
      ['oauth2.googleapis.com', 'www.googleapis.com', 'openidconnect.googleapis.com'].includes(
        url.hostname,
      ) ||
      url.hostname === 'mapbox.com' ||
      url.hostname.endsWith('.mapbox.com')
    ) {
      forbiddenRequests.push(url.hostname);
    } else if (
      url.pathname.startsWith('/api/') &&
      url.pathname !== '/api/routing-config' &&
      !(
        ['/api/github', '/api/google-drive'].includes(url.pathname) &&
        url.searchParams.get('action') === 'session'
      ) &&
      !(
        allowConnectorNavigation &&
        ['/api/github', '/api/google-drive'].includes(url.pathname) &&
        ['start', 'callback'].includes(url.searchParams.get('action') || '')
      ) &&
      !(allowUnavailableRoutingRequest && url.pathname === '/api/route')
    ) {
      forbiddenRequests.push(url.pathname);
    }
  });
});
test.afterEach(() => {
  expect(forbiddenRequests).toEqual([]);
});

test('installation metadata and branded icons stay available in the production offline shell', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Roamlet');
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute('content', 'Roamlet');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'Roamlet',
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon.png',
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const protocol = await context.newCDPSession(page);
  const { installabilityErrors } = await protocol.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
  await protocol.detach();
  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveTitle('Roamlet');
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) throw new Error('Missing install manifest');
    const response = await fetch(link.href);
    if (!response.ok) throw new Error('Install manifest unavailable offline');
    return response.json();
  });
  expect(manifest).toMatchObject({
    id: '/',
    name: 'Roamlet',
    short_name: 'Roamlet',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  });
  expect(manifest.icons).toEqual([
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ]);
  for (const [src, size] of [
    ['/favicon-32.png', 32],
    ['/apple-touch-icon.png', 180],
    ['/icon-192.png', 192],
    ['/icon-512.png', 512],
    ['/icon-maskable-512.png', 512],
    ['/github-mark.png', 560],
    ['/google-drive-2026.png', 128],
    ['/icon.svg', null],
  ] as const) {
    const pixels = await page.evaluate(async (src) => {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`Icon unavailable offline: ${src}`);
      const image = new Image();
      const url = URL.createObjectURL(await response.blob());
      try {
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let opaque = true;
        let brandPixels = 0;
        let outsideSafeZone = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] !== 255) opaque = false;
          // Only the light route and accent are essential artwork, not the green background.
          if (data[i] > 100 && data[i + 3] > 0) {
            brandPixels++;
            const x = (i / 4) % canvas.width;
            const y = Math.floor(i / 4 / canvas.width);
            if (
              Math.hypot(x + 0.5 - canvas.width / 2, y + 0.5 - canvas.height / 2) >
              canvas.width * 0.4
            )
              outsideSafeZone++;
          }
        }
        return { width: canvas.width, height: canvas.height, opaque, brandPixels, outsideSafeZone };
      } finally {
        URL.revokeObjectURL(url);
      }
    }, src);
    if (size !== null) expect([pixels.width, pixels.height], src).toEqual([size, size]);
    expect(pixels.brandPixels, src).toBeGreaterThan(0);
    if (src === '/apple-touch-icon.png' || src === '/icon-maskable-512.png')
      expect(pixels.opaque, src).toBe(true);
    if (src === '/icon-maskable-512.png') expect(pixels.outsideSafeZone).toBe(0);
  }
});

test('connector list and official provider icons are available on the first offline visit without provider requests', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Connections', exact: true }).click();
  const connections = page.getByRole('region', { name: 'Connections', exact: true });
  await expect(connections).toBeVisible();
  await expect(connections.getByRole('heading', { name: 'GitHub', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      connections
        .locator('.github-brand-mark')
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(560);
  const googleCard = connections
    .locator('.connector-card')
    .filter({ has: page.getByRole('heading', { name: 'Google Drive', exact: true }) });
  await expect
    .poll(() => googleCard.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(96);
  for (const [provider, title, login] of [
    ['Google Drive', 'Google Drive connection settings', 'Sign in with Google'],
    ['GitHub', 'GitHub connection settings', 'Sign in with GitHub'],
  ]) {
    const card = connections
      .locator('.connector-card')
      .filter({ has: page.getByRole('heading', { name: provider, exact: true }) });
    await card.getByRole('button', { name: 'Set up connection' }).click();
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: login })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Done' }).click();
  }
  await connections.getByRole('button', { name: 'Back to map' }).click();
  await expect(connections).toHaveCount(0);
});

test('production service worker lets OAuth API navigations and callbacks reach the network', async ({
  page,
  context,
}) => {
  allowConnectorNavigation = true;
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const requests: string[] = [];
  const providerServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(
      '<!doctype html><title>Authorization test</title><p>Mock provider authorization</p>',
    );
  });
  await new Promise<void>((resolve, reject) => {
    providerServer.once('error', reject);
    providerServer.listen(0, '127.0.0.1', () => {
      providerServer.off('error', reject);
      resolve();
    });
  });
  const address = providerServer.address();
  if (!address || typeof address === 'string') throw new Error('Provider fixture did not start');
  const providerOrigin = `http://127.0.0.1:${address.port}`;
  try {
    await context.route('**/api/github?**', (route) => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get('action');
      if (action !== 'start' && action !== 'callback') return route.continue();
      requests.push(`github:${action}`);
      return route.fulfill({
        status: 302,
        headers: {
          Location:
            action === 'start'
              ? `${providerOrigin}/authorize?provider=github`
              : '/?connectors=github&github=error',
          'Cache-Control': 'no-store',
        },
      });
    });
    await context.route('**/api/google-drive?**', (route) => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get('action');
      if (action !== 'start' && action !== 'callback') return route.continue();
      requests.push(`google-drive:${action}`);
      return route.fulfill({
        status: 302,
        headers: {
          Location: action === 'start' ? `${providerOrigin}/authorize?provider=google-drive` : '/',
          'Cache-Control': 'no-store',
        },
      });
    });
    for (const provider of ['github', 'google-drive']) {
      await page.goto(`/api/${provider}?action=start`);
      await expect(page).toHaveURL(`${providerOrigin}/authorize?provider=${provider}`);
      await expect(page.getByText('Mock provider authorization')).toBeVisible();
      await page.goto(
        `http://127.0.0.1:4175/api/${provider}?action=callback&code=synthetic-code&state=synthetic-state`,
      );
      await expect(page).toHaveTitle('Roamlet');
      await expect(page.locator('.brand')).toBeAttached();
      expect(new URL(page.url()).pathname).toBe('/');
    }
    expect(requests).toEqual([
      'github:start',
      'github:callback',
      'google-drive:start',
      'google-drive:callback',
    ]);
    const cachedUrls = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        if (!name.startsWith('roamlet-shell-')) continue;
        for (const request of await (await caches.open(name)).keys())
          urls.push(new URL(request.url).pathname);
      }
      return urls;
    });
    expect(cachedUrls.some((path) => path === '/api' || path.startsWith('/api/'))).toBe(false);
  } finally {
    providerServer.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      providerServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

for (const width of [320, 390, 1440]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`offline banner buttons fit Russian labels at ${width}px in ${colorScheme}`, async ({
      page,
      context,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(() => localStorage.setItem('roamlet-language', 'ru'));
      await page.goto('/');
      await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
      await context.setOffline(true);
      try {
        const banner = page.locator('.offline-banner');
        await expect(
          banner.getByText('Нет подключения к интернету', { exact: true }),
        ).toBeVisible();
        const manual = banner.getByRole('button', { name: 'Рисовать вручную', exact: true });
        const retry = banner.getByRole('button', { name: 'Проверить подключение', exact: true });
        for (const button of [manual, retry]) {
          await expect(button).toBeVisible();
          const measured = await button.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(element);
            return {
              height: bounds.height,
              fits: Array.from(range.getClientRects()).every(
                (line) =>
                  line.top >= bounds.top &&
                  line.bottom <= bounds.bottom &&
                  line.left >= bounds.left &&
                  line.right <= bounds.right,
              ),
            };
          });
          expect(measured.height).toBeGreaterThanOrEqual(44);
          expect(measured.fits).toBe(true);
        }
        expect(await banner.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(width);
        if (width === 320)
          expect((await retry.boundingBox())!.y).toBeGreaterThanOrEqual(
            (await manual.boundingBox())!.y + (await manual.boundingBox())!.height,
          );
        if (width === 390)
          expect((await manual.boundingBox())!.height).toBe((await retry.boundingBox())!.height);
        await page.screenshot({
          path: testInfo.outputPath('offline-banner-ru.png'),
          animations: 'disabled',
        });
        await manual.click();
        await expect(manual).toHaveCount(0);
        await expect(retry).toBeVisible();
        if (width <= 700)
          expect((await retry.boundingBox())!.width).toBeCloseTo(
            (await banner.locator('.offline-banner-actions').boundingBox())!.width,
            0,
          );
        await retry.click();
        await expect(banner).toBeVisible();
      } finally {
        await context.setOffline(false);
      }
    });
  }
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 430, height: 932 },
  { width: 667, height: 375 },
]) {
  test(`offline planner resizes without blank space at ${viewport.width}x${viewport.height}`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
    await context.setOffline(true);
    try {
      const planner = page.getByRole('complementary', { name: 'Route planner' });
      const header = planner.locator('.mobile-sheet-header');
      const toggle = planner.locator('.mobile-sheet-toggle');
      const workspace = page.locator('.workspace-offline');
      if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
      async function settlePlanner() {
        await planner.evaluate(async (element) => {
          element.getBoundingClientRect();
          await Promise.all(
            element.getAnimations().map((animation) => animation.finished.catch(() => {})),
          );
        });
      }
      async function compactFits() {
        await expect(planner).toHaveAttribute('data-sheet-state', 'compact');
        await settlePlanner();
        await expect(planner.locator('.planner-scroll')).toBeHidden();
        await workspace.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        const panelBox = (await planner.boundingBox())!;
        const headerBox = (await header.boundingBox())!;
        const workspaceBox = (await workspace.boundingBox())!;
        expect(panelBox.height).toBeLessThanOrEqual(headerBox.height + 2);
        expect(panelBox.y + panelBox.height).toBeCloseTo(workspaceBox.y + workspaceBox.height, 0);
        const mapBox = (await page.locator('.workspace-offline .map-offline').boundingBox())!;
        const contentBox = (await page
          .locator('.workspace-offline .offline-map-content')
          .boundingBox())!;
        if (viewport.height > 550 && mapBox.height > contentBox.height + 40) {
          const mapCenter = mapBox.y + mapBox.height / 2;
          const contentCenter = contentBox.y + contentBox.height / 2;
          expect(Math.abs(contentCenter - mapCenter)).toBeLessThanOrEqual(4);
        }
      }
      await compactFits();
      await page.screenshot({
        path: testInfo.outputPath('offline-planner-compact.png'),
        animations: 'disabled',
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        await toggle.click();
        await expect(planner).toHaveAttribute('data-sheet-state', 'planning');
        await settlePlanner();
        await expect(planner.locator('.planner-scroll')).toBeVisible();
        const planningHeight = (await planner.boundingBox())!.height;
        expect(
          await planner.locator('.planner-scroll').evaluate((element) => element.clientHeight),
        ).toBeGreaterThan(20);
        await planner.getByRole('button', { name: 'Expand planner view' }).click();
        await expect(planner).toHaveAttribute('data-sheet-state', 'expanded');
        await settlePlanner();
        expect((await planner.boundingBox())!.height).toBeGreaterThanOrEqual(planningHeight);
        await planner.getByRole('button', { name: 'Restore planner view' }).click();
        await expect(planner).toHaveAttribute('data-sheet-state', 'planning');
        await toggle.click();
        await compactFits();
      }
      await page.getByRole('button', { name: 'Use manual drawing', exact: true }).click();
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
        await planner.getByRole('textbox', { name: 'Latitude', exact: true }).fill(value);
        await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
      }
      await expect(page.locator('[data-stop-id]')).toHaveCount(2);
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Export route', exact: true });
      await dialog.getByRole('button', { name: 'Download GPX', exact: true }).click();
      const xml = await readFile((await (await download).path())!, 'utf8');
      expect(xml.match(/<trkpt\s/g)).toHaveLength(2);
      await expect(dialog).toHaveCount(0);
      await toggle.click();
      await compactFits();
      await context.setOffline(false);
      await expect(page.locator('.offline-banner')).toHaveCount(0);
      await expect(planner).toHaveAttribute('data-sheet-state', 'compact');
    } finally {
      await context.setOffline(false);
    }
  });
}

const gpx =
  '<gpx version="1.1" creator="Roamlet test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Offline escape</name><trkseg><trkpt lat="47.2692" lon="11.4041"><ele>600</ele></trkpt><trkpt lat="47.271" lon="11.411"><ele>630</ele></trkpt></trkseg></trk></gpx>';
test('production shell keeps saved routes and GPX export available offline, without caching maps', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'offline.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  await page.getByRole('button', { name: 'Save route', exact: true }).click();
  await page.getByRole('button', { name: 'Save to library' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => {
    if (request.url().includes('/assets/'))
      errors.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  await context.setOffline(true);
  await page.unroute('**/*.openfreemap.org/**');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'New route', exact: true }),
    JSON.stringify(errors),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My routes' }).click();
  await page.getByRole('button', { name: /Offline escape Hiking/ }).click();
  await expect(page.getByRole('heading', { name: 'Offline escape' })).toBeVisible();
  await page.getByRole('button', { name: 'Export' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export route', exact: true });
  await exportDialog.getByRole('radio', { name: 'For social media' }).click();
  await expect(exportDialog.getByRole('img', { name: 'Generated route image' })).toHaveCount(0);
  await exportDialog.getByRole('button', { name: 'Create preview' }).click();
  const image = exportDialog.getByRole('img', { name: 'Generated route image' });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(1080);
  const pngDownload = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Download PNG' }).click();
  const png = await readFile((await (await pngDownload).path())!);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await exportDialog.getByRole('radio', { name: 'GPX', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Download GPX', exact: true }).click();
  const text = await readFile((await (await downloaded).path())!, 'utf8');
  expect(text.match(/<trkpt\s/g)).toHaveLength(2);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls: string[] = [];
    for (const key of keys) {
      const cache = await caches.open(key);
      urls.push(...(await cache.keys()).map((request) => request.url));
    }
    return urls;
  });
  expect(cached.some((url) => url.includes('/assets/'))).toBe(true);
  expect(
    cached.some((url) => url.includes('manrope-latin-wght-normal') && url.endsWith('.woff2')),
  ).toBe(true);
  expect(
    cached.some((url) => url.includes('manrope-cyrillic-wght-normal') && url.endsWith('.woff2')),
  ).toBe(true);
  const fontStatuses = await page.evaluate(async () =>
    (await document.fonts.load('400 16px "Manrope Variable"', 'Маршрут Route')).map(
      (face) => face.status,
    ),
  );
  expect(fontStatuses.length).toBeGreaterThanOrEqual(2);
  expect(fontStatuses.every((status) => status === 'loaded')).toBe(true);
  await expect(page.locator('body')).toHaveCSS('font-family', /Manrope Variable/);
  expect(errors).toEqual([]);
  await expect(
    page.getByRole('region', { name: 'Interactive route map' }).getByRole('status'),
  ).toContainText('No offline map is stored');
  expect(cached.every((url) => url.startsWith('http://127.0.0.1:4175/'))).toBe(true);
  await context.setOffline(false);
});
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`offline UX is usable at ${viewport.width}px in ${colorScheme} theme and recovers without changing GPX`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
      await page.getByLabel('Import GPX file').setInputFiles({
        name: 'preserved.gpx',
        mimeType: 'application/gpx+xml',
        buffer: Buffer.from(gpx),
      });
      await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
      await context.setOffline(true);
      try {
        await expect(
          page.getByText('No network connection detected', { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Map unavailable offline' })).toBeVisible();
        await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
        await expect(page.getByRole('group', { name: 'Map controls' })).toHaveCount(0);
        await expect(page.locator('.configuration-note')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Edit waypoints' })).toBeDisabled();
        await expect(page.locator('#map-elevation-root')).toHaveCount(0);
        await expect(page.locator('.planner .elevation-box')).toHaveCount(1);
        await page.screenshot({ path: test.info().outputPath('offline.png') });
        await page.getByRole('button', { name: 'Retry map', exact: true }).click();
        await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'Export route', exact: true })
          .getByRole('button', { name: 'Download GPX', exact: true })
          .click();
        const offlineXml = await readFile((await (await pending).path())!, 'utf8');
        expect(offlineXml.match(/<trkpt\s/g)).toHaveLength(2);
        await page
          .getByRole('region', { name: 'Interactive route map' })
          .getByRole('button', { name: 'My routes', exact: true })
          .click();
        await expect(
          page.getByRole('heading', { name: 'Saved routes', exact: true }),
        ).toBeVisible();
        await page
          .getByRole('region', { name: 'Saved routes', exact: true })
          .getByRole('button', { name: 'Back to map', exact: true })
          .click();
        await context.setOffline(false);
        await expect(page.getByRole('heading', { name: 'Map unavailable offline' })).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: 'Use my location', exact: true }),
        ).toBeEnabled();
        const reconnected = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'Export route', exact: true })
          .getByRole('button', { name: 'Download GPX', exact: true })
          .click();
        const onlineXml = await readFile((await (await reconnected).path())!, 'utf8');
        expect(onlineXml).toBe(offlineXml);
        await page.screenshot({ path: test.info().outputPath('reconnected.png') });
      } finally {
        await context.setOffline(false);
      }
    });
  }
}

test('an unopened elevation chart loads on its first offline expansion', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'lazy-profile.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpx),
  });
  const profile = page.locator('.planner .elevation-box');
  await expect(profile).toBeVisible();
  await expect(profile).not.toHaveAttribute('open');
  await expect(profile.locator('.elevation-chart')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((entry) => /\/assets\/ElevationChart-[^/]+\.js/.test(entry.name)),
    ),
  ).toBe(false);
  await context.setOffline(true);
  try {
    await profile.locator('summary').click();
    await expect(profile.locator('.elevation-chart .recharts-surface')).toBeVisible();
    await expect(page.getByTestId('panel-loader')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  } finally {
    await context.setOffline(false);
  }
});

for (const language of ['en', 'ru'] as const) {
  test(`GPX worker imports exact segments on its first offline use (${language})`, async ({
    page,
    context,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('roamlet-language', value), language);
    if (language === 'ru') await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const workers = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        urls.push(...(await cache.keys()).map((request) => request.url));
      }
      return urls.filter((url) => /gpxImport\.worker-[^/]+\.js$/.test(url));
    });
    expect(workers).toHaveLength(1);
    expect(page.workers().filter((worker) => /gpxImport\.worker-/.test(worker.url()))).toHaveLength(
      0,
    );
    await context.setOffline(true);
    try {
      await page.reload();
      const xml =
        '<gpx><wpt lat="47" lon="11"/><trk><trkseg><trkpt lat="47" lon="11"><ele>100</ele></trkpt><trkpt lat="47.01" lon="11.01"><ele>120</ele></trkpt></trkseg><trkseg><trkpt lat="48" lon="12"/><trkpt lat="48.01" lon="12.01"><ele>90</ele></trkpt></trkseg></trk></gpx>';
      const started = page.waitForEvent('worker', {
        predicate: (worker) => /gpxImport\.worker-/.test(worker.url()),
      });
      await page
        .getByLabel(language === 'ru' ? 'Импорт файла GPX' : 'Import GPX file')
        .setInputFiles({
          name: 'first-offline.gpx 2',
          mimeType: 'application/octet-stream',
          buffer: Buffer.from(xml),
        });
      expect((await started).url()).toMatch(/gpxImport\.worker-/);
      const title =
        language === 'ru'
          ? page.getByRole('button', { name: /^Импортированный маршрут/ })
          : page.getByRole('heading', { name: 'Imported route', exact: true });
      await expect(title).toBeVisible();
      const pending = page.waitForEvent('download');
      await page
        .getByRole('button', { name: language === 'ru' ? 'Экспорт' : 'Export', exact: true })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', {
          name: language === 'ru' ? 'Скачать GPX' : 'Download GPX',
          exact: true,
        })
        .click();
      const exported = await readFile((await (await pending).path())!, 'utf8');
      expect(exported.match(/<trkseg>/g)).toHaveLength(2);
      expect(exported.match(/<trkpt\s/g)).toHaveLength(4);
      expect(exported.match(/<ele>/g)).toHaveLength(3);
      expect(exported).toMatch(/<trkpt lat="48" lon="12">\s*<\/trkpt>/);
      expect(exported).toContain(
        language === 'ru' ? '<name>Точка</name>' : '<name>Waypoint</name>',
      );
      expect(exported).toContain('<ele>90</ele>');
    } finally {
      await context.setOffline(false);
    }
  });
}

test.describe('core panels without a service worker', () => {
  test.use({ serviceWorkers: 'block' });
  for (const language of ['en', 'ru'] as const) {
    test(`saved routes and manual coordinates work on their first offline use (${language})`, async ({
      page,
      context,
    }) => {
      await page.addInitScript(
        (value) => localStorage.setItem('roamlet-language', value),
        language,
      );
      const copy =
        language === 'ru'
          ? {
              save: 'Сохранить маршрут',
              librarySave: 'Сохранить в библиотеку',
              library: 'Мои маршруты',
              back: 'Назад к карте',
              manual: 'Новый маршрут по координатам',
              coordinates: 'Широта',
              add: 'Добавить координаты',
              export: 'Экспорт',
              exportDialog: 'Экспорт маршрута',
              download: 'Скачать GPX',
            }
          : {
              save: 'Save route',
              librarySave: 'Save to library',
              library: 'My routes',
              back: 'Back to map',
              manual: 'New manual route',
              coordinates: 'Latitude',
              add: 'Add coordinates',
              export: 'Export',
              exportDialog: 'Export route',
              download: 'Download GPX',
            };
      await page.goto('/');
      await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
      await page
        .getByLabel(language === 'ru' ? 'Импорт файла GPX' : 'Import GPX file')
        .setInputFiles({
          name: 'saved.gpx',
          mimeType: 'application/gpx+xml',
          buffer: Buffer.from(gpx),
        });
      await page.getByRole('button', { name: copy.save, exact: true }).click();
      await page.getByRole('button', { name: copy.librarySave, exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.route('**/assets/*.js', (route) => route.abort());
      await context.setOffline(true);
      try {
        await page
          .getByRole('region', {
            name: language === 'ru' ? 'Интерактивная карта маршрута' : 'Interactive route map',
          })
          .getByRole('button', { name: copy.library, exact: true })
          .click();
        await expect(page.getByTestId('panel-loader')).toHaveCount(0);
        await page.getByRole('button', { name: /^Offline escape/ }).click();
        await expect(
          page.getByRole('heading', { name: 'Offline escape', exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: copy.export, exact: true })).toBeEnabled();
        await page.getByRole('button', { name: copy.manual, exact: true }).click();
        for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
          await page.getByRole('textbox', { name: copy.coordinates, exact: true }).fill(value);
          await page.getByRole('button', { name: copy.add, exact: true }).click();
        }
        await expect(page.getByTestId('panel-loader')).toHaveCount(0);
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: copy.export, exact: true }).click();
        await page
          .getByRole('dialog', { name: copy.exportDialog, exact: true })
          .getByRole('button', { name: copy.download, exact: true })
          .click();
        const xml = await readFile((await (await pending).path())!, 'utf8');
        expect(xml.match(/<trkpt\s/g)).toHaveLength(2);
      } finally {
        await context.setOffline(false);
      }
    });
  }
});

test('missing routing key keeps the map usable but never substitutes a fake route', async ({
  page,
}) => {
  allowUnavailableRoutingRequest = true;
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
  await expect(
    page.getByRole('region', { name: 'Interactive route map' }).getByRole('status'),
  ).toHaveCount(0);
  for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
    await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await expect(page.getByRole('alert')).toContainText(
    'Automatic routing is currently unavailable.',
  );
  await expect(
    page.getByRole('alert').getByRole('button', { name: 'Use manual drawing', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled();
});
test('manual drawing calculates and exports offline without a routing key', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).toBeEnabled();
  await expect(page.getByTestId('global-map-loader')).toHaveCount(0);
  await context.setOffline(true);
  try {
    await page.getByRole('button', { name: 'Use manual drawing', exact: true }).click();
    for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
      await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
      await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    await expect(page.locator('.configuration-note')).toHaveCount(0);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Export route', exact: true })
      .getByRole('button', { name: 'Download GPX', exact: true })
      .click();
    const xml = await readFile((await (await downloaded).path())!, 'utf8');
    expect(xml.match(/<trkpt\s/g)).toHaveLength(2);
    expect(xml).not.toContain('Routing by Mapbox');
    expect(xml).not.toContain('Routing by openrouteservice');
  } finally {
    await context.setOffline(false);
  }
});

test('offline reload restores an unsaved draft and exposes library backup without network', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await clickMapTool(page, 'Manual drawing');
  for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
    await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
    await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
  }
  await page.waitForTimeout(1200);
  await context.setOffline(true);
  try {
    await page.unroute('**/*.openfreemap.org/**');
    await page.reload();
    await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save route', exact: true }).click();
    await page.getByRole('textbox', { name: 'Route name' }).fill('Offline draft');
    await page.getByRole('button', { name: 'Save to library', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save to library', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'My routes', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download backup', exact: true }).click();
    const json = await readFile((await (await pending).path())!, 'utf8');
    expect(JSON.parse(json).routes).toHaveLength(1);
    await page.getByLabel('Import library file').setInputFiles({
      name: 'offline-library.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    await page.getByRole('button', { name: 'Import routes', exact: true }).click();
    await expect(page.locator('.library-route')).toHaveCount(2);
  } finally {
    await context.setOffline(false);
  }
});

test('first installation does not offer an app update or report a draft saving error', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.getByRole('button', { name: 'Update app', exact: true })).toHaveCount(0);
  await expect(
    page.getByText(
      'The update could not save your draft. Please retry; the app has not reloaded.',
      { exact: true },
    ),
  ).toHaveCount(0);
});

test('a waiting update stays silent and activates on the next offline reload without reloading other tabs', async ({
  page,
  context,
}) => {
  const workerName = `update-test-${crypto.randomUUID()}`;
  const workerPath = resolve('dist', 'sw.js');
  const worker = await readFile(workerPath, 'utf8');
  const otherPage = await context.newPage();
  try {
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const originalCaches = await page.evaluate(() => caches.keys());
    await otherPage.route('**/*.openfreemap.org/**', (route) =>
      route.fulfill({
        json: { version: 8, sources: {}, layers: [] },
      }),
    );
    await otherPage.goto('/');
    await expect(otherPage.getByRole('heading', { name: 'New route', exact: true })).toBeVisible();
    let otherReloads = 0;
    otherPage.on('framenavigated', (frame) => {
      if (frame === otherPage.mainFrame()) otherReloads++;
    });
    let reloads = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloads++;
    });
    await clickMapTool(page, 'Manual drawing');
    for (const value of ['47.2692, 11.4041', '47.271, 11.411']) {
      await page.getByRole('textbox', { name: 'Latitude' }).fill(value);
      await page.getByRole('button', { name: 'Add coordinates', exact: true }).click();
    }
    await page.waitForFunction(
      () =>
        new Promise<boolean>((resolve, reject) => {
          const open = indexedDB.open('roamlet-routes');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction('drafts').objectStore('drafts').get('current');
            request.onsuccess = () => {
              db.close();
              resolve(request.result?.snapshot?.waypoints?.length === 2);
            };
            request.onerror = () => {
              db.close();
              reject(request.error);
            };
          };
        }),
    );
    await writeFile(
      workerPath,
      worker.replace(/const CACHE = '[^']+';/, `const CACHE = 'roamlet-shell-${workerName}';`),
    );
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration('/'))?.update();
    });
    await page.waitForFunction(async () =>
      Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
    );
    await expect(page.getByRole('button', { name: 'Update app', exact: true })).toHaveCount(0);
    await expect(page.getByText('An app update is ready.', { exact: true })).toHaveCount(0);
    await expect(await mapTool(page, 'Manual drawing')).toHaveAttribute('aria-pressed', 'true');
    expect(reloads).toBe(0);
    await context.setOffline(true);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.reload();
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      return !!registration?.active && !registration.waiting;
    });
    await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
    expect(reloads).toBe(2);
    expect(otherReloads).toBe(0);
    await expect(otherPage.getByRole('heading', { name: 'New route', exact: true })).toBeVisible();
    expect(await page.evaluate(() => caches.keys())).toEqual(
      expect.arrayContaining(originalCaches),
    );
    await expect(await mapTool(page, 'Manual drawing')).toHaveAttribute('aria-pressed', 'true');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Export route', exact: true })
      .getByRole('button', { name: 'Download GPX', exact: true })
      .click();
    const xml = await readFile((await (await pending).path())!, 'utf8');
    expect(xml.match(/<trkpt\s/g)).toHaveLength(2);
  } finally {
    await writeFile(workerPath, worker);
    await context.setOffline(false);
    await otherPage.close();
  }
});

test('waypoint-only GPX remains usable and cannot crash route conversion', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import GPX file').setInputFiles({
    name: 'waypoint.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx version="1.1"><wpt lat="47.2692" lon="11.4041"><name>Meeting point</name></wpt></gpx>',
    ),
  });
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
  await page.getByRole('button', { name: 'Edit waypoints', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('isolated points');
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
});

test('device dialog repairs an incomplete active cache without reloading the app', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'App on this device', exact: true }).click();
  await expect(page.getByText('Ready to work offline', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('roamlet-shell-')) await (await caches.open(key)).delete('/icon-192.png');
    }
  });
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'App on this device', exact: true }).click();
  await expect(page.getByText('Offline preparation could not be verified', { exact: true })).toBeVisible();
  let reloads = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) reloads++; });
  await page.getByRole('button', { name: 'Retry offline preparation', exact: true }).click();
  await expect(page.getByText('Ready to work offline', { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => Boolean(await caches.match('/icon-192.png')))).toBe(true);
  expect(reloads).toBe(0);
});

test('device dialog explains a waiting update without reloading an open editor', async ({ page, context }) => {
  const workerPath = resolve('dist', 'sw.js');
  const original = await readFile(workerPath, 'utf8');
  const otherPage = await context.newPage();
  let reloads = 0;
  let otherReloads = 0;
  try {
    await otherPage.route('**/osm-standard.json', (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
    await otherPage.goto('/');
    await expect(otherPage.getByRole('heading', { name: 'New route', exact: true })).toBeVisible();
    otherPage.on('framenavigated', (frame) => { if (frame === otherPage.mainFrame()) otherReloads++; });
    await page.goto('/');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) reloads++; });
    await writeFile(workerPath, original.replace(/const CACHE = '[^']+';/, `const CACHE = 'roamlet-shell-dialog-${crypto.randomUUID()}';`));
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('/'))?.update(); });
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration('/'))?.waiting));
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'App on this device', exact: true }).click();
    await expect(page.getByText('An update is ready. It will apply on the next app launch or reload, not while you are editing.', { exact: true })).toBeVisible();
    expect(reloads).toBe(0);
    await page.reload();
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'App on this device', exact: true }).click();
    await expect(page.getByText('Ready to work offline', { exact: true })).toBeVisible();
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration('/'))?.waiting))).toBe(false);
    expect(reloads).toBe(2);
    expect(otherReloads).toBe(0);
    await expect(otherPage.getByRole('heading', { name: 'New route', exact: true })).toBeVisible();
  } finally {
    await writeFile(workerPath, original);
    await otherPage.close();
  }
});

test('device dialog verifies the production offline shell and remains available after offline reload', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'App on this device', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'App on this device', exact: true });
  await expect(dialog.getByText('Ready to work offline', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Available offline', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Internet required', exact: true })).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'App on this device', exact: true }).click();
  await expect(dialog.getByText('Ready to work offline', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Open My routes', exact: true })).toBeEnabled();
});
