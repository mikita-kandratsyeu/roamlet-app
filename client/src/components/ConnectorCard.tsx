import { useTranslation } from 'react-i18next';
import { useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { LoaderCircle, RefreshCw, Unplug } from 'lucide-react';
export type ConnectorStatus =
  'checking' | 'attention' | 'unavailable' | 'connected' | 'disconnected';
const labels: Record<ConnectorStatus, string> = {
  checking: 'Checking connection',
  attention: 'Connection needs attention',
  unavailable: 'Unavailable',
  connected: 'Connected',
  disconnected: 'Not connected',
};
export function ConnectorCard({
  name,
  icon,
  description,
  status,
  connected,
  account,
  busy,
  onManage,
  onDisconnect,
  onRetry,
  retrying = false,
}: {
  name: string;
  icon: string;
  description: string;
  status: ConnectorStatus;
  connected: boolean;
  account?: string;
  busy: boolean;
  onManage: () => void;
  onDisconnect: () => void;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { t } = useTranslation();
  const needsRetry = !!onRetry && (status === 'attention' || retrying);
  const retryButton = useRef<HTMLButtonElement>(null);
  const restoreRetryFocus = useRef(false);
  useEffect(() => {
    if (retrying || busy) return;
    // Native disabled buttons lose focus; restore it only if the user has not focused elsewhere.
    if (restoreRetryFocus.current && document.activeElement === document.body)
      retryButton.current?.focus({ preventScroll: true });
    restoreRetryFocus.current = false;
  }, [retrying, busy]);
  return (
    <article className="connector-card" role="listitem">
      <div className="connector-card-heading">
        <img
          src={icon}
          width="48"
          height="48"
          alt=""
          className={`connector-brand-mark${name === 'GitHub' ? ' github-brand-mark' : ''}`}
        />
        <div>
          <h3>{name}</h3>
          <span
            className="connector-status"
            role="status"
            data-connected={connected}
            data-attention={status === 'attention'}
          >
            {t(labels[status])}
          </span>
        </div>
        {connected && (
          <Button
            variant="ghost"
            className="connector-disconnect-action"
            disabled={busy}
            aria-label={t('Disconnect {{name}}', { name })}
            title={t('Disconnect {{name}}', { name })}
            onClick={onDisconnect}
          >
            <Unplug className="size-5" aria-hidden="true" />
          </Button>
        )}
      </div>
      <p>{t(description)}</p>
      {account && <p className="connector-repository">{account}</p>}
      <div className="connector-card-actions">
        <Button
          className="connector-primary-action"
          disabled={busy || retrying}
          aria-busy={retrying}
          aria-haspopup={needsRetry ? undefined : 'dialog'}
          ref={retryButton}
          onClick={(event) => {
            if (needsRetry && onRetry) {
              restoreRetryFocus.current = document.activeElement === event.currentTarget;
              onRetry();
            } else onManage();
          }}
        >
          {needsRetry &&
            (retrying ? (
              <LoaderCircle size={18} className="connector-spinner" aria-hidden="true" />
            ) : (
              <RefreshCw size={18} aria-hidden="true" />
            ))}
          <span>
            {retrying
              ? t('Checking connection')
              : needsRetry
                ? t('Retry')
                : connected
                  ? t('Manage connection')
                  : t('Set up connection')}
          </span>
        </Button>
        {needsRetry && (
          <Button variant="outline" aria-haspopup="dialog" onClick={onManage}>
            {connected ? t('Manage connection') : t('Set up connection')}
          </Button>
        )}
      </div>
    </article>
  );
}
