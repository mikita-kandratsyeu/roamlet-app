import type { Coordinate } from './types';

export type RouteCardFormat = 'post' | 'story';
export type RouteCardTheme = 'light' | 'dark';
export interface RouteCardRequest {
  segments: Coordinate[][];
  format: RouteCardFormat;
  theme: RouteCardTheme;
  privacyRadius: number;
  title: string;
  activityLabel: string;
  plannedLabel: string;
  metrics: { label: string; value: string }[];
}

const NO_GEOMETRY = 'No route geometry is available.';
const NO_VISIBLE = 'No route remains visible. Reduce the privacy radius.';
const RENDER_ERROR = 'Could not generate the image. Please try again.';
const EARTH_RADIUS = 6_371_008.8;
const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
type Vector = [number, number, number];
export type RouteCardPoint = [number, number];
export interface RouteCardBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function vector(point: Coordinate): Vector {
  const lat = point[1] * RAD;
  const lon = point[0] * RAD;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}
function arc(a: Coordinate, b: Coordinate) {
  const start = vector(a);
  const finish = vector(b);
  const cosine = Math.max(-1, Math.min(1, dot(start, finish)));
  const residual: Vector = [
    finish[0] - cosine * start[0],
    finish[1] - cosine * start[1],
    finish[2] - cosine * start[2],
  ];
  const sine = Math.hypot(...residual);
  const length = Math.atan2(sine, cosine);
  // Antipodal endpoints have no unique short arc; choose a stable meridian.
  const axis: Vector = Math.abs(start[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const alignment = dot(start, axis);
  const fallback: Vector = [
    axis[0] - alignment * start[0],
    axis[1] - alignment * start[1],
    axis[2] - alignment * start[2],
  ];
  const norm = Math.hypot(...fallback);
  const tangent: Vector =
    sine > 1e-15
      ? [residual[0] / sine, residual[1] / sine, residual[2] / sine]
      : [fallback[0] / norm, fallback[1] / norm, fallback[2] / norm];
  const at = (angle: number): Vector => [
    start[0] * Math.cos(angle) + tangent[0] * Math.sin(angle),
    start[1] * Math.cos(angle) + tangent[1] * Math.sin(angle),
    start[2] * Math.cos(angle) + tangent[2] * Math.sin(angle),
  ];
  const coordinate = (angle: number): Coordinate => {
    if (angle === 0) return [...a];
    if (angle === length) return [...b];
    const point = at(angle);
    return [
      Math.atan2(point[1], point[0]) / RAD,
      Math.atan2(point[2], Math.hypot(point[0], point[1])) / RAD,
    ];
  };
  return { start, tangent, length, at, coordinate };
}

/** Clip every short great-circle edge, including later endpoint revisits and sparse crossings. */
export function clipRouteCardGeometry(
  segments: Coordinate[][],
  privacyRadius: number,
): Coordinate[][] {
  if (!Number.isFinite(privacyRadius) || privacyRadius < 0 || privacyRadius > 10_000)
    throw new Error(RENDER_ERROR);
  if (!Array.isArray(segments)) throw new Error(NO_GEOMETRY);
  let start: Coordinate | undefined;
  let finish: Coordinate | undefined;
  let count = 0;
  for (const segment of segments) {
    if (!Array.isArray(segment)) throw new Error(NO_GEOMETRY);
    for (const point of segment) {
      if (
        !Array.isArray(point) ||
        (point.length !== 2 && point.length !== 3) ||
        !Array.from(point).every(Number.isFinite) ||
        Math.abs(point[0]) > 180 ||
        Math.abs(point[1]) > 90 ||
        ++count > 1_000_000
      )
        throw new Error(NO_GEOMETRY);
      start ??= point;
      finish = point;
    }
  }
  if (!start || !finish) throw new Error(NO_GEOMETRY);
  if (privacyRadius === 0) {
    const drawable = segments.some((segment) =>
      segment.some((point, index) => index > 0 && arc(segment[index - 1], point).length >= 1e-15),
    );
    if (!drawable) throw new Error(NO_VISIBLE);
    return segments
      .filter((segment) => segment.length > 1)
      .map((segment) => segment.map((point): Coordinate => [...point]));
  }
  const centers = [vector(start), vector(finish)];
  const radius = privacyRadius / EARTH_RADIUS;
  const threshold = Math.cos(radius);
  const sineRadius = Math.sin(radius);
  const output: Coordinate[][] = [];
  let drawable = false;
  for (const segment of segments) {
    let current: Coordinate[] = [];
    const flush = () => {
      if (current.length > 1) output.push(current);
      current = [];
    };
    for (let index = 1; index < segment.length; index++) {
      const edge = arc(segment[index - 1], segment[index]);
      if (edge.length < 1e-15) continue;
      const cuts = [0, edge.length];
      if (privacyRadius > 0) {
        for (const center of centers) {
          const a = dot(center, edge.start);
          const b = dot(center, edge.tangent);
          const normal: Vector = [
            edge.start[1] * edge.tangent[2] - edge.start[2] * edge.tangent[1],
            edge.start[2] * edge.tangent[0] - edge.start[0] * edge.tangent[2],
            edge.start[0] * edge.tangent[1] - edge.start[1] * edge.tangent[0],
          ];
          const crossTrack = dot(center, normal);
          if (Math.abs(crossTrack) > sineRadius) continue;
          const phase = Math.atan2(b, a);
          // atan2 avoids cancellation for sub-metre privacy radii.
          const offset = Math.atan2(
            Math.sqrt(Math.max(0, sineRadius ** 2 - crossTrack ** 2)),
            threshold,
          );
          for (const root of [phase - offset, phase + offset]) {
            for (let turn = -1; turn <= 1; turn++) {
              const angle = root + turn * TAU;
              if (angle > 0 && angle < edge.length) cuts.push(angle);
            }
          }
        }
      }
      cuts.sort((a, b) => a - b);
      for (let part = 1; part < cuts.length; part++) {
        const left = cuts[part - 1];
        const right = cuts[part];
        if (right - left < 1e-15) continue;
        const midpoint = edge.at((left + right) / 2);
        if (
          centers.some((center) => {
            const cross: Vector = [
              center[1] * midpoint[2] - center[2] * midpoint[1],
              center[2] * midpoint[0] - center[0] * midpoint[2],
              center[0] * midpoint[1] - center[1] * midpoint[0],
            ];
            return Math.atan2(Math.hypot(...cross), dot(center, midpoint)) < radius;
          })
        ) {
          flush();
          continue;
        }
        if (!current.length) current.push(edge.coordinate(left));
        current.push(edge.coordinate(right));
        drawable = true;
      }
    }
    flush();
  }
  if (!drawable) throw new Error(NO_VISIBLE);
  return output;
}

function* projectedCoordinates(segment: Coordinate[]): Generator<Coordinate> {
  if (segment.length) yield segment[0];
  for (let index = 1; index < segment.length; index++) {
    const edge = arc(segment[index - 1], segment[index]);
    // Bounded subdivision follows sparse geodesic arcs instead of drawing a misleading chord.
    const steps = Math.min(256, Math.max(1, Math.ceil(edge.length / RAD)));
    for (let step = 1; step < steps; step++) yield edge.coordinate((edge.length * step) / steps);
    yield segment[index];
  }
}

function projectGeometry(segments: Coordinate[][], bounds: RouteCardBounds) {
  const projected: RouteCardPoint[][] = [];
  let anchor: number | undefined;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const segment of segments) {
    let previous = anchor;
    const points: RouteCardPoint[] = [];
    for (const point of projectedCoordinates(segment)) {
      anchor ??= point[0];
      previous ??= anchor;
      const delta = ((((point[0] - previous + 180) % 360) + 360) % 360) - 180;
      const x = previous + delta;
      previous = x;
      const y = -point[1];
      points.push([x, y]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (points.length) projected.push(points);
  }
  if (!Number.isFinite(minX)) throw new Error(NO_VISIBLE);
  const longitudeScale = Math.max(1e-12, Math.cos(((minY + maxY) / 2) * RAD));
  const width = (maxX - minX) * longitudeScale,
    height = maxY - minY;
  const scale = Math.min(bounds.width / (width || 1e-12), bounds.height / (height || 1e-12));
  const left = bounds.x + (bounds.width - width * scale) / 2;
  const top = bounds.y + (bounds.height - height * scale) / 2;
  const project = (longitude: number, latitude: number): RouteCardPoint => [
    left + (longitude - minX) * longitudeScale * scale,
    top + (-latitude - minY) * scale,
  ];
  return {
    points: projected.map((segment) => segment.map(([x, y]) => project(x, -y))),
    project,
    minLongitude: minX,
    maxLongitude: maxX,
    minLatitude: -maxY,
    maxLatitude: -minY,
    horizontalScale: longitudeScale * scale,
  };
}

/** Local equirectangular projection preserves polar geometry and unwraps each segment's dateline. */
export function projectRouteCardGeometry(
  segments: Coordinate[][],
  bounds: RouteCardBounds,
): RouteCardPoint[][] {
  return segments.some((segment) => segment.length) ? projectGeometry(segments, bounds).points : [];
}

/** Conservative spherical-cap envelopes, expanded by eight pixels for stroke/AA safety. */
export function projectRouteCardDrawing(
  segments: Coordinate[][],
  originalSegments: Coordinate[][],
  privacyRadius: number,
  bounds: RouteCardBounds,
): { points: RouteCardPoint[][]; privacyAreas: RouteCardBounds[] } {
  const projection = projectGeometry(segments, bounds);
  const privacyAreas: RouteCardBounds[] = [];
  if (privacyRadius === 0) return { points: projection.points, privacyAreas };
  if (
    !Number.isFinite(privacyRadius) ||
    privacyRadius < 0 ||
    privacyRadius > 10_000 ||
    projection.minLatitude <= -85 ||
    projection.maxLatitude >= 85 ||
    projection.maxLongitude - projection.minLongitude > 360
  )
    throw new Error(RENDER_ERROR);
  let start: Coordinate | undefined, finish: Coordinate | undefined;
  for (const segment of originalSegments) {
    for (let index = 0; index < segment.length; index++) {
      const point = segment[index];
      if (
        Math.abs(point[1]) >= 85 ||
        (index > 0 && dot(vector(segment[index - 1]), vector(point)) < -1 + 1e-12)
      )
        throw new Error(RENDER_ERROR);
      start ??= point;
      finish = point;
    }
  }
  if (!start || !finish) throw new Error(NO_GEOMETRY);
  const angle = (privacyRadius + 1e-6) / EARTH_RADIUS;
  const latitudeDelta = angle / RAD;
  const padding = 8;
  for (const center of [start, finish]) {
    if (Math.abs(center[1]) + latitudeDelta >= 85) throw new Error(RENDER_ERROR);
    const longitudeDelta = Math.asin(Math.sin(angle) / Math.cos(center[1] * RAD)) / RAD;
    const paddingLongitude = padding / projection.horizontalScale;
    const firstCopy = Math.ceil(
      (projection.minLongitude - longitudeDelta - paddingLongitude - center[0]) / 360,
    );
    const lastCopy = Math.floor(
      (projection.maxLongitude + longitudeDelta + paddingLongitude - center[0]) / 360,
    );
    if (lastCopy - firstCopy > 3) throw new Error(RENDER_ERROR);
    for (let copy = firstCopy; copy <= lastCopy; copy++) {
      const longitude = center[0] + copy * 360;
      const [left, top] = projection.project(longitude - longitudeDelta, center[1] + latitudeDelta);
      const [right, bottom] = projection.project(
        longitude + longitudeDelta,
        center[1] - latitudeDelta,
      );
      const x = Math.floor(left - padding),
        y = Math.floor(top - padding);
      privacyAreas.push({
        x,
        y,
        width: Math.ceil(right + padding) - x,
        height: Math.ceil(bottom + padding) - y,
      });
    }
  }
  return { points: projection.points, privacyAreas };
}

function hasVisibleDrawing(points: RouteCardPoint[][], exclusions: RouteCardBounds[]): boolean {
  for (const segment of points) {
    for (let index = 1; index < segment.length; index++) {
      const a = segment[index - 1],
        b = segment[index];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const cuts = [0, 1];
      for (const area of exclusions) {
        for (const [axis, boundary] of [
          [0, area.x],
          [0, area.x + area.width],
          [1, area.y],
          [1, area.y + area.height],
        ]) {
          const delta = b[axis] - a[axis];
          if (!delta) continue;
          const fraction = (boundary - a[axis]) / delta;
          if (fraction > 0 && fraction < 1) cuts.push(fraction);
        }
      }
      cuts.sort((left, right) => left - right);
      for (let cut = 1; cut < cuts.length; cut++) {
        if (cuts[cut] === cuts[cut - 1]) continue;
        const fraction = (cuts[cut] + cuts[cut - 1]) / 2;
        const x = a[0] + (b[0] - a[0]) * fraction,
          y = a[1] + (b[1] - a[1]) * fraction;
        if (
          !exclusions.some(
            (area) =>
              x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height,
          )
        )
          return true;
      }
    }
  }
  return false;
}

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawBrand(context: Context, height: number, ink: string): void {
  const x = 72,
    y = height - 126,
    scale = 72 / 192;
  const point = (px: number, py: number): RouteCardPoint => [x + px * scale, y + py * scale];
  context.save();
  context.beginPath();
  context.roundRect(x, y, 72, 72, 18);
  context.fillStyle = '#173b30';
  context.fill();
  context.clip();
  context.beginPath();
  context.moveTo(...point(38, 56));
  context.bezierCurveTo(...point(70, 58), ...point(126, 68), ...point(126, 92));
  context.bezierCurveTo(...point(126, 115), ...point(73, 116), ...point(73, 128));
  context.bezierCurveTo(...point(73, 144), ...point(136, 140), ...point(169, 188));
  context.lineTo(...point(178, 206));
  context.lineTo(...point(105, 206));
  context.bezierCurveTo(...point(102, 177), ...point(33, 163), ...point(33, 134));
  context.bezierCurveTo(...point(33, 108), ...point(98, 104), ...point(98, 89));
  context.bezierCurveTo(...point(98, 75), ...point(29, 57), ...point(38, 56));
  context.closePath();
  context.fillStyle = '#faf7f2';
  context.fill();
  context.beginPath();
  context.arc(...point(125, 49), 17 * scale, 0, TAU);
  context.fillStyle = '#bdd3a5';
  context.fill();
  context.restore();
  context.fillStyle = ink;
  context.font = '700 42px sans-serif';
  context.fillText('Roamlet', 164, y + 15);
}
function safeText(value: string): string {
  return value
    .slice(0, 1024)
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function fitText(context: Context, text: string, width: number): string {
  const chars = Array.from(text);
  if (context.measureText(text).width <= width) return text;
  let low = 0,
    high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(chars.slice(0, middle).join('') + '…').width <= width) low = middle;
    else high = middle - 1;
  }
  return chars.slice(0, low).join('') + '…';
}
function titleLines(context: Context, value: string, width: number): string[] {
  const words = safeText(value).split(' ');
  const lines: string[] = [];
  let line = '';
  for (let index = 0; index < words.length; index++) {
    const next = line ? `${line} ${words[index]}` : words[index];
    if (line && context.measureText(next).width > width) {
      lines.push(fitText(context, line, width));
      line = words[index];
      if (lines.length === 2) {
        const remaining = words.slice(index).join(' ');
        lines.push(fitText(context, remaining, width));
        return lines;
      }
    } else line = next;
  }
  lines.push(fitText(context, line, width));
  return lines;
}

export async function renderRouteCard(
  request: RouteCardRequest,
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Blob> {
  const geometry = clipRouteCardGeometry(request.segments, request.privacyRadius);
  try {
    if (
      (request.format !== 'post' && request.format !== 'story') ||
      (request.theme !== 'light' && request.theme !== 'dark') ||
      typeof request.title !== 'string' ||
      typeof request.activityLabel !== 'string' ||
      typeof request.plannedLabel !== 'string' ||
      !Array.isArray(request.metrics) ||
      request.metrics.length > 6 ||
      request.metrics.some(
        (metric) => !metric || typeof metric.label !== 'string' || typeof metric.value !== 'string',
      )
    )
      throw new Error(RENDER_ERROR);
    const height = request.format === 'story' ? 1920 : 1350;
    canvas.width = 1080;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(RENDER_ERROR);
    const dark = request.theme === 'dark';
    const background = dark ? '#10251e' : '#f4f7ef';
    const ink = dark ? '#f4f7ef' : '#183c2c';
    const muted = dark ? '#adc5b6' : '#597264';
    const green = dark ? '#86d5a3' : '#287348';
    context.fillStyle = background;
    context.fillRect(0, 0, 1080, height);
    context.fillStyle = dark ? '#19382b' : '#e5eee0';
    context.beginPath();
    context.arc(1000, 80, 360, 0, TAU);
    context.fill();
    context.textBaseline = 'top';
    context.fillStyle = green;
    context.font = '600 26px sans-serif';
    context.fillText(fitText(context, safeText(request.plannedLabel), 936), 72, 72);
    context.fillStyle = ink;
    context.font = '700 64px sans-serif';
    const lines = titleLines(context, request.title, 936);
    lines.forEach((line, index) => context.fillText(line, 72, 126 + index * 76));
    const activityTop = 146 + lines.length * 76;
    context.fillStyle = muted;
    context.font = '500 30px sans-serif';
    context.fillText(fitText(context, safeText(request.activityLabel), 936), 72, activityTop);
    const footerTop = height - 360;
    const routeTop = activityTop + 100;
    const routeBounds = { x: 104, y: routeTop, width: 872, height: footerTop - routeTop - 66 };
    const { points, privacyAreas } = projectRouteCardDrawing(
      geometry,
      request.segments,
      request.privacyRadius,
      routeBounds,
    );
    if (request.privacyRadius > 0 && !hasVisibleDrawing(points, privacyAreas))
      throw new Error(NO_VISIBLE);
    const drawingBounds = {
      x: routeBounds.x - 32,
      y: routeBounds.y - 32,
      width: routeBounds.width + 64,
      height: routeBounds.height + 64,
    };
    context.save();
    context.beginPath();
    context.rect(drawingBounds.x, drawingBounds.y, drawingBounds.width, drawingBounds.height);
    context.clip();
    // Intersect complements separately: overlapping privacy areas remain a union, never XOR.
    for (const area of privacyAreas) {
      context.beginPath();
      context.rect(drawingBounds.x, drawingBounds.y, drawingBounds.width, drawingBounds.height);
      context.rect(area.x, area.y, area.width, area.height);
      context.clip('evenodd');
    }
    context.strokeStyle = green;
    context.lineWidth = 11;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const segment of points) {
      context.beginPath();
      let previous: RouteCardPoint | undefined;
      segment.forEach((point, index) => {
        if (!previous) context.moveTo(...point);
        else if (
          index === segment.length - 1 ||
          Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= 0.8
        )
          context.lineTo(...point);
        else return;
        previous = point;
      });
      context.stroke();
    }
    // Privacy cards deliberately have no endpoint markers.
    if (request.privacyRadius === 0) {
      for (const point of [points[0]?.[0], points.at(-1)?.at(-1)]) {
        if (!point) continue;
        context.beginPath();
        context.arc(...point, 12, 0, TAU);
        context.fillStyle = background;
        context.fill();
        context.stroke();
      }
    }
    context.restore();
    context.fillStyle = dark ? '#244333' : '#d4e1ce';
    context.fillRect(72, footerTop, 936, 2);
    request.metrics.forEach((metric, index) => {
      const columns = request.metrics.length > 3 ? 3 : Math.max(1, request.metrics.length);
      const width = 936 / columns;
      const x = 72 + (index % columns) * width;
      const y = footerTop + 34 + Math.floor(index / columns) * 100;
      context.fillStyle = muted;
      context.font = '400 22px sans-serif';
      context.fillText(fitText(context, safeText(metric.label), width - 24), x, y);
      context.fillStyle = ink;
      context.font = '600 36px sans-serif';
      context.fillText(fitText(context, safeText(metric.value), width - 24), x, y + 34);
    });
    drawBrand(context, height, ink);
    const blob =
      'convertToBlob' in canvas
        ? await canvas.convertToBlob({ type: 'image/png' })
        : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || !blob.size || blob.type !== 'image/png') throw new Error(RENDER_ERROR);
    return blob;
  } catch (error) {
    if (error instanceof Error && error.message === NO_VISIBLE) throw error;
    throw new Error(RENDER_ERROR);
  }
}
