import { useTranslation } from 'react-i18next';
import { useMemo, useEffect, useState, type ComponentProps } from 'react';
import { optionalLazy } from './OptionalPanel';
import { ChevronDown, Info } from 'lucide-react';
import type { Coordinate, PlannedRoute } from '../domain/types';
import { elevationSamples } from '../domain/stats';
import { elevationChartSamples } from './elevationChartSamples';
import './TimeExplanation.css';
import './disclosures.css';
import { formatNumber } from '../i18n';
import { formatDistance, formatDuration } from '../domain/format';
import {
  estimatePersonalTime,
  outwardMinutes,
  type Fitness,
  type Surface,
  type TimeRange,
  type TimeWarning,
} from '../domain/time';
const ElevationChart = optionalLazy<ComponentProps<typeof import('./ElevationChart').ElevationChart>>(
  () => import('./ElevationChart').then(({ ElevationChart }) => ({ default: ElevationChart })),
);

function formatTimeRange(range: TimeRange) {
  const rounded = outwardMinutes(range)!;
  return `${formatDuration(rounded.lower * 60)}–${formatDuration(rounded.upper * 60)}`;
}
const warningLabels: Record<TimeWarning, string> = {
  'unknown-surface': 'Surface is unknown: no surface penalty applied; the range is wider.',
  'missing-elevation':
    'Complete GPX heights unavailable: climbing is not included; the range is wider.',
  'manual-distance': 'Manual straight-line distance may underestimate the actual path.',
  'cycling-climb': 'Cycling climb allowance is a rough heuristic, not Naismith’s walking rule.',
};
export { formatDistance, formatDuration } from '../domain/format';
export function Statistics({
  route,
  emptyHint,
  speedKmh,
  stopsMinutes = 0,
  fitness = 'regular',
  surface = 'unknown',
  mapAvailable = true,
  onElevationHover,
  elevationOpen,
  onElevationOpenChange,
}: {
  route: PlannedRoute | null;
  emptyHint?: string;
  speedKmh?: number;
  stopsMinutes?: number;
  fitness?: Fitness;
  surface?: Surface;
  mapAvailable?: boolean;
  onElevationHover?: (coordinate: Coordinate | null) => void;
  elevationOpen?: boolean;
  onElevationOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [compact, setCompact] = useState(
    () => window.matchMedia?.('(max-width: 700px)').matches ?? false,
  );
  const [profilePosition, setProfilePosition] = useState(0);
  const [localElevationOpen, setLocalElevationOpen] = useState<boolean | undefined>(undefined);
  const profileOpen = elevationOpen ?? localElevationOpen ?? !compact;
  useEffect(() => {
    setProfilePosition(0);
    onElevationHover?.(null);
    return () => onElevationHover?.(null);
  }, [route?.segments, onElevationHover]);
  useEffect(() => {
    const mobile = window.matchMedia?.('(max-width: 700px)');
    if (!mobile) return;
    const updateCompact = () => setCompact(mobile.matches);
    updateCompact();
    mobile.addEventListener('change', updateCompact);
    return () => mobile.removeEventListener('change', updateCompact);
  }, []);
  const samples = useMemo(
    () =>
      route && (route.source === 'gpx' || route.elevationSource === 'openrouteservice')
        ? elevationSamples(route.segments)
        : [],
    [route],
  );
  const showElevation =
    samples.length > 1 && route?.stats.ascent !== undefined && route.stats.descent !== undefined;
  const minimum = samples.length
    ? samples.reduce((min, s) => Math.min(min, s.elevation), Infinity)
    : 0;
  const maximum = samples.length
    ? samples.reduce((max, s) => Math.max(max, s.elevation), -Infinity)
    : 0;
  const total = samples.at(-1)?.distance || 1;
  const chartSamples = useMemo(
    () => (samples.length && route ? elevationChartSamples(route.segments) : []),
    [route, samples.length],
  );
  const previewPaths = useMemo(() => {
    const paths: { line: string; area: string }[] = [];
    let points: { x: number; y: number }[] = [];
    const finishSegment = () => {
      if (!points.length) return;
      const line = points
        .map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`)
        .join(' ');
      paths.push({
        line,
        area: `${line} L${points.at(-1)!.x.toFixed(2)},32 L${points[0].x.toFixed(2)},32 Z`,
      });
      points = [];
    };
    for (const sample of chartSamples) {
      if (sample.elevation === null) {
        finishSegment();
      } else {
        points.push({
          x: (sample.distance / total) * 160,
          y:
            maximum === minimum
              ? 16
              : 29 - ((sample.elevation - minimum) / (maximum - minimum)) * 26,
        });
      }
    }
    finishSegment();
    return paths;
  }, [chartSamples, minimum, maximum, total]);
  const linkedSamples = chartSamples.filter((sample) => sample.coordinate);
  const elevationProfile = showElevation ? (
    <details className="elevation-box planner-disclosure" open={profileOpen}>
      <summary
        className="section-heading"
        aria-expanded={profileOpen}
        onClick={(event) => {
          event.preventDefault();
          const open = !profileOpen;
          setLocalElevationOpen(open);
          onElevationOpenChange?.(open);
          if (!open) onElevationHover?.(null);
        }}
      >
        <span>{t('Elevation profile')}</span>
        {!profileOpen && (
          <svg
            className="elevation-preview"
            viewBox="0 0 160 32"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {previewPaths.map(({ line, area }, index) => (
              <g key={index}>
                <path d={area} fill="currentColor" fillOpacity={0.12} />
                <path
                  d={line}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          </svg>
        )}
        <span className="elevation-toggle disclosure-toggle" aria-hidden="true">
          <ChevronDown size={18} />
        </span>
      </summary>
      <>
        {profileOpen && (
          <ElevationChart
            samples={chartSamples}
            minimum={minimum}
            maximum={maximum}
            total={total}
            onElevationHover={onElevationHover}
          />
        )}
        {onElevationHover && mapAvailable && linkedSamples.length > 1 && (
          <label className="elevation-position">
            {t('Position on elevation profile')}
            <input
              type="range"
              min={0}
              max={linkedSamples.length - 1}
              step={1}
              value={profilePosition}
              aria-valuetext={formatDistance(linkedSamples[profilePosition]?.distance ?? 0)}
              onChange={(event) => {
                const position = Number(event.target.value);
                setProfilePosition(position);
                onElevationHover(linkedSamples[position]?.coordinate ?? null);
              }}
              onBlur={() => onElevationHover(null)}
            />
          </label>
        )}
        <div className="chart-labels sr-only">
          <span>
            {formatNumber(Math.round(minimum))}–{formatNumber(Math.round(maximum))} {t('m')}
          </span>
          <span>{formatDistance(total)}</span>
        </div>
        <p className="fine-print">
          {t(
            route?.elevationSource === 'openrouteservice'
              ? 'Elevation: OpenRouteService terrain estimate, not a ground survey.'
              : 'Elevation: GPX file, when available.',
          )}
        </p>
      </>
    </details>
  ) : null;
  if (!route)
    return (
      <section className="statistics statistics-empty" aria-label={t('Route statistics')}>
        <Info size={18} aria-hidden="true" />
        <p>{emptyHint || t('Add two stops to see distance and time.')}</p>
      </section>
    );
  const personal =
    speedKmh === undefined
      ? null
      : estimatePersonalTime(route, { speedKmh, stopsMinutes, fitness, surface });
  const provider = route.source === 'openrouteservice' || route.source === 'mapbox';
  return (
    <section className="statistics" aria-label={t('Route statistics')}>
      <dl className="stat-grid">
        <div className="stat-card">
          <dt>{t('Distance')}</dt>
          <dd>{formatDistance(route.stats.distance)}</dd>
        </div>
        <div className="stat-card">
          <dt>
            {t(
              route.source === 'mixed'
                ? 'Combined time estimate'
                : provider
                  ? 'Provider estimate'
                  : speedKmh === undefined
                    ? 'Est. moving time'
                    : 'Original time estimate',
            )}
          </dt>
          <dd>{formatDuration(route.stats.duration)}</dd>
        </div>
        {personal && (
          <>
            <div className="stat-card">
              <dt>{t('Personal moving time')}</dt>
              <dd>{formatTimeRange(personal.movingRange)}</dd>
            </div>
            <div className="stat-card">
              <dt>{t('Total time with stops')}</dt>
              <dd>{formatTimeRange(personal.totalRange)}</dd>
            </div>
          </>
        )}
        {personal?.planningReference !== null && personal?.planningReference !== undefined && (
          <div className="stat-card">
            <dt>{t('Planning reference')}</dt>
            <dd>{formatDuration(Math.ceil(personal.planningReference / 60) * 60)}</dd>
          </div>
        )}
        {showElevation && (
          <>
            <div className="stat-card">
              <dt>{t('Elevation gain')}</dt>
              <dd>
                {formatNumber(Math.round(route.stats.ascent!))} {t('m')}
              </dd>
            </div>
            <div className="stat-card">
              <dt>{t('Elevation loss')}</dt>
              <dd>
                {formatNumber(Math.round(route.stats.descent!))} {t('m')}
              </dd>
            </div>
          </>
        )}
      </dl>
      <p className="fine-print">
        {personal
          ? t('Original time excludes stops; personal total includes them.')
          : route.source === 'manual'
            ? t('Moving time estimated at {{speed}} km/h, excluding stops.', {
                speed: route.activity === 'cycling' ? 18 : 5,
              })
            : t('Time is an estimate, excluding stops.')}
        <span className="sr-only">
          {route.source === 'gpx'
            ? t('Imported GPX')
            : route.source === 'manual'
              ? t('Manual route')
              : route.source === 'mixed'
                ? t('Mixed route')
                : route.source === 'mapbox'
                  ? 'Mapbox'
                  : 'OpenRouteService'}
        </span>
      </p>
      {route.source === 'mixed' && (
        <p className="fine-print">
          {t(
            'Combined time uses ORS estimates for routed sections and average speed for direct sections.',
          )}
        </p>
      )}
      {personal && (
        <details className="personal-time-assumptions time-explanation planner-disclosure">
          <summary className="section-heading">
            <span>{t('How time is estimated')}</span>
            <span className="disclosure-toggle" aria-hidden="true">
              <ChevronDown size={18} />
            </span>
          </summary>
          <div className="time-explanation-body">
            <h3>{t('Calculation inputs')}</h3>
            <dl className="time-inputs">
              <div>
                <dt>{t('Flat-ground speed')}</dt>
                <dd>
                  {t('{{speed}} km/h', {
                    speed: formatNumber(speedKmh!, { maximumFractionDigits: 2 }),
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('Surface adjustment')}</dt>
                <dd>×{formatNumber(personal.surfaceFactor, { maximumFractionDigits: 2 })}</dd>
              </div>
              <div>
                <dt>{t('Stops, added once')}</dt>
                <dd>{t('{{minutes}} min', { minutes: formatNumber(stopsMinutes) })}</dd>
              </div>
              {personal.ascentMetres !== null && (
                <div>
                  <dt>{t('Climbing allowance')}</dt>
                  <dd>
                    {t('{{minutes}} min', {
                      minutes: formatNumber(personal.climbSeconds / 60, {
                        maximumFractionDigits: 1,
                      }),
                    })}
                  </dd>
                </div>
              )}
            </dl>
            {personal.ascentMetres !== null && (
              <p className="fine-print">
                {t(
                  'Climbing uses {{ascent}} m ascent after 3 m noise filtering. Descents do not reduce time.',
                  { ascent: formatNumber(Math.round(personal.ascentMetres)) },
                )}
              </p>
            )}
            {provider && (
              <p className="fine-print">
                {t(
                  'Planning reference takes the longer moving estimate (provider or personal), then adds stops once.',
                )}
              </p>
            )}
            <h3>{t('Estimate limitations')}</h3>
            <ul className="time-limitations">
              <li>
                {t(
                  'The range is a rough planning estimate, not a statistical confidence interval or a guarantee.',
                )}
              </li>
              {personal.warnings.map((warning) => (
                <li key={warning}>{t(warningLabels[warning])}</li>
              ))}
              <li>
                {t(
                  'Weather, wind, load and access are not inferred. Original route statistics remain unchanged.',
                )}
              </li>
            </ul>
          </div>
        </details>
      )}
      {speedKmh !== undefined && !personal && (
        <p className="fine-print" role="status">
          {t('Personal estimate unavailable for these inputs.')}
        </p>
      )}
      {elevationProfile}
    </section>
  );
}
