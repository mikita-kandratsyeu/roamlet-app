import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapboxRoutingService, requestJson } from './routing';
import * as routing from './routing';
import { mapboxUrl } from './mapbox';
import type { Waypoint } from '../domain/types';
const points: Waypoint[] = [
  { id: 'a', name: 'A', coordinate: [11.4, 47.26] },
  { id: 'b', name: 'B', coordinate: [11.41, 47.27] },
];
const response = (
  coordinates = [
    [11.4, 47.26, 600],
    [11.405, 47.265, 625],
    [11.41, 47.27, 610],
  ],
) => ({
  code: 'Ok',
  routes: [
    {
      geometry: { type: 'LineString', coordinates },
      distance: 1234,
      duration: 420,
    },
  ],
});
function mockJson(data: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
}
beforeEach(() => vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'pk.test-public-token'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('MapboxRoutingService', () => {
  it('reports missing public token without fabricating geometry', async () => {
    vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', '');
    const fetcher = mockJson({});
    await expect(new MapboxRoutingService().calculateRoute(points, 'cycling')).rejects.toThrow(
      'VITE_MAPBOX_ACCESS_TOKEN',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('calls Mapbox directly with the public token and no cookies', async () => {
    const fetcher = mockJson(response());
    await new MapboxRoutingService().calculateRoute(points, 'cycling');
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin).toBe('https://api.mapbox.com');
    expect(url.pathname).toBe('/directions/v5/mapbox/cycling/11.4,47.26;11.41,47.27');
    expect(url.searchParams.get('access_token')).toBe('pk.test-public-token');
    expect(fetcher.mock.calls[0][1]?.credentials).toBe('omit');
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json' });
    await expect(requestJson('https://external.invalid/', {})).rejects.toThrow(
      'Unsupported Mapbox endpoint',
    );
  });
  it('uses cycling geometry distance and provider time, discarding provider heights', async () => {
    const fetcher = mockJson(response());
    const result = await new MapboxRoutingService().calculateRoute(points, 'cycling');
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get('geometries')).toBe('geojson');
    expect(url.searchParams.get('overview')).toBe('full');
    expect(url.searchParams.get('steps')).toBe('false');
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.segments[0]).toEqual([
      [11.4, 47.26],
      [11.405, 47.265],
      [11.41, 47.27],
    ]);
    expect(result.stats.distance).toBeGreaterThan(1300);
    expect(result.stats.duration).toBe(420);
    expect(result.stats.ascent).toBeUndefined();
    expect(result.stats.descent).toBeUndefined();
  });
  it('routes hiking with walking, not a cycling fallback', async () => {
    const fetcher = mockJson(response());
    await new MapboxRoutingService().calculateRoute(points, 'hiking');
    expect(String(fetcher.mock.calls[0][0])).toContain('/mapbox/walking/');
  });
  it('returns unavailable elevation instead of invented heights', async () => {
    mockJson(
      response([
        [11.4, 47.26],
        [11.41, 47.27],
      ]),
    );
    const result = await new MapboxRoutingService().calculateRoute(points, 'hiking');
    expect(result.stats.ascent).toBeUndefined();
  });
  it('caches exact requests but not waypoint changes', async () => {
    const fetcher = mockJson(response());
    const provider = new MapboxRoutingService();
    const first = await provider.calculateRoute(points, 'cycling');
    first.segments[0][0][0] = 0;
    const second = await provider.calculateRoute(points, 'cycling');
    expect(second.segments[0][0][0]).toBe(11.4);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await provider.calculateRoute([...points].reverse(), 'cycling');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 429, 503, 400, 422])('reports service failure %s', async (status) => {
    mockJson({}, status);
    await expect(new MapboxRoutingService().calculateRoute(points, 'cycling')).rejects.toThrow(
      status === 429
        ? 'quota'
        : status >= 500
          ? 'unavailable'
          : status === 401 || status === 403
            ? 'rejected'
            : 'No route',
    );
  });
  it('validates the Mapbox point limit and geometry', async () => {
    const provider = new MapboxRoutingService();
    await expect(provider.calculateRoute([], 'cycling')).rejects.toThrow('2 and 25');
    await expect(provider.calculateRoute(Array(26).fill(points[0]), 'cycling')).rejects.toThrow(
      '2 and 25',
    );
    const fetcher = mockJson(
      response([
        [999, 47],
        [11, 47],
      ]),
    );
    await expect(provider.calculateRoute(points, 'cycling')).rejects.toThrow(
      'invalid route geometry',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('generates routed loops through intermediate points and deduplicates results', async () => {
    const fetcher = mockJson(
      response([
        [11.4, 47.26, 600],
        [11.42, 47.28, 700],
        [11.4, 47.26, 600],
      ]),
    );
    const result = await new MapboxRoutingService().calculateAlternatives(
      points[0],
      'hiking',
      20000,
    );
    expect(result).toHaveLength(1);
    expect(result[0].segments[0]).toEqual([
      [11.4, 47.26],
      [11.42, 47.28],
      [11.4, 47.26],
    ]);
    expect(result[0].stats.ascent).toBeUndefined();
    expect(result[0].stats.descent).toBeUndefined();
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(6);
    expect(
      fetcher.mock.calls.every(([url]) =>
        new URL(String(url)).pathname.startsWith('/directions/v5/mapbox/'),
      ),
    ).toBe(true);
    const coordinates = new URL(String(fetcher.mock.calls[0][0])).pathname
      .split('/')
      .at(-1)!
      .split(';');
    expect(coordinates).toHaveLength(4);
    expect(coordinates[0]).toEqual(coordinates.at(-1));
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.has('options')).toBe(false);
    expect(String(fetcher.mock.calls[0][0])).not.toEqual(String(fetcher.mock.calls.at(-1)![0]));
  });
  it('stops early when routed length matches the target without elevation requests', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const coordinates = new URL(String(url)).pathname
        .split('/')
        .at(-1)!
        .split(';')
        .map((point) => point.split(',').map(Number));
      return new Response(JSON.stringify(response(coordinates)), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await new MapboxRoutingService().calculateAlternatives(
      points[0],
      'cycling',
      20000,
    );
    expect(results).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const result of results) {
      expect(result.stats.distance).toBeCloseTo(20000, 0);
      expect(result.stats.duration).toBe(420);
      expect(result.stats.ascent).toBeUndefined();
      expect(result.stats.descent).toBeUndefined();
      expect(result.segments[0].every((point) => point.length === 2)).toBe(true);
    }
  });
  it('stops after the bounded search and rejects a nonclosed loop', async () => {
    const fetcher = mockJson(response());
    const provider = new MapboxRoutingService();
    await expect(provider.calculateAlternatives(points[0], 'cycling', 500)).rejects.toThrow(
      '2 and 100',
    );
    await expect(provider.calculateAlternatives(points[0], 'cycling', 20000)).rejects.toThrow(
      'closed loop',
    );
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('retries NoRoute candidates but not quota failures', async () => {
    const fetcher = mockJson({ code: 'NoRoute' }, 422);
    await expect(
      new MapboxRoutingService().calculateAlternatives(points[0], 'cycling', 20000),
    ).rejects.toThrow('closed loop');
    expect(fetcher).toHaveBeenCalledTimes(6);
    fetcher.mockRestore();
    const quota = mockJson({}, 429);
    await expect(
      new MapboxRoutingService().calculateAlternatives(points[0], 'cycling', 20000),
    ).rejects.toThrow('quota');
    expect(quota).toHaveBeenCalledTimes(1);
  });
  it('respects cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new MapboxRoutingService().calculateRoute(points, 'cycling', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      new MapboxRoutingService().calculateAlternatives(
        points[0],
        'cycling',
        20000,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('reports a network failure without falling back to a line', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network'));
    await expect(requestJson('/directions/v5/mapbox/cycling/11,47;12,48', {})).rejects.toThrow(
      'internet connection',
    );
  });
  it('does not expose an address search helper', () => {
    expect(routing).not.toHaveProperty('searchPlaces');
  });
  it.each([
    '/search/geocode/v6/forward?q=Innsbruck',
    '/geocoding/v5/mapbox.places/Innsbruck.json',
    '/v4/mapbox.terrain-rgb/1/1/1.pngraw',
    '/directions/v5/mapbox/driving/11,47;12,48',
    '/directions/v5/mapbox/cycling/../../../../search/geocode/v6/forward?q=Innsbruck',
    '//external.invalid/directions/v5/mapbox/cycling/11,47;12,48',
  ])('rejects unsupported endpoint %s without making a request', async (path) => {
    const fetcher = mockJson({});
    expect(() => mapboxUrl(path)).toThrow('Unsupported Mapbox endpoint');
    await expect(requestJson(path, {})).rejects.toThrow('Unsupported Mapbox endpoint');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
