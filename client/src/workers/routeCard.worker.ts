import { renderRouteCard } from '../domain/routeCard';
import type { RouteCardRequest, RouteCardResponse } from './routeCard.protocol';

export async function runRouteCard(request: RouteCardRequest): Promise<RouteCardResponse> {
  if (typeof OffscreenCanvas === 'undefined') return { status: 'unsupported' };
  try {
    const canvas = new OffscreenCanvas(1080, request.format === 'story' ? 1920 : 1350);
    return { status: 'success', blob: await renderRouteCard(request, canvas) };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error &&
        (error.message === 'No route geometry is available.' ||
          error.message === 'No route remains visible. Reduce the privacy radius.')
          ? error.message
          : 'Could not generate the image. Please try again.',
    };
  }
}

if (typeof document === 'undefined' && typeof self !== 'undefined') {
  self.addEventListener('message', (event: MessageEvent<RouteCardRequest>) => {
    void runRouteCard(event.data).then((response) => {
      try {
        self.postMessage(response);
      } catch {
        self.postMessage({
          status: 'error',
          message: 'Could not generate the image. Please try again.',
        });
      }
    });
  });
}
