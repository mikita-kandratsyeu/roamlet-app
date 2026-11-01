import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RouteCardRequest } from '../domain/routeCard';
import { renderRouteCard } from '../domain/routeCard';
import { generateRouteCard } from './routeCard';

vi.mock('../domain/routeCard', () => ({ renderRouteCard: vi.fn() }));
const request: RouteCardRequest = {
  segments: [
    [
      [10, 50],
      [11, 51],
    ],
  ],
  title: 'Route',
  format: 'post',
  theme: 'light',
  privacyRadius: 0,
  activity: 'hiking',
  activityLabel: 'Hiking',
  plannedLabel: 'Planned route',
  metrics: [],
};
const blob = new Blob(['png'], { type: 'image/png' });
class FakeWorker {
  static instances: FakeWorker[] = [];
  static fail = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(
    public url: URL,
    public options: WorkerOptions,
  ) {
    if (FakeWorker.fail) throw new Error('Worker unavailable');
    FakeWorker.instances.push(this);
  }
  respond(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}
const latest = () => FakeWorker.instances[FakeWorker.instances.length - 1];
beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  FakeWorker.fail = false;
  vi.stubGlobal('Worker', FakeWorker);
  vi.mocked(renderRouteCard).mockReset().mockResolvedValue(blob);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('sends geometry to a module worker and releases it after receiving the PNG', async () => {
  const operation = generateRouteCard(request, new AbortController().signal);
  const worker = latest();
  expect(worker.url.pathname).toMatch(/routeCard.worker.ts$/);
  expect(worker.options).toEqual({ type: 'module' });
  expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith(request);
  worker.respond({ status: 'success', blob });
  expect(await operation).toBe(blob);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.onmessage).toBeNull();
  expect(renderRouteCard).not.toHaveBeenCalled();
});

it.each([
  null,
  {},
  { status: 'success', blob: 'not a blob' },
  { status: 'success', blob: new Blob([]) },
])('rejects malformed response %j', async (data) => {
  const operation = generateRouteCard(request, new AbortController().signal);
  latest().respond(data);
  await expect(operation).rejects.toThrow('Could not generate');
  expect(latest().terminate).toHaveBeenCalledOnce();
});

it('returns domain errors, cleans up, and allows retry', async () => {
  const operation = generateRouteCard(request, new AbortController().signal);
  latest().respond({
    status: 'error',
    message: 'No route remains visible. Reduce the privacy radius.',
  });
  await expect(operation).rejects.toThrow('No route remains visible');
  const retry = generateRouteCard(request, new AbortController().signal);
  latest().respond({ status: 'success', blob });
  expect(await retry).toBe(blob);
});

it.each(['unsupported', 'missing', 'construction'] as const)(
  'uses a yielded compatibility renderer for %s support',
  async (kind) => {
    if (kind === 'missing') vi.stubGlobal('Worker', undefined);
    if (kind === 'construction') FakeWorker.fail = true;
    const operation = generateRouteCard(request, new AbortController().signal);
    if (kind === 'unsupported') {
      latest().respond({ status: 'unsupported' });
      expect(latest().terminate).toHaveBeenCalledOnce();
    }
    expect(renderRouteCard).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await operation).toBe(blob);
    const canvas = vi.mocked(renderRouteCard).mock.calls[0][1];
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  },
);

it('cancels before compatibility work and does not create a worker for an aborted signal', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(generateRouteCard(request, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(FakeWorker.instances).toHaveLength(0);
  vi.stubGlobal('Worker', undefined);
  const other = new AbortController();
  const operation = generateRouteCard(request, other.signal);
  other.abort();
  await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(1);
  expect(renderRouteCard).not.toHaveBeenCalled();
});

it('cancels the worker and ignores late messages', async () => {
  const controller = new AbortController();
  const operation = generateRouteCard(request, controller.signal);
  const worker = latest();
  const stale = worker.onmessage;
  controller.abort();
  stale?.(new MessageEvent('message', { data: { status: 'success', blob } }));
  await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it.each(['error', 'messageerror', 'timeout'] as const)(
  'handles %s and releases resources',
  async (kind) => {
    const operation = generateRouteCard(request, new AbortController().signal);
    const rejected = expect(operation).rejects.toThrow('Could not generate');
    const worker = latest();
    if (kind === 'error') worker.onerror?.(new ErrorEvent('error', { cancelable: true }));
    if (kind === 'messageerror') worker.onmessageerror?.();
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  },
);
