import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import './sonner.css';

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  const { t } = useTranslation();
  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      position="bottom-right"
      mobileOffset={{
        left: 'max(16px, env(safe-area-inset-left))',
        right: 'max(16px, env(safe-area-inset-right))',
        bottom: 'max(16px, env(safe-area-inset-bottom))',
      }}
      closeButton
      containerAriaLabel={t('Notification')}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--width': '400px',
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      toastOptions={{
        className: 'roamlet-toast',
        classNames: { description: 'roamlet-toast-description' },
        closeButtonAriaLabel: t('Dismiss notification'),
      }}
      {...props}
    />
  );
}
