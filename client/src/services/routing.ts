import type {
  Activity,
  Coordinate,
  RoutingProvider,
  RoutingResult,
  Waypoint,
} from '../domain/types';
import { calculateStats } from '../domain/stats';
import { addTerrainElevation } from './elevation';
import { coordinateDistance, loopWaypoints } from './loops';
import { mapboxUrl } from './mapbox';

export const profiles: Record<Activity, string> = {
  cycling: 'cycling',
  hiking: 'walking',
};

class NoRouteError extends Error {}
export async function checkRoutingConfiguration(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  return String(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? '')
    .trim()
    .startsWith('pk.');
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The service returned an invalid response.');
  return value as Record<string, unknown>;
};
export function validCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    (value.length === 2 || value.length === 3) &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}
export async function requestJson(
  url: string,
  options: RequestInit,
  signal?: AbortSignal,
): Promise<unknown> {
  const target = mapboxUrl(url);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(target, {
      ...options,
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error(
          'The routing request was rejected. Check server configuration and provider account permissions.',
        );
      if (response.status === 429)
        throw new Error(
          'Routing quota reached. Wait a moment or check your provider account limits.',
        );
      if (response.status >= 500)
        throw new Error(
          'The routing service is unavailable. Try again later; your saved routes are safe.',
        );
      throw new NoRouteError(
        `No route or location found (service ${response.status}). Try points closer to accessible roads or trails, or a shorter route.`,
      );
    }
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'code' in data && data.code !== 'Ok') {
      if (data.code === 'NoRoute' || data.code === 'NoSegment')
        throw new NoRouteError('No route was returned. Try a different location.');
      throw new Error(
        'The routing service is unavailable. Try again later; your saved routes are safe.',
      );
    }
    return data;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (controller.signal.aborted)
      throw new Error('The service took too long to respond. Please try again.');
    if (error instanceof TypeError)
      throw new Error('Cannot reach the service. Check your internet connection and provider URL.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export class MapboxRoutingService implements RoutingProvider {
  private cache = new Map<string, { time: number; result: RoutingResult }>();
  private async calculate(
    coordinates: Coordinate[],
    activity: Activity,
    signal?: AbortSignal,
    elevation = true,
  ): Promise<RoutingResult> {
    if (!coordinates.every(validCoordinate))
      throw new Error('Route locations must contain valid longitude and latitude.');
    if (!(activity in profiles)) throw new Error('Invalid route activity.');
    const coordinatesPath = coordinates.map((c) => c.slice(0, 2).join(',')).join(';');
    const cacheKey = JSON.stringify([activity, coordinatesPath, elevation]);
    const cached = this.cache.get(cacheKey);
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (cached && Date.now() - cached.time < 300_000) return structuredClone(cached.result);
    const data = object(
      await requestJson(
        `/directions/v5/mapbox/${profiles[activity]}/${coordinatesPath}?geometries=geojson&overview=full&steps=false`,
        { method: 'GET' },
        signal,
      ),
    );
    if (!Array.isArray(data.routes) || !data.routes.length)
      throw new NoRouteError('No route was returned. Try a different location.');
    const route = object(data.routes[0]);
    const geometry = object(route.geometry);
    if (
      geometry.type !== 'LineString' ||
      !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length < 2 ||
      !geometry.coordinates.every(validCoordinate)
    )
      throw new Error('The service returned invalid route geometry.');
    const summary = route;
    if (
      typeof summary.duration !== 'number' ||
      !Number.isFinite(summary.duration) ||
      summary.duration < 0 ||
      typeof summary.distance !== 'number' ||
      !Number.isFinite(summary.distance) ||
      summary.distance < 0
    )
      throw new Error('The service returned invalid route statistics.');
    const points = elevation
      ? await addTerrainElevation(geometry.coordinates, signal)
      : geometry.coordinates;
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const segments: Coordinate[][] = [points];
    const stats = calculateStats(segments, activity);
    stats.duration = summary.duration;
    const result = { segments, stats };
    if (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cacheKey, { time: Date.now(), result: structuredClone(result) });
    return result;
  }
  async calculateRoute(waypoints: Waypoint[], activity: Activity, signal?: AbortSignal) {
    if (waypoints.length < 2 || waypoints.length > 25)
      throw new Error('Choose between 2 and 25 route points.');
    return this.calculate(
      waypoints.map((w) => w.coordinate),
      activity,
      signal,
    );
  }
  async calculateAlternatives(
    start: Waypoint,
    activity: Activity,
    distance: number,
    signal?: AbortSignal,
  ) {
    if (!Number.isFinite(distance) || distance < 2000 || distance > 100000)
      throw new Error('Choose a loop distance between 2 and 100 km.');
    if (!validCoordinate(start.coordinate))
      throw new Error('Route locations must contain valid longitude and latitude.');
    const results: RoutingResult[] = [];
    // Directions has no target-length loop API. Bound the search to six routed candidates.
    for (const bearing of [30, 210]) {
      let radius = distance / 3;
      let best: RoutingResult | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
        let candidate: RoutingResult;
        try {
          candidate = await this.calculate(
            loopWaypoints(start.coordinate, radius, bearing + attempt * 10),
            activity,
            signal,
            false,
          );
        } catch (error) {
          if (!(error instanceof NoRouteError)) throw error;
          radius *= 0.7;
          continue;
        }
        const points = candidate.segments[0];
        if (coordinateDistance(points[0], points[points.length - 1]) > 100) continue;
        if (candidate.stats.distance <= 0) continue;
        if (
          !best ||
          Math.abs(candidate.stats.distance - distance) < Math.abs(best.stats.distance - distance)
        )
          best = candidate;
        const ratio = distance / candidate.stats.distance;
        if (Math.abs(ratio - 1) < 0.15) break;
        radius *= Math.max(0.5, Math.min(1.5, ratio));
      }
      if (
        best &&
        !results.some((r) => JSON.stringify(r.segments) === JSON.stringify(best.segments))
      )
        results.push(best);
    }
    if (!results.length)
      throw new Error('The service did not return a closed loop. Try a different start location.');
    for (const result of results) {
      result.segments = [await addTerrainElevation(result.segments[0], signal)];
      const stats = calculateStats(result.segments, activity);
      result.stats = { ...stats, duration: result.stats.duration };
    }
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    return results;
  }
}
export const routingProvider = new MapboxRoutingService();
export interface Place {
  name: string;
  coordinate: Coordinate;
}
const searches = new Map<string, Place[]>();
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const text = query.trim();
  if (text.length < 3 || text.length > 200)
    throw new Error('Enter a place or address between 3 and 200 characters.');
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  if (searches.has(text)) return structuredClone(searches.get(text)!);
  const params = new URLSearchParams({
    q: text,
    limit: '5',
    permanent: 'true',
    autocomplete: 'false',
  });
  const data = object(
    await requestJson(`/search/geocode/v6/forward?${params}`, { method: 'GET' }, signal),
  );
  if (!Array.isArray(data.features))
    throw new Error('The search service returned invalid locations.');
  const places = data.features.map((raw: unknown) => {
    const feature = object(raw),
      geometry = object(feature.geometry),
      properties = object(feature.properties);
    const name =
      typeof properties.full_address === 'string'
        ? properties.full_address
        : [properties.name, properties.place_formatted]
            .filter((value) => typeof value === 'string' && value)
            .join(', ');
    if (!validCoordinate(geometry.coordinates) || !name)
      throw new Error('The search service returned an invalid location.');
    return { name, coordinate: geometry.coordinates };
  });
  if (searches.size >= 30) searches.delete(searches.keys().next().value!);
  searches.set(text, structuredClone(places));
  return places;
}
