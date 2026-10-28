import { useTranslation } from 'react-i18next';
import { useMemo, useId, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';
import { Info } from 'lucide-react';
import type { PlannedRoute } from '../domain/types';
import { elevationSamples } from '../domain/stats';
import i18n, { formatNumber } from '../i18n';
export const formatDistance = (metres: number) =>
  `${formatNumber(metres / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${i18n.t('km')}`;
export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60
    ? `${formatNumber(Math.floor(minutes / 60))} ${i18n.t('h')} ${formatNumber(minutes % 60)} ${i18n.t('min')}`
    : `${formatNumber(minutes)} ${i18n.t('min')}`;
}
export function Statistics({
  route,
  emptyHint,
}: {
  route: PlannedRoute | null;
  emptyHint?: string;
}) {
  const { t } = useTranslation();
  const [elevationTarget, setElevationTarget] = useState<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1025px)');
    if (!media) return;
    const mobile = window.matchMedia('(max-width: 700px)');
    const updateTarget = () => {
      setElevationTarget(media.matches ? document.getElementById('map-elevation-root') : null);
      setCompact(mobile.matches);
    };
    updateTarget();
    media.addEventListener('change', updateTarget);
    mobile.addEventListener('change', updateTarget);
    return () => {
      media.removeEventListener('change', updateTarget);
      mobile.removeEventListener('change', updateTarget);
    };
  }, []);
  const samples = useMemo(() => (route ? elevationSamples(route.segments) : []), [route]);
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
  const elevationProfile =
    samples.length > 1 ? (
      <details className="elevation-box" open={!compact}>
        <summary className="section-heading">
          <span>{t('Elevation profile')}</span>
          <span className="small muted">{t('metres')}</span>
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
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                width={32}
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
          <p className="fine-print">
            {route?.source !== 'gpx'
              ? t('Elevation: provider terrain model, not a survey.')
              : t('Elevation: GPX file, when available.')}
          </p>
        </>
      </details>
    ) : null;
  if (!route)
    return (
      <section className="statistics statistics-empty" aria-label={t('Route statistics')}>
        <Info size={18} aria-hidden="true" />
        <p>{emptyHint || t('Add two stops to see distance, time and elevation.')}</p>
      </section>
    );
  return (
    <section className="statistics" aria-label={t('Route statistics')}>
      <dl className="stat-grid">
        <div className="stat-card">
          <dt>{t('Distance')}</dt>
          <dd>{formatDistance(route.stats.distance)}</dd>
        </div>
        <div className="stat-card">
          <dt>{t('Est. moving time')}</dt>
          <dd>{formatDuration(route.stats.duration)}</dd>
        </div>
        <div className="stat-card">
          <dt>{t('Elevation gain')}</dt>
          <dd>
            {route.stats.ascent !== undefined
              ? `${formatNumber(Math.round(route.stats.ascent))} ${t('m')}`
              : t('Unavailable')}
          </dd>
        </div>
        <div className="stat-card">
          <dt>{t('Elevation loss')}</dt>
          <dd>
            {route.stats.descent !== undefined
              ? `${formatNumber(Math.round(route.stats.descent))} ${t('m')}`
              : t('Unavailable')}
          </dd>
        </div>
      </dl>
      <p className="fine-print">
        {t('Time is an estimate, excluding stops.')}
        <span className="sr-only">{route.source === 'gpx' ? t('Imported GPX') : 'Mapbox'}</span>
      </p>
      {elevationTarget ? createPortal(elevationProfile, elevationTarget) : elevationProfile}
    </section>
  );
}
