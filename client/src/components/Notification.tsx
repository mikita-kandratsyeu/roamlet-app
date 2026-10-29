import { useEffect, useId, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';

interface Props {
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'warning' | 'info';
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissible?: boolean;
  duration?: number;
}

export function Notification({
  title,
  message,
  variant = 'info',
  actions,
  onDismiss,
  dismissible = true,
  duration = variant === 'success' || variant === 'info' ? 6000 : Infinity,
}: Props) {
  const id = useId();
  const dismissedMessage = useRef<string | null>(null);
  const latest = useRef({ message, onDismiss });
  useEffect(() => {
    latest.current = { message, onDismiss };
  }, [message, onDismiss]);

  useEffect(() => {
    if (dismissedMessage.current === message) return;
    const dismiss = () => {
      dismissedMessage.current = latest.current.message;
      latest.current.onDismiss?.();
    };
    toast[variant](title, {
      id,
      duration,
      dismissible,
      closeButton: dismissible,
      onDismiss: () => dismiss(),
      onAutoClose: () => dismiss(),
      description: (
        <div role={variant === 'error' || variant === 'warning' ? 'alert' : undefined}>
          <div className="notification-message">{message}</div>
          {actions && <div className="notification-actions">{actions}</div>}
        </div>
      ),
    });
  }, [id, title, message, variant, duration, dismissible, actions]);

  useEffect(
    () => () => {
      toast.dismiss(id);
    },
    [id],
  );
  return null;
}
