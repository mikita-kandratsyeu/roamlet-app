import type { Coordinate, PlannedRoute, Waypoint } from './types';

const RADIUS = 6_371_008.8;
const RAD = Math.PI / 180;
/** Routing providers may snap pins to roads. Beyond 100 m, timing is not trustworthy. */
export const WAYPOINT_MATCH_METRES = 100;
export const MAX_PAUSE_MINUTES = 10080;
export function validPauseMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_PAUSE_MINUTES;
}

/** A floating wall clock, not an instant: arithmetic deliberately ignores timezone and DST.
 * This preserves the entered calendar time when reopening on a different device/timezone.
 * UTC is only a calendar arithmetic surrogate, never the departure's timezone.
 */
function calendarTime(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}:00.000Z`);
  if (!Number.isFinite(time) || Number(value.slice(0, 4)) < 1) return null;
  return new Date(time).toISOString().slice(0, 16) === value ? time : null;
}
export function validDepartureLocal(value: unknown): value is string {
  return calendarTime(value) !== null;
}
export function addLocalSeconds(departure: string, seconds: number): string | null {
  const start = calendarTime(departure);
  if (start === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const date = new Date(start + Math.round(seconds * 1000));
  if (!Number.isFinite(date.getTime())) return null;
  const result = date.toISOString();
  return /^\d{4}-/.test(result) ? result.slice(0, 16) : null;
}
export function localDayOffset(departure: string, arrival: string): number {
  return (calendarTime(`${arrival.slice(0, 10)}T00:00`)! -
    calendarTime(`${departure.slice(0, 10)}T00:00`)!) / 86400000;
}

type Vector = [number, number, number];
const dot = (a: Vector, b: Vector) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vector) => Math.hypot(...a);
const angle = (a: Vector, b: Vector) => Math.atan2(length(cross(a, b)), dot(a, b));
function vector(coordinate: Coordinate): Vector {
  const lon = coordinate[0] * RAD, lat = coordinate[1] * RAD;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}
function validCoordinate(point: Coordinate): boolean {
  return Array.isArray(point) && (point.length === 2 || point.length === 3) &&
    point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
}
interface Edge { a: Vector; b: Vector; start: number; length: number; chain: number }
interface Match { along: number; chain: number; distance: number }
function geometry(segments: Coordinate[][]): { edges: Edge[]; total: number } | null {
  if (!Array.isArray(segments)) return null;
  const edges: Edge[] = [];
  let total = 0, chain = 0;
  let end: Vector | null = null;
  for (const segment of segments) {
    if (!Array.isArray(segment) || !segment.every(validCoordinate)) return null;
    // Isolated GPX samples do not connect either neighbouring usable segment.
    if (segment.length < 2) continue;
    const start = vector(segment[0]);
    if (end && angle(end, start) > 1e-12) chain++;
    for (let i = 1; i < segment.length; i++) {
      const a = vector(segment[i - 1]), b = vector(segment[i]);
      const arc = angle(a, b);
      if (arc >= Math.PI - 1e-8) return null; // Antipodal arcs have no unique projection.
      const metres = arc * RADIUS;
      if (metres > 0.001) edges.push({ a, b, start: total, length: metres, chain });
      total += metres;
    }
    end = vector(segment.at(-1)!);
  }
  return edges.length && Number.isFinite(total) && total > 0 ? { edges, total } : null;
}
function match(point: Coordinate, edges: Edge[], minimum: number): Match | null {
  if (!validCoordinate(point)) return null;
  const p = vector(point);
  let best: Match | null = null;
  for (const edge of edges) {
    if (edge.start + edge.length < minimum - 0.001) continue;
    const normal = cross(edge.a, edge.b);
    const normSquared = dot(normal, normal);
    const raw = p.map((n, i) => n - normal[i] * dot(p, normal) / normSquared) as Vector;
    const norm = length(raw);
    const candidates: { v: Vector; fraction: number }[] = [
      { v: edge.a, fraction: 0 }, { v: edge.b, fraction: 1 },
    ];
    if (norm > 1e-12) {
      const projected = raw.map((n) => n / norm) as Vector;
      const arc = edge.length / RADIUS;
      const fromStart = angle(edge.a, projected);
      if (Math.abs(fromStart + angle(projected, edge.b) - arc) < 1e-9)
        candidates.push({ v: projected, fraction: fromStart / arc });
    }
    for (const candidate of candidates) {
      const along = edge.start + candidate.fraction * edge.length;
      if (along < minimum - 0.001) continue;
      const distance = angle(p, candidate.v) * RADIUS;
      if (distance > WAYPOINT_MATCH_METRES) continue;
      // Equal-distance crossings use the earliest still-ordered position, not a later lap.
      if (!best || distance < best.distance - 0.001 ||
          (Math.abs(distance - best.distance) <= 0.001 && along < best.along))
        best = { along: Math.max(minimum, along), chain: edge.chain, distance };
    }
  }
  return best;
}

export type ScheduleUnavailable = 'departure' | 'moving-time' | 'geometry' | 'waypoints' |
  'unmatched-waypoint' | 'disconnected' | 'pause' | 'date-overflow';
export interface WaypointSchedule {
  waypoint: Waypoint;
  distanceMetres: number | null;
  arrivalLocal: string | null;
  departureLocal: string | null;
  dayOffset: number | null;
  unavailable: ScheduleUnavailable | null;
}
export interface RouteScheduleResult {
  rows: WaypointSchedule[];
  finishLocal: string | null;
  pauseMinutes: number;
  unavailable: ScheduleUnavailable | null;
}
/** Distribute the supplied moving-only estimate over actual spherical polyline distance.
 * Local grade/speed is not inferred. Pauses apply AFTER arrival (including the first/last).
 * Aggregate personal stopsMinutes is intentionally not accepted or added: schedule-only pauses
 * supersede it, while existing aggregate statistics/preferences remain unchanged.
 * A gap makes all later arrivals unavailable: distance alone cannot estimate gap travel time.
 */
export function estimateRouteSchedule(
  route: Pick<PlannedRoute, 'segments' | 'waypoints' | 'departureLocal'>,
  movingSeconds: number,
): RouteScheduleResult {
  const shape = geometry(route.segments);
  let minimum = 0;
  const matches = route.waypoints.map((waypoint, index) => {
    let position = shape ? match(waypoint.coordinate, shape.edges, minimum) : null;
    // A final pin at a closed route's finish means the end, not its identical start.
    const last = shape?.edges.at(-1);
    if (last && index === route.waypoints.length - 1 && index > 0 &&
        validCoordinate(waypoint.coordinate)) {
      const distance = angle(vector(waypoint.coordinate), last.b) * RADIUS;
      if (distance <= WAYPOINT_MATCH_METRES && (!position || distance <= position.distance + 0.001))
        position = { along: shape!.total, chain: last.chain, distance };
    }
    if (position) minimum = position.along;
    return position;
  });
  const ordered = matches.filter((position): position is Match => position !== null);
  let unavailable: ScheduleUnavailable | null = !validDepartureLocal(route.departureLocal)
    ? 'departure' : !Number.isFinite(movingSeconds) || movingSeconds < 0 ? 'moving-time'
      : !shape ? 'geometry'
        : ordered.length < 2 || ordered.at(-1)!.along - ordered[0].along <= 0.001 ? 'waypoints' : null;
  let pauses = 0;
  let blocked: ScheduleUnavailable | null = unavailable;
  const rows = route.waypoints.map((waypoint, index): WaypointSchedule => {
    const position = matches[index];
    const pause = waypoint.pauseMinutes ?? 0;
    if (!blocked && !position) blocked = 'unmatched-waypoint';
    if (!blocked && position!.chain !== 0) blocked = 'disconnected';
    if (!blocked && !validPauseMinutes(pause)) blocked = 'pause';
    const arrival = !blocked ? addLocalSeconds(route.departureLocal!,
      movingSeconds * position!.along / shape!.total + pauses * 60) : null;
    if (!blocked && !arrival) blocked = 'date-overflow';
    // Compute from the original departure to retain sub-minute travel time between stops.
    const exactDeparture = !blocked ? addLocalSeconds(route.departureLocal!,
      movingSeconds * position!.along / shape!.total + (pauses + pause) * 60) : null;
    if (!blocked && !exactDeparture) blocked = 'date-overflow';
    pauses += validPauseMinutes(pause) ? pause : 0;
    return { waypoint, distanceMetres: position?.along ?? null,
      arrivalLocal: arrival, departureLocal: exactDeparture,
      dayOffset: arrival ? localDayOffset(route.departureLocal!, arrival) : null,
      unavailable: blocked };
  });
  unavailable ??= blocked;
  // Even when pins precede a gap, a full-route finish cannot be estimated across it.
  if (!unavailable && shape!.edges.at(-1)!.chain !== 0) unavailable = 'disconnected';
  const finishLocal = !unavailable ? addLocalSeconds(route.departureLocal!, movingSeconds + pauses * 60) : null;
  if (!unavailable && !finishLocal) unavailable = 'date-overflow';
  return { rows, finishLocal, pauseMinutes: pauses, unavailable };
}
