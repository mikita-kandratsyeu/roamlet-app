import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UPDATE_EVENT } from '../domain/appUpdate';
import { useAppUpdate } from './useAppUpdate';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(active: boolean = true) {
  const registration = {
    active: active ? {} : null,
    waiting: { postMessage: vi.fn() },
  } as unknown as ServiceWorkerRegistration;
  const workers = Object.assign(new EventTarget(), {
    getRegistration: vi.fn(async () => registration),
  });
  vi.stubGlobal('navigator', { serviceWorker: workers });
  const reload = vi.fn();
  const originalWindow = window;
  vi.stubGlobal('window', new Proxy(originalWindow, {
    get(target, property) {
      if (property === 'location') return { reload };
      return Reflect.get(target, property);
    },
  }));
  return { registration, workers, reload };
}

it('never offers an update for the first installation, including worker events', async () => {
  const { registration } = setup(false);
  const { result } = renderHook(() => useAppUpdate(async () => true));
  await act(async () => {});
  expect(result.current.available).toBe(false);
  act(() => window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: registration })));
  expect(result.current.available).toBe(false);
});

it('removes a stale update after another tab activates it without reloading', async () => {
  const { registration, workers, reload } = setup();
  const { result } = renderHook(() => useAppUpdate(async () => true));
  await waitFor(() => expect(result.current.available).toBe(true));
  Object.assign(registration, { waiting: null });
  await act(async () => { workers.dispatchEvent(new Event('controllerchange')); });
  expect(result.current.available).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

it('reloads after saving when the worker activates during the flush', async () => {
  const { registration, workers, reload } = setup();
  let finish!: (saved: boolean) => void;
  const flush = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const { result } = renderHook(() => useAppUpdate(flush));
  await waitFor(() => expect(result.current.available).toBe(true));
  let applying!: Promise<void>;
  act(() => { applying = result.current.apply(); });
  Object.assign(registration, { waiting: null });
  await act(async () => { workers.dispatchEvent(new Event('controllerchange')); });
  expect(reload).not.toHaveBeenCalled();
  await act(async () => { finish(true); await applying; });
  expect(reload).toHaveBeenCalledOnce();
  expect(result.current.failed).toBeNull();
});

it('waits for controller change after activation and guards duplicate clicks', async () => {
  const { registration, workers, reload } = setup();
  const flush = vi.fn(async () => true);
  const { result } = renderHook(() => useAppUpdate(flush));
  await waitFor(() => expect(result.current.available).toBe(true));
  await act(async () => { await Promise.all([result.current.apply(), result.current.apply()]); });
  expect(flush).toHaveBeenCalledOnce();
  expect(registration.waiting!.postMessage).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
  await act(async () => { workers.dispatchEvent(new Event('controllerchange')); });
  expect(reload).toHaveBeenCalledOnce();
});

it('does not reload on storage failure and clears the error on a successful retry', async () => {
  const { workers, reload } = setup();
  const flush = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const { result } = renderHook(() => useAppUpdate(flush));
  await waitFor(() => expect(result.current.available).toBe(true));
  await act(async () => { await result.current.apply(); });
  expect(result.current.failed).toBe('save-failed');
  expect(result.current.installing).toBe(false);
  await act(async () => { workers.dispatchEvent(new Event('controllerchange')); });
  expect(reload).not.toHaveBeenCalled();
  await act(async () => { await result.current.apply(); });
  expect(result.current.failed).toBeNull();
});
