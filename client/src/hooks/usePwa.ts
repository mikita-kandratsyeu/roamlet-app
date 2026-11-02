import { useEffect, useRef, useState } from 'react';

type OfflineStatus = 'checking' | 'ready' | 'error' | 'unsupported' | 'development';
type StorageStatus = 'checking' | 'persistent' | 'best-effort' | 'unsupported' | 'error';
type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
const INSTALL_CHANGE = 'roamlet-install-change';
const OFFLINE_TIMEOUT = 10000;
const MESSAGE_TIMEOUT = 3000;
let deferredInstall: InstallPrompt | null = null;
let capturingInstall = false;

// Called synchronously by main, before asynchronous startup or rendering the editor.
export function capturePwaInstallPrompt() {
  if (capturingInstall) return;
  capturingInstall = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!('prompt' in event) || !('userChoice' in event)) return;
    event.preventDefault();
    deferredInstall = event as InstallPrompt;
    window.dispatchEvent(new Event(INSTALL_CHANGE));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    window.dispatchEvent(new Event(INSTALL_CHANGE));
  });
}

function isInstalled() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    ('standalone' in navigator && navigator.standalone === true)
  );
}

export function usePwa() {
  const [offlineStatus, setOfflineStatus] = useState<OfflineStatus>('checking');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [installed, setInstalled] = useState(isInstalled);
  const [installAvailable, setInstallAvailable] = useState(
    () => !!deferredInstall && !isInstalled(),
  );
  const [installPending, setInstallPending] = useState(false);
  const [installError, setInstallError] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>('checking');
  const [storagePending, setStoragePending] = useState(false);
  const [storageDeclined, setStorageDeclined] = useState(false);
  const alive = useRef(false);
  const installedRef = useRef(installed);
  const installBusy = useRef(false);
  const storageBusy = useRef(false);
  const storageVersion = useRef(0);
  const retry = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    alive.current = true;
    let mounted = true;
    const media = window.matchMedia?.('(display-mode: standalone)');
    const refreshInstall = () => {
      const standalone = isInstalled();
      installedRef.current ||= standalone;
      setInstalled(installedRef.current);
      setInstallAvailable(!!deferredInstall && !installedRef.current);
    };
    const appInstalled = () => {
      installedRef.current = true;
      setInstalled(true);
      setInstallAvailable(false);
      setInstallError(false);
    };
    window.addEventListener(INSTALL_CHANGE, refreshInstall);
    window.addEventListener('appinstalled', appInstalled);
    media?.addEventListener('change', refreshInstall);
    refreshInstall();

    const storageGeneration = ++storageVersion.current;
    if (!navigator.storage?.persisted) setStorageStatus('unsupported');
    else {
      void (async () => {
        try {
          const persistent = await navigator.storage.persisted();
          if (mounted && storageGeneration === storageVersion.current)
            setStorageStatus(persistent ? 'persistent' : 'best-effort');
        } catch {
          if (mounted && storageGeneration === storageVersion.current) setStorageStatus('error');
        }
      })();
    }

    let registration: ServiceWorkerRegistration | undefined;
    let version = 0;
    let cancelOperation = () => {};
    const subscriptions: (() => void)[] = [];
    const watchedRegistrations = new Set<ServiceWorkerRegistration>();
    const watchedWorkers = new Set<ServiceWorker>();
    const subscribe = (target: EventTarget, type: string, callback: () => void) => {
      target.addEventListener(type, callback);
      subscriptions.push(() => target.removeEventListener(type, callback));
    };
    const observe = (next: ServiceWorkerRegistration) => {
      registration = next;
      setUpdateAvailable(!!next.waiting);
      const observeWorker = () => {
        const worker = next.installing;
        if (worker && !watchedWorkers.has(worker)) {
          watchedWorkers.add(worker);
          subscribe(worker, 'statechange', () => {
            setUpdateAvailable(!!next.waiting);
            if (worker.state === 'activated' || worker.state === 'redundant') void check(false);
          });
        }
      };
      if (!watchedRegistrations.has(next)) {
        watchedRegistrations.add(next);
        subscribe(next, 'updatefound', observeWorker);
      }
      observeWorker();
    };
    const check = (forceUpdate: boolean): Promise<void> => {
      cancelOperation();
      const current = ++version;
      if (!mounted) return Promise.resolve();
      if (!import.meta.env.PROD) {
        setOfflineStatus('development');
        return Promise.resolve();
      }
      if (!('serviceWorker' in navigator)) {
        setOfflineStatus('unsupported');
        return Promise.resolve();
      }
      setOfflineStatus('checking');
      return new Promise((resolve) => {
        let settled = false;
        let cancelMessage = () => {};
        const valid = () => mounted && current === version && !settled;
        const finish = (status?: OfflineStatus) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cancelMessage();
          if (status && mounted && current === version) setOfflineStatus(status);
          resolve();
        };
        const timer = setTimeout(() => finish('error'), OFFLINE_TIMEOUT);
        cancelOperation = () => finish();
        const request = (worker: ServiceWorker, type: 'OFFLINE_STATUS' | 'REPAIR_OFFLINE') =>
          new Promise<boolean>((done) => {
            const channel = new MessageChannel();
            let completed = false;
            const complete = (ready: boolean) => {
              if (completed) return;
              completed = true;
              clearTimeout(messageTimer);
              channel.port1.onmessage = null;
              channel.port1.close();
              channel.port2.close();
              done(ready);
            };
            const messageTimer = setTimeout(
              () => complete(false),
              type === 'REPAIR_OFFLINE' ? OFFLINE_TIMEOUT : MESSAGE_TIMEOUT,
            );
            cancelMessage = () => complete(false);
            channel.port1.onmessage = (event: MessageEvent<unknown>) => {
              const data = event.data;
              complete(
                valid() &&
                  typeof data === 'object' &&
                  data !== null &&
                  'type' in data &&
                  data.type === type &&
                  'ready' in data &&
                  data.ready === true,
              );
            };
            try {
              worker.postMessage({ type }, [channel.port2]);
            } catch {
              complete(false);
            }
          });
        void (async () => {
          try {
            const existing = registration ?? (await navigator.serviceWorker.getRegistration('/'));
            if (!valid()) return;
            const next = existing ?? (await navigator.serviceWorker.register('/sw.js'));
            if (!valid()) return;
            observe(next);
            if (forceUpdate && existing) {
              await next.update();
              if (!valid()) return;
              observe(next);
            }
            if (!next.active) {
              if (!next.installing && !next.waiting) finish('error');
              return;
            }
            const active = next.active;
            if (forceUpdate && existing) {
              const repaired = await request(active, 'REPAIR_OFFLINE');
              if (!valid()) return;
              if (!repaired) {
                finish('error');
                return;
              }
            }
            const ready = await request(active, 'OFFLINE_STATUS');
            if (valid()) finish(ready ? 'ready' : 'error');
          } catch {
            finish('error');
          }
        })();
      });
    };
    retry.current = () => check(true);
    if ('serviceWorker' in navigator)
      subscribe(navigator.serviceWorker, 'controllerchange', () => void check(false));
    void check(false);
    return () => {
      mounted = false;
      alive.current = false;
      ++version;
      cancelOperation();
      subscriptions.forEach((unsubscribe) => unsubscribe());
      window.removeEventListener(INSTALL_CHANGE, refreshInstall);
      window.removeEventListener('appinstalled', appInstalled);
      media?.removeEventListener('change', refreshInstall);
      retry.current = async () => {};
    };
  }, []);

  async function install() {
    const prompt = deferredInstall;
    if (!alive.current || installBusy.current || !prompt || installedRef.current) return;
    installBusy.current = true;
    setInstallPending(true);
    setInstallError(false);
    deferredInstall = null;
    window.dispatchEvent(new Event(INSTALL_CHANGE));
    try {
      await prompt.prompt();
      await prompt.userChoice;
      // Acceptance is not proof of installation; appinstalled or standalone is.
    } catch {
      if (alive.current && !installedRef.current) setInstallError(true);
    } finally {
      installBusy.current = false;
      if (alive.current) setInstallPending(false);
    }
  }

  async function requestStorage() {
    if (!alive.current || storageBusy.current) return;
    ++storageVersion.current;
    setStorageDeclined(false);
    if (!navigator.storage?.persist) {
      setStorageStatus('unsupported');
      return;
    }
    storageBusy.current = true;
    setStoragePending(true);
    try {
      const granted = await navigator.storage.persist();
      if (alive.current) {
        setStorageStatus(granted ? 'persistent' : 'best-effort');
        setStorageDeclined(!granted);
      }
    } catch {
      if (alive.current) setStorageStatus('error');
    } finally {
      storageBusy.current = false;
      if (alive.current) setStoragePending(false);
    }
  }

  return {
    offlineStatus,
    updateAvailable,
    installed,
    installAvailable,
    installPending,
    installError,
    install,
    retryOffline: () => retry.current(),
    storageStatus,
    storagePending,
    storageDeclined,
    requestStorage,
  };
}
