export function isIgnorableRejection(reason: unknown): boolean {
  if (reason instanceof DOMException && reason.name === 'AbortError') return true;
  if (reason instanceof Error && reason.name === 'AbortError') return true;
  return false;
}

export function rejectionMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === 'string' && reason) return reason;
  return 'Something went wrong. Please try again.';
}

export const GLOBAL_UNHANDLED_TOAST_ID = 'global-unhandled-error';

export function registerGlobalErrorHandlers(notify: (message: string) => void) {
  const onRejection = (event: PromiseRejectionEvent) => {
    if (isIgnorableRejection(event.reason)) return;
    event.preventDefault();
    notify(rejectionMessage(event.reason));
  };
  window.addEventListener('unhandledrejection', onRejection);
  return () => window.removeEventListener('unhandledrejection', onRejection);
}