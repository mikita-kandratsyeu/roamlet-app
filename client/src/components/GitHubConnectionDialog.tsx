import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { ConflictMode } from '../domain/backup';
import type {
  useStorageConnector,
  ConnectorFailure,
  ConnectorOperation,
} from '../hooks/useStorageConnector';
import type { useGitHubSession } from '../hooks/useGitHubSession';

export const connectorErrors: Record<ConnectorFailure, string> = {
  configuration: 'Choose an accessible private GitHub repository.',
  unavailable:
    'GitHub connection is not configured on this deployment. Local routes remain available.',
  auth: 'Your GitHub session has expired or was revoked. Sign in again.',
  permission:
    'Grant the GitHub App access to a private repository with Contents read and write permission.',
  'not-found': 'Repository or backup not found. Check the GitHub App repository access.',
  quota: 'GitHub rate limit reached. Try again later.',
  network: 'Could not reach GitHub. Check your connection, then retry.',
  timeout: 'GitHub did not respond in time. Please retry.',
  'invalid-data': 'GitHub returned unsupported or invalid backup data.',
  'too-large':
    'GitHub backups are limited to 3 MiB encrypted data and fewer than 1000 directory entries.',
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

export function GitHubConnectionDialog({
  storage,
  github,
  onClose,
}: {
  storage: ReturnType<typeof useStorageConnector>;
  github: ReturnType<typeof useGitHubSession>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [repository, setRepository] = useState(
    storage.connection ? `${storage.connection.owner}/${storage.connection.repository}` : '',
  );
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState<ConflictMode>('copy');
  const closeButton = useRef<HTMLButtonElement>(null);
  const busy = !!storage.operation || github.loading;
  const selectedBackup = storage.backups.find((item) => item.id === selected);
  const error = storage.error || github.error;
  const authorized = github.session?.connected;
  const installUrl = github.session?.installUrl;
  function close() {
    if (storage.operation !== 'restoring') {
      storage.cancel();
      onClose();
    }
  }
  return (
    <Dialog
      title={t('GitHub connection settings')}
      description={t('Connect GitHub, choose a repository and manage encrypted library backups.')}
      onClose={close}
      initialFocusRef={closeButton}
      footer={
        <div className="button-row dialog-actions">
          <Button
            ref={closeButton}
            variant="outline"
            disabled={storage.operation === 'restoring'}
            onClick={close}
          >
            {t('Done')}
          </Button>
        </div>
      }
    >
      <div className="storage-connections">
        <p className="connector-note">
          {t(
            'Authorization is shared across tabs in this browser through an encrypted HttpOnly cookie. Roamlet server functions process GitHub tokens without storing them in a database. Backup contents are encrypted on this device before upload.',
          )}
        </p>
        {!authorized ? (
          <>
            {github.session?.available === false && (
              <p role="status">
                {t(
                  'GitHub connection is not configured on this deployment. Local routes remain available.',
                )}
              </p>
            )}
            <p>
              {t(
                'Install the GitHub App for selected private repositories, then sign in with GitHub. No personal access token is needed.',
              )}
            </p>
            {installUrl && (
              <a
                className="connector-external-link"
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('Install or configure GitHub App')}
              </a>
            )}
            <Button
              disabled={busy || !github.session?.available}
              onClick={() => window.location.assign('/api/github?action=start')}
            >
              {t('Sign in with GitHub')}
            </Button>
          </>
        ) : (
          <>
            <p>{t('Signed in as {{login}}', { login: github.session?.login || 'GitHub' })}</p>
            {error === 'auth' && (
              <Button
                disabled={busy}
                onClick={() => window.location.assign('/api/github?action=start')}
              >
                {t('Sign in with GitHub')}
              </Button>
            )}
            <fieldset className="connector-fields" disabled={busy}>
              <legend>{t('Repository access')}</legend>
              <Button variant="outline" onClick={() => void github.loadRepositories()}>
                {t('Load accessible repositories')}
              </Button>
              {installUrl && (
                <a href={installUrl} target="_blank" rel="noopener noreferrer">
                  {t('Install or configure GitHub App')}
                </a>
              )}
              <label htmlFor={`${id}-repository`}>
                {t('Private repository')}
                <select
                  id={`${id}-repository`}
                  value={repository}
                  onChange={(event) => setRepository(event.target.value)}
                >
                  <option value="">{t('Choose a repository')}</option>
                  {storage.connection &&
                    !github.repositories.some(
                      (item) => `${item.owner}/${item.name}` === repository,
                    ) &&
                    repository && <option value={repository}>{repository}</option>}
                  {github.repositories.map((item) => (
                    <option key={`${item.owner}/${item.name}`} value={`${item.owner}/${item.name}`}>
                      {item.owner}/{item.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={!repository}
                onClick={() => {
                  const [owner, name] = repository.split('/');
                  if (owner && name) {
                    setPassword('');
                    setConfirmation('');
                    setRestorePassword('');
                    setSelected('');
                    void storage.connect({ provider: 'github', owner, repository: name });
                  }
                }}
              >
                {t('Use this repository')}
              </Button>
              <p className="connector-note">
                {t(
                  'Only private repositories accessible to the installed App are listed. If a repository is missing, update App access and reload the list.',
                )}
              </p>
            </fieldset>
            {storage.connection && (
              <>
                <strong>
                  {t('Connected to {{repository}}', {
                    repository: `${storage.connection.owner}/${storage.connection.repository}`,
                  })}
                </strong>
                <div className="connector-tabs-help">
                  <p>
                    {t(
                      'Saved routes only. Drafts, settings and tokens are not included. Keep your backup password separately: it cannot be recovered.',
                    )}
                  </p>
                </div>
                <fieldset className="connector-fields" disabled={busy}>
                  <legend>{t('Create a backup')}</legend>
                  <label htmlFor={`${id}-password`}>
                    {t('Backup password')}
                    <Input
                      id={`${id}-password`}
                      type="password"
                      autoComplete="off"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        storage.dismissPreview();
                      }}
                    />
                  </label>
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
                  <p className="connector-note">
                    {t(
                      'Use at least 12 characters for a new backup. To restore, enter the password used when that backup was created.',
                    )}
                  </p>
                  <Button
                    disabled={password.length < 12 || password !== confirmation}
                    onClick={() => {
                      storage.dismissPreview();
                      void storage.upload(password);
                    }}
                  >
                    {t('Create encrypted backup')}
                  </Button>
                </fieldset>
                <fieldset className="connector-fields" disabled={busy}>
                  <legend>{t('Restore a backup')}</legend>
                  <Button variant="outline" onClick={() => void storage.refresh()}>
                    {t('Refresh cloud backups')}
                  </Button>
                  {storage.listed && !storage.backups.length && <p>{t('No cloud backups yet.')}</p>}
                  {!storage.listed && (
                    <p className="connector-note">
                      {t('Cloud backups are loaded only when requested.')}
                    </p>
                  )}
                  {!!storage.backups.length && (
                    <>
                      <label htmlFor={`${id}-backup`}>
                        {t('Cloud backup')}
                        <select
                          id={`${id}-backup`}
                          value={selected}
                          onChange={(event) => {
                            setSelected(event.target.value);
                            storage.dismissPreview();
                          }}
                        >
                          <option value="">{t('Choose a backup')}</option>
                          {storage.backups.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label htmlFor={`${id}-restore-password`}>
                        {t('Restore password')}
                        <Input
                          id={`${id}-restore-password`}
                          type="password"
                          autoComplete="off"
                          value={restorePassword}
                          onChange={(event) => {
                            setRestorePassword(event.target.value);
                            storage.dismissPreview();
                          }}
                        />
                      </label>
                      <Button
                        variant="outline"
                        disabled={!selectedBackup || !restorePassword}
                        onClick={() => {
                          setMode('copy');
                          if (selectedBackup)
                            void storage.prepareRestore(selectedBackup, restorePassword);
                        }}
                      >
                        {t('Preview restoration')}
                      </Button>
                    </>
                  )}
                </fieldset>
                {storage.preview && (
                  <section className="connector-preview" aria-label={t('Library import preview')}>
                    <p>
                      {t('{{count}} routes to import', {
                        count: storage.preview.backup.routes.length,
                      })}
                    </p>
                    <p>{t('{{count}} conflicting routes', { count: storage.preview.conflicts })}</p>
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
                      <Button variant="outline" disabled={busy} onClick={storage.dismissPreview}>
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
          </>
        )}
        <details>
          <summary>{t('Privacy and limits')}</summary>
          <p>
            {t(
              'GitHub sees repository and file metadata. Roamlet relays encrypted backups through its server functions, without decrypting them. Sessions expire after at most 8 hours: sign in again to continue.',
            )}
          </p>
          <p>
            {t(
              'Encrypted backups are limited to 3 MiB by the server transport. Keep the backup directory below 1000 entries. No automatic sync or cloud deletion. A cancelled upload may still complete: refresh before retrying.',
            )}
          </p>
        </details>
        {github.loading && <p role="status">{t('Checking GitHub access…')}</p>}
        {storage.operation && (
          <p role="status">
            <LoaderCircle size={18} className="connector-spinner" aria-hidden="true" />
            {t(operations[storage.operation])}
          </p>
        )}
        {storage.operation && storage.operation !== 'restoring' && (
          <Button variant="outline" onClick={storage.cancel}>
            {t('Cancel operation')}
          </Button>
        )}
        {error && <p role="alert">{t(connectorErrors[error])}</p>}
        {storage.success === 'uploaded' && (
          <p role="status">{t('Encrypted backup saved to GitHub.')}</p>
        )}
        {storage.success === 'restored' && (
          <p role="status">
            {t('Library restored on this device. The current editor route is unchanged.')}
          </p>
        )}
      </div>
    </Dialog>
  );
}
