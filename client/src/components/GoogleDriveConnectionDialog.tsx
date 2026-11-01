import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { StorageBackupDialog } from './StorageBackupDialog';
import type { useStorageConnector, ConnectorFailure } from '../hooks/useStorageConnector';
import type { useGoogleDriveSession } from '../hooks/useGoogleDriveSession';

export const googleDriveErrors: Record<ConnectorFailure, string> = {
  configuration: 'Google Drive connection settings are invalid. Please reconnect.',
  unavailable: 'Google Drive is not configured on this deployment. Local routes remain available.',
  auth: 'Your Google Drive session has expired or was revoked. Sign in again.',
  permission: 'Allow Roamlet to access its own backup data in Google Drive.',
  'not-found': 'This Google Drive backup is no longer available. Refresh the list.',
  quota: 'Google Drive quota or request limit reached. Try again later.',
  network: 'Could not reach Google Drive. Check your connection, then retry.',
  timeout: 'Google Drive did not respond in time. Please retry.',
  'invalid-data': 'Google Drive returned unsupported or invalid backup data.',
  'too-large': 'Google Drive backups are limited to 3 MiB encrypted data and 1000 listed backups.',
  conflict: 'Google Drive could not save this backup. Refresh the list before retrying.',
  local: 'Could not read or restore the local library. No incomplete backup was uploaded.',
  password:
    'Check the backup password. It must have at least 12 characters for a new backup. Damaged or unsupported backups cannot be restored.',
};

export function GoogleDriveConnectionDialog({
  storage,
  google,
  onClose,
}: {
  storage: ReturnType<typeof useStorageConnector>;
  google: ReturnType<typeof useGoogleDriveSession>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const authorized = google.session?.connected;
  const error = storage.error || google.error;
  const busy = google.loading || !!storage.operation;
  return (
    <StorageBackupDialog
      storage={storage}
      title={t('Google Drive connection settings')}
      description={t('Keep a protected copy of your saved routes in your Google Drive.')}
      enabled={!!authorized && storage.connection?.provider === 'google-drive'}
      loading={google.loading}
      error={error}
      uploadSuccess={t('Encrypted backup saved to Google Drive.')}
      uploadCancelWarning={t(
        'The backup may already have reached Google Drive. Refresh the backup list before trying again. Closing also clears entered passwords.',
      )}
      onClose={onClose}
      connectionContent={
        authorized ? (
          <>
            <section className="connector-connection-summary" aria-label={t('Connection overview')}>
              <div>
                <span className="connector-note">
                  {t('Signed in as {{login}}', { login: google.session?.email || 'Google' })}
                </span>
                <strong>{t('Roamlet backup storage in Google Drive')}</strong>
              </div>
            </section>
            {error === 'auth' && (
              <Button
                disabled={busy}
                onClick={() => window.location.assign('/api/google-drive?action=start')}
              >
                {t('Sign in with Google')}
              </Button>
            )}
            {!storage.connection && (
              <Button
                disabled={busy}
                onClick={() => void storage.connect({ provider: 'google-drive' })}
              >
                {t('Check Google Drive access')}
              </Button>
            )}
          </>
        ) : (
          <>
            <p>
              {t(
                'Connect Google Drive to keep encrypted copies of your route library. Roamlet can access only its own data, not your other files.',
              )}
            </p>
            <Button
              disabled={busy || !google.session?.available}
              onClick={() => window.location.assign('/api/google-drive?action=start')}
            >
              {t('Sign in with Google')}
            </Button>
            {google.session?.available === false && (
              <p role="status">
                {t(
                  'Google Drive is not configured on this deployment. Local routes remain available.',
                )}
              </p>
            )}
          </>
        )
      }
      privacy={
        <details>
          <summary>{t('Privacy and limits')}</summary>
          <p>
            {t(
              'Backups are stored in hidden Roamlet application storage in your Google Drive. They do not appear in My Drive. Create and restore them here; access is limited to Roamlet data.',
            )}
          </p>
          <p>
            {t(
              'Roamlet server functions process Google access tokens and encrypted backups without a database or decrypting your backups. Your Google email identifies the connected account. Google can see file metadata.',
            )}
          </p>
          <p>
            {t(
              'Google access lasts up to about one hour. Refresh tokens are not stored: sign in again after expiry. Disconnecting ends this connection across tabs, without deleting backups.',
            )}
          </p>
          <p>
            {t(
              'Each encrypted backup can be up to 3 MiB. Up to 1000 backups can be listed. Backups are created manually and are not deleted automatically. A cancelled upload may still complete: refresh before retrying.',
            )}
          </p>
        </details>
      }
    />
  );
}
