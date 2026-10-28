import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Mountain, Timer, Route as RouteIcon } from 'lucide-react';
import type { PlannedRoute } from '../domain/types';
import { elevationSamples } from '../domain/stats';
import i18n, { formatNumber } from '../i18n';
export const formatDistance = (metres: number) => `${formatNumber(metres / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${i18n.t('km')}`;
export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${formatNumber(Math.floor(minutes / 60))} ${i18n.t('h')} ${formatNumber(minutes % 60)} ${i18n.t('min')}` : `${formatNumber(minutes)} ${i18n.t('min')}`;
}
export function Statistics({ route }: { route: PlannedRoute | null }) {
  const { t } = useTranslation();
  const samples = useMemo(() => route ? elevationSamples(route.segments) : [], [route]);
  const minimum = samples.length ? samples.reduce((min, s) => Math.min(min, s.elevation), Infinity) : 0;
  const maximum = samples.length ? samples.reduce((max, s) => Math.max(max, s.elevation), -Infinity) : 0;
  const total = samples.at(-1)?.distance || 1;
  // Decimate only the chart, never the saved/exported geometry.
  const chartSamples = samples.filter((_, i) => i % Math.max(1, Math.ceil(samples.length / 400)) === 0 || i === samples.length - 1);
  const path = chartSamples.map((s, i) => `${i === 0 ? 'M' : 'L'}${(s.distance / total * 300).toFixed(2)},${(70 - (s.elevation - minimum) / Math.max(maximum - minimum, 1) * 56).toFixed(2)}`).join(' ');
  return <section className="statistics" aria-label={t("Route statistics")}>
    <div className="section-heading"><h2>{t("Route overview")}</h2><span className="small muted">{route ? (route.source === 'gpx' ? t("Imported GPX") : 'OpenRouteService') : t("Ready when you are")}</span></div>
    <div className="stat-grid">
      <div><RouteIcon size={17} /><span>{t("Distance")}</span><strong>{route ? formatDistance(route.stats.distance) : '—'}</strong></div>
      <div><Timer size={17} /><span>{t("Est. moving time")}</span><strong>{route ? formatDuration(route.stats.duration) : '—'}</strong></div>
      <div><Mountain size={17} /><span>{t("Elevation gain")}</span><strong>{route?.stats.ascent !== undefined ? `${formatNumber(Math.round(route.stats.ascent))} ${t("m")}` : t("Unavailable")}</strong></div>
      <div><Mountain size={17} /><span>{t("Elevation loss")}</span><strong>{route?.stats.descent !== undefined ? `${formatNumber(Math.round(route.stats.descent))} ${t("m")}` : t("Unavailable")}</strong></div>
    </div>
    <div className="elevation-box"><div className="section-heading"><span>{t("Elevation profile")}</span><span className="small muted">{samples.length ? t("metres") : t("No elevation data")}</span></div>
      {samples.length > 1 ? <><svg viewBox="0 0 300 80" role="img" aria-label={t("Elevation from {{minimum}} to {{maximum}} metres", { minimum: formatNumber(Math.round(minimum)), maximum: formatNumber(Math.round(maximum)) })} preserveAspectRatio="none"><path d={`${path} L300,80 L0,80 Z`} fill="#e7efe8"/><path d={path} fill="none" stroke="#24654f" strokeWidth="2" /></svg><div className="chart-labels"><span>{formatNumber(Math.round(minimum))}–{formatNumber(Math.round(maximum))} {t("m")}</span><span>{formatDistance(total)}</span></div></> : <p className="chart-empty">{route ? t("This route has no complete elevation data.") : t("Your route’s ups and downs will appear here.")}</p>}
    </div>
    {route && <p className="fine-print">{route.activity === 'cycling' ? t("General cycling") : t("Hiking")} {t("· Time is an estimate, excluding stops. Surface information unavailable.")} {route.source === 'openrouteservice' ? t("Elevation: provider terrain model, not a survey.") : t("Elevation: GPX file, when available.")}</p>}
  </section>;
}
