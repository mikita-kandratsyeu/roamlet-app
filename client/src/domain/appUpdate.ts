export const UPDATE_EVENT = 'roamlet-update-available';
export function watchUpdates(registration: ServiceWorkerRegistration) {
  const announce = () => { if (registration.waiting) window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: registration })); };
  announce();
  registration.addEventListener('updatefound', () => {
    registration.installing?.addEventListener('statechange', announce);
  });
}
export async function activateUpdate(registration: ServiceWorkerRegistration, flush: () => Promise<boolean>, onActivate?: () => void): Promise<boolean> {
  if (!await flush() || !registration.waiting) return false;
  onActivate?.();
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}
