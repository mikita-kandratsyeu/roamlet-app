import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plug, Search } from 'lucide-react';
import './Library.css';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog } from './Dialog';
import { Notification } from './Notification';
import { useStorageConnector } from '../hooks/useStorageConnector';
import { useGitHubSession } from '../hooks/useGitHubSession';
import { useGoogleDriveSession } from '../hooks/useGoogleDriveSession';
import { GoogleDriveConnectionDialog, googleDriveErrors } from './GoogleDriveConnectionDialog';
import { STORAGE_PROVIDERS, type StorageProviderId } from '../services/connectors/registry';
import {
  loadGitHubRepository,
  saveGitHubRepository,
  GITHUB_REPOSITORY_KEY,
} from '../domain/connectorPreferences';
import { GitHubConnectionDialog, connectorErrors } from './GitHubConnectionDialog';
import { ConnectorCard, type ConnectorStatus } from './ConnectorCard';
import './StorageConnections.css';
import { useAiConnection } from '../hooks/useAiConnection';
import { AiConnectionDialog } from './AiConnectionDialog';

export function StorageConnections({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const storage = useStorageConnector();
  const googleStorage = useStorageConnector();
  const google = useGoogleDriveSession(open);
  const github = useGitHubSession(open);
  const { connect, disconnect, cancel, connection } = storage;
  const ai = useAiConnection(open);
  const [aiDisconnecting, setAiDisconnecting] = useState(false);
  const [selected, setSelected] = useState<StorageProviderId | 'ai' | null>(null);
  const [disconnecting, setDisconnecting] = useState<StorageProviderId | null>(null);
  const [authorizationFailed, setAuthorizationFailed] = useState<StorageProviderId | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('google') === 'error'
      ? 'google-drive'
      : params.get('github') === 'error'
        ? 'github'
        : null;
  });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'connected'>('all');
  const backButton = useRef<HTMLButtonElement>(null);
  const cancelDisconnect = useRef<HTMLButtonElement>(null);
  const id = useId();
  const authenticated = github.session?.connected;
  const login = github.session?.login;
  const available = github.session?.available;
  const previousAccount = useRef<string | undefined>(undefined);
  const previousGoogleAccount = useRef<string | undefined>(undefined);
  const {
    connect: connectGoogle,
    disconnect: disconnectGoogle,
    cancel: cancelGoogle,
    connection: googleConnection,
  } = googleStorage;
  const googleAuthenticated = google.session?.connected;
  const googleAccountId = google.session?.accountId;
  useEffect(() => {
    if (!open) {
      cancel();
      cancelGoogle();
      setSelected(null);
      setDisconnecting(null);
    } else backButton.current?.focus({ preventScroll: true });
  }, [open, cancel, cancelGoogle]);
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
  useEffect(() => {
    if (!open || googleAuthenticated === undefined) return;
    if (!googleAuthenticated) {
      disconnectGoogle();
      previousGoogleAccount.current = undefined;
      return;
    }
    if (previousGoogleAccount.current && previousGoogleAccount.current !== googleAccountId)
      disconnectGoogle();
    previousGoogleAccount.current = googleAccountId;
    if (!googleConnection || googleConnection.provider !== 'google-drive')
      void connectGoogle({ provider: 'google-drive' });
  }, [
    open,
    googleAuthenticated,
    googleAccountId,
    connectGoogle,
    disconnectGoogle,
    googleConnection,
  ]);
  if (!open) return null;
  function close() {
    if (storage.operation !== 'restoring' && googleStorage.operation !== 'restoring') {
      cancel();
      cancelGoogle();
      onClose();
    }
  }
  const problem = github.error || storage.connectionIssue;
  const error = storage.error || github.error;
  const googleError = googleStorage.error || google.error;
  const googleProblem = google.error || googleStorage.connectionIssue;
  const errorMessage =
    authorizationFailed === 'github'
      ? t('GitHub authorization was cancelled or failed. Open connection settings to try again.')
      : error
        ? t(connectorErrors[error])
        : null;
  const states: Record<
    StorageProviderId,
    {
      connected: boolean;
      status: ConnectorStatus;
      account?: string;
      busy: boolean;
      onDisconnect: () => void;
      onRetry: () => void;
      retrying: boolean;
    }
  > = {
    'google-drive': {
      connected: !!googleAuthenticated,
      status: google.loading
        ? 'checking'
        : googleProblem
          ? 'attention'
          : google.session?.available === false
            ? 'unavailable'
            : googleAuthenticated
              ? 'connected'
              : 'disconnected',
      account: googleAuthenticated ? google.session?.email : undefined,
      busy: google.loading || googleStorage.operation === 'restoring',
      onDisconnect: () => setDisconnecting('google-drive'),
      onRetry: () => void google.refresh(),
      retrying: google.loading,
    },
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
        ? `${login || 'GitHub'}${connection?.provider === 'github' ? ` · ${connection.owner}/${connection.repository}` : ''}`
        : undefined,
      busy: github.loading || storage.operation === 'restoring',
      onDisconnect: () => setDisconnecting('github'),
      onRetry: () => void github.refresh(),
      retrying: github.loading,
    },
  };
  const providers = STORAGE_PROVIDERS.filter(
    (provider) =>
      provider.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === 'all' || states[provider.id].connected),
  );
  const showAi = `${t('AI route assistant')} AI OpenAI`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (filter === 'all' || ai.session?.connected);
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
          disabled={storage.operation === 'restoring' || googleStorage.operation === 'restoring'}
          onClick={close}
        >
          <ArrowLeft size={18} aria-hidden="true" />
          {t('Back to map')}
        </Button>
      </header>
      <div className="library-screen-scroll">
        <div className="route-library connections-content">
          <p id={`${id}-description`} className="library-screen-description">
            {t(
              'Connect your own services. Local planning and the route library work without connections.',
            )}
          </p>
          <div className="library-toolbar">
            <Label className="library-search">
              <Search size={18} aria-hidden="true" />
              <Input
                aria-label={t('Search connectors')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('Search connectors')}
              />
            </Label>
            <div className="connections-filters" role="group" aria-label={t('Filter connectors')}>
              <Button
                variant="outline"
                className="library-favorite-filter"
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                {t('All connectors')}
              </Button>
              <Button
                variant="outline"
                className="library-favorite-filter"
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
            {showAi && <ConnectorCard name={t('AI route assistant')} icon="/ai-connector.svg"
              description="Describe route preferences in your own words. AI suggests settings. You approve every change. Uses your own API key."
              connected={!!ai.session?.connected}
              status={ai.loading ? 'checking' : ai.error ? 'attention' : ai.session?.available === false ? 'unavailable' : ai.session?.connected ? 'connected' : 'disconnected'}
              account={ai.session?.connection?.model} busy={ai.loading} retrying={ai.loading}
              onRetry={() => void ai.refresh()} onManage={() => { setAiDisconnecting(false); setSelected('ai'); }}
              onDisconnect={() => { setAiDisconnecting(true); setSelected('ai'); }} />}
          </div>
          {!providers.length && !showAi && (
            <p className="connector-empty">{t('No connectors match this filter.')}</p>
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
      {errorMessage && (
        <Notification
          title={t('GitHub connection settings')}
          variant="error"
          message={errorMessage}
          onDismiss={
            authorizationFailed === 'github' ? () => setAuthorizationFailed(null) : undefined
          }
        />
      )}
      {(authorizationFailed === 'google-drive' || googleError) && (
        <Notification
          title={t('Google Drive connection settings')}
          variant="error"
          message={
            authorizationFailed === 'google-drive'
              ? t(
                  'Google authorization was cancelled or failed. Open connection settings to try again.',
                )
              : googleError
                ? t(googleDriveErrors[googleError])
                : ''
          }
          onDismiss={
            authorizationFailed === 'google-drive' ? () => setAuthorizationFailed(null) : undefined
          }
        />
      )}
      {selected === 'ai' && <AiConnectionDialog ai={ai} disconnectInitially={aiDisconnecting} onClose={() => setSelected(null)} />}
      {selected === 'google-drive' && (
        <GoogleDriveConnectionDialog
          storage={googleStorage}
          google={google}
          onClose={() => setSelected(null)}
        />
      )}
      {selected === 'github' && (
        <GitHubConnectionDialog
          storage={storage}
          github={github}
          onClose={() => setSelected(null)}
        />
      )}
      {disconnecting && (
        <Dialog
          title={
            disconnecting === 'github' ? t('Disconnect GitHub?') : t('Disconnect Google Drive?')
          }
          description={
            disconnecting === 'github'
              ? t(
                  'This ends the GitHub session for all tabs in this browser. Saved routes and cloud backups are not deleted.',
                )
              : t(
                  'This ends the Google Drive session for all tabs in this browser. Saved routes and cloud backups are not deleted.',
                )
          }
          compact
          initialFocusRef={cancelDisconnect}
          onClose={() => {
            if (!(disconnecting === 'github' ? github.loading : google.loading))
              setDisconnecting(null);
          }}
        >
          <div className="button-row dialog-actions">
            <Button
              ref={cancelDisconnect}
              variant="outline"
              disabled={disconnecting === 'github' ? github.loading : google.loading}
              onClick={() => setDisconnecting(null)}
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={disconnecting === 'github' ? github.loading : google.loading}
              onClick={() => {
                if (disconnecting === 'github')
                  void github.disconnect().then((done) => {
                    if (done) {
                      disconnect();
                      saveGitHubRepository(null);
                      setDisconnecting(null);
                    }
                  });
                else
                  void google.disconnect().then((done) => {
                    if (done) {
                      disconnectGoogle();
                      setDisconnecting(null);
                    }
                  });
              }}
            >
              {t('Disconnect')}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
