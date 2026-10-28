import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouteService, requestJson, searchPlaces } from './routing';
import type { Waypoint } from '../domain/types';
const points: Waypoint[] = [{ id: 'a', name: 'A', coordinate: [11.4, 47.26] }, { id: 'b', name: 'B', coordinate: [11.41, 47.27] }];
const response = (coordinates = [[11.4, 47.26, 600], [11.405, 47.265, 625], [11.41, 47.27, 610]]) => ({ features: [{ geometry: { type: 'LineString', coordinates }, properties: { summary: { distance: 1234, duration: 420 } } }] });
function mockJson(data: unknown, status = 200) { return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })); }
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('OpenRouteService', () => {
  it('fails transparently without credentials, never fabricates geometry', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(new OpenRouteService('').calculateRoute(points, 'cycling')).rejects.toThrow('VITE_ORS_API_KEY');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the cycling profile, actual geometry distance and provider time', async () => {
    const fetcher = mockJson(response());
    const result = await new OpenRouteService('test-only').calculateRoute(points, 'cycling');
    expect(fetcher.mock.calls[0][0]).toContain('/cycling-regular/geojson');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({ coordinates: [[11.4, 47.26], [11.41, 47.27]], elevation: true, options: { avoid_features: ['steps'] } });
    expect(result.segments[0]).toHaveLength(3);
    expect(result.stats.distance).toBeGreaterThan(1300);
    expect(result.stats.duration).toBe(420);
    expect(result.stats.ascent).toBe(25); expect(result.stats.descent).toBe(15);
  });
  it('routes hiking with foot-hiking, not a cycling fallback', async () => {
    const fetcher = mockJson(response()); await new OpenRouteService('test-only').calculateRoute(points, 'hiking');
    expect(fetcher.mock.calls[0][0]).toContain('/foot-hiking/geojson');
  });
  it('returns unavailable elevation instead of invented heights', async () => {
    mockJson(response([[11.4, 47.26], [11.41, 47.27]]));
    const result = await new OpenRouteService('test-only').calculateRoute(points, 'hiking');
    expect(result.stats.ascent).toBeUndefined();
  });
  it('caches exact requests but not waypoint changes', async () => {
    const fetcher = mockJson(response()); const provider = new OpenRouteService('test-only');
    const first = await provider.calculateRoute(points, 'cycling'); first.segments[0][0][0] = 0;
    const second = await provider.calculateRoute(points, 'cycling');
    expect(second.segments[0][0][0]).toBe(11.4); expect(fetcher).toHaveBeenCalledTimes(1);
    await provider.calculateRoute([...points].reverse(), 'cycling'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 429, 503, 400])('reports service failure %s', async status => {
    mockJson({}, status); await expect(new OpenRouteService('test-only').calculateRoute(points, 'cycling')).rejects.toThrow(status === 429 ? 'quota' : status >= 500 ? 'unavailable' : status < 402 || status === 403 ? status === 400 ? 'No route' : 'rejected' : 'No route');
  });
  it('validates waypoint count and geometry', async () => {
    await expect(new OpenRouteService('test-only').calculateRoute([], 'cycling')).rejects.toThrow('2 and 50');
    mockJson(response([[999, 47], [11, 47]]));
    await expect(new OpenRouteService('test-only').calculateRoute(points, 'cycling')).rejects.toThrow('invalid route geometry');
  });
  it('generates actual closed round trips with different seeds and deduplicates identical results', async () => {
    const fetcher = mockJson(response([[11.4, 47.26, 600], [11.42, 47.28, 700], [11.4, 47.26, 600]]));
    const result = await new OpenRouteService('test-only').calculateAlternatives(points[0], 'hiking', 20000);
    expect(result).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetcher.mock.calls[0][1]?.body as string);
    expect(body.coordinates).toHaveLength(1); expect(body.options.round_trip).toMatchObject({ length: 20000, points: 3, seed: 11 });
  });
  it('rejects a nonclosed loop and invalid target distance', async () => {
    mockJson(response()); const provider = new OpenRouteService('test-only');
    await expect(provider.calculateAlternatives(points[0], 'cycling', 500)).rejects.toThrow('2 and 100');
    await expect(provider.calculateAlternatives(points[0], 'cycling', 20000)).rejects.toThrow('closed loop');
  });
  it('respects cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(new OpenRouteService('test-only').calculateRoute(points, 'cycling', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('reports a network failure without falling back to a line', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network')); await expect(requestJson('https://test.invalid', 'test-only', {})).rejects.toThrow('internet connection');
  });
  it('parses geocoding results and requests only on submit', async () => {
    vi.stubEnv('VITE_ORS_API_KEY', 'test-only');
    const fetcher = mockJson({ features: [{ geometry: { coordinates: [11.4, 47.26] }, properties: { label: 'Innsbruck, Austria' } }] });
    const places = await searchPlaces('Innsbruck test'); expect(places[0].name).toBe('Innsbruck, Austria');
    expect(fetcher.mock.calls[0][0]).toContain('/geocode/search?');
  });
});
