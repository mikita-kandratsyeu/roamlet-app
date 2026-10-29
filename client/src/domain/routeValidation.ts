import type { PlannedRoute } from './types';
import { validRoutingOptions } from './routingOptions';
import { validLegMode } from './waypointLegs';
import { validDepartureLocal, validPauseMinutes } from './schedule';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const nonnegative = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const coordinate = (value: unknown) =>
  Array.isArray(value) &&
  (value.length === 2 || value.length === 3) &&
  Array.from(value).every((n) => typeof n === 'number' && Number.isFinite(n)) &&
  Math.abs(value[0]) <= 180 &&
  Math.abs(value[1]) <= 90;

export function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    hour < 24 &&
    minute < 60 &&
    second < 60
  );
}

/** Validates untrusted snapshots without coercing or recomputing stored statistics. */
export function validateRoute(value: unknown): asserts value is PlannedRoute {
  if (
    !record(value) ||
    !text(value.id) ||
    !value.id.trim() ||
    !text(value.name) ||
    !text(value.description) ||
    !['cycling', 'hiking'].includes(value.activity as string) ||
    !['gpx', 'openrouteservice', 'mapbox', 'manual', 'mixed'].includes(value.source as string) ||
    !Array.isArray(value.segments) ||
    !Array.from(value.segments).every(
      (segment) => Array.isArray(segment) && Array.from(segment).every(coordinate),
    ) ||
    !Array.isArray(value.waypoints) ||
    !validTimestamp(value.createdAt) ||
    !validTimestamp(value.updatedAt) ||
    (value.departureLocal !== undefined && !validDepartureLocal(value.departureLocal)) ||
    (value.routingOptions !== undefined && !validRoutingOptions(value.routingOptions)) ||
    (value.routingInputKey !== undefined && !text(value.routingInputKey)) ||
    (value.elevationSource !== undefined && value.elevationSource !== 'openrouteservice') ||
    (value.directSegments !== undefined &&
      (!Array.isArray(value.directSegments) ||
        !Array.from(value.directSegments).every(
          (segment) =>
            Array.isArray(segment) && segment.length >= 2 && Array.from(segment).every(coordinate),
        ))) ||
    (value.favorite !== undefined && typeof value.favorite !== 'boolean') ||
    (value.tags !== undefined &&
      (!Array.isArray(value.tags) || !Array.from(value.tags).every(text)))
  )
    throw new Error('Invalid route data.');
  const ids = new Set<string>();
  for (const waypoint of value.waypoints) {
    if (
      !record(waypoint) ||
      !text(waypoint.id) ||
      !waypoint.id.trim() ||
      ids.has(waypoint.id) ||
      !text(waypoint.name) ||
      !coordinate(waypoint.coordinate) ||
      !validLegMode(waypoint.legMode) ||
      (waypoint.pauseMinutes !== undefined && !validPauseMinutes(waypoint.pauseMinutes))
    )
      throw new Error('Invalid route waypoint.');
    ids.add(waypoint.id);
  }
  const stats = value.stats;
  if (
    !record(stats) ||
    !nonnegative(stats.distance) ||
    !nonnegative(stats.duration) ||
    [stats.ascent, stats.descent].some((n) => n !== undefined && !nonnegative(n)) ||
    (value.elevationSource !== undefined &&
      (!nonnegative(stats.ascent) ||
        !nonnegative(stats.descent) ||
        !value.segments.some((segment) => segment.length >= 2) ||
        value.segments.some((segment) => segment.some((point: number[]) => point.length !== 3)) ||
        (Array.isArray(value.directSegments) && value.directSegments.length > 0)))
  )
    throw new Error('Invalid route statistics.');
}

export function withRouteDefaults(route: PlannedRoute): PlannedRoute {
  return { ...route, favorite: route.favorite ?? false, tags: route.tags ?? [] };
}
