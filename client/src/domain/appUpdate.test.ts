import { expect, it, vi } from 'vitest';
import { activateUpdate, watchUpdates, UPDATE_EVENT } from './appUpdate';
it('announces a waiting update using the registration event contract', () => {
  const listener = vi.fn();
  window.addEventListener(UPDATE_EVENT, listener);
  const registration = { waiting: { postMessage: vi.fn() }, addEventListener: vi.fn() } as unknown as ServiceWorkerRegistration;
  watchUpdates(registration);
  expect(listener.mock.calls[0][0].detail).toBe(registration);
  window.removeEventListener(UPDATE_EVENT, listener);
});
it('flushes first and never activates when draft saving fails', async () => {
  const postMessage = vi.fn();
  const registration = { waiting: { postMessage } } as unknown as ServiceWorkerRegistration;
  expect(await activateUpdate(registration, async () => false)).toBe(false);
  expect(postMessage).not.toHaveBeenCalled();
  expect(await activateUpdate(registration, async () => true)).toBe(true);
  expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
});
