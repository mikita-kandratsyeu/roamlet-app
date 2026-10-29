export const UPDATE_EVENT = 'roamlet-update-available';
export function hasWaitingUpdate(registration: ServiceWorkerRegistration) {
  return !!registration.active && !!registration.waiting;
}
export function watchUpdates(registration: ServiceWorkerRegistration) {
  const announce = () => {
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: registration }));
  };
  announce();
  registration.addEventListener('updatefound', () => {
    registration.installing?.addEventListener('statechange', announce);
  });
}
export async function activateUpdate(
  registration: ServiceWorkerRegistration,
  flush: () => Promise<boolean>,
  onActivate?: () => void,
): Promise<'activated' | 'current' | 'save-failed' | 'activation-failed'> {
  try {
    if (!(await flush())) return 'save-failed';
  } catch {
    return 'save-failed';
  }
  // Another tab may have activated the update while the draft was being saved.
  if (!registration.waiting) return 'current';
  try {
    onActivate?.();
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return 'activated';
  } catch {
    return 'activation-failed';
  }
}
