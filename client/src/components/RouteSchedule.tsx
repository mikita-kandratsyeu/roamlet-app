import { useId, useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { enUS, ru as ruLocale } from 'date-fns/locale';
import { CalendarDays, ChevronDown, Clock3 } from 'lucide-react';
import { Button } from './ui/button';
import { Calendar } from './ui/calendar';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useDecimalField } from '../hooks/useDecimalField';
import {
  estimateRouteSchedule, prepareRouteSchedule, validDepartureLocal, validPauseMinutes,
  type ScheduleUnavailable,
} from '../domain/schedule';
import type { Coordinate, PlannedRoute, Waypoint } from '../domain/types';
import { RouteCalendarActions, type RouteCalendarInput } from './RouteCalendarActions';

import './RouteSchedule.css';
import './disclosures.css';

const emptySegments: Coordinate[][] = [];

export interface RouteScheduleProps {
  route: PlannedRoute | null;
  showHeading?: boolean;
  calendar?: RouteCalendarInput;
  /** Editor waypoints, not the possibly older waypoint metadata in a routing response. */
  waypoints: Waypoint[];
  departureLocal?: string;
  /** Moving-only seconds (e.g. estimatePersonalTime(...).moving), NEVER total including stops. */
  movingSeconds: number | null;
  geometryCurrent?: boolean;
  /** Change on route/session switches to discard unfinished input buffers. */
  contextKey?: string;
  onDepartureLocal: (value: string | undefined) => void;
  onWaypointPause: (id: string, value: number) => void;
}
const reasons: Record<ScheduleUnavailable, string> = {
  departure: 'Choose a local departure date and time to see arrivals.',
  'moving-time': 'A valid moving-time estimate is needed for the schedule.',
  geometry: 'Usable route geometry is needed for the schedule.',
  waypoints: 'At least two ordered waypoints must match the route to show arrivals.',
  'unmatched-waypoint': 'This waypoint does not match the route; later arrivals are unavailable.',
  disconnected: 'This track has a gap; arrival times across it are unavailable.',
  pause: 'Enter whole pause minutes from 0 to 10080.',
  'date-overflow': 'The arrival date is outside the supported calendar range.',
};

function departureTimePart(buffer: string): string {
  return /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})$/.test(buffer) ? buffer.slice(11, 16) : '';
}

function departureCalendarDate(buffer: string): Date | undefined {
  if (!validDepartureLocal(buffer)) return undefined;
  const [year, month, day] = buffer.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function replaceDepartureDate(buffer: string, selected: Date): string {
  const year = selected.getFullYear();
  const month = String(selected.getMonth() + 1).padStart(2, '0');
  const day = String(selected.getDate()).padStart(2, '0');
  const time = departureTimePart(buffer) || '09:00';
  return `${year}-${month}-${day}T${time}`;
}

function localNowDeparture(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}T${hours}:${minutes}`;
}

function replaceDepartureTime(buffer: string, time: string): string {
  const date = validDepartureLocal(buffer)
    ? buffer.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return `${date}T${time}`;
}

function DepartureField({ value, onCommit }: {
  value?: string; onCommit: RouteScheduleProps['onDepartureLocal'];
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const language = i18n.resolvedLanguage || 'en';
  const [buffer, setBuffer] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [month, setMonth] = useState<Date>(() => departureCalendarDate(value ?? '') ?? new Date());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setBuffer(value ?? '');
    setInvalid(false);
    const selected = departureCalendarDate(value ?? '');
    if (selected) setMonth(selected);
  }, [value]);
  const calendarLocale = language.startsWith('ru') ? ruLocale : enUS;
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }), [language]);
  const selectedDate = departureCalendarDate(buffer);
  function commit(next = buffer) {
    if (next && !validDepartureLocal(next)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next !== (value ?? '')) onCommit(next || undefined);
  }
  function apply(next: string) {
    setBuffer(next);
    setInvalid(false);
    if (validDepartureLocal(next) && next !== (value ?? '')) onCommit(next);
  }
  const formatted = selectedDate
    ? dateTimeFormatter.format(new Date(`${buffer}:00.000Z`))
    : '';
  return <div className="route-schedule-departure personal-time-field">
    <Label id={`${id}-label`} onClick={() => setCalendarOpen(true)}>{t('Local departure date and time')}</Label>
    <input ref={input} data-testid="departure-local" tabIndex={-1} aria-hidden="true"
      className="route-schedule-departure-input"
      value={buffer} aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      onChange={(event) => { setBuffer(event.target.value); setInvalid(false); }}
      onBlur={() => commit()} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          commit();
        }
      }} />
    <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="route-schedule-picker"
          aria-labelledby={`${id}-label`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          aria-haspopup="dialog"
          title={formatted || t('Choose a date and time')}>
          <CalendarDays size={16} aria-hidden="true" />
          <span className={formatted ? 'route-schedule-picker-value' : 'route-schedule-picker-placeholder'}>
            {formatted || t('Choose a date and time')}
          </span>
          <ChevronDown size={16} aria-hidden="true" className="route-schedule-picker-chevron" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="route-schedule-picker-popover w-auto p-0" align="start" sideOffset={6}>
        <Calendar
          mode="single"
          locale={calendarLocale}
          captionLayout="label"
          className="p-2"
          classNames={{
            months: 'relative flex flex-col gap-2',
            month: 'flex w-full flex-col gap-2',
            week: 'mt-1 flex w-full',
          }}
          month={month}
          onMonthChange={setMonth}
          selected={selectedDate}
          onSelect={(selected) => {
            if (!selected) return;
            apply(replaceDepartureDate(buffer, selected));
            setMonth(selected);
          }}
          disabled={(date) => date.getFullYear() < 1 || date.getFullYear() > 9999}
        />
        <div className="route-schedule-picker-footer">
          <Label htmlFor={`${id}-time`} className="route-schedule-picker-time-label">
            {t('Departure time')}
          </Label>
          <Input id={`${id}-time`} className="route-schedule-picker-time" type="time" step={60}
            aria-label={t('Departure time')}
            value={departureTimePart(buffer)}
            onChange={(event) => {
              if (!event.target.value) return;
              apply(replaceDepartureTime(buffer, event.target.value));
            }} />
          <Button type="button" variant="ghost" className="route-schedule-picker-action"
            onClick={() => apply(localNowDeparture())}>
            {t('Now')}
          </Button>
          <Button type="button" variant="ghost" className="route-schedule-picker-action"
            onClick={() => { setBuffer(''); setInvalid(false); if (value) onCommit(undefined); setCalendarOpen(false); }}>
            {t('Clear')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
    {invalid && <p id={`${id}-error`} role="alert">{t('Enter a valid local date and time.')}</p>}
  </div>;
}
function PauseField({ waypoint, onCommit }: {
  waypoint: Waypoint; onCommit: RouteScheduleProps['onWaypointPause'];
}) {
  const { t } = useTranslation();
  const id = useId();
  const { invalid, ...field } = useDecimalField(waypoint.pauseMinutes ?? 0,
    (value) => onCommit(waypoint.id, value), true, waypoint.id, validPauseMinutes);
  return <div className="route-schedule-pause personal-time-field">
    <Label htmlFor={id}>{t('Pause (minutes)')}</Label>
    <Input id={id} type="text" inputMode="numeric" {...field}
      aria-label={`${t('Pause (minutes)')}: ${waypoint.name}`}
      aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} />
    {invalid && <p id={`${id}-error`} role="alert">
      {t('Enter whole pause minutes from 0 to 10080.')}
    </p>}
  </div>;
}
export function RouteSchedule({ route, waypoints, departureLocal, movingSeconds,
  geometryCurrent = true, contextKey, showHeading = true, calendar, onDepartureLocal, onWaypointPause }: RouteScheduleProps) {
  const { t, i18n } = useTranslation();
  const segments = geometryCurrent ? route?.segments ?? emptySegments : emptySegments;
  const coordinatesKey = JSON.stringify(waypoints.map((point) => point.coordinate));
  const coordinates = useMemo<Coordinate[]>(() => JSON.parse(coordinatesKey), [coordinatesKey]);
  const timingAvailable = validDepartureLocal(departureLocal) && movingSeconds !== null &&
    Number.isFinite(movingSeconds) && movingSeconds >= 0;
  const prepared = useMemo(() => timingAvailable ? prepareRouteSchedule(segments, coordinates) : null,
    [segments, coordinates, timingAvailable]);
  const schedule = useMemo(() => estimateRouteSchedule({ segments, waypoints, departureLocal },
    movingSeconds ?? NaN, prepared), [segments, waypoints, departureLocal, movingSeconds, prepared]);
  const language = i18n.resolvedLanguage || 'en';
  const formatter = useMemo(() => new Intl.DateTimeFormat(language, {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }), [language]);
  function time(value: string | null) {
    return value ? <time dateTime={value}>{formatter.format(new Date(`${value}:00Z`))}</time>
      : <span>{t('Unavailable')}</span>;
  }
  return <section className="route-schedule" aria-label={t('Route schedule')}>
    {showHeading && <div className="section-heading">
      <h2><Clock3 size={16} aria-hidden="true" />{t('Route schedule')}</h2>
    </div>}
    <DepartureField key={`departure:${contextKey ?? route?.id}`} value={departureLocal} onCommit={onDepartureLocal} />
    {schedule.unavailable && <p className="route-schedule-notice">{t(reasons[schedule.unavailable])}</p>}
    <ol className="route-schedule-list">
      {schedule.rows.map((row, index) => <li key={`${contextKey ?? route?.id}:${row.waypoint.id}`}>
        <h4>{index + 1}. {row.waypoint.name || t('Waypoint')}</h4>
        <dl className="route-schedule-times">
          <div><dt>{t('Arrival')}</dt><dd>{time(row.arrivalLocal)}
            {row.dayOffset !== null && row.dayOffset > 0 &&
              <span className="route-schedule-day">{t('Day +{{count}}', { count: row.dayOffset })}</span>}</dd></div>
          <div><dt>{t('Departure after pause')}</dt><dd>{time(row.departureLocal)}</dd></div>
        </dl>
        <PauseField waypoint={row.waypoint} onCommit={onWaypointPause} />
        {row.unavailable && row.unavailable !== schedule.unavailable &&
          <p className="fine-print">{t(reasons[row.unavailable])}</p>}
      </li>)}
    </ol>
    <p className="route-schedule-finish"><strong>{t('Route end after all pauses')}</strong> {time(schedule.finishLocal)}</p>
    {calendar && <RouteCalendarActions key={`calendar:${calendar.routeId}`}
      input={{ ...calendar, description: [calendar.description,
        route ? t('Distance: {{distance}} km', { distance: (route.stats.distance / 1000).toLocaleString(language, { maximumFractionDigits: 1 }) }) : '',
        t('Waypoint pauses: {{minutes}} minutes', { minutes: waypoints.reduce((sum, point) => sum + (point.pauseMinutes ?? 0), 0) }),
      ].filter(Boolean).join('\n') }}
      departureLocal={departureLocal}
      durationSeconds={schedule.finishLocal && !schedule.unavailable && movingSeconds !== null
        ? movingSeconds + waypoints.reduce((sum, point) => sum + (point.pauseMinutes ?? 0) * 60, 0) : null}
      location={waypoints[0]?.name ?? ''} />}
    <details className="route-schedule-explanation planner-disclosure">
      <summary className="section-heading">
        <span>{t('How arrival times are estimated')}</span>
        <span className="disclosure-toggle" aria-hidden="true"><ChevronDown size={18} /></span>
      </summary>
      <div className="route-schedule-explanation-body">
        <p className="fine-print">{t('Local clock times; timezone and daylight-saving changes are not applied.')}</p>
        <p className="fine-print">{t('Waypoint pauses apply after arrival and replace aggregate stops for this schedule only.')}</p>
        <p className="fine-print">{t('Moving time is distributed by distance along the route; local terrain and speed may vary.')}</p>
      </div>
    </details>
  </section>;
}