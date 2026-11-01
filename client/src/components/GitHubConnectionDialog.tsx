import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { PlannerChoice } from './PlannerChoice';
import { StorageBackupDialog } from './StorageBackupDialog';
import type { useStorageConnector, ConnectorFailure } from '../hooks/useStorageConnector';
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
  const connection = storage.connection?.provider === 'github' ? storage.connection : null;
  const [repository, setRepository] = useState(
    connection ? `${connection.owner}/${connection.repository}` : '',
  );
  const [changingRepository, setChangingRepository] = useState(false);
  const busy = !!storage.operation || github.loading;
  const authorized = github.session?.connected;
  const installUrl = github.session?.installUrl;
  const configuring = !connection || changingRepository;
  const error = storage.error || github.error;

  useEffect(() => {
    if (!connection) return;
    setChangingRepository(false);
    setRepository(`${connection.owner}/${connection.repository}`);
  }, [connection]);

  return (
    <StorageBackupDialog
      storage={storage}
      title={t('GitHub connection settings')}
      description={t('Keep a protected copy of your saved routes in your GitHub repository.')}
      enabled={!!authorized && !configuring}
      loading={github.loading}
      error={error}
      onClose={onClose}
      uploadSuccess={t('Encrypted backup saved to GitHub.')}
      uploadCancelWarning={t(
        'The backup may already have reached GitHub. Refresh the backup list before trying again. Closing also clears entered passwords.',
      )}
      connectionContent={
        <>
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
                          void storage.connect({ provider: 'github', owner, repository: name });
                        }
                      }}
                    >
                      {t('Use this repository')}
                    </Button>
                  </div>
                </fieldset>
              ) : null}
            </>
          )}
          {github.loading && <p role="status">{t('Checking GitHub access…')}</p>}
        </>
      }
      privacy={
        <>
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
        </>
      }
    />
  );
}
