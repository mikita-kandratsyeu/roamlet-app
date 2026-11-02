import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import workerSource from '../../public/sw.js?raw';
import { capturePwaInstallPrompt, usePwa } from './usePwa';

const channels: FakeChannel[] = [];
class FakeChannel {
  port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
  port2 = {
    postMessage: (data: unknown) => this.port1.onmessage?.({ data }),
    close: vi.fn(),
  };
  constructor() {
    channels.push(this);
  }
}
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function worker() {
  return Object.assign(new EventTarget(), {
    state: 'activated',
    postMessage: vi.fn((_data: unknown, ports: FakeChannel['port2'][]) => {
      ports[0].postMessage({ type: 'OFFLINE_STATUS', ready: true });
    }),
  });
}
function setup() {
  const active = worker();
  const registration = Object.assign(new EventTarget(), {
    active: active as ReturnType<typeof worker> | null,
    waiting: null as ReturnType<typeof worker> | null,
    installing: null as ReturnType<typeof worker> | null,
    update: vi.fn(async () => {}),
  });
  const workers = Object.assign(new EventTarget(), {
    controller: active,
    getRegistration: vi.fn(async () => registration as typeof registration | undefined),
    register: vi.fn(async () => registration),
  });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: workers });
  return { active, registration, workers };
}
let env: ReturnType<typeof setup>;
let media: EventTarget & { matches: boolean };
let storage: { persisted: ReturnType<typeof vi.fn>; persist: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.stubEnv('PROD', true);
  vi.stubGlobal('MessageChannel', FakeChannel);
  channels.length = 0;
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  storage = { persisted: vi.fn(async () => false), persist: vi.fn(async () => true) };
  Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: false });
  capturePwaInstallPrompt();
  window.dispatchEvent(new Event('appinstalled'));
  env = setup();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, 'standalone');
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'storage');
});
async function ready() {
  const hook = renderHook(usePwa);
  await waitFor(() => expect(hook.result.current.offlineStatus).toBe('ready'));
  return hook;
}
function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => window.dispatchEvent(event));
  return event;
}

it('verifies readiness through the active worker, not the controller, and probes storage passively', async () => {
  const { result } = await ready();
  expect(result.current.storageStatus).toBe('best-effort');
  expect(storage.persist).not.toHaveBeenCalled();
  expect(env.active.postMessage).toHaveBeenCalledWith({ type: 'OFFLINE_STATUS' }, [
    channels[0].port2,
  ]);
  expect(channels[0].port1.close).toHaveBeenCalledOnce();
  expect(channels[0].port2.close).toHaveBeenCalledOnce();
});
it.each([false, undefined])(
  'does not trust incomplete or legacy shell responses (%s)',
  async (value) => {
    env.active.postMessage.mockImplementation((_data, ports) =>
      ports[0].postMessage(value === undefined ? {} : { type: 'OFFLINE_STATUS', ready: value }),
    );
    const { result } = renderHook(usePwa);
    await waitFor(() => expect(result.current.offlineStatus).toBe('error'));
    env.active.postMessage.mockImplementation((_data, ports) =>
      ports[0].postMessage({ type: 'OFFLINE_STATUS', ready: true }),
    );
    await act(async () => result.current.retryOffline());
    expect(result.current.offlineStatus).toBe('ready');
    expect(env.registration.update).toHaveBeenCalledOnce();
  },
);
it('surfaces registration failure and retries a fresh registration', async () => {
  env.workers.getRegistration.mockResolvedValue(undefined);
  env.workers.register.mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(usePwa);
  await waitFor(() => expect(result.current.offlineStatus).toBe('error'));
  await act(async () => result.current.retryOffline());
  expect(result.current.offlineStatus).toBe('ready');
  expect(env.workers.register).toHaveBeenCalledTimes(2);
  expect(env.registration.update).not.toHaveBeenCalled();
});
it('reports lookup/update failures and allows recovery', async () => {
  env.workers.getRegistration.mockRejectedValueOnce(new Error('denied'));
  const { result } = renderHook(usePwa);
  await waitFor(() => expect(result.current.offlineStatus).toBe('error'));
  env.registration.update.mockRejectedValueOnce(new Error('update'));
  await act(async () => result.current.retryOffline());
  expect(result.current.offlineStatus).toBe('error');
  await act(async () => result.current.retryOffline());
  expect(result.current.offlineStatus).toBe('ready');
});
it.each(['message', 'lookup', 'register', 'update'] as const)(
  'bounds stalled %s and ignores late results',
  async (stage) => {
    vi.useFakeTimers();
    const stall = pending<typeof env.registration>();
    if (stage === 'message') env.active.postMessage.mockImplementation(() => {});
    if (stage === 'lookup') env.workers.getRegistration.mockReturnValueOnce(stall.promise);
    if (stage === 'register') {
      env.workers.getRegistration.mockResolvedValue(undefined);
      env.workers.register.mockReturnValueOnce(stall.promise);
    }
    const { result } = renderHook(usePwa);
    await act(async () => {});
    let operation: Promise<void> | undefined;
    if (stage === 'update') {
      env.registration.update.mockReturnValueOnce(new Promise(() => {}));
      act(() => {
        operation = result.current.retryOffline();
      });
    }
    expect(result.current.offlineStatus).toBe('checking');
    await act(async () => vi.advanceTimersByTimeAsync(stage === 'message' ? 3000 : 10000));
    await operation;
    expect(result.current.offlineStatus).toBe('error');
    await act(async () => stall.resolve(env.registration));
    expect(result.current.offlineStatus).toBe('error');
    expect(vi.getTimerCount()).toBe(0);
  },
);
it('keeps checking through first installation and rechecks activation', async () => {
  const installing = worker();
  installing.state = 'installing';
  env.registration.active = null;
  env.registration.installing = installing;
  const { result } = renderHook(usePwa);
  await waitFor(() => expect(env.workers.getRegistration).toHaveBeenCalled());
  expect(result.current.offlineStatus).toBe('checking');
  env.registration.active = installing;
  env.registration.installing = null;
  installing.state = 'activated';
  act(() => installing.dispatchEvent(new Event('statechange')));
  await waitFor(() => expect(result.current.offlineStatus).toBe('ready'));
});
it('detects waiting updates discovered later without activation or reload', async () => {
  const { result } = await ready();
  const next = worker();
  next.state = 'installing';
  env.registration.installing = next;
  act(() => env.registration.dispatchEvent(new Event('updatefound')));
  env.registration.waiting = next;
  next.state = 'installed';
  act(() => next.dispatchEvent(new Event('statechange')));
  expect(result.current.updateAvailable).toBe(true);
  await act(async () => result.current.retryOffline());
  expect(next.postMessage).not.toHaveBeenCalled();
  expect(result.current.offlineStatus).toBe('ready');
});
it.each(['development', 'unsupported'] as const)(
  'reports %s without registration',
  async (status) => {
    if (status === 'development') vi.stubEnv('PROD', false);
    else Reflect.deleteProperty(navigator, 'serviceWorker');
    const { result } = renderHook(usePwa);
    await waitFor(() => expect(result.current.offlineStatus).toBe(status));
    await act(async () => result.current.retryOffline());
    expect(env.workers.getRegistration).not.toHaveBeenCalled();
  },
);
it.each(['accepted', 'dismissed'] as const)(
  'captures install before mount and handles %s gracefully',
  async (outcome) => {
    const event = installEvent(outcome);
    const { result } = await ready();
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.installAvailable).toBe(true);
    await act(async () => result.current.install());
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(result.current.installAvailable).toBe(false);
    expect(result.current.installPending).toBe(false);
    expect(result.current.installError).toBe(false);
    expect(result.current.installed).toBe(false);
    await act(async () => result.current.install());
    expect(event.prompt).toHaveBeenCalledOnce();
  },
);
it('exposes install pending/error and recovers on another browser prompt', async () => {
  const { result } = await ready();
  const event = installEvent();
  const choice = pending<void>();
  event.prompt.mockReturnValueOnce(choice.promise);
  let operation!: Promise<void>;
  act(() => {
    operation = result.current.install();
  });
  expect(result.current.installPending).toBe(true);
  await act(async () => result.current.install());
  expect(event.prompt).toHaveBeenCalledOnce();
  await act(async () => {
    choice.reject(new Error('prompt'));
    await operation;
  });
  expect(result.current.installError).toBe(true);
  installEvent();
  await act(async () => result.current.install());
  expect(result.current.installError).toBe(false);
});
it('handles appinstalled and standalone changes', async () => {
  const { result } = await ready();
  installEvent();
  act(() => window.dispatchEvent(new Event('appinstalled')));
  expect(result.current.installed).toBe(true);
  expect(result.current.installAvailable).toBe(false);
  const other = await ready();
  media.matches = true;
  act(() => media.dispatchEvent(new Event('change')));
  expect(other.result.current.installed).toBe(true);
});
it('detects iOS standalone and existing persistent storage', async () => {
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  storage.persisted.mockResolvedValue(true);
  installEvent();
  const { result } = await ready();
  expect(result.current.installed).toBe(true);
  expect(result.current.installAvailable).toBe(false);
  expect(result.current.storageStatus).toBe('persistent');
});
it.each([true, false])(
  'requests persistence only explicitly and reports grant=%s',
  async (grant) => {
    storage.persist.mockResolvedValue(grant);
    const { result } = await ready();
    await act(async () => result.current.requestStorage());
    expect(storage.persist).toHaveBeenCalledOnce();
    expect(result.current.storageStatus).toBe(grant ? 'persistent' : 'best-effort');
    expect(result.current.storageDeclined).toBe(!grant);
    expect(result.current.storagePending).toBe(false);
  },
);
it('resets declined on retry, prevents duplicate requests and ignores stale passive results', async () => {
  const passive = pending<boolean>();
  storage.persisted.mockReturnValue(passive.promise);
  storage.persist.mockResolvedValueOnce(false);
  const { result } = await ready();
  await act(async () => result.current.requestStorage());
  expect(result.current.storageDeclined).toBe(true);
  const explicit = pending<boolean>();
  storage.persist.mockReturnValueOnce(explicit.promise);
  let operation!: Promise<void>;
  act(() => {
    operation = result.current.requestStorage();
  });
  expect(result.current.storageDeclined).toBe(false);
  expect(result.current.storagePending).toBe(true);
  await act(async () => result.current.requestStorage());
  expect(storage.persist).toHaveBeenCalledTimes(2);
  await act(async () => {
    explicit.resolve(true);
    await operation;
    passive.resolve(false);
  });
  expect(result.current.storageStatus).toBe('persistent');
});
it('reports passive and explicit storage errors then recovers', async () => {
  storage.persisted.mockRejectedValue(new Error('read'));
  storage.persist.mockRejectedValueOnce(new Error('permission'));
  const { result } = await ready();
  expect(result.current.storageStatus).toBe('error');
  await act(async () => result.current.requestStorage());
  expect(result.current.storageStatus).toBe('error');
  expect(result.current.storagePending).toBe(false);
  await act(async () => result.current.requestStorage());
  expect(result.current.storageStatus).toBe('persistent');
});
it('reports unsupported storage APIs', async () => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: {} });
  const { result } = await ready();
  expect(result.current.storageStatus).toBe('unsupported');
  await act(async () => result.current.requestStorage());
  expect(result.current.storageStatus).toBe('unsupported');
});
it('closes channels and removes lifecycle listeners on unmount', async () => {
  vi.useFakeTimers();
  env.active.postMessage.mockImplementation(() => {});
  const removeWorkers = vi.spyOn(env.workers, 'removeEventListener');
  const removeRegistration = vi.spyOn(env.registration, 'removeEventListener');
  const removeMedia = vi.spyOn(media, 'removeEventListener');
  const removeWindow = vi.spyOn(window, 'removeEventListener');
  const { unmount } = renderHook(usePwa);
  await act(async () => {});
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(channels[0].port1.close).toHaveBeenCalledOnce();
  expect(channels[0].port1.onmessage).toBeNull();
  expect(removeWorkers).toHaveBeenCalledWith('controllerchange', expect.any(Function));
  expect(removeRegistration).toHaveBeenCalledWith('updatefound', expect.any(Function));
  expect(removeMedia).toHaveBeenCalledWith('change', expect.any(Function));
  expect(removeWindow).toHaveBeenCalledWith('appinstalled', expect.any(Function));
});
it('ignores lookup/install/storage completions after unmount', async () => {
  const lookup = pending<typeof env.registration>();
  env.workers.getRegistration.mockReturnValue(lookup.promise);
  const passive = pending<boolean>();
  storage.persisted.mockReturnValue(passive.promise);
  const explicit = pending<boolean>();
  storage.persist.mockReturnValue(explicit.promise);
  const event = installEvent();
  const prompt = pending<void>();
  event.prompt.mockReturnValue(prompt.promise);
  const { result, unmount } = renderHook(usePwa);
  let installing!: Promise<void>;
  let requesting!: Promise<void>;
  act(() => {
    installing = result.current.install();
    requesting = result.current.requestStorage();
  });
  unmount();
  await act(async () => {
    lookup.resolve(env.registration);
    passive.resolve(true);
    explicit.resolve(true);
    prompt.reject(new Error('late'));
    await Promise.all([installing, requesting]);
  });
  expect(env.active.postMessage).not.toHaveBeenCalled();
  expect(result.current.installError).toBe(false);
  await result.current.retryOffline();
  expect(env.workers.getRegistration).toHaveBeenCalledOnce();
});

it('retries a stalled message without accepting its obsolete reply', async () => {
  env.active.postMessage.mockImplementationOnce(() => {});
  const { result } = renderHook(usePwa);
  await waitFor(() => expect(channels).toHaveLength(1));
  const obsolete = channels[0].port1.onmessage;
  await act(async () => result.current.retryOffline());
  expect(result.current.offlineStatus).toBe('ready');
  act(() => obsolete?.({ data: { type: 'OFFLINE_STATUS', ready: false } }));
  expect(result.current.offlineStatus).toBe('ready');
  expect(channels[0].port1.close).toHaveBeenCalledOnce();
});
it('reports synchronous storage failures without crashing the editor', async () => {
  storage.persisted.mockImplementationOnce(() => {
    throw new Error('storage disabled');
  });
  storage.persist.mockImplementationOnce(() => {
    throw new Error('storage disabled');
  });
  const { result } = await ready();
  expect(result.current.storageStatus).toBe('error');
  await act(async () => result.current.requestStorage());
  expect(result.current.storageStatus).toBe('error');
  expect(result.current.storagePending).toBe(false);
});
it('keeps appinstalled authoritative if a pending install prompt later fails', async () => {
  const { result } = await ready();
  const event = installEvent();
  const prompt = pending<void>();
  event.prompt.mockReturnValueOnce(prompt.promise);
  let operation!: Promise<void>;
  act(() => {
    operation = result.current.install();
  });
  act(() => window.dispatchEvent(new Event('appinstalled')));
  await act(async () => {
    prompt.reject(new Error('late prompt error'));
    await operation;
  });
  expect(result.current.installed).toBe(true);
  expect(result.current.installError).toBe(false);
  installEvent();
  expect(result.current.installAvailable).toBe(false);
});
it('cleans up installation state listeners after unmount and reports failed first installs', async () => {
  const installing = worker();
  installing.state = 'installing';
  env.registration.active = null;
  env.registration.installing = installing;
  const remove = vi.spyOn(installing, 'removeEventListener');
  const { result, unmount } = renderHook(usePwa);
  await waitFor(() => expect(env.workers.getRegistration).toHaveBeenCalled());
  env.registration.installing = null;
  installing.state = 'redundant';
  act(() => installing.dispatchEvent(new Event('statechange')));
  await waitFor(() => expect(result.current.offlineStatus).toBe('error'));
  unmount();
  expect(remove).toHaveBeenCalledWith('statechange', expect.any(Function));
});

describe('service worker completion protocol', () => {
  function shell() {
    type WorkerEvent = {
      data?: unknown;
      ports: { postMessage(data: unknown): void }[];
      waitUntil(promise: Promise<unknown>): void;
    };
    const listeners = new Map<string, (event: WorkerEvent) => void>();
    class Response {
      ok = true;
      constructor(private body: string) {}
      async text() {
        return this.body;
      }
      clone() {
        return new Response(this.body);
      }
      async json(): Promise<unknown> {
        return JSON.parse(this.body);
      }
    }
    const cachesByName = new Map<string, Map<string, Response>>();
    const addAll = vi.fn(async (entries: Map<string, Response>, paths: string[]) => {
      for (const path of paths)
        entries.set(path, new Response(path.endsWith('.css') ? 'url(./font.woff2)' : 'asset'));
    });
    const match = vi.fn(async (entries: Map<string, Response>, key: string) => entries.get(key));
    const open = async (name: string) => {
      let entries = cachesByName.get(name);
      if (!entries) {
        entries = new Map();
        cachesByName.set(name, entries);
      }
      const current = entries;
      return {
        match: (key: string) => match(current, key),
        put: async (key: string, value: Response) => {
          current.set(key, value);
        },
        addAll: (paths: string[]) => addAll(current, paths),
      };
    };
    const fetch = vi.fn(
      async (path: string) =>
        new Response(
          path === '/'
            ? '<script src="/assets/app.js"></script>'
            : JSON.stringify({ app: { file: 'assets/app.js', css: ['assets/app.css'] } }),
        ),
    );
    const skipWaiting = vi.fn();
    new Function('self', 'caches', 'fetch', 'Response', 'URL', workerSource)(
      {
        addEventListener: (type: string, callback: (event: WorkerEvent) => void) =>
          listeners.set(type, callback),
        location: { origin: 'https://example.test' },
        skipWaiting,
      },
      { open, delete: async (name: string) => cachesByName.delete(name) },
      fetch,
      Response,
      URL,
    );
    async function dispatch(type: string, data?: unknown) {
      const postMessage = vi.fn();
      let operation: Promise<unknown> | undefined;
      listeners.get(type)?.({
        data,
        ports: [{ postMessage }],
        waitUntil: (promise) => {
          operation = promise;
        },
      });
      await operation;
      return postMessage;
    }
    return { cachesByName, addAll, match, fetch, dispatch, skipWaiting, Response };
  }
  it('only reports readiness after all shell caching succeeds, including fonts', async () => {
    const { addAll, dispatch } = shell();
    const blocked = pending<void>();
    const add = addAll.getMockImplementation()!;
    addAll.mockImplementationOnce(async (entries, paths) => {
      await blocked.promise;
      await add(entries, paths);
    });
    const installing = dispatch('install');
    expect(await dispatch('message', { type: 'OFFLINE_STATUS' })).toHaveBeenCalledWith({
      type: 'OFFLINE_STATUS',
      ready: false,
    });
    blocked.resolve();
    await installing;
    expect(await dispatch('message', { type: 'OFFLINE_STATUS' })).toHaveBeenCalledWith({
      type: 'OFFLINE_STATUS',
      ready: true,
    });
    expect(addAll).toHaveBeenLastCalledWith(expect.any(Map), ['/assets/font.woff2']);
  });
  it('never certifies partial first installation and allows retry', async () => {
    const { addAll, dispatch } = shell();
    addAll.mockRejectedValueOnce(new Error('asset missing'));
    await expect(dispatch('install')).rejects.toThrow('asset missing');
    expect(await dispatch('message', { type: 'OFFLINE_STATUS' })).toHaveBeenCalledWith({
      type: 'OFFLINE_STATUS',
      ready: false,
    });
    await dispatch('install');
    expect(await dispatch('message', { type: 'OFFLINE_STATUS' })).toHaveBeenCalledWith({
      type: 'OFFLINE_STATUS',
      ready: true,
    });
  });
  it('preserves a good active shell when staging a same-cache retry fails', async () => {
    const { addAll, dispatch, cachesByName } = shell();
    await dispatch('install');
    addAll.mockRejectedValueOnce(new Error('asset missing'));
    await expect(dispatch('install')).rejects.toThrow('asset missing');
    expect(await dispatch('message', { type: 'OFFLINE_STATUS' })).toHaveBeenCalledWith({
      type: 'OFFLINE_STATUS',
      ready: true,
    });
    expect([...cachesByName.keys()].some((name) => name.endsWith('-installing'))).toBe(false);
  });
  it.each(['/', '/assets/app.js', '/assets/app.css', '/assets/font.woff2', '/icon.svg'])(
    'does not trust a marker after eviction of %s',
    async (asset) => {
      const { dispatch, cachesByName } = shell();
      await dispatch('install');
      cachesByName.get('roamlet-shell-__BUILD_REVISION__')?.delete(asset);
      expect(await dispatch('message', { type: 'OFFLINE_STATUS' })).toHaveBeenCalledWith({
        type: 'OFFLINE_STATUS',
        ready: false,
      });
    },
  );
  it('rejects wrong markers/cache errors and preserves explicit startup activation', async () => {
    const { cachesByName, Response, match, dispatch, skipWaiting } = shell();
    await dispatch('install');
    cachesByName
      .get('roamlet-shell-__BUILD_REVISION__')
      ?.set('/__roamlet_offline_complete__', new Response('older build'));
    expect(await dispatch('message', { type: 'OFFLINE_STATUS' })).toHaveBeenCalledWith({
      type: 'OFFLINE_STATUS',
      ready: false,
    });
    match.mockRejectedValueOnce(new Error('storage'));
    expect(await dispatch('message', { type: 'OFFLINE_STATUS' })).toHaveBeenCalledWith({
      type: 'OFFLINE_STATUS',
      ready: false,
    });
    expect(skipWaiting).not.toHaveBeenCalled();
    await dispatch('message', { type: 'SKIP_WAITING' });
    expect(skipWaiting).toHaveBeenCalledOnce();
  });
});
