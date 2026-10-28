import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapboxRoutingService, requestJson, searchPlaces } from './routing';
import { addTerrainElevation } from './elevation';
vi.mock('./elevation', () => ({ addTerrainElevation: vi.fn(async (coordinates) => coordinates) }));
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
  features: [
    {
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
describe('MapboxRoutingService', () => {
  it('reports missing server credentials without fabricating geometry', async () => {
    mockJson({ error: { code: 'NOT_CONFIGURED' } }, 503);
    await expect(new MapboxRoutingService().calculateRoute(points, 'cycling')).rejects.toThrow(
      'MAPBOX_ACCESS_TOKEN',
    );
  });
  it('sends only same-origin requests and never sends a provider key', async () => {
    const fetcher = mockJson(response());
    await new MapboxRoutingService().calculateRoute(points, 'cycling');
    expect(fetcher.mock.calls[0][0]).toBe('/api/directions/cycling/geojson');
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    await expect(requestJson('https://external.invalid/', {})).rejects.toThrow('local API proxy');
  });
  it('uses the cycling profile, terrain geometry distance and provider time', async () => {
    const fetcher = mockJson(response());
    const result = await new MapboxRoutingService().calculateRoute(points, 'cycling');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      coordinates: [
        [11.4, 47.26],
        [11.41, 47.27],
      ],
      instructions: false,
    });
    expect(addTerrainElevation).toHaveBeenCalled();
    expect(result.segments[0]).toHaveLength(3);
    expect(result.stats.distance).toBeGreaterThan(1300);
    expect(result.stats.duration).toBe(420);
    expect(result.stats.ascent).toBe(25);
    expect(result.stats.descent).toBe(15);
  });
  it('routes hiking with walking, not a cycling fallback', async () => {
    const fetcher = mockJson(response());
    await new MapboxRoutingService().calculateRoute(points, 'hiking');
    expect(fetcher.mock.calls[0][0]).toContain('/walking/geojson');
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
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(6);
    const body = JSON.parse(fetcher.mock.calls[0][1]?.body as string);
    expect(body.coordinates).toHaveLength(4);
    expect(body.coordinates[0]).toEqual(body.coordinates.at(-1));
    expect(body).not.toHaveProperty('options');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).coordinates[1]).not.toEqual(
      JSON.parse(fetcher.mock.calls.at(-1)![1]?.body as string).coordinates[1],
    );
  });
  it('stops early when routed length matches the target and samples only selected loops', async () => {
    vi.mocked(addTerrainElevation).mockClear();
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, options) => {
      const body = JSON.parse(options?.body as string);
      return new Response(JSON.stringify(response(body.coordinates)), {
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
    expect(addTerrainElevation).toHaveBeenCalledTimes(2);
    for (const result of results) {
      expect(result.stats.distance).toBeCloseTo(20000, 0);
      expect(result.stats.duration).toBe(420);
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
    await expect(requestJson('/api/directions/cycling/geojson', {})).rejects.toThrow(
      'internet connection',
    );
  });
  it('parses permanent geocoding results and requests only on submit', async () => {
    const fetcher = mockJson({
      features: [
        { geometry: { coordinates: [11.4, 47.26] }, properties: { label: 'Innsbruck, Austria' } },
      ],
    });
    const places = await searchPlaces('Innsbruck test');
    expect(places[0].name).toBe('Innsbruck, Austria');
    expect(fetcher.mock.calls[0][0]).toContain('/geocode/search?');
    const controller = new AbortController();
    controller.abort();
    await expect(searchPlaces('Innsbruck test', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
