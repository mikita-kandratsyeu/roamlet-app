import { Bike, Footprints, Printer } from 'lucide-react';
import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { analyzeRouteElevation } from '../domain/routeElevation';
import { formatDistance, formatDuration } from '../domain/format';
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

export function RouteBookExport({ route, onPrint }: { route: PlannedRoute; onPrint: () => void }) {
  const { t } = useTranslation();
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
  const ascent = elevation?.complete ? (route.stats.ascent ?? elevation.ascent) : elevation?.ascent;
  const descent = elevation?.complete
    ? (route.stats.descent ?? elevation.descent)
    : elevation?.descent;
  const hasElevation = Boolean(elevation?.available);

  function coordinates(coordinate: PlannedRoute['waypoints'][number]['coordinate']) {
    return `${formatNumber(coordinate[1], { maximumFractionDigits: 5 })}, ${formatNumber(
      coordinate[0],
      { maximumFractionDigits: 5 },
    )}`;
  }

  return (
    <div className="roadbook-export">
      <div className="roadbook-toolbar">
        <p className="roadbook-print-help">
          {t('A4 portrait. Choose Print to open your browser’s print dialog.')}
        </p>
        <Button type="button" className="roadbook-print-action" onClick={onPrint}>
          <Printer size={17} aria-hidden="true" />
          {t('Print roadbook')}
        </Button>
      </div>
      <div className="roadbook-stage">
        <article className="roadbook-print-sheet">
          <header className="roadbook-header">
            <div className="roadbook-brandbar">
              <BrandMark />
              <span className="roadbook-wordmark">Roamlet</span>
              <p className="roadbook-kicker">{t('Route roadbook')}</p>
            </div>
            <div className="roadbook-title-row">
              <h1>{route.name.trim() || t('Untitled adventure')}</h1>
              <p className="roadbook-activity">
                {route.activity === 'cycling' ? (
                  <Bike size={15} aria-hidden="true" />
                ) : (
                  <Footprints size={15} aria-hidden="true" />
                )}
                {t(route.activity === 'cycling' ? 'Cycling' : 'Hiking')}
              </p>
            </div>
            <dl className="roadbook-metrics">
              <div>
                <dt>{t('Distance')}</dt>
                <dd>{formatDistance(route.stats.distance)}</dd>
              </div>
              <div>
                <dt>{t('Original time estimate')}</dt>
                <dd>{formatDuration(route.stats.duration)}</dd>
              </div>
              {hasElevation && typeof ascent === 'number' && Number.isFinite(ascent) && (
                <div>
                  <dt>{t(elevation?.complete ? 'Elevation gain' : 'Known elevation gain')}</dt>
                  <dd>
                    {formatNumber(Math.round(ascent))} {t('m')}
                  </dd>
                </div>
              )}
              {hasElevation && typeof descent === 'number' && Number.isFinite(descent) && (
                <div>
                  <dt>{t(elevation?.complete ? 'Elevation loss' : 'Known elevation loss')}</dt>
                  <dd>
                    {formatNumber(Math.round(descent))} {t('m')}
                  </dd>
                </div>
              )}
            </dl>
          </header>

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

          <section
            className="roadbook-section roadbook-stops"
            aria-label={t('Control points and pauses')}
          >
            <h2>{t('Control points and pauses')}</h2>
            {route.waypoints.length ? (
              <ol>
                {route.waypoints.map((waypoint, index) => {
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
