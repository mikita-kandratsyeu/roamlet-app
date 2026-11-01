// Run before mounting the editor: only this startup may reload, never an editing tab.
export function applyWaitingUpdateOnStartup(
  workers: ServiceWorkerContainer,
  reload: () => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let waiting: ServiceWorker | null = null;
    const finish = (reloading: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      workers.removeEventListener('controllerchange', activated);
      resolve(reloading);
    };
    const activated = () => {
      if (!settled && waiting && workers.controller === waiting) {
        try {
          reload();
          finish(true);
        } catch {
          finish(false);
        }
      }
    };
    // A stalled registration or worker must not block the offline editor indefinitely.
    const timer = setTimeout(() => finish(false), 3000);
    void workers
      .getRegistration('/')
      .then((registration) => {
        if (settled) return;
        waiting = registration?.waiting ?? null;
        if (!registration?.active || !waiting) {
          finish(false);
          return;
        }
        workers.addEventListener('controllerchange', activated);
        waiting.postMessage({ type: 'SKIP_WAITING' });
      })
      .catch(() => finish(false));
  });
}
