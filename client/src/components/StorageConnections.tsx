import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, LoaderCircle, Plug } from 'lucide-react';
import './Library.css';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  useStorageConnector,
  type ConnectorFailure,
  type ConnectorOperation,
} from '../hooks/useStorageConnector';
import type { ConflictMode } from '../domain/backup';
import './StorageConnections.css';

const errors: Record<ConnectorFailure, string> = {
  configuration: 'Enter a valid GitHub owner, repository and token.',
  auth: 'GitHub rejected the token. Check its value and expiry, then reconnect.',
  permission: 'Use a private repository and grant the token Contents read and write access.',
  'not-found': 'Repository or backup not found. Check the repository and token access.',
  quota: 'GitHub rate limit reached. Try again later.',
  network: 'Could not reach GitHub. Check your connection and browser restrictions, then retry.',
  timeout: 'GitHub did not respond in time. Please retry.',
  'invalid-data': 'GitHub returned unsupported or invalid backup data.',
  'too-large': 'This backup or repository listing exceeds the pilot limits.',
  conflict: 'GitHub rejected the new backup. Refresh the list before retrying.',
  local: 'Could not read or restore the local library. No incomplete backup was uploaded.',
  password:
    'Check the backup password. It must have at least 12 characters for a new backup. Damaged or unsupported backups cannot be restored.',
};
const operations: Record<ConnectorOperation, string> = {
  connecting: 'Checking GitHub connection…',
  listing: 'Loading cloud backups…',
  uploading: 'Encrypting and uploading backup…',
  previewing: 'Downloading and checking backup…',
  restoring: 'Restoring local library…',
};

export function StorageConnections({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const storage = useStorageConnector();
  const { cancel, connection } = storage;
  const [owner, setOwner] = useState('');
  const [repository, setRepository] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState<ConflictMode>('copy');
  const [selectedConnector, setSelectedConnector] = useState(false);
  const backButton = useRef<HTMLButtonElement>(null);
  const ownerFocus = useRef<HTMLInputElement>(null);
  const needsAttention = connection && storage.connectionIssue;
  const id = useId();
  const busy = storage.operation !== null;
  const selectedBackup = storage.backups.find((entry) => entry.id === selected);
  const newPasswordValid = password.length >= 12 && password === confirmation;

  useEffect(() => {
    if (!open) {
      cancel();
      setToken('');
      setPassword('');
      setConfirmation('');
      setSelected('');
      setSelectedConnector(false);
    } else backButton.current?.focus({ preventScroll: true });
  }, [open, cancel]);
  useEffect(() => {
    if (selectedConnector && !connection) ownerFocus.current?.focus({ preventScroll: true });
  }, [selectedConnector, connection]);
  useEffect(() => {
    if (connection) setToken('');
  }, [connection]);

  if (!open) return null;
  function close() {
    if (storage.operation === 'restoring') return;
    cancel();
    onClose();
  }
  function changePassword(value: string) {
    setPassword(value);
    storage.dismissPreview();
  }

  return (
    <section
      className="library-screen connections-screen"
      role="region"
      aria-label={t('Connections')}
      aria-describedby={`${id}-description`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
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
              'Optional encrypted library backups in your own GitHub repository. Local planning stays independent.',
            )}
          </p>
          <div className="connections-layout">
            <div className="connections-list" role="list" aria-label={t('Available connectors')}>
              <article className="connector-card" role="listitem">
                <div className="connector-card-heading">
                  <img
                    src="/github-mark.png"
                    width="48"
                    height="48"
                    alt=""
                    className="github-brand-mark"
                  />
                  <div>
                    <h2>GitHub</h2>
                    <span
                      className="connector-status"
                      data-connected={!!connection}
                      data-attention={!!needsAttention}
                      role="status"
                    >
                      {storage.operation === 'connecting'
                        ? t('Checking connection')
                        : needsAttention
                          ? t('Connection needs attention')
                          : connection
                            ? t('Connected')
                            : t('Not connected')}
                    </span>
                  </div>
                </div>
                <p>{t('Encrypted route library backups in a private repository.')}</p>
                {connection && (
                  <p className="connector-repository">
                    {connection.owner}/{connection.repository}
                  </p>
                )}
                <Button
                  variant="outline"
                  aria-expanded={selectedConnector}
                  aria-controls={`${id}-management`}
                  onClick={() => setSelectedConnector(true)}
                >
                  {connection ? t('Manage connection') : t('Set up connection')}
                </Button>
                {connection && (
                  <Button
                    variant="ghost"
                    disabled={storage.operation === 'restoring'}
                    onClick={() => {
                      storage.disconnect();
                      setPassword('');
                      setConfirmation('');
                      setSelected('');
                    }}
                  >
                    {t('Disconnect')}
                  </Button>
                )}
              </article>
            </div>
            {selectedConnector ? (
              <div
                id={`${id}-management`}
                className="storage-connections"
                role="region"
                aria-label={t('GitHub connection settings')}
              >
                <h2>{t('GitHub connection settings')}</h2>
                <p className="connector-note" id={`${id}-privacy`}>
                  {t(
                    'The token is kept only in this tab’s memory and sent only to GitHub. Reloading or disconnecting forgets it. Roamlet servers receive neither the token nor backups.',
                  )}
                </p>
                <details>
                  <summary>{t('GitHub setup and pilot limits')}</summary>
                  <p>
                    {t(
                      'Create a private repository with an initial commit. Create a fine-grained personal access token limited to that repository with Contents read and write permission. Organization approval may be required.',
                    )}
                  </p>
                  <a
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('Create GitHub token')}
                  </a>
                  <p>
                    {t(
                      'Backups contain saved routes only, not the current draft, settings or tokens. Files are encrypted before upload. GitHub still sees repository and file metadata. Remember the password: Roamlet cannot recover it.',
                    )}
                  </p>
                  <p>
                    {t(
                      'Manual backups only. No automatic sync or cloud deletion. Up to 1000 snapshots in roamlet-backups. Library JSON is limited to 20 MiB. A cancelled upload may still have reached GitHub: refresh before retrying.',
                    )}
                  </p>
                </details>
                {!connection ? (
                  <form
                    autoComplete="off"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void storage.connect({ provider: 'github', owner, repository, token });
                    }}
                  >
                    <label htmlFor={`${id}-owner`}>
                      {t('GitHub owner')}
                      <Input
                        id={`${id}-owner`}
                        ref={ownerFocus}
                        required
                        disabled={busy}
                        value={owner}
                        onChange={(event) => setOwner(event.target.value)}
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                    </label>
                    <label htmlFor={`${id}-repo`}>
                      {t('Private repository')}
                      <Input
                        id={`${id}-repo`}
                        required
                        disabled={busy}
                        value={repository}
                        onChange={(event) => setRepository(event.target.value)}
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                    </label>
                    <label htmlFor={`${id}-token`}>
                      {t('GitHub access token')}
                      <Input
                        id={`${id}-token`}
                        type="password"
                        autoComplete="off"
                        aria-describedby={`${id}-privacy`}
                        required
                        disabled={busy}
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                      />
                    </label>
                    <Button type="submit" disabled={busy}>
                      {t('Connect GitHub')}
                    </Button>
                  </form>
                ) : (
                  <>
                    <div className="connector-account">
                      <strong>
                        {t('Connected to {{repository}}', {
                          repository: `${connection.owner}/${connection.repository}`,
                        })}
                      </strong>
                    </div>
                    <fieldset disabled={busy} className="connector-fields">
                      <legend>{t('Encrypted backups')}</legend>
                      <label htmlFor={`${id}-password`}>
                        {t('Backup password')}
                        <Input
                          id={`${id}-password`}
                          type="password"
                          autoComplete="off"
                          value={password}
                          onChange={(event) => changePassword(event.target.value)}
                          aria-describedby={`${id}-password-help`}
                        />
                      </label>
                      <p id={`${id}-password-help`} className="connector-note">
                        {t(
                          'Use at least 12 characters for a new backup. To restore, enter the password used when that backup was created.',
                        )}
                      </p>
                      <label htmlFor={`${id}-confirm`}>
                        {t('Confirm backup password')}
                        <Input
                          id={`${id}-confirm`}
                          type="password"
                          autoComplete="off"
                          value={confirmation}
                          onChange={(event) => setConfirmation(event.target.value)}
                        />
                      </label>
                      <Button
                        disabled={!newPasswordValid}
                        onClick={() => {
                          storage.dismissPreview();
                          void storage.upload(password);
                        }}
                      >
                        {t('Create encrypted backup')}
                      </Button>
                      <Button variant="outline" onClick={() => void storage.refresh()}>
                        {t('Refresh cloud backups')}
                      </Button>
                      {!storage.listed && (
                        <p className="connector-note">
                          {t(
                            'Refresh to retrieve all cloud backups. No requests run automatically.',
                          )}
                        </p>
                      )}
                      {storage.listed && storage.backups.length === 0 && (
                        <p>{t('No cloud backups yet.')}</p>
                      )}
                      {storage.backups.length > 0 && (
                        <>
                          <label htmlFor={`${id}-backup`}>
                            {t('Cloud backup')}
                            <select
                              id={`${id}-backup`}
                              value={selected}
                              onChange={(event) => {
                                setSelected(event.target.value);
                                storage.dismissPreview();
                                setMode('copy');
                              }}
                            >
                              <option value="">{t('Choose a backup')}</option>
                              {storage.backups.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Button
                            variant="outline"
                            disabled={!selectedBackup || !password}
                            onClick={() => {
                              setMode('copy');
                              if (selectedBackup)
                                void storage.prepareRestore(selectedBackup, password);
                            }}
                          >
                            {t('Preview restoration')}
                          </Button>
                        </>
                      )}
                    </fieldset>
                    {storage.preview && (
                      <section
                        className="connector-preview"
                        aria-label={t('Library import preview')}
                      >
                        <p>
                          {t('{{count}} routes to import', {
                            count: storage.preview.backup.routes.length,
                          })}
                        </p>
                        <p>
                          {t('{{count}} conflicting routes', { count: storage.preview.conflicts })}
                        </p>
                        <p>{t('Import changes only your library, not the route in the editor.')}</p>
                        <label htmlFor={`${id}-mode`}>
                          {t('Conflicting routes')}
                          <select
                            id={`${id}-mode`}
                            disabled={busy}
                            value={mode}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (value === 'copy' || value === 'skip' || value === 'replace')
                                setMode(value);
                            }}
                          >
                            <option value="copy">{t('Import copies')}</option>
                            <option value="skip">{t('Skip existing routes')}</option>
                            <option value="replace">{t('Replace existing routes')}</option>
                          </select>
                        </label>
                        {mode === 'replace' && (
                          <p>
                            {t(
                              'Confirming will replace conflicting saved routes with the backup versions.',
                            )}
                          </p>
                        )}
                        <div className="button-row">
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={storage.dismissPreview}
                          >
                            {t('Cancel import')}
                          </Button>
                          <Button disabled={busy} onClick={() => void storage.restore(mode)}>
                            {t('Import routes')}
                          </Button>
                        </div>
                      </section>
                    )}
                  </>
                )}
                {storage.operation && (
                  <p role="status">
                    <LoaderCircle size={18} aria-hidden="true" className="connector-spinner" />
                    {t(operations[storage.operation])}
                  </p>
                )}
                {busy && storage.operation !== 'restoring' && (
                  <Button variant="outline" onClick={cancel}>
                    {t('Cancel operation')}
                  </Button>
                )}
                {storage.error && <p role="alert">{t(errors[storage.error])}</p>}
                {storage.success === 'uploaded' && (
                  <p role="status">{t('Encrypted backup saved to GitHub.')}</p>
                )}
                {storage.success === 'restored' && (
                  <p role="status">
                    {t('Library restored on this device. The current editor route is unchanged.')}
                  </p>
                )}
              </div>
            ) : (
              <p className="connector-selection-hint">
                {t('Choose a connector to view setup and backup actions.')}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
