import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectorCard } from './ConnectorCard';
import { Dialog } from './Dialog';
import { Notification } from './Notification';
import { Button } from './ui/button';
import type { useGoogleCalendarSession } from '../hooks/useGoogleCalendarSession';
import { googleCalendarErrors } from '../services/connectors/googleCalendar';

export function GoogleCalendarConnection({
  google,
}: {
  google: ReturnType<typeof useGoogleCalendarSession>;
}) {
  const { t } = useTranslation();
  const [managing, setManaging] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [authorizationFailed, setAuthorizationFailed] = useState(
    () => new URLSearchParams(window.location.search).get('calendar') === 'error',
  );
  const cancel = useRef<HTMLButtonElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const connected = !!google.session?.connected;
  return (
    <>
      <ConnectorCard
        name="Google Calendar"
        icon="/google-calendar-2026.svg"
        description="Reserve time for a route in a separate Roamlet calendar."
        connected={connected}
        account={connected ? google.session?.email : undefined}
        status={
          google.loading
            ? 'checking'
            : google.error || (google.knownConnected && !connected)
              ? 'attention'
              : google.session?.available === false
                ? 'unavailable'
                : connected
                  ? 'connected'
                  : 'disconnected'
        }
        busy={google.loading}
        retrying={google.loading}
        onRetry={() => void google.refresh()}
        onManage={() => setManaging(true)}
        onDisconnect={() => setDisconnecting(true)}
      />
      {(google.error || authorizationFailed) && (
        <Notification
          title={t('Google Calendar connection settings')}
          variant="error"
          message={
            authorizationFailed
              ? t('Google Calendar authorization was cancelled or failed. Try connecting again.')
              : google.error
                ? t(googleCalendarErrors[google.error])
                : ''
          }
          onDismiss={authorizationFailed ? () => setAuthorizationFailed(false) : undefined}
        />
      )}
      {managing && (
        <Dialog
          title={t('Google Calendar connection settings')}
          description={t(
            'Calendar publishing is optional. Local planning and ICS export need no connection.',
          )}
          onClose={() => setManaging(false)}
          initialFocusRef={done}
          footer={
            <div className="button-row dialog-actions connector-modal-footer">
              <Button ref={done} variant="outline" onClick={() => setManaging(false)}>
                {t('Done')}
              </Button>
            </div>
          }
        >
          <div className="storage-connections">
            {connected && (
              <section
                className="connector-connection-summary"
                aria-label={t('Connection overview')}
              >
                <div>
                  <span className="connector-note">
                    {t('Signed in as {{login}}', { login: google.session?.email })}
                  </span>
                  <strong>{t('Roamlet calendar')}</strong>
                </div>
              </section>
            )}
            <p>
              {t(
                'Roamlet creates a separate calendar on your first publication. It does not read your other calendars.',
              )}
            </p>
            <p>
              {t(
                'Create or update an event from Route schedule. Changes are never sent automatically.',
              )}
            </p>
            {(!connected || google.error === 'auth') && (
              <Button
                disabled={google.loading || !google.session?.available}
                onClick={() => window.location.assign('/api/google-calendar?action=start')}
              >
                {t('Sign in with Google')}
              </Button>
            )}
            {google.session?.available === false && (
              <p role="status">{t(googleCalendarErrors.unavailable)}</p>
            )}
            <details>
              <summary>{t('Privacy and limits')}</summary>
              <p>
                {t(
                  'Only the confirmed event details are sent to Google. GPX and full route geometry are not attached.',
                )}
              </p>
              <p>
                {t(
                  'Calendar access lasts up to one hour. Sign in again after expiry. Disconnecting removes the browser session, not calendar events or the Google Drive connection.',
                )}
              </p>
              <p>
                {t(
                  'You can revoke Google authorization in your Google account settings; this may also affect Google Drive.',
                )}
              </p>
            </details>
          </div>
        </Dialog>
      )}
      {disconnecting && (
        <Dialog
          title={t('Disconnect Google Calendar?')}
          description={t(
            'This ends the Calendar session across browser tabs. Existing events, local routes and the Google Drive connection are kept.',
          )}
          compact
          initialFocusRef={cancel}
          dismissible={!google.loading}
          onClose={() => setDisconnecting(false)}
        >
          <div className="button-row dialog-actions">
            <Button
              ref={cancel}
              variant="outline"
              disabled={google.loading}
              onClick={() => setDisconnecting(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={google.loading}
              onClick={() =>
                void google.disconnect().then((done) => {
                  if (done) setDisconnecting(false);
                })
              }
            >
              {t('Disconnect')}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
