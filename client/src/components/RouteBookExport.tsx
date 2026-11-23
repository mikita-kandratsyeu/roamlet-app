import { Bike, Footprints, Printer } from 'lucide-react';
import { useCallback, useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { analyzeClimbs } from '../domain/climbs';
import { analyzeRouteElevation } from '../domain/routeElevation';
import { formatDistance, formatDuration } from '../domain/format';
import {
  estimateRouteSchedule,
  prepareRouteSchedule,
  validDepartureLocal,
  validPauseMinutes,
} from '../domain/schedule';
import { estimatePersonalTime, type PersonalTimeOptions } from '../domain/time';
import type { PlannedRoute } from '../domain/types';
import { formatNumber } from '../i18n';
import { Button } from './ui/button';
import { ExportRouteMap } from './ExportRouteMap';
import './RouteBookExport.css';

function BrandMark() {
  return (
    <svg className="roadbook-mark" viewBox="0 0 192 192" aria-hidden="true">
      <rect width="192" height="192" rx="48" fill="#173b30" />
      <path
        d="M38 56C70 58 126 68 126 92C126 115 73 116 73 128C73 144 136 140 169 188L178 206H105C102 177 33 163 33 134C33 108 98 104 98 89C98 75 29 57 38 56Z"
        fill="#faf7f2"
      />
      <circle cx="125" cy="49" r="17" fill="#bdd3a5" />
    </svg>
  );
}

function elevationPaths(
  samples: ReturnType<typeof analyzeRouteElevation>['samples'],
  distance: number,
  minimum: number,
  maximum: number,
) {
  const left = 52;
  const right = 12;
  const top = 14;
  const bottom = 34;
  const width = 720 - left - right;
  const height = 180 - top - bottom;
  const lines: string[] = [];
  const areas: string[] = [];
  let points: Array<[number, number]> = [];
  const stride = Math.max(1, Math.ceil(samples.length / 500));
  const finishRun = () => {
    if (!points.length) return;
    const line = points
      .map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' ');
    const [firstX] = points[0];
    const [lastX] = points[points.length - 1];
    lines.push(line);
    areas.push(`${line} L${lastX.toFixed(2)},146 L${firstX.toFixed(2)},146 Z`);
    points = [];
  };
  for (const [index, sample] of samples.entries()) {
    if (sample.elevation === null) {
      finishRun();
      continue;
    }
    if (
      index !== 0 &&
      index !== samples.length - 1 &&
      index % stride !== 0 &&
      samples[index - 1]?.elevation !== null &&
      samples[index + 1]?.elevation !== null
    ) {
      continue;
    }
    const x = left + (distance > 0 ? sample.distance / distance : 0) * width;
    const y =
      maximum === minimum
        ? top + height / 2
        : top + height - ((sample.elevation - minimum) / (maximum - minimum)) * height;
    points.push([x, y]);
  }
  finishRun();
  return { lines, areas };
}

export function RouteBookExport({
  route,
  personalTime,
  onPrint,
  showToolbar = true,
}: {
  route: PlannedRoute;
  personalTime?: PersonalTimeOptions;
  onPrint: () => void;
  showToolbar?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const chartId = useId().replace(/:/g, '');
  const elevationAllowed =
    route.source === 'gpx' ||
    ((route.source === 'openrouteservice' || route.source === 'mixed') &&
      route.elevationSource === 'openrouteservice');
  const elevation = useMemo(
    () => (elevationAllowed ? analyzeRouteElevation(route.segments) : null),
    [elevationAllowed, route.segments],
  );
  const elevationSamples = elevation?.samples ?? [];
  const heightRange = elevationSamples.reduce(
    (range, sample) =>
      sample.elevation === null
        ? range
        : {
            minimum: Math.min(range.minimum, sample.elevation),
            maximum: Math.max(range.maximum, sample.elevation),
            count: range.count + 1,
          },
    { minimum: Infinity, maximum: -Infinity, count: 0 },
  );
  const minimum = heightRange.count ? heightRange.minimum : 0;
  const maximum = heightRange.count ? heightRange.maximum : 0;
  const chart = elevation
    ? elevationPaths(elevationSamples, elevation.distance, minimum, maximum)
    : { lines: [], areas: [] };
  const hasElevation = Boolean(elevation?.available);
  const ascent = hasElevation ? elevation?.ascent : undefined;
  const descent = hasElevation ? elevation?.descent : undefined;
  const description = route.description.trim();
  const tags = (route.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  const personal = useMemo(
    () => (personalTime ? estimatePersonalTime(route, personalTime) : null),
    [personalTime, route],
  );
  const movingSeconds =
    personal?.moving ??
    (Number.isFinite(route.stats.duration) && route.stats.duration >= 0
      ? route.stats.duration
      : null);
  const positions = useMemo(
    () =>
      prepareRouteSchedule(
        route.segments,
        route.waypoints.map((waypoint) => waypoint.coordinate),
      )?.matches ?? route.waypoints.map(() => null),
    [route.segments, route.waypoints],
  );
  const schedule = useMemo(
    () =>
      movingSeconds === null || !route.waypoints.length
        ? null
        : estimateRouteSchedule(
            {
              segments: route.segments,
              waypoints: route.waypoints,
              departureLocal: route.departureLocal,
            },
            movingSeconds,
          ),
    [movingSeconds, route.departureLocal, route.segments, route.waypoints],
  );
  const climbs = useMemo(() => {
    const analysis = analyzeClimbs(route);
    return analysis.available ? analysis.climbs : [];
  }, [route]);
  const pauseMinutes = route.waypoints.reduce((sum, waypoint) => {
    const pause = waypoint.pauseMinutes ?? 0;
    return sum + (validPauseMinutes(pause) ? pause : 0);
  }, 0);
  const pace =
    route.stats.duration > 0 && Number.isFinite(route.stats.distance) && route.stats.distance >= 0
      ? (route.stats.distance / 1000 / route.stats.duration) * 3600
      : null;
  const timesReady = Boolean(schedule && !schedule.unavailable);
  const clock = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage || 'en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }),
    [i18n.resolvedLanguage],
  );

  function coordinates(coordinate: PlannedRoute['waypoints'][number]['coordinate']) {
    return `${formatNumber(coordinate[1], { maximumFractionDigits: 5 })}, ${formatNumber(
      coordinate[0],
      { maximumFractionDigits: 5 },
    )}`;
  }

  const clockTime = useCallback((value: string | null | undefined) => {
    if (!value) return null;
    return <time dateTime={value}>{clock.format(new Date(`${value}:00Z`))}</time>;
  }, [clock]);

  const heroMetrics = useMemo(() => {
    const items: Array<{ key: string; label: string; value: ReactNode }> = [
      { key: 'distance', label: t('Distance'), value: formatDistance(route.stats.distance) },
      {
        key: 'original-time',
        label: t('Original time estimate'),
        value: formatDuration(route.stats.duration),
      },
    ];
    if (personal) {
      items.push({
        key: 'personal-time',
        label: t('Your moving time'),
        value: formatDuration(personal.moving),
      });
    }
    if (pace !== null && Number.isFinite(pace)) {
      items.push({
        key: 'pace',
        label: t('Pace from original time'),
        value: `${formatNumber(pace, { maximumFractionDigits: 1 })} ${t('km/h')}`,
      });
    }
    return items;
  }, [pace, personal, route.stats.distance, route.stats.duration, t]);

  const detailMetrics = useMemo(() => {
    const items: Array<{ key: string; label: string; value: ReactNode }> = [];
    const showAscent = hasElevation && typeof ascent === 'number' && Number.isFinite(ascent);
    const showDescent = hasElevation && typeof descent === 'number' && Number.isFinite(descent);
    if (showAscent && showDescent) {
      items.push({
        key: 'elevation',
        label: elevation?.complete ? t('Elevation') : t('Known elevation'),
        value: (
          <span className="roadbook-elevation-pair">
            <span className="roadbook-elevation-up">
              +{formatNumber(Math.round(ascent!))} {t('m')}
            </span>
            <span className="roadbook-elevation-down">
              −{formatNumber(Math.round(descent!))} {t('m')}
            </span>
          </span>
        ),
      });
    } else if (showAscent) {
      items.push({
        key: 'elevation-gain',
        label: t(elevation?.complete ? 'Elevation gain' : 'Known elevation gain'),
        value: `${formatNumber(Math.round(ascent!))} ${t('m')}`,
      });
    } else if (showDescent) {
      items.push({
        key: 'elevation-loss',
        label: t(elevation?.complete ? 'Elevation loss' : 'Known elevation loss'),
        value: `${formatNumber(Math.round(descent!))} ${t('m')}`,
      });
    }
    if (pauseMinutes > 0) {
      items.push({
        key: 'pauses',
        label: t('Total pauses'),
        value: formatDuration(pauseMinutes * 60),
      });
    }
    if (validDepartureLocal(route.departureLocal)) {
      items.push({
        key: 'departure',
        label: t('Departure'),
        value: clockTime(route.departureLocal),
      });
    }
    if (timesReady && schedule?.finishLocal) {
      items.push({
        key: 'finish',
        label: t('Finish'),
        value: clockTime(schedule.finishLocal),
      });
    }
    return items;
  }, [
    ascent,
    descent,
    elevation?.complete,
    hasElevation,
    pauseMinutes,
    clockTime,
    route.departureLocal,
    schedule?.finishLocal,
    timesReady,
    t,
  ]);

  return (
    <div className={`roadbook-export${showToolbar ? '' : ' roadbook-export--embedded'}`}>
      {showToolbar && (
        <div className="roadbook-toolbar">
          <p className="roadbook-print-help">
            {t('A4 portrait. Choose Print to open your browser’s print dialog.')}
          </p>
          <Button type="button" className="roadbook-print-action" onClick={onPrint}>
            <Printer size={16} aria-hidden="true" />
            {t('Print roadbook')}
          </Button>
        </div>
      )}
      <div className="roadbook-stage">
        <article className="roadbook-print-sheet">
          <header className="roadbook-header">
            <div className="roadbook-brandbar">
              <BrandMark />
              <span className="roadbook-wordmark">Roamlet</span>
              <p className="roadbook-kicker">{t('Route roadbook')}</p>
            </div>
            <div className="roadbook-title-row">
              <div className="roadbook-title-copy">
                <h1>{route.name.trim() || t('Untitled adventure')}</h1>
                {!!tags.length && (
                  <ul className="roadbook-tags">
                    {tags.map((tag, index) => (
                      <li key={`${tag}-${index}`}>{tag}</li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="roadbook-activity">
                {route.activity === 'cycling' ? (
                  <Bike size={15} aria-hidden="true" />
                ) : (
                  <Footprints size={15} aria-hidden="true" />
                )}
                {t(route.activity === 'cycling' ? 'Cycling' : 'Hiking')}
              </p>
            </div>
            <div className="roadbook-metrics-board">
              <dl
                className="roadbook-metrics roadbook-metrics-hero"
                style={{ '--roadbook-hero-cols': heroMetrics.length } as CSSProperties}
              >
                {heroMetrics.map((metric) => (
                  <div key={metric.key}>
                    <dt>{metric.label}</dt>
                    <dd>{metric.value}</dd>
                  </div>
                ))}
              </dl>
              {!!detailMetrics.length && (
                <dl className="roadbook-metrics roadbook-metrics-detail">
                  {detailMetrics.map((metric) => (
                    <div key={metric.key}>
                      <dt>{metric.label}</dt>
                      <dd>{metric.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </header>

          {description && (
            <section className="roadbook-section roadbook-notes" aria-label={t('Notes')}>
              <h2>{t('Notes')}</h2>
              <p>{description}</p>
            </section>
          )}

          <section className="roadbook-section" aria-label={t('Route map')}>
            <h2>{t('Route map')}</h2>
            <ExportRouteMap segments={route.segments} />
          </section>

          <section className="roadbook-section" aria-label={t('Elevation profile')}>
            <h2>{t('Elevation profile')}</h2>
            {hasElevation && elevation ? (
              <>
                {!elevation.complete && (
                  <p className="roadbook-elevation-note">{t('Known elevation sections only')}</p>
                )}
                <svg
                  className="roadbook-elevation-chart"
                  viewBox="0 0 720 180"
                  role="img"
                  aria-label={t('Elevation profile from {{minimum}} to {{maximum}} m', {
                    minimum: formatNumber(Math.round(minimum)),
                    maximum: formatNumber(Math.round(maximum)),
                  })}
                >
                  <defs>
                    <linearGradient id={`${chartId}-fill`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#286046" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#286046" stopOpacity="0.03" />
                    </linearGradient>
                  </defs>
                  {[47, 80, 113].map((y) => (
                    <line key={y} x1="52" y1={y} x2="708" y2={y} className="roadbook-chart-grid" />
                  ))}
                  <line x1="52" y1="146" x2="708" y2="146" className="roadbook-chart-axis" />
                  <line x1="52" y1="14" x2="52" y2="146" className="roadbook-chart-axis" />
                  {chart.areas.map((path, index) => (
                    <path
                      key={`area-${index}`}
                      d={path}
                      fill={`url(#${chartId}-fill)`}
                      stroke="none"
                    />
                  ))}
                  {chart.lines.map((path, index) => (
                    <path
                      key={index}
                      d={path}
                      className="roadbook-chart-line"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  <text x="46" y="16" textAnchor="end">
                    {formatNumber(Math.round(maximum))} {t('m')}
                  </text>
                  <text x="46" y="148" textAnchor="end">
                    {formatNumber(Math.round(minimum))} {t('m')}
                  </text>
                  <text x="52" y="168">
                    0
                  </text>
                  <text x="708" y="168" textAnchor="end">
                    {formatDistance(elevation.distance)}
                  </text>
                </svg>
              </>
            ) : (
              <p className="roadbook-unavailable">
                {t('Elevation data is unavailable for this route.')}
              </p>
            )}
          </section>

          {!!climbs.length && (
            <section className="roadbook-section roadbook-climbs" aria-label={t('Climb analysis')}>
              <h2>{t('Climb analysis')}</h2>
              <ol>
                {climbs.map((climb, index) => (
                  <li key={`${climb.segmentIndex}-${climb.startDistanceMeters}`}>
                    <strong>{t('Climb {{number}}', { number: formatNumber(index + 1) })}</strong>
                    <span>
                      {formatDistance(climb.startDistanceMeters)} –{' '}
                      {formatDistance(climb.endDistanceMeters)}
                    </span>
                    <span className="roadbook-climb-meta">
                      {formatDistance(climb.lengthMeters)} ·{' '}
                      {formatNumber(Math.round(climb.ascentMeters))} {t('m')} ·{' '}
                      {formatNumber(climb.averageGradePercent, { maximumFractionDigits: 1 })}%
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section
            className="roadbook-section roadbook-stops"
            aria-label={t('Control points and pauses')}
          >
            <h2>{t('Control points and pauses')}</h2>
            {route.waypoints.length > 0 && !validDepartureLocal(route.departureLocal) && (
              <p className="roadbook-elevation-note">
                {t('Set a local departure time to print arrivals.')}
              </p>
            )}
            {route.waypoints.length > 0 &&
              validDepartureLocal(route.departureLocal) &&
              schedule?.unavailable &&
              schedule.unavailable !== 'departure' && (
                <p className="roadbook-elevation-note">
                  {schedule.unavailable === 'moving-time'
                    ? t('A valid moving-time estimate is needed for the schedule.')
                    : schedule.unavailable === 'geometry'
                      ? t('Usable route geometry is needed for the schedule.')
                      : schedule.unavailable === 'waypoints'
                        ? t('At least two ordered waypoints must match the route to show arrivals.')
                        : schedule.unavailable === 'unmatched-waypoint'
                          ? t(
                              'This waypoint does not match the route; later arrivals are unavailable.',
                            )
                          : schedule.unavailable === 'disconnected'
                            ? t('This track has a gap; arrival times across it are unavailable.')
                            : schedule.unavailable === 'pause'
                              ? t('Enter whole pause minutes from 0 to 10080.')
                              : t('The arrival date is outside the supported calendar range.')}
                </p>
              )}
            {timesReady && (
              <p className="roadbook-elevation-note">
                {personal
                  ? t(
                      'Arrival times follow the personal moving estimate and the pauses saved on stops. Local clock only. Daylight-saving changes are not applied.',
                    )
                  : t(
                      'Arrival times follow the original moving estimate and the pauses saved on stops. Local clock only. Daylight-saving changes are not applied.',
                    )}
              </p>
            )}
            {timesReady && personal?.warnings.includes('missing-elevation') && (
              <p className="roadbook-elevation-note">
                {t(
                  'Complete heights unavailable: climbing is not included. A single time estimate uses the top of the range.',
                )}
              </p>
            )}
            {route.waypoints.length ? (
              <ol>
                {route.waypoints.map((waypoint, index) => {
                  const position = positions[index];
                  const next = positions[index + 1];
                  const legMetres =
                    position && next && next.along >= position.along
                      ? next.along - position.along
                      : null;
                  const timed = timesReady ? schedule?.rows[index] : null;
                  const role =
                    route.waypoints.length === 1
                      ? t('Start and finish')
                      : index === 0
                        ? t('Start')
                        : index === route.waypoints.length - 1
                          ? t('Finish')
                          : t('Checkpoint');
                  return (
                    <li key={waypoint.id}>
                      <span
                        className={`roadbook-stop-marker${
                          route.waypoints.length === 1
                            ? ' is-start'
                            : index === 0
                              ? ' is-start'
                              : index === route.waypoints.length - 1
                                ? ' is-finish'
                                : ''
                        }`}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <div className="roadbook-stop-content">
                        <p className="roadbook-stop-role">{role}</p>
                        <h3>{waypoint.name.trim() || coordinates(waypoint.coordinate)}</h3>
                        {waypoint.name.trim() && (
                          <p className="roadbook-stop-coordinates">
                            {coordinates(waypoint.coordinate)}
                          </p>
                        )}
                        {(position ||
                          legMetres !== null ||
                          timed?.arrivalLocal ||
                          waypoint.legMode === 'direct') && (
                          <dl className="roadbook-stop-facts">
                            {position && (
                              <div>
                                <dt>{t('From start')}</dt>
                                <dd>{formatDistance(position.along)}</dd>
                              </div>
                            )}
                            {legMetres !== null && (
                              <div>
                                <dt>{t('To the next stop')}</dt>
                                <dd>
                                  {formatDistance(legMetres)}
                                  {waypoint.legMode === 'direct' ? ` · ${t('Straight line')}` : ''}
                                </dd>
                              </div>
                            )}
                            {legMetres === null &&
                              waypoint.legMode === 'direct' &&
                              index < route.waypoints.length - 1 && (
                                <div>
                                  <dt>{t('To the next stop')}</dt>
                                  <dd>{t('Straight line')}</dd>
                                </div>
                              )}
                            {timed?.arrivalLocal && (
                              <div>
                                <dt>{t('Arrival')}</dt>
                                <dd>
                                  {clockTime(timed.arrivalLocal)}
                                  {timed.dayOffset !== null && timed.dayOffset > 0 && (
                                    <span className="roadbook-stop-day">
                                      {t('Day +{{count}}', { count: timed.dayOffset })}
                                    </span>
                                  )}
                                </dd>
                              </div>
                            )}
                            {timed?.departureLocal && !!waypoint.pauseMinutes && (
                              <div>
                                <dt>{t('Departure after pause')}</dt>
                                <dd>{clockTime(timed.departureLocal)}</dd>
                              </div>
                            )}
                          </dl>
                        )}
                        {!!waypoint.pauseMinutes && (
                          <p className="roadbook-stop-pause">
                            {t('Pause: {{duration}}', {
                              duration: formatDuration(waypoint.pauseMinutes * 60),
                            })}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="roadbook-unavailable">{t('No saved route points.')}</p>
            )}
          </section>
          <footer className="roadbook-footer">
            <span className="roadbook-wordmark">Roamlet</span>
            <p>
              {t(
                'Printed with Roamlet. Check the sheet before you rely on it. Times are estimates.',
              )}
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}
