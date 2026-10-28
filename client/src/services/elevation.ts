import type { Coordinate } from '../domain/types';

const ZOOM = 12;
const TILE_LIMIT = 64;
const CACHE_LIMIT = 32;
const TIMEOUT_MS = 10_000;
const MAX_LATITUDE = 85.0511287798066;
interface Tile {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}
const cache = new Map<string, Tile>();

export function terrainRgbHeight(red: number, green: number, blue: number): number {
  return -10_000 + (red * 65_536 + green * 256 + blue) * 0.1;
}

/** Fractional pixels are sampled at the containing pixel, including tile boundaries. */
export function terrainTilePosition(longitude: number, latitude: number) {
  const count = 2 ** ZOOM;
  const wrapped = ((longitude % 360) + 540) % 360 - 180;
  const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude)) * Math.PI / 180;
  const x = ((wrapped + 180) / 360) * count;
  const y = Math.max(0, Math.min(count - Number.EPSILON * count,
    (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * count));
  return { x: Math.floor(x), y: Math.floor(y), u: x - Math.floor(x), v: y - Math.floor(y) };
}

function abortError(): DOMException {
  return new DOMException('Terrain elevation request aborted.', 'AbortError');
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function decodePng(blob: Blob, signal: AbortSignal): Promise<Tile> {
  let image: ImageBitmap | HTMLImageElement;
  let release: () => void;
  if (typeof createImageBitmap === 'function') {
    image = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const bitmap = image;
    release = () => bitmap.close();
  } else {
    const url = URL.createObjectURL(blob);
    const element = new Image();
    release = () => {
      element.src = '';
      URL.revokeObjectURL(url);
    };
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          element.onload = null;
          element.onerror = null;
          signal.removeEventListener('abort', onAbort);
        };
        const onAbort = () => { cleanup(); reject(abortError()); };
        element.onload = () => { cleanup(); resolve(); };
        element.onerror = () => { cleanup(); reject(new Error('Invalid terrain PNG.')); };
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
        else element.src = url;
      });
      image = element;
    } catch (error) {
      release();
      throw error;
    }
  }
  try {
    checkAbort(signal);
    const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
    const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
    if (![256, 512].includes(width) || height !== width) throw new Error('Invalid terrain tile size.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Terrain decoding unavailable.');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    if (pixels.length !== width * height * 4) throw new Error('Invalid terrain pixels.');
    return { width, height, pixels };
  } finally {
    release();
  }
}

async function fetchTile(key: string, signal?: AbortSignal): Promise<Tile> {
  checkAbort(signal);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let rejectDeadline: (error: DOMException) => void = () => {};
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const onDeadline = () => rejectDeadline(abortError());
  controller.signal.addEventListener('abort', onDeadline, { once: true });
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const tile = await Promise.race([
      (async () => {
        const response = await fetch(`/api/terrain/${key}.pngraw`, {
          credentials: 'same-origin', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Terrain tile unavailable.');
        const blob = await response.blob();
        if (blob.size > 2 * 1024 * 1024) throw new Error('Terrain tile too large.');
        checkAbort(controller.signal);
        return decodePng(blob, controller.signal);
      })(),
      deadline,
    ]);
    checkAbort(controller.signal);
    cache.set(key, tile);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return tile;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    controller.signal.removeEventListener('abort', onDeadline);
  }
}

/**
 * Estimated metres from zoom-12 Terrain-RGB pixels, not surveyed route heights.
 * No smoothing/interpolation: sparse geometry can undercount ascent, noisy pixels can overcount.
 * Any missing tile (including ocean 404), transparent sample or failure yields entirely 2D geometry.
 * Complete finite input heights are retained; incomplete input heights are never mixed with terrain.
 */
export async function addTerrainElevation(
  coordinates: Coordinate[], signal?: AbortSignal,
): Promise<Coordinate[]> {
  checkAbort(signal);
  const geometry: Coordinate[] = coordinates.map(([lon, lat]) => [lon, lat]);
  if (!coordinates.length) return geometry;
  if (coordinates.some(([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat))) return geometry;
  if (coordinates.every(point => point.length === 3 && Number.isFinite(point[2]))) {
    return coordinates.map(point => [...point] as Coordinate);
  }
  const positions = coordinates.map(([lon, lat]) => terrainTilePosition(lon, lat));
  const keys = positions.map(({ x, y }) => `${ZOOM}/${x}/${y}`);
  const unique = [...new Set(keys)];
  if (unique.length > TILE_LIMIT) return geometry;
  const tiles = new Map<string, Tile>();
  let next = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
    while (!failed && next < unique.length) {
      checkAbort(signal);
      const key = unique[next++];
      try {
        tiles.set(key, await fetchTile(key, signal));
      } catch {
        checkAbort(signal);
        failed = true;
      }
    }
  }));
  checkAbort(signal);
  if (failed) return geometry;
  const elevated: Coordinate[] = [];
  for (let index = 0; index < coordinates.length; index++) {
    const tile = tiles.get(keys[index])!;
    const { u, v } = positions[index];
    const offset = (Math.floor(v * tile.height) * tile.width + Math.floor(u * tile.width)) * 4;
    if (tile.pixels[offset + 3] !== 255) return geometry;
    elevated.push([coordinates[index][0], coordinates[index][1], terrainRgbHeight(
      tile.pixels[offset], tile.pixels[offset + 1], tile.pixels[offset + 2],
    )]);
  }
  return elevated;
}
