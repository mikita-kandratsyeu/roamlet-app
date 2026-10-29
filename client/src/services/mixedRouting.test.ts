import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouteServiceRoutingService } from './routing';
import type { Coordinate, Waypoint } from '../domain/types';
import { calculateStats } from '../domain/stats';

const points: Waypoint[] = Array.from({ length: 6 }, (_, index) => ({
  id: String(index),
  name: String(index),
  coordinate: [11.4 + index * 0.01, 47.26],
}));
function feature(coordinates: Coordinate[], duration = 100) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { summary: { duration, distance: 1000 } },
  };
}
function mockProvider() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const coordinates = body.coordinates.map((point: number[], index: number) => [
      ...point,
      600 + index * 10,
    ]);
    return new Response(
      JSON.stringify({ type: 'FeatureCollection', features: [feature(coordinates)] }),
    );
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('mixed direct and automatic routing', () => {
  it('batches contiguous automatic runs, isolates direct chunks and omits incomplete elevations', async () => {
    const fetcher = mockProvider();
    const stops = points.map((point, index) => ({
      ...point,
      legMode: index === 2 ? ('direct' as const) : ('automatic' as const),
    }));
    const result = await new OpenRouteServiceRoutingService().calculateRoute(stops, 'cycling');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies.map((body) => body.coordinates.length)).toEqual([3, 3]);
    expect(result.segments).toHaveLength(3);
    expect(result.directSegments).toEqual([[points[2].coordinate, points[3].coordinate]]);
    const directStats = calculateStats(result.directSegments!, 'cycling');
    expect(result.stats.duration).toBeCloseTo(200 + directStats.duration);
    expect(result.stats.distance).toBeCloseTo(calculateStats(result.segments, 'cycling').distance);
    expect(result.stats.ascent).toBeUndefined();
    expect(result.elevationSource).toBeUndefined();
  });
  it('does not connect a snapped automatic endpoint to a direct leg', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            feature([
              [11.4, 47.26, 600],
              [11.409, 47.26, 610],
            ]),
          ],
        }),
      ),
    );
    const stops = points.slice(0, 3).map((point, index) => ({
      ...point,
      legMode: index === 1 ? ('direct' as const) : ('automatic' as const),
    }));
    const result = await new OpenRouteServiceRoutingService().calculateRoute(stops, 'hiking');
    expect(result.segments[0].at(-1)?.[0]).toBe(11.409);
    expect(result.segments[1][0][0]).toBe(11.41);
    expect(result.stats.distance).toBeCloseTo(calculateStats(result.segments, 'hiking').distance);
    expect(result.segments).toHaveLength(2);
  });
  it('routes all-direct legs locally without credentials, discarding waypoint heights', async () => {
    const fetcher = mockProvider();
    const stops = points.map((point) => ({
      ...point,
      coordinate: [...point.coordinate.slice(0, 2), 1000] as Coordinate,
      legMode: 'direct' as const,
    }));
    const result = await new OpenRouteServiceRoutingService().calculateRoute(stops, 'cycling');
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.directSegments).toEqual(result.segments);
    expect(result.segments.flat().every((point) => point.length === 2)).toBe(true);
    expect(result.elevationSource).toBeUndefined();
  });
  it('allows up to1000 direct points and only25 automatic participants', async () => {
    const fetcher = mockProvider();
    const many = Array.from({ length: 1000 }, (_, index): Waypoint => ({
      id: String(index),
      name: '',
      coordinate: [11 + index / 10000, 47],
      legMode: 'direct',
    }));
    many[0].legMode = 'automatic';
    const provider = new OpenRouteServiceRoutingService();
    expect((await provider.calculateRoute(many, 'cycling')).segments).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(provider.calculateRoute([...many, many[0]], 'cycling')).rejects.toThrow('1,000');
    await expect(
      provider.calculateRoute(
        many.slice(0, 26).map((point) => ({ ...point, legMode: 'automatic' })),
        'cycling',
      ),
    ).rejects.toThrow('2 and 25');
  });
  it('ignores the last outgoing mode and caches unchanged automatic portions after direct edits', async () => {
    const fetcher = mockProvider();
    const provider = new OpenRouteServiceRoutingService();
    const stops = points.slice(0, 4).map((point, index) => ({
      ...point,
      legMode: index >= 1 ? ('direct' as const) : ('automatic' as const),
    }));
    await provider.calculateRoute(stops, 'cycling');
    await provider.calculateRoute(
      stops.map((point, index) =>
        index === 3 ? { ...point, coordinate: [11.5, 47.3], legMode: 'automatic' } : point,
      ),
      'cycling',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('checks abort before local work and does not continue to a later automatic run', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = mockProvider();
    const provider = new OpenRouteServiceRoutingService();
    await expect(
      provider.calculateRoute(
        points.map((point) => ({ ...point, legMode: 'direct' })),
        'cycling',
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
    const running = new AbortController();
    fetcher.mockImplementation(async () => {
      running.abort();
      return new Response(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [feature([points[0].coordinate, points[1].coordinate])],
        }),
      );
    });
    await expect(
      provider.calculateRoute(
        points.map((point, index) => ({ ...point, legMode: index === 2 ? 'direct' : 'automatic' })),
        'cycling',
        running.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
describe('documented routing profiles and point alternatives', () => {
  it('routes road and mountain cycling with standard avoid_features, and keys the cache by options', async () => {
    const fetcher = mockProvider();
    const provider = new OpenRouteServiceRoutingService();
    for (const cyclingProfile of ['cycling-road', 'cycling-mountain'] as const) {
      await provider.calculateRoute(points.slice(0, 2), 'cycling', undefined, {
        cyclingProfile,
        avoidFerries: true,
        avoidSteps: true,
      });
    }
    await provider.calculateRoute(points.slice(0, 2), 'cycling', undefined, {
      cyclingProfile: 'cycling-road',
    });
    await provider.calculateRoute(points.slice(0, 2), 'cycling', undefined, {
      cyclingProfile: 'cycling-road',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).profile).toBe('cycling-road');
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).profile).toBe('cycling-mountain');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).options).toEqual({
      avoid_features: ['ferries', 'steps'],
    });
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).not.toHaveProperty('options');
  });
  it('keeps hiking profile unchanged and rejects unrecognized options values', async () => {
    const fetcher = mockProvider();
    const provider = new OpenRouteServiceRoutingService();
    await provider.calculateRoute(points.slice(0, 2), 'hiking', undefined, {
      cyclingProfile: 'cycling-mountain',
      avoidFerries: true,
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).profile).toBe('foot-hiking');
    await expect(
      provider.calculateRoute(points.slice(0, 2), 'cycling', undefined, {
        cyclingProfile: 'road' as never,
      }),
    ).rejects.toThrow('Invalid routing options');
    await expect(
      provider.calculateRoute(points.slice(0, 2), 'cycling', undefined, {
        avoidFerries: 'true' as never,
      }),
    ).rejects.toThrow('Invalid routing options');
  });
  it('parses both point alternatives in one cached request with3D provenance', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              feature([
                [11.4, 47.26, 600],
                [11.41, 47.27, 610],
              ]),
              feature(
                [
                  [11.4, 47.26, 600],
                  [11.42, 47.265, 650],
                  [11.41, 47.27, 610],
                ],
                130,
              ),
            ],
          }),
        ),
    );
    const provider = new OpenRouteServiceRoutingService();
    const alternatives = await provider.calculatePointAlternatives(points.slice(0, 2), 'cycling');
    expect(alternatives).toHaveLength(2);
    expect(alternatives.every((result) => result.elevationSource === 'openrouteservice')).toBe(
      true,
    );
    expect(alternatives.map((result) => result.stats.duration)).toEqual([100, 130]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).alternative_routes).toEqual({
      target_count: 2,
      weight_factor: 1.4,
      share_factor: 0.6,
    });
    alternatives[0].segments[0][0][0] = 0;
    expect(
      (await provider.calculatePointAlternatives(points.slice(0, 2), 'cycling'))[0]
        .segments[0][0][0],
    ).toBe(11.4);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await provider.calculateRoute(points.slice(0, 2), 'cycling');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects unsupported alternatives without making requests and preserves partial elevation truth', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            feature([
              [11.4, 47.26, 600],
              [11.41, 47.27],
            ]),
          ],
        }),
      ),
    );
    const provider = new OpenRouteServiceRoutingService();
    await expect(
      provider.calculatePointAlternatives(points.slice(0, 3), 'cycling'),
    ).rejects.toThrow('exactly two automatic');
    await expect(
      provider.calculatePointAlternatives(
        [{ ...points[0], legMode: 'direct' }, points[1]],
        'cycling',
      ),
    ).rejects.toThrow('exactly two automatic');
    expect(fetcher).not.toHaveBeenCalled();
    const result = (await provider.calculatePointAlternatives(points.slice(0, 2), 'cycling'))[0];
    expect(result.segments[0][0]).toHaveLength(3);
    expect(result.stats.ascent).toBeUndefined();
    expect(result.elevationSource).toBeUndefined();
  });
});
