import { useEffect, useRef, useState } from 'react';
import { activateUpdate, UPDATE_EVENT } from '../domain/appUpdate';
export function useAppUpdate(flush: () => Promise<boolean>) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [failed, setFailed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const controllerListener = useRef<(() => void) | null>(null);
  useEffect(() => {
    const available = (event: Event) => setRegistration((event as CustomEvent<ServiceWorkerRegistration>).detail);
    window.addEventListener(UPDATE_EVENT, available);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration().then(value => { if (value?.waiting) setRegistration(value); }).catch(() => {});
    return () => { window.removeEventListener(UPDATE_EVENT, available); if (controllerListener.current) navigator.serviceWorker?.removeEventListener('controllerchange', controllerListener.current); };
  }, []);
  async function apply() {
    if (!registration || installing) return;
    setInstalling(true);
    let reloadArmed = false;
    const reload = () => { if (reloadArmed) { navigator.serviceWorker?.removeEventListener('controllerchange', reload); window.location.reload(); } };
    controllerListener.current = reload;
    navigator.serviceWorker?.addEventListener('controllerchange', reload);
    try {
      if (!await activateUpdate(registration, flush, () => { reloadArmed = true; })) { reloadArmed = false; setFailed(true); }
    } catch { reloadArmed = false; setFailed(true); }
    if (!reloadArmed) { navigator.serviceWorker?.removeEventListener('controllerchange', reload); setInstalling(false); }
  }
  return { available: !!registration, failed, installing, apply };
}
