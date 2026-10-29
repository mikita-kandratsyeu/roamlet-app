import { expect, it, vi } from 'vitest';
import { activateUpdate, hasWaitingUpdate, watchUpdates, UPDATE_EVENT } from './appUpdate';
it('announces a waiting update using the registration event contract', () => {
  const listener = vi.fn();
  window.addEventListener(UPDATE_EVENT, listener);
  const registration = {
    waiting: { postMessage: vi.fn() },
    addEventListener: vi.fn(),
  } as unknown as ServiceWorkerRegistration;
  watchUpdates(registration);
  expect(listener.mock.calls[0][0].detail).toBe(registration);
  window.removeEventListener(UPDATE_EVENT, listener);
});
it('does not arm reload while a draft flush is still pending', async () => {
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const armed = vi.fn();
  const postMessage = vi.fn();
  const registration = { waiting: { postMessage } } as unknown as ServiceWorkerRegistration;
  const update = activateUpdate(registration, () => pending, armed);
  expect(armed).not.toHaveBeenCalled();
  finish(false);
  expect(await update).toBe('save-failed');
  expect(armed).not.toHaveBeenCalled();
  expect(postMessage).not.toHaveBeenCalled();
});
it('flushes first and never activates when draft saving fails', async () => {
  const postMessage = vi.fn();
  const registration = { waiting: { postMessage } } as unknown as ServiceWorkerRegistration;
  expect(await activateUpdate(registration, async () => false)).toBe('save-failed');
  expect(postMessage).not.toHaveBeenCalled();
  expect(await activateUpdate(registration, async () => true)).toBe('activated');
  expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
});
it('distinguishes a first installation from an update to an active version', () => {
  const registration = {
    active: null,
    waiting: { postMessage: vi.fn() },
  } as unknown as ServiceWorkerRegistration;
  expect(hasWaitingUpdate(registration)).toBe(false);
  Object.assign(registration, { active: {} });
  expect(hasWaitingUpdate(registration)).toBe(true);
  Object.assign(registration, { waiting: null });
  expect(hasWaitingUpdate(registration)).toBe(false);
});
it('allows a saved reload if the waiting worker disappears during the flush', async () => {
  const postMessage = vi.fn();
  const armed = vi.fn();
  const registration = { waiting: { postMessage } } as unknown as ServiceWorkerRegistration;
  const flush = vi.fn(async () => {
    Object.assign(registration, { waiting: null });
    return true;
  });
  expect(await activateUpdate(registration, flush, armed)).toBe('current');
  expect(flush).toHaveBeenCalledOnce();
  expect(armed).not.toHaveBeenCalled();
  expect(postMessage).not.toHaveBeenCalled();
});
it('reports a rejected flush as a storage failure without activating', async () => {
  const postMessage = vi.fn();
  const registration = { waiting: { postMessage } } as unknown as ServiceWorkerRegistration;
  expect(await activateUpdate(registration, async () => { throw new Error('storage'); }))
    .toBe('save-failed');
  expect(postMessage).not.toHaveBeenCalled();
});
it('reports an activation failure separately after saving', async () => {
  const postMessage = vi.fn(() => { throw new Error('worker'); });
  const registration = { waiting: { postMessage } } as unknown as ServiceWorkerRegistration;
  const flush = vi.fn(async () => true);
  expect(await activateUpdate(registration, flush)).toBe('activation-failed');
  expect(flush).toHaveBeenCalledOnce();
});
