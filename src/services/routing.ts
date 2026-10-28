import type { Activity, Coordinate, RoutingProvider, RoutingResult, Waypoint } from '../domain/types';
import { calculateStats } from '../domain/stats';

export const profiles: Record<Activity, string> = { cycling: 'cycling-regular', hiking: 'foot-hiking' };
export const routingConfigured = Boolean(import.meta.env.VITE_ORS_API_KEY?.trim());
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The service returned an invalid response.');
  return value as Record<string, unknown>;
};
export function validCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && (value.length === 2 || value.length === 3) && value.every(v => typeof v === 'number' && Number.isFinite(v)) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}
export async function requestJson(url: string, key: string, options: RequestInit, signal?: AbortSignal): Promise<unknown> {
  if (!key.trim()) throw new Error('Online routing and place search need an OpenRouteService key. Set VITE_ORS_API_KEY in .env.local and restart the app. GPX and your library still work.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: key, ...options.headers }, signal: controller.signal });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('The routing key was rejected. Check your OpenRouteService key and account permissions.');
      if (response.status === 429) throw new Error('Routing quota reached. Wait a moment or check your provider account limits.');
      if (response.status >= 500) throw new Error('The routing service is unavailable. Try again later; your saved routes are safe.');
      throw new Error(`No route or location found (service ${response.status}). Try points closer to accessible roads or trails, or a shorter route.`);
    }
    return await response.json() as unknown;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (controller.signal.aborted) throw new Error('The service took too long to respond. Please try again.');
    if (error instanceof TypeError) throw new Error('Cannot reach the service. Check your internet connection and provider URL.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

export class OpenRouteService implements RoutingProvider {
  private cache = new Map<string, { time: number; result: RoutingResult }>();
  constructor(private key = import.meta.env.VITE_ORS_API_KEY ?? '', private base = import.meta.env.VITE_ORS_URL || 'https://api.openrouteservice.org') {}
  private async calculate(coordinates: Coordinate[], activity: Activity, options: Record<string, unknown>, signal?: AbortSignal): Promise<RoutingResult> {
    if (!coordinates.every(validCoordinate)) throw new Error('Route locations must contain valid longitude and latitude.');
    const body = { coordinates: coordinates.map(c => c.slice(0, 2)), elevation: true, instructions: false, options };
    const cacheKey = JSON.stringify([activity, body]);
    const cached = this.cache.get(cacheKey);
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (cached && Date.now() - cached.time < 300_000) return structuredClone(cached.result);
    const data = object(await requestJson(`${this.base.replace(/\/$/, '')}/v2/directions/${profiles[activity]}/geojson`, this.key, { method: 'POST', body: JSON.stringify(body) }, signal));
    if (!Array.isArray(data.features) || !data.features.length) throw new Error('No route was returned. Try a different location.');
    const feature = object(data.features[0]);
    const geometry = object(feature.geometry);
    if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 || !geometry.coordinates.every(validCoordinate)) throw new Error('The service returned invalid route geometry.');
    const segments: Coordinate[][] = [geometry.coordinates];
    const stats = calculateStats(segments, activity);
    const properties = object(feature.properties);
    const summary = object(properties.summary);
    if (typeof summary.duration !== 'number' || !Number.isFinite(summary.duration) || summary.duration < 0) throw new Error('The service returned invalid route statistics.');
    stats.duration = summary.duration;
    const result = { segments, stats };
    if (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cacheKey, { time: Date.now(), result: structuredClone(result) });
    return result;
  }
  async calculateRoute(waypoints: Waypoint[], activity: Activity, signal?: AbortSignal) {
    if (waypoints.length < 2 || waypoints.length > 50) throw new Error('Choose between 2 and 50 route points.');
    return this.calculate(waypoints.map(w => w.coordinate), activity, activity === 'cycling' ? { avoid_features: ['steps'] } : {}, signal);
  }
  async calculateAlternatives(start: Waypoint, activity: Activity, distance: number, signal?: AbortSignal) {
    if (!Number.isFinite(distance) || distance < 2000 || distance > 100000) throw new Error('Choose a loop distance between 2 and 100 km.');
    const results: RoutingResult[] = [];
    for (const seed of [11, 37]) {
      const result = await this.calculate([start.coordinate], activity, { round_trip: { length: distance, points: 3, seed }, ...(activity === 'cycling' ? { avoid_features: ['steps'] } : {}) }, signal);
      const points = result.segments[0];
      const a = points[0], b = points[points.length - 1];
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 0.002) throw new Error('The service did not return a closed loop. Try a different start location.');
      if (!results.some(r => JSON.stringify(r.segments) === JSON.stringify(result.segments))) results.push(result);
    }
    return results;
  }
}
export const routingProvider = new OpenRouteService();
export interface Place { name: string; coordinate: Coordinate }
const searches = new Map<string, Place[]>();
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const text = query.trim();
  if (text.length < 3 || text.length > 200) throw new Error('Enter a place or address between 3 and 200 characters.');
  if (searches.has(text)) return structuredClone(searches.get(text)!);
  const base = import.meta.env.VITE_ORS_URL || 'https://api.openrouteservice.org';
  const params = new URLSearchParams({ text, size: '5' });
  const data = object(await requestJson(`${base.replace(/\/$/, '')}/geocode/search?${params}`, import.meta.env.VITE_ORS_API_KEY ?? '', { method: 'GET' }, signal));
  if (!Array.isArray(data.features)) throw new Error('The search service returned invalid locations.');
  const places = data.features.map((raw: unknown) => {
    const feature = object(raw), geometry = object(feature.geometry), properties = object(feature.properties);
    if (!validCoordinate(geometry.coordinates) || typeof properties.label !== 'string') throw new Error('The search service returned an invalid location.');
    return { name: properties.label, coordinate: geometry.coordinates };
  });
  if (searches.size >= 30) searches.delete(searches.keys().next().value!);
  searches.set(text, structuredClone(places));
  return places;
}
