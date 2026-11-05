import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  CalendarPlus,
  ChevronDown,
  Download,
  ExternalLink,
  Globe2,
  LoaderCircle,
} from 'lucide-react';
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
import { Label } from './ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import './RouteCalendarActions.css';

const timeZoneOptions = [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])].sort();

function formatReminderLabel(value: string, locale: string, t: (key: string) => string) {
  const totalMinutes = Number(value);
  if (Number.isNaN(totalMinutes) || totalMinutes <= 0) return t('No reminder');

  const pluralKey = (baseKey: string, count: number) => {
    const form = new Intl.PluralRules(locale).select(count);
    return t(`${baseKey}_${form}`);
  };

  const hours = Math.floor(totalMinutes / 60);
  const remainder = totalMinutes % 60;
  const formatUnit = (baseKey: string, count: number) => `${count} ${pluralKey(baseKey, count)}`;

  if (hours === 0) return formatUnit('minute', totalMinutes);
  if (remainder === 0) return formatUnit('hour', hours);
  return `${formatUnit('hour', hours)} ${formatUnit('minute', remainder)}`;
}

function formatTimeZoneLabel(zone: string, locale: string) {
  if (zone === 'UTC') return 'UTC';
  const cityName = zone.split('/').at(-1)?.replace(/_/g, ' ') ?? zone;
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date());
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'UTC';
  return `${cityName} (${offset.replace(/^GMT/, 'UTC')})`;
}

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
  const { t, i18n } = useTranslation();
  const google = useGoogleCalendarSession(true);
  const publication = useCalendarPublication(
    google.session?.accountId,
    input.routeId,
    !!google.session?.connected,
  );
  const [localEventId] = useState(createCalendarEventId);
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [timeZoneMenuOpen, setTimeZoneMenuOpen] = useState(false);
  const [reminderMenuOpen, setReminderMenuOpen] = useState(false);
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [reminder, setReminder] = useState('30');
  const [notice, setNotice] = useState<'saved' | 'cancelled' | 'download-error' | null>(null);
  const id = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);
  const zoneInput = useRef<HTMLButtonElement>(null);
  const { record } = publication;
  const availableTimeZones = timeZoneOptions.includes(timeZone)
    ? timeZoneOptions
    : [...timeZoneOptions, timeZone].sort();
  const popularTimeZones = [
    ...new Set([
      timeZone,
      'UTC',
      'Europe/Minsk',
      'Europe/Warsaw',
      'Europe/London',
      'Europe/Paris',
      'America/New_York',
      'America/Los_Angeles',
      'Asia/Dubai',
      'Asia/Tokyo',
      'Australia/Sydney',
    ]),
  ].filter((zone) => availableTimeZones.includes(zone));
  const allTimeZones = availableTimeZones.filter((zone) => !popularTimeZones.includes(zone));
  const reminderOptions = ['0', '5', '10', '15', '30', '45', '60', '90', '120', '180'];
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
  const calendarUnavailable =
    google.session?.available === false ||
    google.error === 'unavailable' ||
    publication.error === 'unavailable';
  const googleVisible =
    !calendarUnavailable && (google.knownConnected || !!google.session?.connected);
  const changedNoticeId = `${id}-calendar-event-changed`;
  useEffect(() => {
    if (!googleVisible || !changed) return;
    toast.warning(t('Route or event settings changed. Update the calendar event manually.'), {
      id: changedNoticeId,
      duration: Infinity,
      dismissible: true,
      closeButton: true,
    });
    return () => {
      toast.dismiss(changedNoticeId);
    };
  }, [changed, changedNoticeId, googleVisible, t]);
  const publicationError =
    publication.error === 'local'
      ? t(
          'Could not safely save the local calendar event reference. No new publication can start until local storage is available.',
        )
      : publication.error
        ? t(googleCalendarErrors[publication.error])
        : null;
  function previewTime(value: string | undefined) {
    if (!value || !event) return <span>{t('Unavailable')}</span>;
    const date = new Date(value);
    const language = i18n.resolvedLanguage || 'en';
    const zone = event.start.timeZone;
    return (
      <time dateTime={value}>
        <span className="calendar-event-date">
          {new Intl.DateTimeFormat(language, {
            timeZone: zone,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }).format(date)}
        </span>
        <span className="calendar-event-clock">
          {new Intl.DateTimeFormat(language, {
            timeZone: zone,
            hour: '2-digit',
            minute: '2-digit',
            ...(value.slice(17, 19) !== '00' ? { second: '2-digit' } : {}),
          }).format(date)}
        </span>
      </time>
    );
  }
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
        <Button variant="outline" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <CalendarPlus size={18} aria-hidden="true" />
          {t('Add to calendar')}
        </Button>
      </div>
      {googleVisible && record?.htmlLink && (
        <Button asChild variant="outline" className="calendar-event-open">
          <a href={record.htmlLink} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" />
            {t('Open calendar event')}
          </a>
        </Button>
      )}
      {open && (
        <Dialog
          title={t('Route calendar event')}
          description={t('Review the event details and the time zone at the route start.')}
          onClose={close}
          initialFocusRef={zoneInput}
          footer={
            <div className="button-row calendar-event-footer">
              <Button
                variant={googleVisible ? 'outline' : 'default'}
                disabled={publication.busy || !event}
                onClick={download}
              >
                <Download size={18} aria-hidden="true" />
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
                  {publication.busy ? (
                    <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <CalendarPlus size={18} aria-hidden="true" />
                  )}
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
          <div className="calendar-event-content">
            <section className="calendar-event-overview" aria-label={t('Event preview')}>
              <h3>
                <CalendarPlus size={20} aria-hidden="true" />
                <span>{event?.summary || input.name || t('Route')}</span>
              </h3>
              <dl className="calendar-event-times">
                <div>
                  <dt>{t('Start')}</dt>
                  <dd>{previewTime(event?.start.dateTime)}</dd>
                </div>
                <div>
                  <dt>{t('Finish')}</dt>
                  <dd>{previewTime(event?.end.dateTime)}</dd>
                </div>
              </dl>
              {event && (
                <p className="calendar-event-zone">
                  <Globe2 size={15} aria-hidden="true" />
                  <span>
                    {event.start.timeZone} ·{' '}
                    {[...new Set([event.start.dateTime.slice(-6), event.end.dateTime.slice(-6)])]
                      .map((offset) => `UTC${offset}`)
                      .join(' → ')}
                  </span>
                </p>
              )}
              <dl className="calendar-event-preview">
                <div>
                  <dt>{t('Location')}</dt>
                  <dd>{(event?.location ?? location) || t('Not specified')}</dd>
                </div>
                <div>
                  <dt>{t('Description')}</dt>
                  <dd>{(event?.description ?? input.description) || t('Not specified')}</dd>
                </div>
              </dl>
            </section>
            <section className="calendar-event-settings" aria-labelledby={`${id}-settings`}>
              <h3 id={`${id}-settings`}>{t('Event settings')}</h3>
              <div className="calendar-event-fields">
                <div className="calendar-event-field">
                  <Label htmlFor={`${id}-zone`}>{t('Time zone at route start')}</Label>
                  <DropdownMenu
                    open={timeZoneMenuOpen}
                    onOpenChange={setTimeZoneMenuOpen}
                  >
                    <DropdownMenuTrigger asChild disabled={publication.busy}>
                      <Button
                        ref={zoneInput}
                        id={`${id}-zone`}
                        variant="outline"
                        className="planner-choice calendar-timezone-trigger"
                        aria-label={t('Time zone at route start')}
                        aria-describedby={`${id}-zone-help${draftError ? ` ${id}-error` : ''}`}
                        disabled={publication.busy}
                      >
                        <span>
                          {formatTimeZoneLabel(
                            timeZone,
                            i18n.resolvedLanguage || i18n.language || 'en',
                          )}
                        </span>
                        <ChevronDown size={16} aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      collisionPadding={12}
                      className="planner-choice-menu calendar-timezone-menu"
                    >
                      <DropdownMenuLabel>{t('Popular time zones')}</DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={timeZone} onValueChange={setTimeZone}>
                        {popularTimeZones.map((zone) => (
                          <DropdownMenuRadioItem
                            key={zone}
                            value={zone}
                            aria-label={formatTimeZoneLabel(
                              zone,
                              i18n.resolvedLanguage || i18n.language || 'en',
                            )}
                          >
                            {formatTimeZoneLabel(zone, i18n.resolvedLanguage || i18n.language || 'en')}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      {allTimeZones.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>{t('All time zones')}</DropdownMenuLabel>
                          <DropdownMenuRadioGroup value={timeZone} onValueChange={setTimeZone}>
                            {allTimeZones.map((zone) => (
                              <DropdownMenuRadioItem
                                key={zone}
                                value={zone}
                                aria-label={formatTimeZoneLabel(
                                  zone,
                                  i18n.resolvedLanguage || i18n.language || 'en',
                                )}
                              >
                                {formatTimeZoneLabel(
                                  zone,
                                  i18n.resolvedLanguage || i18n.language || 'en',
                                )}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="calendar-event-field">
                  <Label htmlFor={`${id}-reminder`}>{t('Reminder before start (minutes)')}</Label>
                  <DropdownMenu open={reminderMenuOpen} onOpenChange={setReminderMenuOpen}>
                    <DropdownMenuTrigger asChild disabled={publication.busy}>
                      <Button
                        id={`${id}-reminder`}
                        variant="outline"
                        className="planner-choice calendar-timezone-trigger calendar-reminder-trigger"
                        aria-label={t('Reminder before start (minutes)')}
                        aria-describedby={draftError ? `${id}-error` : undefined}
                        disabled={publication.busy}
                      >
                        <span>
                          {reminder === '0'
                            ? t('No reminder')
                            : formatReminderLabel(
                                reminder,
                                i18n.resolvedLanguage || i18n.language || 'en',
                                t,
                              )}
                        </span>
                        <ChevronDown size={16} aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      collisionPadding={12}
                      className="planner-choice-menu calendar-timezone-menu"
                    >
                      <DropdownMenuRadioGroup value={reminder} onValueChange={(value) => {
                        setReminder(value);
                        setReminderMenuOpen(false);
                      }}>
                        {reminderOptions.map((option) => (
                          <DropdownMenuRadioItem key={option} value={option}>
                        {option === '0'
                          ? t('No reminder')
                          : formatReminderLabel(
                              option,
                              i18n.resolvedLanguage || i18n.language || 'en',
                              t,
                            )}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <p className="fine-print" id={`${id}-zone-help`}>
                {t('The default time zone is based on your device. Check it matches the route start.')}
              </p>
            </section>
            {draftError && (
              <p className="calendar-event-notice" id={`${id}-error`} role="alert">
                {draftError}
              </p>
            )}
            {googleVisible && !input.canPublish && (
              <p role="status">
                {t('Save the current route and its schedule before publishing to Google Calendar.')}
              </p>
            )}
            {googleVisible && !input.online && (
              <p role="status">
                {t(
                  'You are offline. ICS export remains available; Google Calendar needs internet.',
                )}
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
            <p className="fine-print calendar-event-privacy">
              {googleVisible
                ? t(
                    'Only the previewed event details are sent to Google. No GPX or full track is attached.',
                  )
                : t('Calendar file only. Nothing is sent to Google.')}
            </p>
            <details className="calendar-event-disclosure">
              <summary>{t('Timing and privacy')}</summary>
              <div className="calendar-event-disclosure-body">
                <p>
                  {t(
                    'Calendar end time includes waypoint pauses and elapsed moving time. Clock changes are applied here; planner arrivals remain local-clock estimates.',
                  )}
                </p>
                <p>
                  {t(
                    'Changes are never sent automatically. Importing the same ICS file may create duplicates in another calendar app.',
                  )}
                </p>
              </div>
            </details>
          </div>
        </Dialog>
      )}
      {open && !calendarUnavailable && (publicationError || google.error) && (
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
