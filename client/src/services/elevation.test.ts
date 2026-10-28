import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Coordinate } from '../domain/types';
import { terrainRgbHeight, terrainTilePosition } from './elevation';

let addTerrainElevation: typeof import('./elevation').addTerrainElevation;
let pixels: Uint8ClampedArray;
let close: ReturnType<typeof vi.fn>;
let bitmap: ReturnType<typeof vi.fn>;
let fetcher: MockInstance<typeof fetch>;

function coordinateAt(x: number, y = 2048, u = 0, v = 0): [number, number] {
  return [
    ((x + u) / 4096) * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v)) / 4096))) * 180) / Math.PI,
  ];
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'pk.test-only-not-a-real-token');
  ({ addTerrainElevation } = await import('./elevation'));
  pixels = new Uint8ClampedArray(256 * 256 * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels.set([1, 138, 136, 255], index); // 100 metres.
  }
  close = vi.fn();
  bitmap = vi.fn().mockResolvedValue({ width: 256, height: 256, close });
  vi.stubGlobal('createImageBitmap', bitmap);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: pixels })),
  } as unknown as CanvasRenderingContext2D);
  fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(new Blob(['png'], { type: 'image/png' }), {
        headers: { 'Content-Type': 'image/png' },
      }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Terrain-RGB mapping', () => {
  it('uses the exact RGB formula, including zero and negative heights', () => {
    expect(terrainRgbHeight(0, 0, 0)).toBe(-10000);
    expect(terrainRgbHeight(1, 134, 160)).toBe(0);
    expect(terrainRgbHeight(1, 138, 136)).toBe(100);
    expect(terrainRgbHeight(255, 255, 255)).toBeCloseTo(1667721.5);
  });
  it('maps the equator and exact tile boundaries to the next tile', () => {
    expect(terrainTilePosition(0, 0)).toEqual({ x: 2048, y: 2048, u: 0, v: 0 });
    expect(terrainTilePosition(360 / 4096, 0)).toMatchObject({ x: 2049, u: 0 });
    const position = terrainTilePosition(...coordinateAt(2048, 2048, 0.5, 0.5));
    expect(position).toMatchObject({ x: 2048, y: 2048 });
    expect(position.u).toBeCloseTo(0.5);
    expect(position.v).toBeCloseTo(0.5);
  });
  it('wraps longitude and clamps both poles without out-of-range tiles', () => {
    expect(terrainTilePosition(180, 0)).toEqual(terrainTilePosition(-180, 0));
    expect(terrainTilePosition(540, 0)).toEqual(terrainTilePosition(-180, 0));
    expect(terrainTilePosition(-540, 0)).toEqual(terrainTilePosition(-180, 0));
    expect(terrainTilePosition(0, 90).y).toBe(0);
    const south = terrainTilePosition(0, -90);
    expect(south.y).toBe(4095);
    expect(south.v).toBeLessThan(1);
  });
});

describe('addTerrainElevation', () => {
  it('samples containing pixels, keeps all geometry and requests unique Mapbox tiles directly', async () => {
    pixels.set([1, 134, 160, 255], (128 * 256 + 128) * 4);
    const middle = coordinateAt(2048, 2048, 0.501, 0.501);
    const original: Coordinate[] = [[0, 0], middle, [360, 0], [180, -90]];
    const snapshot = structuredClone(original);
    expect(await addTerrainElevation(original)).toEqual([
      [0, 0, 100],
      [...middle, 0],
      [360, 0, 100],
      [180, -90, 100],
    ]);
    expect(original).toEqual(snapshot);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.mapbox.com/v4/mapbox.terrain-rgb/12/2048/2048.pngraw?access_token=pk.test-only-not-a-real-token',
      'https://api.mapbox.com/v4/mapbox.terrain-rgb/12/0/4095.pngraw?access_token=pk.test-only-not-a-real-token',
    ]);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
    expect(bitmap).toHaveBeenCalledWith(expect.any(Blob), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('uses only the public browser token, trims it and encodes query characters', async () => {
    vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', ' pk.test&other=value#fragment ');
    vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'sk.server-test-only-not-a-real-token');
    expect(await addTerrainElevation([[0, 0]])).toEqual([[0, 0, 100]]);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin).toBe('https://api.mapbox.com');
    expect(url.pathname).toBe('/v4/mapbox.terrain-rgb/12/2048/2048.pngraw');
    expect([...url.searchParams]).toEqual([['access_token', 'pk.test&other=value#fragment']]);
    expect(url.hash).toBe('');
    expect(url.toString()).not.toContain('sk.server');
    expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
  });
  it.each([undefined, '', ' ', 'sk.secret-test-only', 'invalid'])(
    'returns entirely 2D without network requests for invalid public token %s',
    async (token) => {
      vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', token);
      vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'pk.server-test-only-not-a-real-token');
      expect(
        await addTerrainElevation([
          [0, 0, 25],
          [0, 0],
        ]),
      ).toEqual([
        [0, 0],
        [0, 0],
      ]);
      expect(fetcher).not.toHaveBeenCalled();
      expect(bitmap).not.toHaveBeenCalled();
    },
  );
  it('does not serve cached elevations when public configuration becomes unavailable', async () => {
    await addTerrainElevation([[0, 0]]);
    vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', '');
    expect(await addTerrainElevation([[0, 0]])).toEqual([[0, 0]]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    await expect(addTerrainElevation([[0, 0]], controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('returns fresh coordinates on cache hits without mutating the cached tile', async () => {
    const original: Coordinate[] = [
      [0, 0],
      [0, 0],
    ];
    const first = await addTerrainElevation(original);
    first[0][0] = 99;
    first[0][2] = 500;
    expect(await addTerrainElevation(original)).toEqual([
      [0, 0, 100],
      [0, 0, 100],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(bitmap).toHaveBeenCalledTimes(1);
    expect(original).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
  it('retains only complete finite 3D input, cloning it without network requests', async () => {
    const complete: Coordinate[] = [
      [0, 0, 42],
      [1, 1, -2],
    ];
    const result = await addTerrainElevation(complete);
    expect(result).toEqual(complete);
    expect(result[0]).not.toBe(complete[0]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await addTerrainElevation([
        [0, 0, 42],
        [0, 0, NaN],
      ]),
    ).toEqual([
      [0, 0, 100],
      [0, 0, 100],
    ]);
  });
  it.each([404, 429, 500])('drops all partial input heights on tile failure %s', async (status) => {
    fetcher.mockResolvedValueOnce(new Response('{}', { status }));
    const input: Coordinate[] = [
      [0, 0, 600],
      [0, 0],
    ];
    expect(await addTerrainElevation(input)).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(input[0]).toEqual([0, 0, 600]);
    expect(bitmap).not.toHaveBeenCalled();
    expect(await addTerrainElevation([[0, 0]])).toEqual([[0, 0, 100]]);
    expect(fetcher).toHaveBeenCalledTimes(2); // Failures are not cached.
  });
  it('never returns a partially elevated route when one of several tiles is missing (water)', async () => {
    fetcher.mockImplementation(async (url) =>
      String(url).includes('/2049/')
        ? new Response('{"error":{"code":"TERRAIN_NOT_FOUND"}}', { status: 404 })
        : new Response(new Blob(['png'])),
    );
    const input: Coordinate[] = [[0, 0, 400], coordinateAt(2049)];
    expect(await addTerrainElevation(input)).toEqual(input.map(([lon, lat]) => [lon, lat]));
  });
  it('accepts legitimate black RGB and rejects transparent no-data samples', async () => {
    pixels.set([0, 0, 0, 255], 0);
    expect(await addTerrainElevation([[0, 0]])).toEqual([[0, 0, -10000]]);
    pixels.set([0, 0, 0, 0], 0);
    expect(await addTerrainElevation([coordinateAt(2049)])).toEqual([coordinateAt(2049)]);
  });
  it('returns 2D for fetch and decode failures and closes invalid bitmaps', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('Offline'));
    expect(
      await addTerrainElevation([
        [0, 0, 1],
        [0, 0],
      ]),
    ).toEqual([
      [0, 0],
      [0, 0],
    ]);
    bitmap.mockRejectedValueOnce(new Error('Corrupt PNG'));
    expect(await addTerrainElevation([[0, 0]])).toEqual([[0, 0]]);
    bitmap.mockResolvedValueOnce({ width: 1024, height: 1024, close });
    expect(await addTerrainElevation([[0, 0]])).toEqual([[0, 0]]);
    expect(close).toHaveBeenCalledOnce();
  });
  it('rejects oversized PNGs before decoding', async () => {
    const response = new Response();
    vi.spyOn(response, 'blob').mockResolvedValue(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]));
    fetcher.mockResolvedValue(response);
    expect(await addTerrainElevation([[0, 0]])).toEqual([[0, 0]]);
    expect(bitmap).not.toHaveBeenCalled();
  });
  it('handles empty and invalid geometry without requests', async () => {
    expect(await addTerrainElevation([])).toEqual([]);
    expect(await addTerrainElevation([[NaN, 0, 1]])).toEqual([[NaN, 0]]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not request tiles when the route exceeds the 64-tile budget', async () => {
    const route = Array.from({ length: 65 }, (_, i) => coordinateAt(2048 + i));
    expect(await addTerrainElevation(route)).toEqual(route);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds concurrent requests to four and allows exactly 64 tiles', async () => {
    let active = 0;
    let maximum = 0;
    fetcher.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return new Response(new Blob(['png']));
    });
    const route = Array.from({ length: 64 }, (_, i) => coordinateAt(2048 + i));
    expect((await addTerrainElevation(route)).every((point) => point[2] === 100)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(64);
    expect(maximum).toBe(4);
  });
  it('uses an LRU decoded cache bounded to 32 tiles', async () => {
    for (let i = 0; i < 32; i++) await addTerrainElevation([coordinateAt(2048 + i)]);
    await addTerrainElevation([coordinateAt(2048)]); // Refresh the oldest tile.
    await addTerrainElevation([coordinateAt(2080)]);
    await addTerrainElevation([coordinateAt(2048)]);
    expect(fetcher).toHaveBeenCalledTimes(33);
    await addTerrainElevation([coordinateAt(2049)]);
    expect(fetcher).toHaveBeenCalledTimes(34);
  });
  it('propagates AbortError for already aborted signals, even with complete 3D input', async () => {
    const controller = new AbortController();
    controller.abort('custom reason');
    await expect(addTerrainElevation([[0, 0, 1]], controller.signal)).rejects.toBeInstanceOf(
      DOMException,
    );
    await expect(addTerrainElevation([], controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('propagates in-flight abort even if the fetch implementation ignores cancellation', async () => {
    fetcher.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const result = addTerrainElevation([[0, 0]], controller.signal);
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(new Error('cancelled'));
    await rejection;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('times out at 10 seconds, returns 2D and never caches a late decoded tile', async () => {
    vi.useFakeTimers();
    let resolveBitmap!: (image: unknown) => void;
    bitmap.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBitmap = resolve;
        }),
    );
    const route: Coordinate[] = [
      [0, 0, 3],
      [0, 0],
    ];
    const result = addTerrainElevation(route);
    await vi.advanceTimersByTimeAsync(9999);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual([
      [0, 0],
      [0, 0],
    ]);
    resolveBitmap({ width: 256, height: 256, close });
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledOnce();
    expect(await addTerrainElevation([[0, 0]])).toEqual([[0, 0, 100]]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('propagates cancellation during bitmap decoding and releases late bitmaps', async () => {
    vi.useFakeTimers();
    let resolveBitmap!: (image: unknown) => void;
    bitmap.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBitmap = resolve;
        }),
    );
    const controller = new AbortController();
    const result = addTerrainElevation([[0, 0]], controller.signal);
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejection;
    resolveBitmap({ width: 256, height: 256, close });
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses the actual pixel dimensions of a 512-pixel tile', async () => {
    pixels = new Uint8ClampedArray(512 * 512 * 4);
    pixels.set([1, 138, 136, 255], (256 * 512 + 256) * 4);
    bitmap.mockResolvedValue({ width: 512, height: 512, close });
    const point = coordinateAt(2048, 2048, 0.501, 0.501);
    expect(await addTerrainElevation([point])).toEqual([[...point, 100]]);
  });
  it('fails safely when canvas decoding is unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(await addTerrainElevation([[0, 0]])).toEqual([[0, 0]]);
    expect(close).toHaveBeenCalledOnce();
  });
  it('times out an unresponsive fetch', async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation(() => new Promise(() => {}));
    const result = addTerrainElevation([[0, 0]]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toEqual([[0, 0]]);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it.each(['error', 'abort'])('revokes fallback blob URLs after %s', async (outcome) => {
    vi.useFakeTimers();
    vi.stubGlobal('createImageBitmap', undefined);
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:terrain-test');
        static revokeObjectURL = revoke;
      },
    );
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (
      this: HTMLImageElement,
      value,
    ) {
      if (value && outcome === 'error') queueMicrotask(() => this.onerror?.(new Event('error')));
    });
    const controller = new AbortController();
    const result = addTerrainElevation([[0, 0]], controller.signal);
    if (outcome === 'abort') {
      const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await rejection;
    } else {
      expect(await result).toEqual([[0, 0]]);
    }
    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:terrain-test');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('decodes with an Image fallback and revokes its blob URL', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:terrain-test');
        static revokeObjectURL = revoke;
      },
    );
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(256);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(256);
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (
      this: HTMLImageElement,
      value,
    ) {
      if (value) queueMicrotask(() => this.onload?.(new Event('load')));
    });
    expect(await addTerrainElevation([[0, 0]])).toEqual([[0, 0, 100]]);
    expect(revoke).toHaveBeenCalledWith('blob:terrain-test');
    expect(bitmap).not.toHaveBeenCalled();
  });
});
