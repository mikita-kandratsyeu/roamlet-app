import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Download } from 'lucide-react';
import {
  buildCalendarEvent,
  CalendarDraftError,
  calendarEventFingerprint,
  calendarEventIcs,
  createCalendarEventId,
  type CalendarEventDraft,
} from '../domain/calendar';
import { useGoogleCalendarSession } from '../hooks/useGoogleCalendarSession';
import { useCalendarPublication } from '../hooks/useCalendarPublication';
import { googleCalendarErrors } from '../services/connectors/googleCalendar';
import { Dialog } from './Dialog';
import { Notification } from './Notification';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import './RouteCalendarActions.css';

export interface RouteCalendarInput {
  routeId: string;
  name: string;
  description: string;
  canPublish: boolean;
  online: boolean;
}
const draftErrors = {
  'time-zone': 'Enter a valid IANA time zone, for example Europe/Warsaw.',
  departure: 'Choose a valid departure date between 1900 and 2100.',
  'ambiguous-time':
    'This departure occurs twice during a clock change. Choose an unambiguous time.',
  'missing-time': 'This departure does not exist during a clock change. Choose another time.',
  duration: 'A positive, complete route duration is needed for a calendar event.',
  fields: 'Check the event title, description and reminder (0–40320 whole minutes).',
};
export function RouteCalendarActions({
  input,
  departureLocal,
  durationSeconds,
  location,
}: {
  input: RouteCalendarInput;
  departureLocal?: string;
  durationSeconds: number | null;
  location: string;
}) {
  const { t } = useTranslation();
  const google = useGoogleCalendarSession(true);
  const publication = useCalendarPublication(
    google.session?.accountId,
    input.routeId,
    !!google.session?.connected,
  );
  const [localEventId] = useState(createCalendarEventId);
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [reminder, setReminder] = useState('30');
  const [notice, setNotice] = useState<'saved' | 'cancelled' | 'download-error' | null>(null);
  const id = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);
  const { record } = publication;
  useEffect(() => {
    if (record) {
      setTimeZone(record.timeZone);
      setReminder(String(record.reminderMinutes));
    }
  }, [record]);
  let event: CalendarEventDraft | null = null;
  let draftError: string | null = null;
  try {
    event = buildCalendarEvent({
      eventId: record?.eventId ?? localEventId,
      name: input.name || t('Route'),
      description: input.description,
      departureLocal: departureLocal ?? '',
      durationSeconds: durationSeconds ?? NaN,
      timeZone,
      reminderMinutes: reminder.trim() ? Number(reminder) : NaN,
      location,
    });
  } catch (failure) {
    draftError = t(
      failure instanceof CalendarDraftError ? draftErrors[failure.code] : draftErrors.fields,
    );
  }
  const changed =
    !!record?.fingerprint && !!event && record.fingerprint !== calendarEventFingerprint(event);
  const googleVisible = google.knownConnected || !!google.session?.connected;
  const publicationError =
    publication.error === 'local'
      ? t(
          'Could not safely save the local calendar event reference. No new publication can start until local storage is available.',
        )
      : publication.error
        ? t(googleCalendarErrors[publication.error])
        : null;
  function close() {
    if (publication.busy) setStopping(true);
    else setOpen(false);
  }
  function download() {
    if (!event) return;
    try {
      const url = URL.createObjectURL(
        new Blob([calendarEventIcs(event)], { type: 'text/calendar;charset=utf-8' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${(input.name || 'route').replace(/[\\/:*?"<>|\r\n]/g, '-').slice(0, 100)}.ics`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setNotice('download-error');
    }
  }
  return (
    <div className="route-calendar-actions">
      <div className="button-row">
        {googleVisible && (
          <Button variant="outline" aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <CalendarDays size={18} aria-hidden="true" />
            {record?.htmlLink ? t('Update calendar event') : t('Add to Google Calendar')}
          </Button>
        )}
        <Button variant="outline" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <Download size={18} aria-hidden="true" />
          {t('Export calendar (.ics)')}
        </Button>
      </div>
      {googleVisible && changed && (
        <p className="fine-print" role="status">
          {t('Route or event settings changed. Update the calendar event manually.')}
        </p>
      )}
      {googleVisible && record?.htmlLink && (
        <a href={record.htmlLink} target="_blank" rel="noopener noreferrer">
          {t('Open calendar event')}
        </a>
      )}
      {open && (
        <Dialog
          title={t('Route calendar event')}
          description={t(
            'Check the time zone at the route start. The default is your device time zone, not an inferred start location.',
          )}
          onClose={close}
          footer={
            <div className="button-row">
              <Button variant="outline" disabled={publication.busy || !event} onClick={download}>
                {t('Download .ics')}
              </Button>
              {googleVisible && (
                <Button
                  disabled={
                    publication.busy ||
                    google.loading ||
                    !google.session?.connected ||
                    !input.online ||
                    !input.canPublish ||
                    !event ||
                    publication.error === 'local'
                  }
                  onClick={() => {
                    if (event)
                      void publication.publish(event).then((done) => {
                        if (done) {
                          setNotice('saved');
                          setOpen(false);
                        }
                      });
                  }}
                  aria-busy={publication.busy}
                >
                  {publication.busy
                    ? t('Publishing event…')
                    : record?.htmlLink
                      ? t('Confirm event update')
                      : t('Confirm event creation')}
                </Button>
              )}
            </div>
          }
        >
          <div className="calendar-event-fields">
            <Label htmlFor={`${id}-zone`}>{t('Start time zone (IANA)')}</Label>
            <Input
              id={`${id}-zone`}
              value={timeZone}
              disabled={publication.busy}
              onChange={(event) => setTimeZone(event.target.value)}
              placeholder="Europe/Warsaw"
              autoComplete="off"
            />
            <Label htmlFor={`${id}-reminder`}>{t('Reminder before start (minutes)')}</Label>
            <Input
              id={`${id}-reminder`}
              value={reminder}
              disabled={publication.busy}
              inputMode="numeric"
              onChange={(event) => setReminder(event.target.value)}
            />
          </div>
          {event && (
            <dl className="calendar-event-preview">
              <div>
                <dt>{t('Title')}</dt>
                <dd>{event.summary}</dd>
              </div>
              <div>
                <dt>{t('Start')}</dt>
                <dd>
                  <time dateTime={event.start.dateTime}>{event.start.dateTime}</time>
                </dd>
              </div>
              <div>
                <dt>{t('Finish')}</dt>
                <dd>
                  <time dateTime={event.end.dateTime}>{event.end.dateTime}</time>
                </dd>
              </div>
              <div>
                <dt>{t('Location')}</dt>
                <dd>{event.location || t('Not specified')}</dd>
              </div>
              <div>
                <dt>{t('Description')}</dt>
                <dd>{event.description || t('Not specified')}</dd>
              </div>
            </dl>
          )}
          {draftError && <p role="alert">{draftError}</p>}
          {googleVisible && !input.canPublish && (
            <p role="status">
              {t('Save the current route and its schedule before publishing to Google Calendar.')}
            </p>
          )}
          {googleVisible && !input.online && (
            <p role="status">
              {t('You are offline. ICS export remains available; Google Calendar needs internet.')}
            </p>
          )}
          {googleVisible && !google.session?.connected && (
            <Button
              variant="outline"
              disabled={google.loading || google.session?.available === false}
              onClick={() => window.location.assign('/api/google-calendar?action=start')}
            >
              {t('Reconnect Google Calendar')}
            </Button>
          )}
          <p className="fine-print">
            {t(
              'Calendar end time includes waypoint pauses and elapsed moving time. Clock changes are applied here; planner arrivals remain local-clock estimates.',
            )}
          </p>
          <p className="fine-print">
            {t(
              'Only the confirmed event details are sent to Google. GPX and full route geometry are not attached.',
            )}
          </p>
          <p className="fine-print">
            {t(
              'Changes are never sent automatically. Importing the same ICS file may create duplicates in another calendar app.',
            )}
          </p>
        </Dialog>
      )}
      {open && (publicationError || google.error) && (
        <Notification
          title={t('Google Calendar')}
          variant="error"
          message={publicationError || (google.error ? t(googleCalendarErrors[google.error]) : '')}
        />
      )}
      {stopping && (
        <Dialog
          title={t('Stop calendar publication?')}
          description={t(
            'The event may already have reached Google Calendar. Retry uses the same event ID to avoid a duplicate.',
          )}
          compact
          initialFocusRef={cancelButton}
          onClose={() => setStopping(false)}
        >
          <div className="button-row dialog-actions">
            <Button ref={cancelButton} variant="outline" onClick={() => setStopping(false)}>
              {t('Keep working')}
            </Button>
            <Button
              onClick={() => {
                publication.cancel();
                setStopping(false);
                setOpen(false);
                setNotice('cancelled');
              }}
            >
              {t('Stop and close')}
            </Button>
          </div>
        </Dialog>
      )}
      {notice && (
        <Notification
          title={t('Route calendar event')}
          variant={notice === 'saved' ? 'success' : notice === 'cancelled' ? 'warning' : 'error'}
          message={t(
            notice === 'saved'
              ? 'Calendar event saved. Future route changes require a manual update.'
              : notice === 'cancelled'
                ? 'Publication stopped locally. The event may already exist; retry uses the same event ID.'
                : 'Could not download the calendar file. Try again.',
          )}
          onDismiss={() => setNotice(null)}
        />
      )}
    </div>
  );
}
