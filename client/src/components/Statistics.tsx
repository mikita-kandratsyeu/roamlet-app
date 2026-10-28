import { useMemo } from 'react';
import { Mountain, Timer, Route as RouteIcon } from 'lucide-react';
import type { PlannedRoute } from '../domain/types';
import { elevationSamples } from '../domain/stats';
export const formatDistance = (metres: number) => `${(metres / 1000).toFixed(1)} km`;
export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}
export function Statistics({ route }: { route: PlannedRoute | null }) {
  const samples = useMemo(() => route ? elevationSamples(route.segments) : [], [route]);
  const minimum = samples.length ? samples.reduce((min, s) => Math.min(min, s.elevation), Infinity) : 0;
  const maximum = samples.length ? samples.reduce((max, s) => Math.max(max, s.elevation), -Infinity) : 0;
  const total = samples.at(-1)?.distance || 1;
  // Decimate only the chart, never the saved/exported geometry.
  const chartSamples = samples.filter((_, i) => i % Math.max(1, Math.ceil(samples.length / 400)) === 0 || i === samples.length - 1);
  const path = chartSamples.map((s, i) => `${i === 0 ? 'M' : 'L'}${(s.distance / total * 300).toFixed(2)},${(70 - (s.elevation - minimum) / Math.max(maximum - minimum, 1) * 56).toFixed(2)}`).join(' ');
  return <section className="statistics" aria-label="Route statistics">
    <div className="section-heading"><h2>Route overview</h2><span className="small muted">{route ? (route.source === 'gpx' ? 'Imported GPX' : 'OpenRouteService') : 'Ready when you are'}</span></div>
    <div className="stat-grid">
      <div><RouteIcon size={17} /><span>Distance</span><strong>{route ? formatDistance(route.stats.distance) : '—'}</strong></div>
      <div><Timer size={17} /><span>Est. moving time</span><strong>{route ? formatDuration(route.stats.duration) : '—'}</strong></div>
      <div><Mountain size={17} /><span>Elevation gain</span><strong>{route?.stats.ascent !== undefined ? `${Math.round(route.stats.ascent)} m` : 'Unavailable'}</strong></div>
      <div><Mountain size={17} /><span>Elevation loss</span><strong>{route?.stats.descent !== undefined ? `${Math.round(route.stats.descent)} m` : 'Unavailable'}</strong></div>
    </div>
    <div className="elevation-box"><div className="section-heading"><span>Elevation profile</span><span className="small muted">{samples.length ? 'metres' : 'No elevation data'}</span></div>
      {samples.length > 1 ? <><svg viewBox="0 0 300 80" role="img" aria-label={`Elevation from ${Math.round(minimum)} to ${Math.round(maximum)} metres`} preserveAspectRatio="none"><path d={`${path} L300,80 L0,80 Z`} fill="#e7efe8"/><path d={path} fill="none" stroke="#24654f" strokeWidth="2" /></svg><div className="chart-labels"><span>{Math.round(minimum)}–{Math.round(maximum)} m</span><span>{formatDistance(total)}</span></div></> : <p className="chart-empty">{route ? 'This route has no complete elevation data.' : 'Your route’s ups and downs will appear here.'}</p>}
    </div>
    {route && <p className="fine-print">{route.activity === 'cycling' ? 'General cycling' : 'Hiking'} · Time is an estimate, excluding stops. Surface information unavailable. {route.source === 'openrouteservice' ? 'Elevation: provider terrain model, not a survey.' : 'Elevation: GPX file, when available.'}</p>}
  </section>;
}
