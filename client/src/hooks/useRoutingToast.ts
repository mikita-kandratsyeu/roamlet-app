import { useCallback, useEffect, useId, useRef } from 'react';
import { toast } from 'sonner';
import i18n, { translateMessage } from '../i18n';

export interface RoutingNotification {
  success: () => void;
  error: (message: string) => void;
}

export function useRoutingToast(onRetry?: () => void) {
  const id = useId();
  const current = useRef<AbortController | null>(null);
  const retry = useRef(onRetry);
  useEffect(() => { retry.current = onRetry; }, [onRetry]);
  useEffect(() => () => {
    current.current = null;
    toast.dismiss(id);
  }, [id]);

  return useCallback((controller: AbortController): RoutingNotification => {
    current.current = controller;
    let succeeded = false;
    toast.loading(i18n.t('Calculating route…'), {
      id,
      duration: Infinity,
      dismissible: false,
      closeButton: false,
    });
    controller.signal.addEventListener('abort', () => {
      if (!succeeded && current.current === controller) toast.dismiss(id);
    }, { once: true });
    const active = () => !controller.signal.aborted && current.current === controller;
    return {
      success: () => {
        if (!active()) return;
        succeeded = true;
        toast.success(i18n.t('Route calculated.'), { id, duration: 6000, dismissible: true, closeButton: true });
      },
      error: (message) => {
        if (!active()) return;
        toast.error(i18n.t('Routing error'), {
          id,
          description: translateMessage(message),
          action: retry.current ? {
            label: i18n.t('Retry routing'),
            onClick: (event) => {
              event.preventDefault();
              retry.current?.();
            },
          } : undefined,
          duration: Infinity,
          dismissible: true,
          closeButton: true,
        });
      },
    };
  }, [id]);
}
