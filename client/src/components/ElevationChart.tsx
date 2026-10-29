import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';
import type { Coordinate } from '../domain/types';
import type { ElevationChartSample } from './elevationChartSamples';
import { formatNumber } from '../i18n';
import { formatDistance } from '../domain/format';

export function ElevationChart({
  samples,
  minimum,
  maximum,
  total,
  onElevationHover,
}: {
  samples: ElevationChartSample[];
  minimum: number;
  maximum: number;
  total: number;
  onElevationHover?: (coordinate: Coordinate | null) => void;
}) {
  const { t } = useTranslation();
  const gradientId = `elevation-${useId().replace(/:/g, '')}`;
  const hoverSample = (index: number | string | null | undefined, active = true) => {
    const sample = index == null ? undefined : samples[Number(index)];
    onElevationHover?.(active ? (sample?.coordinate ?? null) : null);
  };
  return (
    <ChartContainer
      config={{ elevation: { label: t('Elevation'), color: 'var(--primary)' } }}
      className="elevation-chart"
      role="img"
      aria-label={t('Elevation from {{minimum}} to {{maximum}} metres', {
        minimum: formatNumber(Math.round(minimum)),
        maximum: formatNumber(Math.round(maximum)),
      })}
    >
      <AreaChart
        data={samples}
        margin={{ top: 12, right: 4, bottom: 0, left: 0 }}
        onMouseMove={(event) => hoverSample(event.activeTooltipIndex, event.isTooltipActive)}
        onClick={(event) => hoverSample(event.activeTooltipIndex, event.isTooltipActive)}
        onMouseLeave={() => onElevationHover?.(null)}
      >
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
          tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          height={20}
        />
        <YAxis
          dataKey="elevation"
          domain={['dataMin - 5', 'dataMax + 5']}
          tickFormatter={(elevation: number) => `${formatNumber(elevation)} ${t('m')}`}
          tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          width={52}
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
          connectNulls={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
