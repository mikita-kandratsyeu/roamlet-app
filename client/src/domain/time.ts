import type { Coordinate, PlannedRoute } from './types';

export type Fitness = 'beginner' | 'regular' | 'trained';
export type Surface = 'unknown' | 'paved' | 'mixed' | 'rough';
export const isFitness = (value: unknown): value is Fitness =>
  value === 'beginner' || value === 'regular' || value === 'trained';
export const isSurface = (value: unknown): value is Surface =>
  value === 'unknown' || value === 'paved' || value === 'mixed' || value === 'rough';
export function speedToPace(speedKmh: number): number | null {
  const pace = 60 / speedKmh;
  return speedKmh > 0 && Number.isFinite(pace) && pace > 0 ? pace : null;
}
export const paceToSpeed = speedToPace;

export function estimateTime(distanceMetres: number, speedKmh: number, stopsMinutes: number) {
  if (
    !Number.isFinite(distanceMetres) ||
    distanceMetres < 0 ||
    !Number.isFinite(speedKmh) ||
    speedKmh <= 0 ||
    !Number.isFinite(stopsMinutes) ||
    stopsMinutes < 0
  )
    return null;
  const moving = (distanceMetres / 1000 / speedKmh) * 3600;
  const total = moving + stopsMinutes * 60;
  return Number.isFinite(total) ? { moving, total } : null;
}

export interface PersonalTimeOptions {
  speedKmh: number;
  stopsMinutes: number;
  fitness: Fitness;
  surface: Surface;
}
export interface TimeRange {
  lower: number;
  upper: number;
}
export type TimeWarning =
  'unknown-surface' | 'missing-elevation' | 'manual-distance' | 'cycling-climb';

// A 3 m reversal threshold suppresses small GPS oscillations; segments never connect.
export function reliableAscent(segments: Coordinate[][]): number | null {
  if (
    !Array.isArray(segments) ||
    !segments.length ||
    segments.some((segment) => !Array.isArray(segment)) ||
    !segments.some((segment) => segment.length > 1)
  )
    return null;
  if (
    segments.some((segment) =>
      segment.some((point) => !Array.isArray(point) || !Number.isFinite(point[2])),
    )
  )
    return null;
  let ascent = 0;
  for (const segment of segments) {
    if (!segment.length) continue;
    let valley = segment[0][2]!;
    let peak = valley;
    let climbing = false;
    for (const point of segment.slice(1)) {
      const height = point[2]!;
      if (!climbing) {
        valley = Math.min(valley, height);
        if (height - valley >= 3) {
          peak = height;
          climbing = true;
        }
      } else if (height > peak) peak = height;
      else if (peak - height >= 3) {
        ascent += peak - valley;
        valley = height;
        climbing = false;
      }
    }
    if (climbing) ascent += peak - valley;
  }
  return Number.isFinite(ascent) ? ascent : null;
}

export function planningReferenceTime(
  providerMoving: number,
  personalMoving: number,
  stopsMinutes: number,
): number | null {
  if (
    ![providerMoving, personalMoving, stopsMinutes].every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  )
    return null;
  const total = Math.max(providerMoving, personalMoving) + stopsMinutes * 60;
  return Number.isFinite(total) ? total : null;
}

export function estimatePersonalTime(route: PlannedRoute, options: PersonalTimeOptions) {
  if (
    !route ||
    !route.stats ||
    !options ||
    !['cycling', 'hiking'].includes(route.activity) ||
    !['openrouteservice', 'mapbox', 'gpx', 'manual', 'mixed'].includes(route.source) ||
    !isFitness(options.fitness) ||
    !isSurface(options.surface)
  )
    return null;
  const base = estimateTime(route.stats.distance, options.speedKmh, options.stopsMinutes);
  if (!base) return null;
  const surfaceFactors = {
    hiking: { unknown: 1, paved: 1, mixed: 1.1, rough: 1.25 },
    cycling: { unknown: 1, paved: 1, mixed: 1.2, rough: 1.5 },
  };
  const surfaceFactor = surfaceFactors[route.activity][options.surface];
  const ascentMetres =
    route.source === 'gpx' || route.elevationSource === 'openrouteservice'
      ? reliableAscent(route.segments)
      : null;
  const climbSeconds =
    ascentMetres === null
      ? 0
      : route.activity === 'hiking'
        ? ascentMetres * 6 * { beginner: 1.3, regular: 1, trained: 0.9 }[options.fitness]
        : (ascentMetres / { beginner: 300, regular: 450, trained: 600 }[options.fitness]) * 3600;
  const moving = base.moving * surfaceFactor + climbSeconds;
  const stops = options.stopsMinutes * 60;
  const warnings: TimeWarning[] = [];
  if (options.surface === 'unknown') warnings.push('unknown-surface');
  if (ascentMetres === null) warnings.push('missing-elevation');
  const hasDirectLegs =
    route.source === 'manual' || route.source === 'mixed' || !!route.directSegments?.length;
  if (hasDirectLegs) warnings.push('manual-distance');
  if (route.activity === 'cycling' && climbSeconds > 0) warnings.push('cycling-climb');
  // These spreads are transparent planning heuristics, not statistical confidence intervals.
  const spread = { beginner: 0.25, regular: 0.2, trained: 0.15 }[options.fitness];
  const lowerSpread = spread + (options.surface === 'unknown' ? 0.1 : 0);
  const upperSpread = lowerSpread + (ascentMetres === null ? 0.2 : 0) + (hasDirectLegs ? 0.3 : 0);
  const movingRange = { lower: moving * (1 - lowerSpread), upper: moving * (1 + upperSpread) };
  const totalRange = { lower: movingRange.lower + stops, upper: movingRange.upper + stops };
  const total = moving + stops;
  const automatic =
    route.source === 'openrouteservice' || route.source === 'mapbox' || route.source === 'mixed';
  const planningReference = automatic
    ? planningReferenceTime(route.stats.duration, moving, options.stopsMinutes)
    : null;
  if (automatic && planningReference === null) return null;
  if (
    ![moving, total, ...Object.values(movingRange), ...Object.values(totalRange)].every(
      Number.isFinite,
    )
  )
    return null;
  return {
    moving,
    total,
    planningReference,
    movingRange,
    totalRange,
    ascentMetres,
    climbSeconds,
    surfaceFactor,
    warnings,
  };
}

export function outwardMinutes(range: TimeRange): TimeRange | null {
  if (
    !Number.isFinite(range.lower) ||
    !Number.isFinite(range.upper) ||
    range.lower < 0 ||
    range.upper < range.lower
  )
    return null;
  return { lower: Math.floor(range.lower / 60), upper: Math.ceil(range.upper / 60) };
}
