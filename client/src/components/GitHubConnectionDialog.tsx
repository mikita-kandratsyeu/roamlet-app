import { useEffect, useId, useRef, useState } from 'react';
import { Tabs } from 'radix-ui';
import { useBackupSummary } from '../hooks/useBackupSummary';
import { Notification } from './Notification';
import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { PlannerChoice } from './PlannerChoice';
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
  permission: 'Allow Roamlet to read and save backups in your private GitHub repository.',
  'not-found':
    'Repository or backup not found. Check which repositories you have shared with Roamlet.',
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
  const [changingRepository, setChangingRepository] = useState(false);
  const [tab, setTab] = useState<'create' | 'restore'>('create');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  const [restorePassword, setRestorePassword] = useState('');
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState<ConflictMode>('copy');
  const [closeConfirm, setCloseConfirm] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const keepWorking = useRef<HTMLButtonElement>(null);
  const busy = !!storage.operation || github.loading;
  const authorized = github.session?.connected;
  const installUrl = github.session?.installUrl;
  const configuring = !storage.connection || changingRepository;
  const error = storage.error || github.error;
  const selectedBackup = storage.backups.find((item) => item.id === selected);
  const summary = useBackupSummary(
    !!authorized && !configuring && tab === 'create',
    storage.success,
  );
  const shortPassword = passwordTouched && password.length > 0 && password.length < 12;
  const mismatch = confirmationTouched && confirmation.length > 0 && password !== confirmation;
  const connection = storage.connection;

  useEffect(() => {
    if (!connection) return;
    setChangingRepository(false);
    setRepository(`${connection.owner}/${connection.repository}`);
  }, [connection]);

  function close() {
    if (storage.operation === 'restoring') return;
    if (storage.operation) {
      setCloseConfirm(true);
      return;
    }
    storage.cancel();
    onClose();
  }
  function changeTab(value: string) {
    if (busy || (value !== 'create' && value !== 'restore')) return;
    storage.dismissPreview();
    setTab(value);
  }
  const navigation =
    authorized && !configuring ? (
      <Tabs.List className="connector-operation-tabs" aria-label={t('Backup actions')}>
        <Tabs.Trigger value="create" disabled={busy}>
          {t('Create a backup')}
        </Tabs.Trigger>
        <Tabs.Trigger value="restore" disabled={busy}>
          {t('Restore a backup')}
        </Tabs.Trigger>
      </Tabs.List>
    ) : undefined;

  return (
    <Tabs.Root value={tab} onValueChange={changeTab}>
      <Dialog
        title={t('GitHub connection settings')}
        description={t('Keep a protected copy of your saved routes in your GitHub repository.')}
        onClose={close}
        initialFocusRef={closeButton}
        navigation={navigation}
        footer={
          <div className="button-row dialog-actions connector-modal-footer">
            {authorized && !configuring && tab === 'create' && (
              <Button
                disabled={
                  busy ||
                  summary.count === null ||
                  password.length < 12 ||
                  password !== confirmation
                }
                onClick={() => {
                  storage.dismissPreview();
                  void storage.upload(password);
                }}
              >
                {t('Create encrypted backup')}
              </Button>
            )}
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
          {!authorized ? (
            <>
              <ol className="connector-setup-steps" aria-label={t('Connection steps')}>
                <li aria-current="step">
                  <strong>{t('1. Allow repository access')}</strong>
                  <p>{t('Choose which private repositories Roamlet can use for your backups.')}</p>
                  {installUrl && (
                    <a href={installUrl} target="_blank" rel="noopener noreferrer">
                      {t('Manage repository access')}
                    </a>
                  )}
                </li>
                <li>
                  <strong>{t('2. Sign in with GitHub')}</strong>
                  <p>{t('After granting access, return here and sign in to finish connecting.')}</p>
                  <Button
                    disabled={busy || !github.session?.available}
                    onClick={() => window.location.assign('/api/github?action=start')}
                  >
                    {t('Sign in with GitHub')}
                  </Button>
                </li>
              </ol>
              {github.session?.available === false && (
                <p role="status">
                  {t(
                    'GitHub connection is not configured on this deployment. Local routes remain available.',
                  )}
                </p>
              )}
            </>
          ) : (
            <>
              <section
                className="connector-connection-summary"
                aria-label={t('Connection overview')}
              >
                <div>
                  <span className="connector-note">
                    {t('Signed in as {{login}}', { login: github.session?.login || 'GitHub' })}
                  </span>
                  {connection && (
                    <strong>
                      {t('Connected to {{repository}}', {
                        repository: `${connection.owner}/${connection.repository}`,
                      })}
                    </strong>
                  )}
                </div>
                {connection && !changingRepository && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setChangingRepository(true);
                      setRepository(`${connection.owner}/${connection.repository}`);
                      storage.dismissPreview();
                    }}
                  >
                    {t('Change repository')}
                  </Button>
                )}
              </section>
              {error === 'auth' && (
                <Button
                  disabled={busy}
                  onClick={() => window.location.assign('/api/github?action=start')}
                >
                  {t('Sign in with GitHub')}
                </Button>
              )}
              {configuring ? (
                <fieldset className="connector-fields" disabled={busy}>
                  <legend>
                    {connection ? t('Change repository') : t('3. Choose a backup repository')}
                  </legend>
                  <p className="connector-note">
                    {t(
                      'Choose a private repository you have shared with Roamlet. If it is missing, update repository access and reload the list.',
                    )}
                  </p>
                  <Button variant="outline" onClick={() => void github.loadRepositories()}>
                    {t('Load accessible repositories')}
                  </Button>
                  {github.repositoriesListed && github.repositories.length === 0 && (
                    <p>
                      {t(
                        'No accessible private repositories yet. Grant repository access, then reload the list.',
                      )}
                    </p>
                  )}
                  {installUrl && (
                    <a href={installUrl} target="_blank" rel="noopener noreferrer">
                      {t('Manage repository access')}
                    </a>
                  )}
                  <div className="connector-choice-field">
                    <span>{t('Private repository')}</span>
                    <PlannerChoice
                      label={t('Private repository')}
                      value={repository}
                      disabled={busy}
                      selectedLabel={!repository ? 'Choose a repository' : undefined}
                      options={[
                        { value: '', label: 'Choose a repository' },
                        ...(connection &&
                        !github.repositories.some(
                          (item) => `${item.owner}/${item.name}` === repository,
                        ) &&
                        repository
                          ? [{ value: repository, label: repository }]
                          : []),
                        ...github.repositories.map((item) => ({
                          value: `${item.owner}/${item.name}`,
                          label: `${item.owner}/${item.name}`,
                        })),
                      ]}
                      onChange={setRepository}
                    />
                  </div>
                  <div className="button-row">
                    {connection && (
                      <Button variant="outline" onClick={() => setChangingRepository(false)}>
                        {t('Cancel')}
                      </Button>
                    )}
                    <Button
                      disabled={!repository}
                      onClick={() => {
                        const [owner, name] = repository.split('/');
                        if (owner && name) {
                          setPassword('');
                          setConfirmation('');
                          setRestorePassword('');
                          setSelected('');
                          setPasswordTouched(false);
                          setConfirmationTouched(false);
                          void storage.connect({ provider: 'github', owner, repository: name });
                        }
                      }}
                    >
                      {t('Use this repository')}
                    </Button>
                  </div>
                </fieldset>
              ) : (
                <>
                  <Tabs.Content value="create" className="connector-tab-panel">
                    <p className="connector-note">
                      {t(
                        'Saved routes only. Drafts, settings and tokens are not included. Keep your backup password separately: it cannot be recovered.',
                      )}
                    </p>
                    <p role="status">
                      {summary.count !== null
                        ? t('{{count}} saved routes will be included', { count: summary.count })
                        : summary.failed
                          ? t('Library summary unavailable.')
                          : t('Checking saved routes…')}
                    </p>
                    {summary.failed && (
                      <Button variant="outline" disabled={busy} onClick={summary.retry}>
                        {t('Retry')}
                      </Button>
                    )}
                    <fieldset className="connector-fields" disabled={busy}>
                      <legend>{t('Create a backup')}</legend>
                      <label htmlFor={`${id}-password`}>
                        {t('Backup password')}
                        <Input
                          id={`${id}-password`}
                          type="password"
                          autoComplete="new-password"
                          value={password}
                          aria-invalid={shortPassword}
                          aria-describedby={`${id}-password-help`}
                          onBlur={() => setPasswordTouched(true)}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </label>
                      <p className="connector-note" id={`${id}-password-help`}>
                        {shortPassword
                          ? t('Use at least 12 characters.')
                          : t(
                              'Choose a password of at least 12 characters and keep it somewhere safe.',
                            )}
                      </p>
                      <label htmlFor={`${id}-confirm`}>
                        {t('Confirm backup password')}
                        <Input
                          id={`${id}-confirm`}
                          type="password"
                          autoComplete="new-password"
                          value={confirmation}
                          aria-invalid={mismatch}
                          aria-describedby={mismatch ? `${id}-password-match` : undefined}
                          onBlur={() => setConfirmationTouched(true)}
                          onChange={(event) => setConfirmation(event.target.value)}
                        />
                      </label>
                      {mismatch && (
                        <p id={`${id}-password-match`} className="connector-field-hint">
                          {t('Passwords do not match.')}
                        </p>
                      )}
                    </fieldset>
                  </Tabs.Content>
                  <Tabs.Content value="restore" className="connector-tab-panel">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void storage.refresh()}
                    >
                      {t('Refresh cloud backups')}
                    </Button>
                    {!storage.listed && (
                      <p className="connector-note">
                        {t('Load your backups to choose one to restore.')}
                      </p>
                    )}
                    {storage.listed && !storage.backups.length && (
                      <div className="connector-empty-backups">
                        <p>{t('No cloud backups yet.')}</p>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => changeTab('create')}
                        >
                          {t('Create a backup')}
                        </Button>
                      </div>
                    )}
                    {!!storage.backups.length && (
                      <fieldset className="connector-fields" disabled={busy}>
                        <legend>{t('Restore a backup')}</legend>
                        <div className="connector-choice-field">
                          <span>{t('Cloud backup')}</span>
                          <PlannerChoice
                            label={t('Cloud backup')}
                            value={selected}
                            disabled={busy}
                            selectedLabel={!selected ? 'Choose a backup' : undefined}
                            options={[
                              { value: '', label: 'Choose a backup' },
                              ...storage.backups.map((item) => ({
                                value: item.id,
                                label: `${item.name} · ${Math.ceil(item.size / 1024)} ${t('KiB')}`,
                              })),
                            ]}
                            onChange={(value) => {
                              setSelected(value);
                              storage.dismissPreview();
                            }}
                          />
                        </div>
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
                        <p className="connector-note">
                          {t('Enter the password used when this backup was created.')}
                        </p>
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
                      </fieldset>
                    )}
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
                        <div className="connector-choice-field">
                          <span>{t('Conflicting routes')}</span>
                          <PlannerChoice<ConflictMode>
                            label={t('Conflicting routes')}
                            value={mode}
                            disabled={busy}
                            options={[
                              { value: 'copy', label: 'Import copies' },
                              { value: 'skip', label: 'Skip existing routes' },
                              { value: 'replace', label: 'Replace existing routes' },
                            ]}
                            onChange={setMode}
                          />
                        </div>
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
                  </Tabs.Content>
                </>
              )}
            </>
          )}
          <details>
            <summary>{t('Privacy and limits')}</summary>
            <p>
              {t(
                'Roamlet processes GitHub access tokens without storing them in a database and transfers your backups without decrypting them. GitHub can see repository and file metadata. Your connection lasts up to 8 hours, then you need to sign in again.',
              )}
            </p>
            <p>
              {t(
                'Each encrypted backup can be up to 3 MiB. Keep fewer than 1000 files in the backup folder. Backups are created manually and are not deleted automatically. A cancelled upload may still complete: refresh the list before trying again.',
              )}
            </p>
          </details>
          {authorized && !configuring && tab === 'create' && summary.failed && !error && (
            <Notification
              title={t('GitHub connection settings')}
              variant="error"
              message={t(
                'Could not read or restore the local library. No incomplete backup was uploaded.',
              )}
            />
          )}
          {github.loading && <p role="status">{t('Checking GitHub access…')}</p>}
          {storage.operation && (
            <p role="status">
              <LoaderCircle size={18} className="connector-spinner" aria-hidden="true" />
              {t(operations[storage.operation])}
            </p>
          )}
          {storage.operation && storage.operation !== 'restoring' && (
            <Button variant="outline" onClick={close}>
              {t('Cancel operation')}
            </Button>
          )}
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
      {closeConfirm && (
        <Dialog
          title={t('Stop this operation?')}
          description={
            storage.operation === 'uploading'
              ? t(
                  'The backup may already have reached GitHub. Refresh the backup list before trying again. Closing also clears entered passwords.',
                )
              : t(
                  'Closing stops the current operation and clears entered passwords. Your saved routes are unchanged.',
                )
          }
          compact
          onClose={() => setCloseConfirm(false)}
          initialFocusRef={keepWorking}
        >
          <div className="button-row dialog-actions">
            <Button ref={keepWorking} variant="outline" onClick={() => setCloseConfirm(false)}>
              {t('Keep working')}
            </Button>
            <Button
              disabled={storage.operation === 'restoring'}
              onClick={() => {
                storage.cancel();
                setCloseConfirm(false);
                onClose();
              }}
            >
              {t('Stop and close')}
            </Button>
          </div>
        </Dialog>
      )}
    </Tabs.Root>
  );
}
