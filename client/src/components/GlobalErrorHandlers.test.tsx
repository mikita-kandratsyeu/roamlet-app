import { render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { GlobalErrorHandlers } from './GlobalErrorHandlers';
import { GLOBAL_UNHANDLED_TOAST_ID } from '../domain/globalErrors';

afterEach(() => {
  vi.restoreAllMocks();
});

it('surfaces unhandled rejections through Sonner', () => {
  const error = vi.spyOn(toast, 'error').mockImplementation(() => 0);
  const { unmount } = render(<GlobalErrorHandlers />);
  const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
  Object.defineProperty(rejection, 'reason', { value: new Error('Background failure') });
  Object.defineProperty(rejection, 'preventDefault', { value: vi.fn() });
  window.dispatchEvent(rejection);
  expect(error).toHaveBeenCalledWith('Background failure', { id: GLOBAL_UNHANDLED_TOAST_ID });
  unmount();
});