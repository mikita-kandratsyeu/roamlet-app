import type {
  Activity,
  Coordinate,
  RoutingProvider,
  RoutingResult,
  RoutingOptions,
  Waypoint,
} from '../domain/types';
import { manualRoute, MANUAL_STOP_LIMIT } from '../domain/manualRoute';
import {
  AUTOMATIC_POINT_LIMIT,
  automaticPointCount,
  validLegMode,
  waypointLegMode,
  waypointRuns,
} from '../domain/waypointLegs';
import {
  normalizeRoutingOptions,
  orsRoutingOptions,
  routingProfile,
} from '../domain/routingOptions';
import { calculateStats } from '../domain/stats';
import { coordinateDistance, loopWaypoints, rankLoopCandidates } from './loops';
import { openRouteServiceProfile } from './openrouteservice';

export const profiles: Record<Activity, string> = {
  cycling: 'cycling-regular',
  hiking: 'foot-hiking',
};

class NoRouteError extends Error {}
export async function checkRoutingConfiguration(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 8_000);
  try {
    const response = await fetch('/api/routing-config', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Routing configuration could not be checked.');
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== 'object' ||
      !('available' in data) ||
      typeof data.available !== 'boolean'
    )
      throw new Error('Routing configuration could not be checked.');
    return data.available;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
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
    Array.from(value).every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}
export async function requestJson(
  url: string,
  options: RequestInit,
  signal?: AbortSignal,
): Promise<unknown> {
  const profile = openRouteServiceProfile(url);
  const body = { ...JSON.parse(String(options.body ?? '{}')), profile };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch('/api/route', {
      method: 'POST',
      body: JSON.stringify(body),
      credentials: 'same-origin',
      headers: {
        Accept: 'application/geo+json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error('The routing request was rejected. Reload the app and try again.');
      if (response.status === 429)
        throw new Error(
          'Routing quota reached. Wait a moment or check your provider account limits.',
        );
    }
    if (response.status === 504)
      throw new Error('The service took too long to respond. Please try again.');
    const data: unknown = await response.json().catch(() => {
      throw new Error(
        response.ok
          ? 'The service returned an invalid response.'
          : 'The routing service is unavailable. Try again later; your saved routes are safe.',
      );
    });
    const error = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'UPSTREAM_RATE_LIMITED')
        throw new Error(
          'Routing quota reached. Wait a moment or check your provider account limits.',
        );
      if (error.code === 'ROUTING_NOT_CONFIGURED')
        throw new Error(
          'Configure ORS_API_KEY on the server. GPX and saved routes remain available.',
        );
      if (error.code === 2009 || error.code === 2010)
        throw new NoRouteError('No route was returned. Try a different location.');
      if (error.code === 2004)
        throw new Error(
          'The routing request exceeds the service limits. Try fewer points or a shorter route.',
        );
    }
    if (!response.ok || error)
      throw new Error(
        'The routing service is unavailable. Try again later; your saved routes are safe.',
      );
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

export class OpenRouteServiceRoutingService implements RoutingProvider {
  private cache = new Map<string, { time: number; results: RoutingResult[] }>();
  private async requestRoutes(
    coordinates: Coordinate[],
    activity: Activity,
    signal?: AbortSignal,
    options: RoutingOptions = {},
    alternatives = false,
  ): Promise<RoutingResult[]> {
    if (!coordinates.every(validCoordinate))
      throw new Error('Route locations must contain valid longitude and latitude.');
    const profile = routingProfile(activity, options);
    const locations = coordinates.map((coordinate) => coordinate.slice(0, 2));
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const body = {
      coordinates: locations,
      instructions: false,
      elevation: true,
      ...(orsRoutingOptions(options) ? { options: orsRoutingOptions(options) } : {}),
      ...(alternatives
        ? { alternative_routes: { target_count: 2, weight_factor: 1.4, share_factor: 0.6 } }
        : {}),
    };
    const cacheKey = JSON.stringify([profile, body]);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < 300_000) return structuredClone(cached.results);
    const data = object(
      await requestJson(
        `/openrouteservice/v2/directions/${profile}/geojson`,
        { method: 'POST', body: JSON.stringify(body) },
        signal,
      ),
    );
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features))
      throw new Error('The service returned an invalid response.');
    if (!data.features.length)
      throw new NoRouteError('No route was returned. Try a different location.');
    const results: RoutingResult[] = (
      alternatives ? data.features.slice(0, 2) : data.features.slice(0, 1)
    ).map((feature) => {
      const route = object(feature);
      if (route.type !== 'Feature') throw new Error('The service returned an invalid response.');
      const geometry = object(route.geometry);
      if (
        geometry.type !== 'LineString' ||
        !Array.isArray(geometry.coordinates) ||
        geometry.coordinates.length < 2 ||
        !geometry.coordinates.every(validCoordinate)
      )
        throw new Error('The service returned invalid route geometry.');
      const summary = object(object(route.properties).summary);
      if (
        typeof summary.duration !== 'number' ||
        !Number.isFinite(summary.duration) ||
        summary.duration < 0 ||
        typeof summary.distance !== 'number' ||
        !Number.isFinite(summary.distance) ||
        summary.distance < 0
      )
        throw new Error('The service returned invalid route statistics.');
      const segments: Coordinate[][] = [
        geometry.coordinates.map((point) => [...point] as Coordinate),
      ];
      const stats = calculateStats(segments, activity);
      stats.duration = summary.duration;
      return {
        segments,
        stats,
        ...(stats.ascent !== undefined ? { elevationSource: 'openrouteservice' as const } : {}),
      };
    });
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cacheKey, { time: Date.now(), results: structuredClone(results) });
    return results;
  }
  private async calculate(
    coordinates: Coordinate[],
    activity: Activity,
    signal?: AbortSignal,
    options?: RoutingOptions,
  ): Promise<RoutingResult> {
    return (await this.requestRoutes(coordinates, activity, signal, options))[0];
  }
  async calculateRoute(
    waypoints: Waypoint[],
    activity: Activity,
    signal?: AbortSignal,
    options?: RoutingOptions,
  ): Promise<RoutingResult> {
    normalizeRoutingOptions(options);
    routingProfile(activity, options);
    if (waypoints.length < 2 || automaticPointCount(waypoints) > AUTOMATIC_POINT_LIMIT)
      throw new Error('Choose between 2 and 50 route points.');
    if (waypoints.length > MANUAL_STOP_LIMIT)
      throw new Error('Choose between 2 and 1,000 points for a manual route.');
    if (
      !waypoints.every((point) => validCoordinate(point.coordinate) && validLegMode(point.legMode))
    )
      throw new Error('Route locations must contain valid longitude and latitude.');
    const segments: Coordinate[][] = [];
    const directSegments: Coordinate[][] = [];
    let duration = 0;
    for (const run of waypointRuns(waypoints)) {
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      const result =
        run.mode === 'direct'
          ? manualRoute(run.waypoints, activity)
          : await this.calculate(
              run.waypoints.map((point) => point.coordinate),
              activity,
              signal,
              options,
            );
      segments.push(...result.segments);
      if (run.mode === 'direct') directSegments.push(...result.segments);
      duration += result.stats.duration;
    }
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const stats = calculateStats(segments, activity);
    stats.duration = duration;
    return {
      segments,
      stats,
      ...(directSegments.length ? { directSegments } : {}),
      ...(stats.ascent !== undefined ? { elevationSource: 'openrouteservice' as const } : {}),
    };
  }
  async calculatePointAlternatives(
    waypoints: Waypoint[],
    activity: Activity,
    signal?: AbortSignal,
    options?: RoutingOptions,
  ): Promise<RoutingResult[]> {
    if (waypoints.length !== 2 || waypointLegMode(waypoints[0]) !== 'automatic')
      throw new Error('Alternatives require exactly two automatic route points.');
    if (!waypoints.every((point) => validLegMode(point.legMode)))
      throw new Error('Invalid routing options.');
    return this.requestRoutes(
      waypoints.map((point) => point.coordinate),
      activity,
      signal,
      options,
      true,
    );
  }
  async calculateAlternatives(
    start: Waypoint,
    activity: Activity,
    distance: number,
    signal?: AbortSignal,
    options?: RoutingOptions,
  ) {
    normalizeRoutingOptions(options);
    routingProfile(activity, options);
    if (!Number.isFinite(distance) || distance < 2000 || distance > 100000)
      throw new Error('Choose a loop distance between 2 and 100 km.');
    if (!validCoordinate(start.coordinate))
      throw new Error('Route locations must contain valid longitude and latitude.');
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const controller = new AbortController();
    const bestByBearing = new Map<number, RoutingResult>();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel = () => {};
    const stopped = new Promise<void>((resolve, reject) => {
      cancel = () => {
        controller.abort();
        reject(new DOMException('Request cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve();
      }, 45_000);
    });
    const search = async () => {
      // Keep the existing loop search bounded to six routed candidates.
      for (const bearing of [30, 210]) {
        let radius = distance / 3;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (controller.signal.aborted) return;
          let candidate: RoutingResult;
          try {
            candidate = await this.calculate(
              loopWaypoints(start.coordinate, radius, bearing + attempt * 10),
              activity,
              controller.signal,
              options,
            );
          } catch (error) {
            if (controller.signal.aborted) return;
            if (!(error instanceof NoRouteError)) throw error;
            radius *= 0.7;
            continue;
          }
          if (controller.signal.aborted) return;
          const points = candidate.segments[0];
          if (coordinateDistance(points[0], points[points.length - 1]) > 100) continue;
          if (candidate.stats.distance <= 0) continue;
          const best = bestByBearing.get(bearing);
          if (
            !best ||
            Math.abs(candidate.stats.distance - distance) < Math.abs(best.stats.distance - distance)
          )
            bestByBearing.set(bearing, candidate);
          const ratio = distance / candidate.stats.distance;
          if (Math.abs(ratio - 1) < 0.15) break;
          radius *= Math.max(0.5, Math.min(1.5, ratio));
        }
      }
    };
    try {
      await Promise.race([search(), stopped]);
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      const results = rankLoopCandidates([...bestByBearing.values()], distance);
      if (!results.length) {
        throw new Error(
          timedOut
            ? 'Round-trip search reached the 45-second limit. Try a shorter distance or another starting point.'
            : 'The service did not return a closed loop. Try a different start location.',
        );
      }
      return results;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      controller.abort();
    }
  }
}
export const routingProvider: RoutingProvider = new OpenRouteServiceRoutingService();
