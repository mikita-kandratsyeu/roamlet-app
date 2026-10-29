import { useId, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Clock3 } from 'lucide-react';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useDecimalField } from '../hooks/useDecimalField';
import {
  estimateRouteSchedule, validDepartureLocal, validPauseMinutes,
  type ScheduleUnavailable,
} from '../domain/schedule';
import type { PlannedRoute, Waypoint } from '../domain/types';
import './RouteSchedule.css';
import './disclosures.css';

export interface RouteScheduleProps {
  route: PlannedRoute | null;
  showHeading?: boolean;
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
function DepartureField({ value, onCommit }: {
  value?: string; onCommit: RouteScheduleProps['onDepartureLocal'];
}) {
  const { t } = useTranslation();
  const id = useId();
  const [buffer, setBuffer] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setBuffer(value ?? ''); setInvalid(false); }, [value]);
  function commit() {
    if (input.current?.validity.badInput || (buffer && !validDepartureLocal(buffer))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (buffer !== (value ?? '')) onCommit(buffer || undefined);
  }
  return <div className="route-schedule-departure personal-time-field">
    <Label htmlFor={id}>{t('Local departure date and time')}</Label>
    <Input ref={input} id={id} type="datetime-local" min="0001-01-01T00:00" max="9999-12-31T23:59"
      step={60} value={buffer} aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      onChange={(event) => { setBuffer(event.target.value); setInvalid(false); }}
      onBlur={commit} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); commit(); }
      }} />
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
  geometryCurrent = true, contextKey, showHeading = true, onDepartureLocal, onWaypointPause }: RouteScheduleProps) {
  const { t, i18n } = useTranslation();
  const schedule = estimateRouteSchedule({ segments: geometryCurrent ? route?.segments ?? [] : [],
    waypoints, departureLocal }, movingSeconds ?? NaN);
  const formatter = new Intl.DateTimeFormat(i18n.resolvedLanguage || 'en', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  });
  function time(value: string | null) {
    return value ? <time dateTime={value}>{formatter.format(new Date(`${value}:00Z`))}</time>
      : <span>{t('Unavailable')}</span>;
  }
  return <section className="route-schedule" aria-label={t('Route schedule')}>
    {showHeading && <div className="section-heading">
      <h2><Clock3 size={16} aria-hidden="true" />{t('Route schedule')}</h2>
    </div>}
    <DepartureField key={contextKey ?? route?.id} value={departureLocal} onCommit={onDepartureLocal} />
    {schedule.unavailable && <p className="route-schedule-notice">{t(reasons[schedule.unavailable])}</p>}
    <ol className="route-schedule-list">
      {schedule.rows.map((row, index) => <li key={`${contextKey ?? route?.id}:${row.waypoint.id}`}>
        <h4>{index + 1}. {row.waypoint.name || t('Waypoint')}</h4>
        <dl className="route-schedule-times">
          <div><dt>{t('Arrival')}</dt><dd>{time(row.arrivalLocal)}
            {row.dayOffset !== null && row.dayOffset > 0 &&
              <span className="route-schedule-day">{t('Day +{{count}}', { count: row.dayOffset })}</span>}
          </dd></div>
          <div><dt>{t('Departure after pause')}</dt><dd>{time(row.departureLocal)}</dd></div>
        </dl>
        <PauseField waypoint={row.waypoint} onCommit={onWaypointPause} />
        {row.unavailable && row.unavailable !== schedule.unavailable &&
          <p className="fine-print">{t(reasons[row.unavailable])}</p>}
      </li>)}
    </ol>
    <p className="route-schedule-finish"><strong>{t('Route end after all pauses')}</strong> {time(schedule.finishLocal)}</p>
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
