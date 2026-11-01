import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
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
}) {
  const { t } = useTranslation();
  return (
    <article className="connector-card" role="listitem">
      <div className="connector-card-heading">
        <img src={icon} width="48" height="48" alt="" className="github-brand-mark" />
        <div>
          <h2>{name}</h2>
          <span
            className="connector-status"
            role="status"
            data-connected={connected}
            data-attention={status === 'attention'}
          >
            {t(labels[status])}
          </span>
        </div>
      </div>
      <p>{t(description)}</p>
      {account && <p className="connector-repository">{account}</p>}
      <div className="connector-card-actions">
        <Button variant="outline" aria-haspopup="dialog" onClick={onManage}>
          {connected ? t('Manage connection') : t('Set up connection')}
        </Button>
        {connected && (
          <Button variant="ghost" disabled={busy} onClick={onDisconnect}>
            {t('Disconnect')}
          </Button>
        )}
      </div>
    </article>
  );
}
