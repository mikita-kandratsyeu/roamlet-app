import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouteServiceRoutingService, requestJson } from './routing';
import * as routing from './routing';
import { openRouteServiceProfile } from './openrouteservice';
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
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: { summary: { distance: 1234, duration: 420 } },
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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('OpenRouteServiceRoutingService', () => {
  it('reports missing server configuration without fabricating geometry', async () => {
    const fetcher = mockJson({ error: { code: 'ROUTING_NOT_CONFIGURED' } }, 503);
    await expect(
      new OpenRouteServiceRoutingService().calculateRoute(points, 'cycling'),
    ).rejects.toThrow('ORS_API_KEY on the server');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('calls the same-origin proxy without browser credentials or a provider key', async () => {
    const fetcher = mockJson(response());
    await new OpenRouteServiceRoutingService().calculateRoute(points, 'cycling');
    expect(fetcher.mock.calls[0][0]).toBe('/api/route');
    expect(fetcher.mock.calls[0][1]?.credentials).toBe('same-origin');
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({
      Accept: 'application/geo+json',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).profile).toBe('cycling-regular');
    await expect(requestJson('https://external.invalid/', {})).rejects.toThrow(
      'Unsupported OpenRouteService endpoint',
    );
  });
  it('uses cycling geometry distance, provider time and confirmed provider heights', async () => {
    const fetcher = mockJson(response());
    const result = await new OpenRouteServiceRoutingService().calculateRoute(points, 'cycling');
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      profile: 'cycling-regular',
      coordinates: points.map((point) => point.coordinate),
      instructions: false,
      elevation: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.segments[0]).toEqual([
      [11.4, 47.26, 600],
      [11.405, 47.265, 625],
      [11.41, 47.27, 610],
    ]);
    expect(result.stats.distance).toBeGreaterThan(1300);
    expect(result.stats.duration).toBe(420);
    expect(result.stats.ascent).toBe(25);
    expect(result.stats.descent).toBe(15);
    expect(result.elevationSource).toBe('openrouteservice');
  });
  it('routes hiking with foot-hiking, not a cycling fallback', async () => {
    const fetcher = mockJson(response());
    await new OpenRouteServiceRoutingService().calculateRoute(points, 'hiking');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).profile).toBe('foot-hiking');
  });
  it('returns unavailable elevation instead of invented heights', async () => {
    mockJson(
      response([
        [11.4, 47.26],
        [11.41, 47.27],
      ]),
    );
    const result = await new OpenRouteServiceRoutingService().calculateRoute(points, 'hiking');
    expect(result.stats.ascent).toBeUndefined();
  });
  it('caches exact requests but not waypoint changes', async () => {
    const fetcher = mockJson(response());
    const provider = new OpenRouteServiceRoutingService();
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
    await expect(
      new OpenRouteServiceRoutingService().calculateRoute(points, 'cycling'),
    ).rejects.toThrow(
      status === 429 ? 'quota' : status === 401 || status === 403 ? 'rejected' : 'unavailable',
    );
  });
  it('preserves the application point limit and validates geometry', async () => {
    const provider = new OpenRouteServiceRoutingService();
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
    const result = await new OpenRouteServiceRoutingService().calculateAlternatives(
      points[0],
      'hiking',
      20000,
    );
    expect(result).toHaveLength(1);
    expect(result[0].segments[0]).toEqual([
      [11.4, 47.26, 600],
      [11.42, 47.28, 700],
      [11.4, 47.26, 600],
    ]);
    expect(result[0].stats.ascent).toBe(100);
    expect(result[0].stats.descent).toBe(100);
    expect(result[0].elevationSource).toBe('openrouteservice');
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(6);
    expect(fetcher.mock.calls.every(([url]) => url === '/api/route')).toBe(true);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.coordinates).toHaveLength(4);
    expect(body.coordinates[0]).toEqual(body.coordinates.at(-1));
    expect(body).not.toHaveProperty('options');
    expect(fetcher.mock.calls[0][1]?.body).not.toEqual(fetcher.mock.calls.at(-1)![1]?.body);
  });
  it('stops early when routed length matches the target without elevation requests', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const { coordinates } = JSON.parse(String(options?.body));
      return new Response(JSON.stringify(response(coordinates)), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const results = await new OpenRouteServiceRoutingService().calculateAlternatives(
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
    const provider = new OpenRouteServiceRoutingService();
    await expect(provider.calculateAlternatives(points[0], 'cycling', 500)).rejects.toThrow(
      '2 and 100',
    );
    await expect(provider.calculateAlternatives(points[0], 'cycling', 20000)).rejects.toThrow(
      'closed loop',
    );
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('retries NoRoute candidates but not quota failures', async () => {
    const fetcher = mockJson({ error: { code: 2009, message: 'Route not found' } }, 404);
    await expect(
      new OpenRouteServiceRoutingService().calculateAlternatives(points[0], 'cycling', 20000),
    ).rejects.toThrow('closed loop');
    expect(fetcher).toHaveBeenCalledTimes(6);
    fetcher.mockRestore();
    const quota = mockJson({}, 429);
    await expect(
      new OpenRouteServiceRoutingService().calculateAlternatives(points[0], 'cycling', 20000),
    ).rejects.toThrow('quota');
    expect(quota).toHaveBeenCalledTimes(1);
  });
  it('respects cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new OpenRouteServiceRoutingService().calculateRoute(points, 'cycling', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      new OpenRouteServiceRoutingService().calculateAlternatives(
        points[0],
        'cycling',
        20000,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('cancels an in-flight request', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const controller = new AbortController();
    const promise = new OpenRouteServiceRoutingService().calculateRoute(
      points,
      'cycling',
      controller.signal,
    );
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('times out without returning fabricated geometry', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      );
      const promise = new OpenRouteServiceRoutingService().calculateRoute(points, 'cycling');
      const assertion = expect(promise).rejects.toThrow('took too long');
      await vi.advanceTimersByTimeAsync(25_000);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('reports a network failure without falling back to a line', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network'));
    await expect(
      requestJson('/openrouteservice/v2/directions/cycling-regular/geojson', {}),
    ).rejects.toThrow('internet connection');
  });
  it('does not expose an address search helper', () => {
    expect(routing).not.toHaveProperty('searchPlaces');
  });
  it('checks only server availability and preserves cancellation', async () => {
    const fetcher = mockJson({ available: true });
    expect(await routing.checkRoutingConfiguration()).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe('/api/routing-config');
    expect(fetcher.mock.calls[0][1]?.cache).toBe('no-store');
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ available: false })));
    expect(await routing.checkRoutingConfiguration()).toBe(false);
    const controller = new AbortController();
    controller.abort();
    await expect(routing.checkRoutingConfiguration(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(
      new OpenRouteServiceRoutingService().calculateRoute(points, 'cycling', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([{}, { available: 'true' }, null])(
    'rejects invalid server availability %s',
    async (data) => {
      mockJson(data);
      await expect(routing.checkRoutingConfiguration()).rejects.toThrow('could not be checked');
    },
  );
  it('does not depend on a browser API key for routing or its cache', async () => {
    const fetcher = mockJson(response());
    const provider = new OpenRouteServiceRoutingService();
    await provider.calculateRoute(points, 'cycling');
    await provider.calculateRoute(points, 'cycling');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  });
  it.each([2009, 2010])('retries ORS route/snap error %s', async (code) => {
    const fetcher = mockJson({ error: { code } }, 404);
    await expect(
      new OpenRouteServiceRoutingService().calculateAlternatives(points[0], 'cycling', 20000),
    ).rejects.toThrow('closed loop');
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it.each([2003, 2004, 2011])('does not retry invalid or oversized requests %s', async (code) => {
    const fetcher = mockJson({ error: { code } }, 400);
    await expect(
      new OpenRouteServiceRoutingService().calculateAlternatives(points[0], 'cycling', 20000),
    ).rejects.toThrow(code === 2004 ? 'service limits' : 'unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    { type: 'FeatureCollection', features: null },
    { type: 'FeatureCollection', features: [{}] },
  ])('rejects malformed GeoJSON responses', async (data) => {
    mockJson(data);
    await expect(
      new OpenRouteServiceRoutingService().calculateRoute(points, 'cycling'),
    ).rejects.toThrow('invalid response');
  });
  it.each([-1, Infinity, '420'])('rejects invalid provider durations %s', async (duration) => {
    const data = response();
    Object.assign(data.features[0].properties.summary, { duration });
    mockJson(data);
    await expect(
      new OpenRouteServiceRoutingService().calculateRoute(points, 'cycling'),
    ).rejects.toThrow('invalid route statistics');
  });
  it('posts longitude/latitude only and keeps all intermediate points', async () => {
    const fetcher = mockJson(response());
    const waypoints: Waypoint[] = [
      { ...points[0], coordinate: [11.4, 47.26, 600] },
      { id: 'via', name: 'Via', coordinate: [11.405, 47.265] },
      points[1],
    ];
    await new OpenRouteServiceRoutingService().calculateRoute(waypoints, 'cycling');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).coordinates).toEqual([
      [11.4, 47.26],
      [11.405, 47.265],
      [11.41, 47.27],
    ]);
  });
  it.each([
    '/geocode/search?text=Innsbruck',
    '/elevation/line',
    '/openrouteservice/v2/directions/driving-car/geojson',
    '/openrouteservice/v2/directions/cycling-regular/json',
    '/openrouteservice/v2/directions/cycling-regular/../../geocode/search',
    '//external.invalid/openrouteservice/v2/directions/cycling-regular/geojson',
    'https://external.invalid/openrouteservice/v2/directions/cycling-regular/geojson',
    '/openrouteservice/v2/directions/cycling-regular/geojson?api_key=test',
    '/openrouteservice/v2/directions/cycling-regular/geojson#fragment',
  ])('rejects unsupported endpoint %s without making a request', async (path) => {
    const fetcher = mockJson({});
    expect(() => openRouteServiceProfile(path)).toThrow('Unsupported OpenRouteService endpoint');
    await expect(requestJson(path, {})).rejects.toThrow('Unsupported OpenRouteService endpoint');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
