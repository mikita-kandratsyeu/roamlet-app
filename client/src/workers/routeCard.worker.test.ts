import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteCardRequest } from './routeCard.protocol';
import { runRouteCard } from './routeCard.worker';

const request: RouteCardRequest = {
  segments: [
    [
      [0, 0],
      [0.03, 0],
    ],
  ],
  format: 'post',
  theme: 'light',
  privacyRadius: 500,
  title: 'Route',
  activityLabel: 'Hiking',
  plannedLabel: 'Planned route',
  metrics: [],
};
const png = new Blob(['png'], { type: 'image/png' });
function installCanvas() {
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    roundRect: vi.fn(),
    bezierCurveTo: vi.fn(),
    closePath: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fillText: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 16 }),
  };
  const convertToBlob = vi.fn().mockResolvedValue(png);
  const dimensions: number[][] = [];
  class Canvas {
    constructor(
      public width: number,
      public height: number,
    ) {
      dimensions.push([width, height]);
    }
    getContext() {
      return context;
    }
    convertToBlob = convertToBlob;
  }
  vi.stubGlobal('OffscreenCanvas', Canvas);
  return { context, convertToBlob, dimensions };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('route card worker', () => {
  it('reports unsupported without attempting main-thread work', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(await runRouteCard(request)).toEqual({ status: 'unsupported' });
  });
  it.each(['post', 'story'] as const)(
    'renders and posts a PNG Blob for %s without browser/network APIs',
    async (format) => {
      const { dimensions, convertToBlob } = installCanvas();
      vi.stubGlobal('document', undefined);
      vi.stubGlobal('window', undefined);
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error('Network forbidden');
        }),
      );
      expect(await runRouteCard({ ...request, format })).toEqual({ status: 'success', blob: png });
      expect(dimensions).toEqual([[1080, format === 'post' ? 1350 : 1920]]);
      expect(convertToBlob).toHaveBeenCalledExactlyOnceWith({ type: 'image/png' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('preserves actionable geometry errors', async () => {
    installCanvas();
    expect(await runRouteCard({ ...request, segments: [] })).toEqual({
      status: 'error',
      message: 'No route geometry is available.',
    });
    expect(await runRouteCard({ ...request, privacyRadius: 10_000 })).toEqual({
      status: 'error',
      message: 'No route remains visible. Reduce the privacy radius.',
    });
  });
  it('normalizes canvas allocation failure', async () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor() {
          throw new Error('GPU allocation failed');
        }
      },
    );
    expect(await runRouteCard(request)).toEqual({
      status: 'error',
      message: 'Could not generate the image. Please try again.',
    });
  });
  it('normalizes PNG encoding failure', async () => {
    const { convertToBlob } = installCanvas();
    convertToBlob.mockRejectedValue(new Error('GPU failure'));
    expect(await runRouteCard(request)).toEqual({
      status: 'error',
      message: 'Could not generate the image. Please try again.',
    });
  });
  it.each([false, true])(
    'registers messages and handles serialization failure: %s',
    async (failPost) => {
      installCanvas();
      const addEventListener =
        vi.fn<(type: string, listener: (event: MessageEvent<RouteCardRequest>) => void) => void>();
      const postMessage = vi.fn();
      if (failPost)
        postMessage.mockImplementationOnce(() => {
          throw new Error('DataCloneError');
        });
      vi.stubGlobal('document', undefined);
      vi.stubGlobal('self', { addEventListener, postMessage });
      await import('./routeCard.worker');
      expect(addEventListener).toHaveBeenCalledOnce();
      expect(addEventListener.mock.calls[0][0]).toBe('message');
      addEventListener.mock.calls[0][1](new MessageEvent('message', { data: request }));
      await vi.waitFor(() => {
        expect(postMessage).toHaveBeenCalledTimes(failPost ? 2 : 1);
        expect(postMessage).toHaveBeenLastCalledWith(
          failPost
            ? { status: 'error', message: 'Could not generate the image. Please try again.' }
            : { status: 'success', blob: png },
        );
      });
      expect(postMessage.mock.calls.every((call) => call.length === 1)).toBe(true);
    },
  );
});
