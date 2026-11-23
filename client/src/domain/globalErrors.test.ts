import { afterEach, expect, it, vi } from 'vitest';
import { isIgnorableRejection, registerGlobalErrorHandlers, rejectionMessage } from './globalErrors';

afterEach(() => {
  vi.restoreAllMocks();
});

it('ignores aborted async work', () => {
  expect(isIgnorableRejection(new DOMException('Cancelled', 'AbortError'))).toBe(true);
  expect(isIgnorableRejection(Object.assign(new Error('Cancelled'), { name: 'AbortError' }))).toBe(
    true,
  );
  expect(isIgnorableRejection(new Error('Storage failed'))).toBe(false);
});

it('normalizes rejection messages', () => {
  expect(rejectionMessage(new Error('Connector offline'))).toBe('Connector offline');
  expect(rejectionMessage('Plain failure')).toBe('Plain failure');
  expect(rejectionMessage({})).toBe('Something went wrong. Please try again.');
});

it('reports unexpected promise rejections and skips aborts', () => {
  const notify = vi.fn();
  const unregister = registerGlobalErrorHandlers(notify);
  const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
  Object.defineProperty(rejection, 'reason', { value: new Error('Sync failed') });
  const preventDefault = vi.fn();
  Object.defineProperty(rejection, 'preventDefault', { value: preventDefault });
  window.dispatchEvent(rejection);
  expect(notify).toHaveBeenCalledWith('Sync failed');
  expect(preventDefault).toHaveBeenCalled();
  notify.mockClear();
  const aborted = new Event('unhandledrejection') as PromiseRejectionEvent;
  Object.defineProperty(aborted, 'reason', {
    value: new DOMException('Cancelled', 'AbortError'),
  });
  window.dispatchEvent(aborted);
  expect(notify).not.toHaveBeenCalled();
  unregister();
});