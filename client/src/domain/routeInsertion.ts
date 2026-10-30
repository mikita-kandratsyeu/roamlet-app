import type { Coordinate, Waypoint } from './types';

interface Position {
  coordinate: Coordinate;
  distance: number;
  along: number;
  segment: number;
  edge: number;
}
function nearest(coordinate: Coordinate, segments: Coordinate[][], minimum = 0): Position | null {
  let best: Position | null = null;
  let along = 0;
  const latitude = segments.find((segment) => segment.length)?.[0][1] ?? coordinate[1];
  const scale = Math.cos((latitude * Math.PI) / 180);
  for (const [segment, points] of segments.entries()) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      const dx = (b[0] - a[0]) * scale,
        dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      const fraction = length
        ? Math.max(
            0,
            Math.min(
              1,
              ((coordinate[0] - a[0]) * scale * dx + (coordinate[1] - a[1]) * dy) /
                (length * length),
            ),
          )
        : 0;
      const position = along + fraction * length;
      const projected: Coordinate = [
        a[0] + fraction * (b[0] - a[0]),
        a[1] + fraction * (b[1] - a[1]),
      ];
      if (a.length === 3 && b.length === 3) projected.push(a[2]! + fraction * (b[2]! - a[2]!));
      const distance = Math.hypot(
        (coordinate[0] - projected[0]) * scale,
        coordinate[1] - projected[1],
      );
      if (position >= minimum - 1e-10 && (!best || distance < best.distance))
        best = { coordinate: projected, distance, along: position, segment, edge: i };
      along += length;
    }
  }
  return best;
}

/** Include the routed bends of a selected leg without joining disconnected geometry. */
export function routeSectionSegments(
  segments: Coordinate[][], waypoints: Waypoint[], index: number,
): Coordinate[][] {
  if (!Number.isInteger(index) || index < 0 || index >= waypoints.length - 1) return [];
  let start = nearest(waypoints[0].coordinate, segments);
  if (!start) return [];
  for (let stop = 0; stop < index; stop++) {
    start = nearest(waypoints[stop + 1].coordinate, segments, start.along);
    if (!start) return [];
  }
  const end = nearest(waypoints[index + 1].coordinate, segments, start.along);
  if (!end || end.along <= start.along) return [];
  const section: Coordinate[][] = [];
  for (let part = start.segment; part <= end.segment; part++) {
    const coordinates = segments[part];
    const first = part === start.segment ? start.edge : 0;
    const last = part === end.segment ? end.edge : coordinates.length;
    const clipped = [
      ...(part === start.segment ? [start.coordinate] : []),
      ...coordinates.slice(first, last),
      ...(part === end.segment ? [end.coordinate] : []),
    ];
    if (clipped.length >= 2) section.push(clipped);
  }
  return section;
}

/** Match stops in route order, not by proximity to pins on hairpins or crossing routes. */
export function routeInsertion(
  coordinate: Coordinate,
  segments: Coordinate[][],
  waypoints: Waypoint[],
): { coordinate: Coordinate; index: number } | null {
  if (waypoints.length < 2) return null;
  const clicked = nearest(coordinate, segments);
  if (!clicked) return null;
  let previous = nearest(waypoints[0].coordinate, segments);
  if (!previous) return null;
  for (let index = 1; index < waypoints.length; index++) {
    const next = nearest(waypoints[index].coordinate, segments, previous.along);
    if (!next) return null;
    if (
      clicked.along > previous.along + 1e-10 &&
      clicked.along < next.along - 1e-10 &&
      clicked.segment === previous.segment &&
      clicked.segment === next.segment
    ) {
      return { coordinate: clicked.coordinate, index };
    }
    previous = next;
  }
  return null;
}
