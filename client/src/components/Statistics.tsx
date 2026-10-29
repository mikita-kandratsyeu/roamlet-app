import { useTranslation } from 'react-i18next';
import { useMemo, useId, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';
import { ChevronDown, Info } from 'lucide-react';
import type { PlannedRoute } from '../domain/types';
import { elevationSamples } from '../domain/stats';
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
}: {
  route: PlannedRoute | null;
  emptyHint?: string;
  speedKmh?: number;
  stopsMinutes?: number;
  fitness?: Fitness;
  surface?: Surface;
  mapAvailable?: boolean;
}) {
  const { t } = useTranslation();
  const [elevationTarget, setElevationTarget] = useState<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1025px)');
    if (!media) return;
    const mobile = window.matchMedia('(max-width: 700px)');
    const updateTarget = () => {
      setElevationTarget(
        mapAvailable && media.matches ? document.getElementById('map-elevation-root') : null,
      );
      setCompact(mobile.matches);
    };
    updateTarget();
    media.addEventListener('change', updateTarget);
    mobile.addEventListener('change', updateTarget);
    return () => {
      media.removeEventListener('change', updateTarget);
      mobile.removeEventListener('change', updateTarget);
    };
  }, [mapAvailable]);
  const samples = useMemo(
    () => (route?.source === 'gpx' ? elevationSamples(route.segments) : []),
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
  const gradientId = `elevation-${useId().replace(/:/g, '')}`;
  // Decimate only the chart, never the saved/exported geometry.
  const chartSamples = samples.filter(
    (_, i) => i % Math.max(1, Math.ceil(samples.length / 400)) === 0 || i === samples.length - 1,
  );
  const elevationProfile = showElevation ? (
    <details className="elevation-box" open={!compact}>
      <summary className="section-heading">
        <span>{t('Elevation profile')}</span>
        <span className="elevation-toggle" aria-hidden="true">
          <ChevronDown size={18} />
        </span>
      </summary>
      <>
        <ChartContainer
          config={{ elevation: { label: t('Elevation'), color: 'var(--primary)' } }}
          className="elevation-chart"
          role="img"
          aria-label={t('Elevation from {{minimum}} to {{maximum}} metres', {
            minimum: formatNumber(Math.round(minimum)),
            maximum: formatNumber(Math.round(maximum)),
          })}
        >
          <AreaChart data={chartSamples} margin={{ top: 12, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-elevation)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--color-elevation)" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="distance"
              type="number"
              domain={[0, total]}
              ticks={[0, total / 3, (total * 2) / 3, total]}
              tickFormatter={(distance: number) =>
                distance === total
                  ? formatDistance(distance)
                  : formatNumber(distance / 1000, { maximumFractionDigits: 1 })
              }
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
              height={20}
            />
            <YAxis
              dataKey="elevation"
              domain={['dataMin - 5', 'dataMax + 5']}
              tickFormatter={(elevation: number) => `${formatNumber(elevation)} ${t('m')}`}
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) =>
                    formatDistance(Number(payload[0]?.payload.distance ?? 0))
                  }
                  formatter={(value) => `${formatNumber(Math.round(Number(value)))} ${t('m')}`}
                />
              }
            />
            <Area
              dataKey="elevation"
              type="linear"
              fill={`url(#${gradientId})`}
              stroke="var(--color-elevation)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
        <div className="chart-labels sr-only">
          <span>
            {formatNumber(Math.round(minimum))}–{formatNumber(Math.round(maximum))} {t('m')}
          </span>
          <span>{formatDistance(total)}</span>
        </div>
        <p className="fine-print">{t('Elevation: GPX file, when available.')}</p>
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
              provider
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
        {route.source === 'manual'
          ? t('Moving time estimated at {{speed}} km/h, excluding stops.', {
              speed: route.activity === 'cycling' ? 18 : 5,
            })
          : t('Time is an estimate, excluding stops.')}
        <span className="sr-only">
          {route.source === 'gpx'
            ? t('Imported GPX')
            : route.source === 'manual'
              ? t('Manual route')
              : route.source === 'mapbox'
                ? 'Mapbox'
                : 'OpenRouteService'}
        </span>
      </p>
      {personal && (
        <div className="personal-time-assumptions">
          <p className="fine-print">
            {t('Heuristic planning range, not a confidence interval or guarantee.')}
          </p>
          {provider && (
            <p className="fine-print">
              {t(
                'Planning reference uses the larger of provider and personal moving estimates, plus stops once. Not a guarantee.',
              )}
            </p>
          )}
          <p className="fine-print">
            {t(
              'Flat-ground speed {{speed}} km/h; surface factor ×{{factor}}; stops {{stops}} min added once.',
              {
                speed: formatNumber(speedKmh!, { maximumFractionDigits: 2 }),
                factor: formatNumber(personal.surfaceFactor, { maximumFractionDigits: 2 }),
                stops: formatNumber(stopsMinutes),
              },
            )}
          </p>
          {personal.ascentMetres !== null && (
            <p className="fine-print">
              {t(
                'GPX ascent {{ascent}} m after 3 m noise filtering; climb allowance {{minutes}} min. No downhill bonus.',
                {
                  ascent: formatNumber(Math.round(personal.ascentMetres)),
                  minutes: formatNumber(personal.climbSeconds / 60, { maximumFractionDigits: 1 }),
                },
              )}
            </p>
          )}
          {personal.warnings.map((warning) => (
            <p className="fine-print" key={warning}>
              {t(warningLabels[warning])}
            </p>
          ))}
          <p className="fine-print">
            {t(
              'Weather, wind, load and access are not inferred. Original route statistics remain unchanged.',
            )}
          </p>
        </div>
      )}
      {speedKmh !== undefined && !personal && (
        <p className="fine-print" role="status">
          {t('Personal estimate unavailable for these inputs.')}
        </p>
      )}
      {elevationTarget ? createPortal(elevationProfile, elevationTarget) : elevationProfile}
    </section>
  );
}
