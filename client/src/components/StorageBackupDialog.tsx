import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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

const operations: Record<ConnectorOperation, string> = {
  connecting: 'Checking connection',
  listing: 'Loading cloud backups…',
  uploading: 'Encrypting and uploading backup…',
  previewing: 'Downloading and checking backup…',
  restoring: 'Restoring local library…',
};

export interface StorageBackupDialogProps {
  storage: ReturnType<typeof useStorageConnector>;
  title: string;
  description: string;
  enabled: boolean;
  loading: boolean;
  error?: ConnectorFailure | null;
  connectionContent: ReactNode;
  /** Disclosure body only; this dialog owns the details and summary elements. */
  privacy: ReactNode;
  uploadSuccess: string;
  uploadCancelWarning: string;
  onClose: () => void;
}

export function StorageBackupDialog({
  storage,
  title,
  description,
  enabled,
  loading,
  error,
  connectionContent,
  privacy,
  uploadSuccess,
  uploadCancelWarning,
  onClose,
}: StorageBackupDialogProps) {
  const { t } = useTranslation();
  const id = useId();
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
  const busy = !!storage.operation || loading;
  const selectedBackup = storage.backups.find((item) => item.id === selected);
  const summary = useBackupSummary(enabled && tab === 'create', storage.success);
  const shortPassword = passwordTouched && password.length > 0 && password.length < 12;
  const mismatch = confirmationTouched && confirmation.length > 0 && password !== confirmation;
  const connection = storage.connection;

  useEffect(() => {
    setPassword('');
    setConfirmation('');
    setRestorePassword('');
    setSelected('');
    setPasswordTouched(false);
    setConfirmationTouched(false);
    setMode('copy');
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
  const navigation = enabled ? (
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
        title={title}
        description={description}
        onClose={close}
        initialFocusRef={closeButton}
        navigation={navigation}
        footer={
          <div className="button-row dialog-actions connector-modal-footer">
            {enabled && tab === 'create' && (
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
          {connectionContent}
          {enabled && (
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
                <Button variant="outline" disabled={busy} onClick={() => void storage.refresh()}>
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
                    <Button variant="outline" disabled={busy} onClick={() => changeTab('create')}>
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
                  <section className="connector-preview" aria-label={t('Library import preview')}>
                    <p>
                      {t('{{count}} routes to import', {
                        count: storage.preview.backup.routes.length,
                      })}
                    </p>
                    <p>{t('{{count}} conflicting routes', { count: storage.preview.conflicts })}</p>
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
                      <Button variant="outline" disabled={busy} onClick={storage.dismissPreview}>
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
          <details>
            <summary>{t('Privacy and limits')}</summary>
            {privacy}
          </details>
          {enabled && tab === 'create' && summary.failed && !error && (
            <Notification
              title={title}
              variant="error"
              message={t(
                'Could not read or restore the local library. No incomplete backup was uploaded.',
              )}
            />
          )}
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
          {storage.success === 'uploaded' && <p role="status">{uploadSuccess}</p>}
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
              ? uploadCancelWarning
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
