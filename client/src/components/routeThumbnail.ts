import type { Coordinate } from '../domain/types';

/** Local-only SVG paths; each GPX segment stays separate, with bounded samples per path. */
export function thumbnailPaths(segments: Coordinate[][]): string[] {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const segment of segments)
    for (const [x, y] of segment) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  if (!Number.isFinite(minX)) return [];
  const scale = 56 / Math.max(maxX - minX, maxY - minY, 0.000001);
  const centerX = (minX + maxX) / 2,
    centerY = (minY + maxY) / 2;
  return segments
    .filter((segment) => segment.length)
    .map((segment) => {
      const count = Math.min(segment.length, 200);
      return Array.from({ length: count }, (_, i) => {
        const point =
          segment[count === 1 ? 0 : Math.round((i * (segment.length - 1)) / (count - 1))];
        const x = (32 + (point[0] - centerX) * scale).toFixed(2);
        const y = (32 - (point[1] - centerY) * scale).toFixed(2);
        return `${i ? 'L' : 'M'}${x},${y}${count === 1 ? ` l0.01,0` : ''}`;
      }).join(' ');
    });
}
