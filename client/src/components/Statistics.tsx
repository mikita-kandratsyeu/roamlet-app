import { useTranslation } from 'react-i18next';
import { useMemo, useId } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card } from './ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';
import { Mountain, Timer, Route as RouteIcon } from 'lucide-react';
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
export function Statistics({ route }: { route: PlannedRoute | null }) {
  const { t } = useTranslation();
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
  return (
    <section className="statistics" aria-label={t('Route statistics')}>
      <div className="section-heading">
        <h2><RouteIcon size={15} aria-hidden="true" />{t('Route overview')}</h2>
        <span className="small muted">
          {route
            ? route.source === 'gpx'
              ? t('Imported GPX')
              : 'OpenRouteService'
            : t('Ready when you are')}
        </span>
      </div>
      <div className="stat-grid">
        <Card className="stat-card">
          <RouteIcon size={17} />
          <span>{t('Distance')}</span>
          <strong>{route ? formatDistance(route.stats.distance) : '—'}</strong>
        </Card>
        <Card className="stat-card">
          <Timer size={17} />
          <span>{t('Est. moving time')}</span>
          <strong>{route ? formatDuration(route.stats.duration) : '—'}</strong>
        </Card>
        <Card className="stat-card">
          <Mountain size={17} />
          <span>{t('Elevation gain')}</span>
          <strong>
            {route?.stats.ascent !== undefined
              ? `${formatNumber(Math.round(route.stats.ascent))} ${t('m')}`
              : t('Unavailable')}
          </strong>
        </Card>
        <Card className="stat-card">
          <Mountain size={17} />
          <span>{t('Elevation loss')}</span>
          <strong>
            {route?.stats.descent !== undefined
              ? `${formatNumber(Math.round(route.stats.descent))} ${t('m')}`
              : t('Unavailable')}
          </strong>
        </Card>
      </div>
      <Card className="elevation-box">
        <div className="section-heading">
          <span>{t('Elevation profile')}</span>
          <span className="small muted">
            {samples.length ? t('metres') : t('No elevation data')}
          </span>
        </div>
        {samples.length > 1 ? (
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
                    <stop offset="0%" stopColor="var(--color-elevation)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-elevation)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="distance" type="number" domain={[0, total]} hide />
                <YAxis dataKey="elevation" domain={['dataMin - 5', 'dataMax + 5']} hide />
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
            <div className="chart-labels">
              <span>
                {formatNumber(Math.round(minimum))}–{formatNumber(Math.round(maximum))} {t('m')}
              </span>
              <span>{formatDistance(total)}</span>
            </div>
          </>
        ) : (
          <p className="chart-empty">
            {route
              ? t('This route has no complete elevation data.')
              : t('Your route’s ups and downs will appear here.')}
          </p>
        )}
      </Card>
      {route && (
        <p className="fine-print">
          {route.activity === 'cycling' ? t('General cycling') : t('Hiking')}{' '}
          {t('· Time is an estimate, excluding stops. Surface information unavailable.')}{' '}
          {route.source === 'openrouteservice'
            ? t('Elevation: provider terrain model, not a survey.')
            : t('Elevation: GPX file, when available.')}
        </p>
      )}
    </section>
  );
}
