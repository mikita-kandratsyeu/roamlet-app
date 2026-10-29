import { useEffect, useRef, useState } from 'react';
import { activateUpdate, hasWaitingUpdate, UPDATE_EVENT } from '../domain/appUpdate';
export function useAppUpdate(flush: () => Promise<boolean>) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [failed, setFailed] = useState<'save-failed' | 'activation-failed' | null>(null);
  const [installing, setInstalling] = useState(false);
  const applying = useRef(false);
  const controllerListener = useRef<(() => void) | null>(null);
  useEffect(() => {
    let disposed = false;
    const sync = (value?: ServiceWorkerRegistration) => {
      if (!disposed) setRegistration(value && hasWaitingUpdate(value) ? value : null);
    };
    const available = (event: Event) =>
      sync((event as CustomEvent<ServiceWorkerRegistration>).detail);
    const check = () => {
      if ('serviceWorker' in navigator)
        void navigator.serviceWorker.getRegistration().then(sync).catch(() => {});
    };
    window.addEventListener(UPDATE_EVENT, available);
    navigator.serviceWorker?.addEventListener('controllerchange', check);
    check();
    return () => {
      disposed = true;
      window.removeEventListener(UPDATE_EVENT, available);
      navigator.serviceWorker?.removeEventListener('controllerchange', check);
      if (controllerListener.current)
        navigator.serviceWorker?.removeEventListener(
          'controllerchange',
          controllerListener.current,
        );
    };
  }, []);
  async function apply() {
    if (!registration || applying.current) return;
    applying.current = true;
    setInstalling(true);
    setFailed(null);
    let reloadArmed = false;
    const reload = () => {
      if (reloadArmed) {
        navigator.serviceWorker?.removeEventListener('controllerchange', reload);
        window.location.reload();
      }
    };
    controllerListener.current = reload;
    navigator.serviceWorker?.addEventListener('controllerchange', reload);
    const result = await activateUpdate(registration, flush, () => {
      reloadArmed = true;
    });
    if (result !== 'activated') {
      reloadArmed = false;
      navigator.serviceWorker?.removeEventListener('controllerchange', reload);
      controllerListener.current = null;
      applying.current = false;
      setInstalling(false);
      if (result === 'current') {
        setRegistration(null);
        window.location.reload();
      } else {
        setFailed(result);
      }
    }
  }
  return { available: !!registration, failed, installing, apply };
}
