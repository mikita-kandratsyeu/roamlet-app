import { calculateStats, measureElevation } from './stats';
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

/** Straight-line legs are shorter than a path. Applied to the point estimate only. */
export const DIRECT_DISTANCE_FACTOR = 1.2;
/** Below this grade on an edge, cycling keeps flat speed. At or above it, vertical speed replaces that edge. */
export const CYCLING_STEEP_GRADE = 0.04;

/** Filtered ascent shared with route statistics. Stationary jumps and gaps add nothing. */
export function reliableAscent(segments: Coordinate[][]): number | null {
  const measured = measureElevation(segments);
  return measured && Number.isFinite(measured.ascent) ? measured.ascent : null;
}

function geometryDistance(segments: Coordinate[][] | undefined): number | null {
  if (!segments?.length) return null;
  try {
    return calculateStats(segments, 'hiking').distance;
  } catch {
    return null;
  }
}

function directDistanceFactor(route: PlannedRoute): number {
  if (route.source === 'manual') return DIRECT_DISTANCE_FACTOR;
  if (!route.directSegments?.length) return 1;
  const direct = geometryDistance(route.directSegments);
  const total = geometryDistance(route.segments);
  if (direct === null || total === null || !(total > 0)) return DIRECT_DISTANCE_FACTOR;
  return 1 + (DIRECT_DISTANCE_FACTOR - 1) * Math.min(1, direct / total);
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
  const trustedElevation =
    route.source === 'gpx' || route.elevationSource === 'openrouteservice';
  const measured = trustedElevation
    ? measureElevation(route.segments, CYCLING_STEEP_GRADE)
    : null;
  const ascentMetres = measured?.ascent ?? null;
  const pace = route.stats.distance > 0 ? base.moving / route.stats.distance : 0;
  const effectiveDistance = route.stats.distance * directDistanceFactor(route);
  const steepShare =
    route.activity === 'cycling' && measured && measured.horizontal > 0
      ? Math.min(1, measured.steepHorizontal / measured.horizontal)
      : 0;
  const flatDistance = effectiveDistance * (1 - steepShare);
  const climbSeconds =
    measured === null
      ? 0
      : route.activity === 'hiking'
        ? measured.ascent * 6 * { beginner: 1.3, regular: 1, trained: 0.9 }[options.fitness]
        : (measured.steepAscent / { beginner: 300, regular: 450, trained: 600 }[options.fitness]) *
          3600;
  let moving = flatDistance * pace * surfaceFactor + climbSeconds;
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
  // Without heights the centre would ignore every climb. Use the top of the unchanged range.
  if (ascentMetres === null) moving = movingRange.upper;
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
