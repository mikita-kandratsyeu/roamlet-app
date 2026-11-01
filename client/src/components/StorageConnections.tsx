import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plug, Search } from 'lucide-react';
import './Library.css';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog } from './Dialog';
import { useStorageConnector } from '../hooks/useStorageConnector';
import { useGitHubSession } from '../hooks/useGitHubSession';
import { STORAGE_PROVIDERS, type StorageProviderId } from '../services/connectors/registry';
import {
  loadGitHubRepository,
  saveGitHubRepository,
  GITHUB_REPOSITORY_KEY,
} from '../domain/connectorPreferences';
import { GitHubConnectionDialog, connectorErrors } from './GitHubConnectionDialog';
import { ConnectorCard, type ConnectorStatus } from './ConnectorCard';
import './StorageConnections.css';

export function StorageConnections({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const storage = useStorageConnector();
  const github = useGitHubSession(open);
  const { connect, disconnect, cancel, connection } = storage;
  const [selected, setSelected] = useState<StorageProviderId | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [authorizationFailed, setAuthorizationFailed] = useState(
    () => new URLSearchParams(window.location.search).get('github') === 'error',
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'connected'>('all');
  const backButton = useRef<HTMLButtonElement>(null);
  const cancelDisconnect = useRef<HTMLButtonElement>(null);
  const id = useId();
  const authenticated = github.session?.connected;
  const login = github.session?.login;
  const available = github.session?.available;
  const previousAccount = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!open) {
      cancel();
      setSelected(null);
      setDisconnecting(false);
    } else backButton.current?.focus({ preventScroll: true });
  }, [open, cancel]);
  useEffect(() => {
    if (!open || authenticated === undefined) return;
    if (!authenticated) {
      disconnect();
      previousAccount.current = undefined;
      return;
    }
    if (previousAccount.current && previousAccount.current !== login) {
      disconnect();
      saveGitHubRepository(null);
    }
    previousAccount.current = login;
    const saved = loadGitHubRepository();
    if (saved && !connection) void connect(saved);
  }, [open, authenticated, login, connect, disconnect, connection]);
  useEffect(() => {
    if (!open) return;
    const changed = (event: StorageEvent) => {
      if (event.key !== GITHUB_REPOSITORY_KEY) return;
      const saved = loadGitHubRepository();
      if (!saved) disconnect();
      else if (authenticated) void connect(saved);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [open, authenticated, connect, disconnect]);
  if (!open) return null;
  function close() {
    if (storage.operation !== 'restoring') {
      cancel();
      onClose();
    }
  }
  const problem = github.error || storage.connectionIssue;
  const states: Record<
    StorageProviderId,
    {
      connected: boolean;
      status: ConnectorStatus;
      account?: string;
      busy: boolean;
      onDisconnect: () => void;
    }
  > = {
    github: {
      connected: !!authenticated,
      status: github.loading
        ? 'checking'
        : problem
          ? 'attention'
          : available === false
            ? 'unavailable'
            : authenticated
              ? 'connected'
              : 'disconnected',
      account: authenticated
        ? `${login || 'GitHub'}${connection ? ` · ${connection.owner}/${connection.repository}` : ''}`
        : undefined,
      busy: github.loading || storage.operation === 'restoring',
      onDisconnect: () => setDisconnecting(true),
    },
  };
  const providers = STORAGE_PROVIDERS.filter(
    (provider) =>
      provider.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === 'all' || states[provider.id].connected),
  );
  return (
    <section
      className="library-screen connections-screen"
      role="region"
      aria-label={t('Connections')}
      aria-describedby={`${id}-description`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && !selected && !disconnecting) {
          event.preventDefault();
          close();
        }
      }}
    >
      <header className="library-screen-header">
        <div className="library-screen-heading">
          <Plug size={22} aria-hidden="true" />
          <h1>{t('Connections')}</h1>
        </div>
        <Button
          ref={backButton}
          variant="ghost"
          className="back-to-map-button"
          disabled={storage.operation === 'restoring'}
          onClick={close}
        >
          <ArrowLeft size={18} aria-hidden="true" />
          {t('Back to map')}
        </Button>
      </header>
      <div className="library-screen-scroll">
        <div className="connections-content">
          <p id={`${id}-description`} className="library-screen-description">
            {t(
              'Connect your own services. Local planning and the route library work without connections.',
            )}
          </p>
          {authorizationFailed && (
            <p role="alert">
              {t(
                'GitHub authorization was cancelled or failed. Open connection settings to try again.',
              )}{' '}
              <Button variant="ghost" onClick={() => setAuthorizationFailed(false)}>
                {t('Dismiss')}
              </Button>
            </p>
          )}
          <div className="connections-toolbar">
            <label className="connections-search">
              <Search size={18} aria-hidden="true" />
              <Input
                aria-label={t('Search connectors')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('Search connectors')}
              />
            </label>
            <div className="connections-filters" role="group" aria-label={t('Filter connectors')}>
              <Button
                variant={filter === 'all' ? 'default' : 'outline'}
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                {t('All connectors')}
              </Button>
              <Button
                variant={filter === 'connected' ? 'default' : 'outline'}
                aria-pressed={filter === 'connected'}
                onClick={() => setFilter('connected')}
              >
                {t('Connected connectors')}
              </Button>
            </div>
          </div>
          <div className="connections-list" role="list" aria-label={t('Available connectors')}>
            {providers.map((provider) => (
              <ConnectorCard
                key={provider.id}
                name={provider.name}
                icon={provider.icon}
                description={provider.description}
                {...states[provider.id]}
                onManage={() => setSelected(provider.id)}
              />
            ))}
          </div>
          {!providers.length && (
            <p className="connector-empty">{t('No connectors match this filter.')}</p>
          )}
          {problem && (
            <p className="connector-error" role="alert">
              {t(connectorErrors[problem])}
            </p>
          )}
          {github.error && (
            <Button
              variant="outline"
              disabled={github.loading}
              onClick={() => void github.refresh()}
            >
              {t('Retry')}
            </Button>
          )}
          {available === false && !problem && (
            <p className="connector-note">
              {t(
                'GitHub connection is not configured on this deployment. Local routes remain available.',
              )}
            </p>
          )}
        </div>
      </div>
      {selected === 'github' && (
        <GitHubConnectionDialog
          storage={storage}
          github={github}
          onClose={() => setSelected(null)}
        />
      )}
      {disconnecting && (
        <Dialog
          title={t('Disconnect GitHub?')}
          description={t(
            'This ends the GitHub session for all tabs in this browser. Saved routes and cloud backups are not deleted.',
          )}
          compact
          initialFocusRef={cancelDisconnect}
          onClose={() => {
            if (!github.loading) setDisconnecting(false);
          }}
        >
          <div className="button-row dialog-actions">
            <Button
              ref={cancelDisconnect}
              variant="outline"
              disabled={github.loading}
              onClick={() => setDisconnecting(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={github.loading}
              onClick={() => {
                void github.disconnect().then((done) => {
                  if (done) {
                    disconnect();
                    saveGitHubRepository(null);
                    setDisconnecting(false);
                  }
                });
              }}
            >
              {t('Disconnect')}
            </Button>
          </div>
          {github.error && <p role="alert">{t(connectorErrors[github.error])}</p>}
        </Dialog>
      )}
    </section>
  );
}
