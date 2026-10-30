import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import type { PlannedRoute } from '../domain/types';
import { importGpxFile } from './gpxImport';

const route: PlannedRoute = {
  id: 'imported',
  name: 'Route',
  description: '',
  activity: 'hiking',
  source: 'gpx',
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
  segments: [[[10, 50, 100]], [], [[11, 51]]],
  waypoints: [{ id: 'waypoint', name: 'Stop', coordinate: [12, 52, 120] }],
  stats: { distance: 0, duration: 0 },
};

class FakeWorker {
  static instances: FakeWorker[] = [];
  static constructionError = false;
  static onConstruct: (() => void) | undefined;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(
    public url: URL,
    public options: WorkerOptions,
  ) {
    if (FakeWorker.constructionError) throw new Error('Internal construction error');
    FakeWorker.instances.push(this);
    FakeWorker.onConstruct?.();
  }

  respond(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

const latest = () => FakeWorker.instances[FakeWorker.instances.length - 1];
const file = new File(['<gpx/>'], 'route.gpx');
const failure = 'Something went wrong. Please try again.';

function expectCleaned(worker: FakeWorker) {
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
}

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.constructionError = false;
  FakeWorker.onConstruct = undefined;
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe('GPX worker import boundary', () => {
  it('sends the File untouched to a module worker and preserves the returned route', async () => {
    const text = vi.fn(() => Promise.reject(new Error('Do not read on UI thread')));
    Object.defineProperty(file, 'text', { value: text, configurable: true });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const result = importGpxFile(file, controller.signal);
    const worker = latest();
    expect(worker.url.pathname).toMatch(/\/workers\/gpxImport.worker.ts$/);
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ file, language: 'en' });
    worker.respond({ status: 'success', route });
    expect(await result).toBe(route);
    expect(text).not.toHaveBeenCalled();
    expectCleaned(worker);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    expectCleaned(worker);
  });

  it('snapshots active Russian locale without translating supplied names', async () => {
    await i18n.changeLanguage('ru');
    const result = importGpxFile(file);
    expect(latest().postMessage).toHaveBeenCalledWith({ file, language: 'ru' });
    await i18n.changeLanguage('en');
    latest().respond({ status: 'success', route });
    expect((await result).name).toBe('Route');
  });

  it.each([
    null,
    {},
    { status: 'success' },
    { status: 'success', route: {} },
    { status: 'success', route: { ...route, stats: { distance: NaN, duration: 0 } } },
    { status: 'success', route: { ...route, source: 'manual' } },
    {
      status: 'success',
      route: { ...route, stats: { distance: 0, duration: 0, ascent: Infinity } },
    },
    { status: 'error', message: '' },
    { status: 'error', message: 42 },
  ])('rejects malformed responses and cleans up: %j', async (response) => {
    const result = importGpxFile(file);
    latest().respond(response);
    await expect(result).rejects.toThrow(failure);
    expectCleaned(latest());
  });

  it('preserves domain validation errors as untranslated Error messages', async () => {
    const result = importGpxFile(file);
    latest().respond({ status: 'error', message: 'Invalid GPX elevation.' });
    await expect(result).rejects.toThrow('Invalid GPX elevation.');
    expectCleaned(latest());
  });

  it('handles a worker error without exposing internal paths or stack traces', async () => {
    const result = importGpxFile(file);
    const event = new ErrorEvent('error', { message: '/internal/worker/path', cancelable: true });
    latest().onerror?.(event);
    await expect(result).rejects.toThrow(failure);
    expect(event.defaultPrevented).toBe(true);
    expectCleaned(latest());
  });

  it('handles message deserialization errors', async () => {
    const result = importGpxFile(file);
    latest().onmessageerror?.();
    await expect(result).rejects.toThrow(failure);
    expectCleaned(latest());
  });

  it('rejects pre-aborted signals without creating a worker', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(importGpxFile(file, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('terminates when aborted during worker construction without posting a request', async () => {
    const controller = new AbortController();
    FakeWorker.onConstruct = () => controller.abort();
    const result = importGpxFile(file, controller.signal);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(latest().postMessage).not.toHaveBeenCalled();
    expectCleaned(latest());
  });

  it('ignores stale completion/error callbacks after abort while a retry succeeds', async () => {
    const controller = new AbortController();
    const result = importGpxFile(file, controller.signal);
    const oldWorker = latest();
    const staleMessage = oldWorker.onmessage;
    const staleError = oldWorker.onerror;
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expectCleaned(oldWorker);
    const retry = importGpxFile(file);
    const retryWorker = latest();
    staleMessage?.(new MessageEvent('message', { data: { status: 'success', route } }));
    staleError?.(new ErrorEvent('error'));
    retryWorker.respond({ status: 'success', route });
    expect(await retry).toBe(route);
    expectCleaned(oldWorker);
    expectCleaned(retryWorker);
  });

  it('ignores stale errors after successful completion', async () => {
    const result = importGpxFile(file);
    const worker = latest();
    const staleMessage = worker.onmessage;
    const staleError = worker.onerror;
    worker.respond({ status: 'success', route });
    staleMessage?.(
      new MessageEvent('message', { data: { status: 'error', message: 'late error' } }),
    );
    staleError?.(new ErrorEvent('error'));
    expect(await result).toBe(route);
    expectCleaned(worker);
  });

  it('allows retry after worker construction fails and removes the abort listener', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    FakeWorker.constructionError = true;
    await expect(importGpxFile(file, controller.signal)).rejects.toThrow(failure);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    FakeWorker.constructionError = false;
    const retry = importGpxFile(file);
    latest().respond({ status: 'success', route });
    expect(await retry).toBe(route);
    expectCleaned(latest());
  });

  it('handles postMessage failures and allows retry', async () => {
    FakeWorker.onConstruct = () =>
      latest().postMessage.mockImplementation(() => {
        throw new Error('DataCloneError');
      });
    await expect(importGpxFile(file)).rejects.toThrow(failure);
    expectCleaned(latest());
    FakeWorker.onConstruct = undefined;
    const retry = importGpxFile(file);
    latest().respond({ status: 'success', route });
    expect(await retry).toBe(route);
    expectCleaned(latest());
  });

  it('fails without Worker support rather than parsing synchronously', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(importGpxFile(file)).rejects.toThrow(failure);
    expect(FakeWorker.instances).toHaveLength(0);
  });
});
