import { useTranslation } from 'react-i18next';
import type { PlannedRoute } from '../domain/types';
import { formatDistance, formatDuration } from '../domain/format';
import { formatNumber } from '../i18n';
import './RouteComparison.css';

export const ROUTE_COMPARISON_COLORS = ['#286046', '#2864b7', '#bc6a20'] as const;

const sourceLabels: Record<PlannedRoute['source'], string> = {
  openrouteservice: 'OpenRouteService',
  mapbox: 'Mapbox',
  gpx: 'GPX import',
  manual: 'Manual drawing',
  mixed: 'Mixed sources',
};

function hasEligibleElevation(route: PlannedRoute): boolean {
  if (route.source !== 'gpx' && route.elevationSource !== 'openrouteservice') return false;
  const points = route.segments.flat();
  return (
    points.length > 1 && points.every((point) => point.length === 3 && Number.isFinite(point[2]))
  );
}

/** Pure dialog content. The parent owns dismissal, focus restoration and the read-only map.
 * Keep route order identical for the legend and comparisonLayers, using ROUTE_COMPARISON_COLORS.
 * Fit combined geometry without replacing the editor route or rendering it as the map's base layer.
 */
export function RouteComparison({ routes }: { routes: PlannedRoute[] }) {
  const { t } = useTranslation();
  if (
    routes.length < 2 ||
    routes.length > 3 ||
    new Set(routes.map((route) => route.id)).size !== routes.length
  )
    return <p>{t('Select 2–3 different saved routes to compare.')}</p>;

  const labels = ['Activity', 'Distance', 'Ascent', 'Descent', 'Source', 'Original duration'];
  const missing = t('Not available');
  const nonnegative = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) && value >= 0;
  const elevation = (route: PlannedRoute, value: number | undefined) =>
    hasEligibleElevation(route) && nonnegative(value)
      ? `${formatNumber(Math.round(value!))} ${t('m')}`
      : missing;

  return (
    <div className="route-comparison">
      <ul className="route-comparison-legend" aria-label={t('Route colors')}>
        {routes.map((route, index) => (
          <li key={route.id}>
            <span
              className="route-comparison-color"
              style={{ backgroundColor: ROUTE_COMPARISON_COLORS[index] }}
              aria-hidden="true"
            />
            <span>
              {index + 1}. {route.name}
            </span>
          </li>
        ))}
      </ul>
      {new Set(routes.map((route) => route.activity)).size > 1 && (
        <p className="route-comparison-note">
          {t('Mixed activities: durations are not directly comparable.')}
        </p>
      )}
      <table className="route-comparison-table" role="table">
        <caption className="route-comparison-sr-only">{t('Saved route comparison')}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              {t('Route')}
            </th>
            {labels.map((label) => (
              <th key={label} scope="col" role="columnheader">
                {t(label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {routes.map((route, index) => {
            const values = [
              route.activity === 'cycling' ? t('Cycling') : t('Hiking'),
              nonnegative(route.stats.distance) ? formatDistance(route.stats.distance) : missing,
              elevation(route, route.stats.ascent),
              elevation(route, route.stats.descent),
              t(sourceLabels[route.source]),
              nonnegative(route.stats.duration) && route.stats.duration > 0
                ? formatDuration(route.stats.duration)
                : missing,
            ];
            return (
              <tr key={route.id} role="row">
                <th scope="row" role="rowheader">
                  {index + 1}. {route.name}
                </th>
                {values.map((value, column) => (
                  <td key={labels[column]} role="cell">
                    <span className="route-comparison-mobile-label" aria-hidden="true">
                      {t(labels[column])}
                    </span>
                    <span>{value}</span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="route-comparison-note">
        {t(
          'Saved duration, not a personal estimate. Missing or incomplete elevation is not estimated.',
        )}
      </p>
    </div>
  );
}
