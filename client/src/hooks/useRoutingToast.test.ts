import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import i18n from '../i18n';
import { useRoutingToast } from './useRoutingToast';

vi.mock('sonner', () => ({ toast: {
  loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn(),
} }));
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

it('updates one loading toast to success and reuses its id for subsequent requests', () => {
  const { result } = renderHook(useRoutingToast);
  const first = new AbortController();
  const notification = result.current(first);
  const id = vi.mocked(toast.loading).mock.calls[0][1]!.id;
  expect(toast.loading).toHaveBeenCalledWith('Calculating route…', expect.objectContaining({
    id, duration: Infinity, dismissible: false, closeButton: false,
  }));
  notification.success();
  expect(toast.success).toHaveBeenCalledWith('Route calculated.', expect.objectContaining({ id, duration: 6000 }));
  first.abort();
  expect(toast.dismiss).not.toHaveBeenCalled();
  result.current(new AbortController());
  expect(vi.mocked(toast.loading).mock.calls[1][1]!.id).toBe(id);
});

it('updates the same toast to a translated persistent error', async () => {
  await i18n.changeLanguage('ru');
  const { result } = renderHook(useRoutingToast);
  result.current(new AbortController()).error('Routing quota reached.');
  expect(toast.error).toHaveBeenCalledWith(i18n.t('Routing error'), expect.objectContaining({
    id: vi.mocked(toast.loading).mock.calls[0][1]!.id,
    description: i18n.t('Routing quota reached.'), duration: Infinity, dismissible: true,
  }));
  expect(toast.success).not.toHaveBeenCalled();
});

it('dismisses cancelled loading and ignores late success or error', () => {
  const { result } = renderHook(useRoutingToast);
  const controller = new AbortController();
  const notification = result.current(controller);
  controller.abort();
  notification.success();
  notification.error('Late failure');
  expect(toast.dismiss).toHaveBeenCalledWith(vi.mocked(toast.loading).mock.calls[0][1]!.id);
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it('does not let an old request overwrite or dismiss a newer request', () => {
  const { result } = renderHook(useRoutingToast);
  const old = new AbortController();
  const first = result.current(old);
  const second = result.current(new AbortController());
  old.abort();
  first.success();
  first.error('Old failure');
  expect(toast.dismiss).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  second.success();
  expect(toast.success).toHaveBeenCalledOnce();
});

it('cleans up on unmount and prevents later completion from recreating a toast', () => {
  const { result, unmount } = renderHook(useRoutingToast);
  const notification = result.current(new AbortController());
  act(() => unmount());
  notification.success();
  expect(toast.dismiss).toHaveBeenCalledOnce();
  expect(toast.success).not.toHaveBeenCalled();
});
