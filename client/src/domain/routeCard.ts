import type { Activity, Coordinate } from './types';

export type RouteCardFormat = 'post' | 'story' | 'square';
export type RouteCardTemplate = 'minimal' | 'adventure' | 'elevation';
export type RouteCardAccent = 'green' | 'blue' | 'orange';
export type RouteCardTheme = 'light' | 'dark';

export function getRouteCardDimensions(format: RouteCardFormat): { width: number; height: number } {
  return { width: 1080, height: format === 'story' ? 1920 : format === 'square' ? 1080 : 1350 };
}
export interface RouteCardRequest {
  segments: Coordinate[][];
  format: RouteCardFormat;
  theme: RouteCardTheme;
  template?: RouteCardTemplate;
  accent?: RouteCardAccent;
  elevationProfileLabel?: string;
  privacyRadius: number;
  title: string;
  activity: Activity;
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

function drawCenteredText(context: Context, text: string, x: number, centerY: number): void {
  const baseline = context.textBaseline;
  context.textBaseline = 'alphabetic';
  const metrics = context.measureText(text);
  const y = centerY + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
  context.fillText(text, x, y);
  context.textBaseline = baseline;
}

const ACCENTS = {
  green: { light: '#1f6846', dark: '#9de4b5', deep: '#173b30', soft: '#bdd3a5' },
  blue: { light: '#245f9e', dark: '#9ecfff', deep: '#193754', soft: '#b5d4ee' },
  orange: { light: '#a34719', dark: '#ffc18c', deep: '#4a2d20', soft: '#edc5a0' },
} satisfies Record<RouteCardAccent, { light: string; dark: string; deep: string; soft: string }>;
type AccentPalette = (typeof ACCENTS)[RouteCardAccent];

function drawBrand(
  context: Context,
  ink: string,
  dark: boolean,
  palette: AccentPalette,
  y: number,
): void {
  const x = 72,
    scale = 56 / 192;
  const point = (px: number, py: number): RouteCardPoint => [x + px * scale, y + py * scale];
  context.save();
  context.beginPath();
  context.roundRect(x, y, 56, 56, 14);
  context.fillStyle = dark ? palette.soft : palette.deep;
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
  context.fillStyle = dark ? palette.deep : '#faf7f2';
  context.fill();
  context.beginPath();
  context.arc(...point(125, 49), 17 * scale, 0, TAU);
  context.fillStyle = dark ? (palette === ACCENTS.green ? '#52745d' : palette.light) : palette.soft;
  context.fill();
  context.restore();
  context.fillStyle = ink;
  context.font = '600 36px sans-serif';
  drawCenteredText(context, 'Roamlet', 144, y + 28);
}

function drawBackground(
  context: Context,
  height: number,
  dark: boolean,
  palette: AccentPalette,
  template: RouteCardTemplate,
): void {
  if (template !== 'adventure') {
    context.fillStyle = dark ? '#10251e' : '#faf7f2';
    context.fillRect(0, 0, 1080, height);
    return;
  }
  const gradient = context.createLinearGradient(0, 0, 1080, height);
  gradient.addColorStop(0, dark ? palette.deep : '#faf7f2');
  gradient.addColorStop(0.5, dark ? '#10251e' : '#edf2e7');
  gradient.addColorStop(1, dark ? '#213b2c' : palette === ACCENTS.green ? '#dbe7d0' : palette.soft);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1080, height);
  const glow = context.createRadialGradient(880, height * 0.48, 0, 880, height * 0.48, 760);
  glow.addColorStop(0, palette.soft + (dark ? '1a' : '38'));
  glow.addColorStop(1, palette.soft + '00');
  context.fillStyle = glow;
  context.fillRect(0, 0, 1080, height);
  // Decorative waves are fixed-work artwork, unrelated to coordinates or real terrain.
  context.strokeStyle = dark ? palette.soft + '14' : palette.deep + '10';
  context.lineWidth = 1.5;
  for (let index = 0; index < 18; index++) {
    const y = (height * (index + 0.5)) / 18;
    const bend = 36 * Math.sin(index * 0.48);
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(180, y - 88 + bend, 260, y + 104, 420, y + 24);
    context.bezierCurveTo(580, y - 56, 640, y - 100 - bend, 800, y - 20);
    context.bezierCurveTo(920, y + 44 + bend, 1000, y + 20, 1080, y - 48);
    context.stroke();
  }
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
function titleLines(context: Context, value: string, width: number, limit = 3): string[] {
  let remaining = safeText(value);
  const lines: string[] = [];
  while (remaining && lines.length < limit - 1) {
    if (context.measureText(remaining).width <= width) break;
    const fitted = fitText(context, remaining, width).slice(0, -1);
    const lastSpace = fitted.lastIndexOf(' ');
    const line = lastSpace > 0 ? fitted.slice(0, lastSpace) : fitted;
    if (!line) break;
    lines.push(line);
    remaining = remaining.slice(line.length).trimStart();
  }
  lines.push(fitText(context, remaining, width));
  return lines;
}

function drawActivityIcon(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  activity: Activity,
  x: number,
  y: number,
  color: string,
) {
  const scale = 32 / 24;
  const move = (px: number, py: number) => context.moveTo(x + px * scale, y + py * scale);
  const line = (px: number, py: number) => context.lineTo(x + px * scale, y + py * scale);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (activity === 'cycling') {
    for (const wheel of [5, 19]) {
      move(wheel + 4, 17);
      context.arc(x + wheel * scale, y + 17 * scale, 4 * scale, 0, TAU);
    }
    move(5, 17);
    line(10, 9);
    line(14, 17);
    line(5, 17);
    move(10, 9);
    line(17, 9);
    line(19, 17);
    move(17, 9);
    line(14, 17);
    move(16, 6);
    line(18, 6);
    line(19, 9);
    move(8, 7);
    line(12, 7);
    move(10, 7);
    line(10, 9);
  } else {
    context.arc(x + 13 * scale, y + 4 * scale, 2 * scale, 0, TAU);
    move(12, 8);
    line(10, 14);
    line(7, 21);
    move(10, 14);
    line(14, 17);
    line(13, 22);
    move(12, 8);
    line(16, 11);
    line(19, 10);
    move(19, 9);
    line(17, 22);
    move(10, 8);
    line(8, 12);
    line(10, 14);
  }
  context.stroke();
  context.restore();
}

/** Only original visible heights are plotted; privacy-cut vertices retain their missing height. */
export function projectRouteCardElevationProfile(
  visibleSegments: Coordinate[][],
  bounds: RouteCardBounds,
): RouteCardPoint[][] {
  let distance = 0,
    minimum = Infinity,
    maximum = -Infinity;
  const runs: { distance: number; elevation: number }[][] = [];
  for (const segment of visibleSegments) {
    let run: { distance: number; elevation: number }[] = [];
    const flush = () => {
      if (run.length) runs.push(run);
      run = [];
    };
    for (let index = 0; index < segment.length; index++) {
      const point = segment[index];
      if (index) distance += arc(segment[index - 1], point).length * EARTH_RADIUS;
      if (point.length !== 3 || !Number.isFinite(point[2])) {
        flush();
        continue;
      }
      minimum = Math.min(minimum, point[2]);
      maximum = Math.max(maximum, point[2]);
      run.push({ distance, elevation: point[2] });
    }
    flush();
  }
  if (!runs.some((run) => run.length > 1 && run.at(-1)!.distance > run[0].distance)) return [];
  const range = maximum - minimum;
  if (!Number.isFinite(range) || !Number.isFinite(distance)) return [];
  return runs.map((run) => {
    const stride = Math.max(1, Math.ceil(run.length / 400));
    return run
      .filter((_, index) => index === 0 || index === run.length - 1 || index % stride === 0)
      .map((sample): RouteCardPoint => [
        bounds.x + (sample.distance / distance) * bounds.width,
        bounds.y + (range ? 1 - (sample.elevation - minimum) / range : 0.5) * bounds.height,
      ]);
  });
}

export async function renderRouteCard(
  request: RouteCardRequest,
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Blob> {
  const geometry = clipRouteCardGeometry(request.segments, request.privacyRadius);
  try {
    const template = request.template === undefined ? 'adventure' : request.template;
    const accent = request.accent === undefined ? 'green' : request.accent;
    if (
      (request.template !== undefined &&
        !['minimal', 'adventure', 'elevation'].includes(template)) ||
      (request.accent !== undefined && !['green', 'blue', 'orange'].includes(accent)) ||
      (request.elevationProfileLabel !== undefined &&
        typeof request.elevationProfileLabel !== 'string') ||
      (template === 'elevation' &&
        request.segments.some((segment) => segment.some((point) => point.length !== 3))) ||
      (request.format !== 'post' && request.format !== 'story' && request.format !== 'square') ||
      (request.theme !== 'light' && request.theme !== 'dark') ||
      typeof request.title !== 'string' ||
      (request.activity !== 'cycling' && request.activity !== 'hiking') ||
      typeof request.activityLabel !== 'string' ||
      typeof request.plannedLabel !== 'string' ||
      !Array.isArray(request.metrics) ||
      request.metrics.length > 6 ||
      request.metrics.some(
        (metric) => !metric || typeof metric.label !== 'string' || typeof metric.value !== 'string',
      )
    )
      throw new Error(RENDER_ERROR);
    const { width, height } = getRouteCardDimensions(request.format);
    canvas.width = width;
    canvas.height = height;
    const topInset = request.format === 'story' ? 250 : 76;
    const bottomInset = request.format === 'story' ? 250 : 72;
    const headerOffset = topInset - 76;
    const compact = request.format === 'square' || template !== 'adventure';
    const context = canvas.getContext('2d');
    if (!context) throw new Error(RENDER_ERROR);
    const dark = request.theme === 'dark';
    const ink = dark ? '#f4f7ef' : '#183c2c';
    const muted = dark ? '#adc5b6' : '#597264';
    const palette = ACCENTS[accent];
    const routeColor = dark ? palette.dark : palette.light;
    drawBackground(context, height, dark, palette, template);
    context.textBaseline = 'top';
    context.textAlign = 'left';
    drawBrand(context, ink, dark, palette, topInset);
    context.font = '600 20px sans-serif';
    const planned = fitText(context, safeText(request.plannedLabel), 408);
    const badgeWidth = Math.min(440, context.measureText(planned).width + 32);
    const badgeX = 1008 - badgeWidth;
    if (template !== 'minimal') {
      context.fillStyle = dark ? palette.soft + '1c' : palette.deep + '10';
      context.beginPath();
      context.roundRect(badgeX, 86 + headerOffset, badgeWidth, 36, 18);
      context.fill();
    }
    context.fillStyle = routeColor;
    drawCenteredText(context, planned, badgeX + 16, 104 + headerOffset);
    context.fillStyle = ink;
    const titleStep = compact ? 56 : 76;
    context.font = compact ? '700 44px sans-serif' : '800 64px sans-serif';
    const lines = titleLines(context, request.title, 936, compact ? 2 : 3);
    lines.forEach((line, index) =>
      context.fillText(line, 72, 176 + headerOffset + index * titleStep),
    );
    const activityTop = 192 + headerOffset + lines.length * titleStep;
    context.fillStyle = muted;
    context.font = '500 30px sans-serif';
    drawActivityIcon(context, request.activity, 72, activityTop, muted);
    const activity = titleLines(context, request.activityLabel, 892, 2);
    activity.forEach((line, index) =>
      drawCenteredText(context, line, 116, activityTop + 16 + index * 40),
    );
    const columns = request.metrics.length === 4 ? 2 : Math.min(3, request.metrics.length);
    const rows = columns ? Math.ceil(request.metrics.length / columns) : 0;
    const metricPaddingX = 40;
    const metricPaddingY = compact ? 16 : 36;
    const metricRowHeight = compact ? 112 : 128;
    const panelHeight = rows ? metricPaddingY * 2 + rows * metricRowHeight : 0;
    const footerTop = height - bottomInset - panelHeight;
    const profileHeight = template === 'elevation' ? 170 : 0;
    const profileTop = footerTop - profileHeight - 24;
    const routeTop = activityTop + activity.length * 40 + (compact ? 24 : 52);
    const routeBottom =
      template === 'elevation' ? profileTop - 32 : footerTop - (compact ? 32 : 66);
    const routeBounds = { x: 104, y: routeTop, width: 872, height: routeBottom - routeTop };
    if (routeBounds.height <= 0) throw new Error(RENDER_ERROR);
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
      // Both passes share the privacy union clip; casing stays within its eight-pixel padding.
      context.strokeStyle = dark ? '#10251e' : '#faf7f2';
      context.lineWidth = template === 'minimal' ? 10 : 14;
      context.stroke();
      context.strokeStyle = routeColor;
      context.lineWidth = template === 'minimal' ? 7 : 11;
      context.stroke();
    }
    // Privacy cards deliberately have no endpoint markers.
    if (request.privacyRadius === 0) {
      const endpoints = [points[0]?.[0], points.at(-1)?.at(-1)];
      for (const [index, point] of endpoints.entries()) {
        if (!point) continue;
        context.beginPath();
        context.arc(...point, 12, 0, TAU);
        context.fillStyle = index === 0 ? routeColor : '#faf7f2';
        context.fill();
        context.strokeStyle = index === 0 ? '#faf7f2' : routeColor;
        context.lineWidth = 3;
        context.stroke();
        if (index === 1) {
          context.beginPath();
          context.arc(...point, 4, 0, TAU);
          context.fillStyle = routeColor;
          context.fill();
        }
      }
    }
    context.restore();
    if (template === 'elevation') {
      const profileBounds = { x: 104, y: profileTop + 50, width: 872, height: 104 };
      const profile = projectRouteCardElevationProfile(geometry, profileBounds);
      if (!profile.length) throw new Error(RENDER_ERROR);
      context.fillStyle = muted;
      context.font = '600 24px sans-serif';
      context.fillText(
        fitText(context, safeText(request.elevationProfileLabel ?? 'Elevation profile'), 936),
        72,
        profileTop,
      );
      context.strokeStyle = palette.soft;
      context.lineWidth = 1;
      for (const fraction of [0, 0.5, 1]) {
        context.beginPath();
        const y = profileBounds.y + fraction * profileBounds.height;
        context.moveTo(profileBounds.x, y);
        context.lineTo(profileBounds.x + profileBounds.width, y);
        context.stroke();
      }
      context.strokeStyle = routeColor;
      context.lineWidth = 4;
      for (const segment of profile) {
        if (segment.length < 2) continue;
        context.beginPath();
        segment.forEach((point, index) => {
          if (index) context.lineTo(...point);
          else context.moveTo(...point);
        });
        context.stroke();
      }
    }
    if (rows && template !== 'minimal') {
      context.fillStyle = dark ? palette.deep : '#faf7f2';
      context.beginPath();
      context.roundRect(72, footerTop, 936, panelHeight, 28);
      context.fill();
      context.strokeStyle = dark ? '#adc5b624' : '#5972641f';
      context.lineWidth = 1;
      context.stroke();
    }
    context.textAlign = 'center';
    request.metrics.forEach((metric, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const rowColumns = Math.min(columns, request.metrics.length - row * columns);
      const cellWidth = 936 / rowColumns;
      const cellLeft = 72 + column * cellWidth;
      const metricWidth = cellWidth - metricPaddingX * 2;
      const x = cellLeft + cellWidth / 2;
      const y = footerTop + metricPaddingY + row * metricRowHeight;
      if (column > 0) {
        context.strokeStyle = dark ? '#adc5b62e' : '#59726433';
        context.lineWidth = 1.5;
        context.lineCap = 'butt';
        context.beginPath();
        context.moveTo(cellLeft, y + 4);
        context.lineTo(cellLeft, y + 108);
        context.stroke();
      }
      context.fillStyle = muted;
      context.font = '500 22px sans-serif';
      const labels = titleLines(context, metric.label, metricWidth, 2);
      const labelHeight = labels.length * 28;
      const groupHeight = labelHeight + 16 + 48;
      const groupTop = y + (metricRowHeight - groupHeight) / 2;
      labels.forEach((line, lineIndex) =>
        drawCenteredText(context, line, x, groupTop + 14 + lineIndex * 28),
      );
      context.fillStyle = ink;
      context.font = '700 44px sans-serif';
      const value = safeText(metric.value);
      const valueSize = Math.max(
        32,
        Math.min(
          44,
          Math.floor((44 * metricWidth) / Math.max(1, context.measureText(value).width)),
        ),
      );
      context.font = `700 ${valueSize}px sans-serif`;
      drawCenteredText(
        context,
        fitText(context, value, metricWidth),
        x,
        groupTop + labelHeight + 16 + 24,
      );
    });
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
