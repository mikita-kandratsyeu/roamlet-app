import { afterEach, expect, it, vi } from 'vitest';
import { applyWaitingUpdateOnStartup } from './appUpdate';

function setup() {
  const waiting = { postMessage: vi.fn() };
  const registration = { active: {}, waiting };
  const workers = Object.assign(new EventTarget(), {
    controller: {},
    getRegistration: vi.fn(async () => registration),
  });
  const reload = vi.fn();
  const start = () =>
    applyWaitingUpdateOnStartup(workers as unknown as ServiceWorkerContainer, reload);
  return { waiting, registration, workers, reload, start };
}

afterEach(() => vi.useRealTimers());

it('activates an installed update and reloads once when it controls this startup', async () => {
  const { waiting, workers, reload, start } = setup();
  const pending = start();
  await Promise.resolve();
  expect(workers.getRegistration).toHaveBeenCalledWith('/');
  expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  expect(reload).not.toHaveBeenCalled();
  workers.controller = waiting;
  workers.dispatchEvent(new Event('controllerchange'));
  expect(await pending).toBe(true);
  workers.dispatchEvent(new Event('controllerchange'));
  expect(reload).toHaveBeenCalledOnce();
});

it.each([
  undefined,
  { active: null, waiting: { postMessage: vi.fn() } },
  { active: {}, waiting: null },
  { active: {}, waiting: null, installing: {} },
])(
  'does not reload a first installation or a startup without a ready update (%j)',
  async (registration) => {
    const workers = Object.assign(new EventTarget(), {
      getRegistration: vi.fn(async () => registration),
    });
    const reload = vi.fn();
    expect(
      await applyWaitingUpdateOnStartup(workers as unknown as ServiceWorkerContainer, reload),
    ).toBe(false);
    workers.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    if (registration?.waiting) expect(registration.waiting.postMessage).not.toHaveBeenCalled();
  },
);

it('leaves updates discovered after startup waiting without a reload', async () => {
  const { registration, workers, reload, start } = setup();
  Object.assign(registration, { waiting: null });
  expect(await start()).toBe(false);
  Object.assign(registration, { waiting: { postMessage: vi.fn() } });
  workers.dispatchEvent(new Event('updatefound'));
  workers.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  expect(registration.waiting.postMessage).not.toHaveBeenCalled();
});

it('keeps startup available when registration lookup fails', async () => {
  const { workers, reload, start } = setup();
  workers.getRegistration.mockRejectedValueOnce(new Error('unavailable'));
  expect(await start()).toBe(false);
  workers.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
});

it('keeps startup available when activation fails and retries on the next startup', async () => {
  const { waiting, workers, reload, start } = setup();
  waiting.postMessage.mockImplementationOnce(() => {
    throw new Error('worker');
  });
  expect(await start()).toBe(false);
  workers.controller = waiting;
  workers.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  const retry = start();
  await Promise.resolve();
  workers.dispatchEvent(new Event('controllerchange'));
  expect(await retry).toBe(true);
  expect(reload).toHaveBeenCalledOnce();
});

it('times out activation and never reloads the editor on a late controller change', async () => {
  vi.useFakeTimers();
  const { waiting, workers, reload, start } = setup();
  const pending = start();
  await vi.advanceTimersByTimeAsync(3000);
  expect(await pending).toBe(false);
  workers.controller = waiting;
  workers.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not activate after a registration lookup outlives the startup timeout', async () => {
  vi.useFakeTimers();
  const { registration, waiting, workers, reload, start } = setup();
  let resolve!: (value: typeof registration) => void;
  workers.getRegistration.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = start();
  await vi.advanceTimersByTimeAsync(3000);
  expect(await pending).toBe(false);
  resolve(registration);
  await Promise.resolve();
  expect(waiting.postMessage).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});
