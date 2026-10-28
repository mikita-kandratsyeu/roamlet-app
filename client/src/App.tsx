import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bike, Footprints, Search, Plus, ArrowDownUp, ArrowUp, ArrowDown, X, Download, Upload, Bookmark, Library as LibraryIcon, ChevronDown, ChevronUp, Sparkles, Check, Pencil, LoaderCircle, Info } from 'lucide-react';
import type { Activity, Coordinate, PlannedRoute, RoutingResult, Waypoint } from './domain/types';
import { importGpx, exportGpx, gpxFilename } from './domain/gpx';
import { calculateStats } from './domain/stats';
import { saveRoute } from './domain/storage';
import { checkRoutingConfiguration, routingProvider, searchPlaces, type Place } from './services/routing';
import { RouteMap } from './components/RouteMap';
import { Statistics, formatDistance, formatDuration } from './components/Statistics';
import { Dialog } from './components/Dialog';
import { Library } from './components/Library';
import i18n, { formatNumber, translateMessage } from './i18n';

const emptySegments: Coordinate[][] = [];
const identity = (): { id: string; createdAt: string } => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString() });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
interface Confirmation { title: string; text: string; label: string; action: () => void }

export default function App() {
  const { t } = useTranslation();
  const [activity, setActivity] = useState<Activity>('cycling');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [result, setResult] = useState<PlannedRoute | null>(null);
  const [mode, setMode] = useState<'manual' | 'snapshot'>('manual');
  const [planningMode, setPlanningMode] = useState<'point' | 'loop'>('point');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [routingConfigured, setRoutingConfigured] = useState<boolean | null>(null);
  const [configurationUnavailable, setConfigurationUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchTarget, setSearchTarget] = useState<string | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [targetKm, setTargetKm] = useState(20);
  const [alternatives, setAlternatives] = useState<RoutingResult[]>([]);
  const [selectedAlternative, setSelectedAlternative] = useState(-1);
  const routeIdentity = useRef(identity());
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const fail = (text: string) => setNotice({ text, error: true });

  useEffect(() => {
    if (mode !== 'manual' || planningMode !== 'point' || waypoints.length < 2) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setNotice(null); setResult(null);
    const timer = setTimeout(() => {
      routingProvider.calculateRoute(waypoints, activity, controller.signal).then(calculated => {
        if (controller.signal.aborted) return;
        setResult({ ...routeIdentity.current, name: i18n.t('Untitled adventure'), description: '', activity, waypoints, ...calculated, updatedAt: new Date().toISOString(), source: 'openrouteservice' });
        setFitToken(token => token + 1);
      }).catch(error => { if (!controller.signal.aborted) setNotice({ text: errorMessage(error), error: true }); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [activity, waypoints, mode, planningMode]);
  useEffect(() => {
    const controller = new AbortController();
    checkRoutingConfiguration(controller.signal).then(configured => {
      if (!controller.signal.aborted) setRoutingConfigured(configured);
    }).catch(() => {
      if (!controller.signal.aborted) setConfigurationUnavailable(true);
    });
    return () => controller.abort();
  }, []);
  useEffect(() => () => { request.current?.abort(); searchRequest.current?.abort(); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function invalidate() {
    request.current?.abort(); setBusy(false); setResult(null); setAlternatives([]); setSelectedAlternative(-1); setNotice(null); setDirty(true);
  }
  function changeWaypoints(next: Waypoint[]) { invalidate(); setWaypoints(next); }
  function addLocation(coordinate: Coordinate, label?: string) {
    if (mode !== 'manual') return;
    const point: Waypoint = { id: crypto.randomUUID(), name: label || `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`, coordinate };
    if (searchTarget) changeWaypoints(waypoints.map(w => w.id === searchTarget ? { ...point, id: w.id } : w));
    else if (planningMode === 'loop') changeWaypoints([point]);
    else if (waypoints.length < 50) changeWaypoints([...waypoints, point]);
    else { fail('A route supports up to 50 stops. Remove a stop before adding another.'); return; }
    setPlaces([]); setQuery(''); setSearchTarget(null);
  }
  function guard(action: () => void) {
    if (dirty) setConfirmation({ title: 'Leave this route?', text: 'Your unsaved changes will be lost. Save the route first if you want to keep it.', label: 'Discard changes', action });
    else action();
  }
  function newRoute() {
    invalidate(); routeIdentity.current = identity(); setWaypoints([]); setName(''); setDescription(''); setMode('manual'); setPlanningMode('point'); setDirty(false); setQuery(''); setPlaces([]); setSearchTarget(null);
  }
  function openRoute(route: PlannedRoute) {
    invalidate(); routeIdentity.current = { id: route.id, createdAt: route.createdAt };
    setResult(route); setWaypoints(route.waypoints); setName(route.name); setDescription(route.description); setActivity(route.activity); setMode('snapshot'); setPlanningMode('point'); setDirty(false); setLibraryOpen(false); setCollapsed(false); setFitToken(token => token + 1); setSearchTarget(null); setPlaces([]); setQuery('');
  }
  function currentRoute(): PlannedRoute | null { return result ? { ...result, name: name.trim() || i18n.t('Untitled adventure'), description: description.trim(), activity, updatedAt: new Date().toISOString() } : null; }
  async function doSave() {
    const route = currentRoute(); if (!route || !name.trim()) return;
    setSaving(true);
    try { await saveRoute(route); setDirty(false); setSaveOpen(false); setNotice({ text: 'Route saved on this device. Your next adventure is ready.', error: false }); }
    catch (error) { fail(errorMessage(error)); }
    finally { setSaving(false); }
  }
  function download() {
    const route = currentRoute(); if (!route || busy) return;
    try {
      const blob = new Blob([exportGpx(route)], { type: 'application/gpx+xml' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = gpxFilename(route.name); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ text: 'GPX exported. Import it through your GPS device or compatible app’s GPX upload workflow.', error: false });
    } catch (error) { fail(errorMessage(error)); }
  }
  async function handleFile(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { fail('Choose a GPX file smaller than 10 MiB.'); return; }
    try {
      const route = importGpx(await file.text());
      guard(() => { openRoute(route); setDirty(true); setNotice({ text: 'GPX imported. Original points and track segments are preserved. Save it to keep it on this device.', error: false }); });
    } catch (error) { fail(errorMessage(error)); }
  }
  async function search(event: React.FormEvent) {
    event.preventDefault(); searchRequest.current?.abort(); setSearching(false); setNotice(null); setPlaces([]);
    const coordinateMatch = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordinateMatch) {
      const latitude = Number(coordinateMatch[1]), longitude = Number(coordinateMatch[2]);
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) { fail('Use latitude −90 to 90 and longitude −180 to 180.'); return; }
      addLocation([longitude, latitude]); return;
    }
    const controller = new AbortController(); searchRequest.current = controller; setSearching(true);
    try { const found = await searchPlaces(query, controller.signal); if (!controller.signal.aborted) { setPlaces(found); if (!found.length) fail('No places found. Try a town, address, or latitude, longitude.'); } }
    catch (error) { if (!controller.signal.aborted) fail(errorMessage(error)); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  }
  function changeActivity(next: Activity) {
    if (next === activity) return;
    if (mode === 'snapshot' && result?.source === 'gpx') {
      setActivity(next); setResult({ ...result, activity: next, stats: calculateStats(result.segments, next) }); setDirty(true);
    } else if (mode === 'snapshot') {
      setConfirmation({ title: `Recalculate for ${next === 'cycling' ? 'cycling' : 'hiking'}?`, text: 'This changes the routing profile and may change the route geometry. Save or export the original if you want to keep it.', label: 'Recalculate route', action: () => { invalidate(); setMode('manual'); setActivity(next); } });
    } else { invalidate(); setActivity(next); }
  }
  function editSnapshot() {
    if (!result) return;
    if (!result.segments.some(segment => segment.length >= 2)) {
      fail('This GPX contains only isolated points. They are preserved for saving and export; start a new route to plan between locations.');
      return;
    }
    const source = result.source;
    const action = () => {
      let next = result.waypoints;
      if (source === 'gpx' || next.length < 2) {
        const coordinates = result.segments.flat();
        next = [coordinates[0], coordinates[coordinates.length - 1]].map((coordinate, index) => ({ id: crypto.randomUUID(), name: i18n.t(index ? 'Imported finish' : 'Imported start'), coordinate }));
      }
      invalidate(); setMode('manual'); setWaypoints(next); setPlanningMode('point');
    };
    setConfirmation({ title: source === 'gpx' ? 'Convert GPX to an editable route?' : 'Edit this route?', text: source === 'gpx' ? 'A fresh road/path route will be calculated between the track’s start and finish. This replaces original GPX geometry; export or save the original first. Disconnected tracks may not be routable.' : 'Your saved waypoints will be routed again. Current map data may produce a different route.', label: 'Edit waypoints', action });
  }
  async function generateLoops() {
    if (!waypoints.length) { fail('Choose a starting point on the map or with search first.'); return; }
    invalidate(); const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const found = await routingProvider.calculateAlternatives(waypoints[0], activity, targetKm * 1000, controller.signal);
      if (!controller.signal.aborted) { setAlternatives(found); selectAlternative(found[0], 0); }
    } catch (error) { if (!controller.signal.aborted) fail(errorMessage(error)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function selectAlternative(calculated: RoutingResult, index: number) {
    const coordinates = calculated.segments[0];
    const stops = [0, 0.25, 0.5, 0.75, 1].map((fraction, i) => ({ id: crypto.randomUUID(), name: i === 0 ? waypoints[0]?.name || i18n.t('Loop start') : i === 4 ? i18n.t('Return to start') : i18n.t('Loop stop {{number}}', { number: formatNumber(i) }), coordinate: coordinates[Math.round(fraction * (coordinates.length - 1))] }));
    setResult({ ...routeIdentity.current, name: i18n.t('Untitled adventure'), description: '', activity, waypoints: stops, ...calculated, updatedAt: new Date().toISOString(), source: 'openrouteservice' });
    setSelectedAlternative(index); setDirty(true); setFitToken(token => token + 1);
  }
  const mapWaypoints = useMemo(() => {
    if (result?.source === 'gpx') {
      const points = result.segments.flat();
      if (!points.length) return result.waypoints;
      // Display-only endpoint markers must never alter imported/exported GPX waypoints.
      const endpoints: Waypoint[] = [
        { id: `${result.id}-display-start`, name: 'Track start', coordinate: points[0] },
        { id: `${result.id}-display-finish`, name: 'Track finish', coordinate: points[points.length - 1] },
      ];
      return [endpoints[0], ...result.waypoints, endpoints[1]];
    }
    return result && planningMode === 'loop' ? result.waypoints : waypoints;
  }, [result, planningMode, waypoints]);
  const canUseRoute = Boolean(result) && !busy;

  return <div className="app" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { event.preventDefault(); void handleFile(event.dataTransfer.files[0]); }}>
    <header className="app-header"><a className="brand" href="#" onClick={event => { event.preventDefault(); guard(newRoute); }} aria-label={t("Roamlet home")}><span className="brand-mark"><img src="/icon.svg" alt="" /></span><strong className="brand-wordmark">Roamlet</strong></a><span className="brand-tagline">{t("A little planning. A lot of possibility.")}</span><nav aria-label={t("Main navigation")}><select className="language-selector" aria-label={t("Language")} value={i18n.resolvedLanguage || 'en'} onChange={event => { void i18n.changeLanguage(event.target.value); }}><option value="en">EN</option><option value="ru">Русский</option></select><button className="nav-library" aria-label={t("My routes")} onClick={() => setLibraryOpen(true)}><LibraryIcon size={18} /><span>{t("My routes")}</span></button><button className="icon-button" aria-label={t("Help and data sources")} onClick={() => setHelpOpen(true)}><Info size={20} /></button><button className="header-new" aria-label={t("New route")} onClick={() => guard(newRoute)}><Plus size={18} /><span>{t("New route")}</span></button></nav></header>
    <main className={`workspace ${collapsed ? 'panel-collapsed' : ''}`}>
      <aside className="planner" aria-label={t("Route planner")}>
        <button className="mobile-sheet-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}><span>{result ? formatDistance(result.stats.distance) + ' · ' + (name || t('Your route')) : t("Plan your next adventure")}</span>{collapsed ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</button>
        <div className="planner-scroll">
          <div className="planner-heading"><div><p className="eyebrow">{t("MAKE TIME FOR OUTSIDE")}</p><h1>{name || t('Where shall we go?')}</h1><p className="muted">{t("Find your own way, one stop at a time.")}</p></div>{canUseRoute && <button className="icon-button" aria-label={t("Edit route name")} onClick={() => setSaveOpen(true)}><Pencil size={16} /></button>}</div>
          <div className="activity-selector" role="group" aria-label={t("Activity profile")}><button className={activity === 'cycling' ? 'selected' : ''} aria-pressed={activity === 'cycling'} onClick={() => changeActivity('cycling')}><Bike size={19} />{t("Cycling")}</button><button className={activity === 'hiking' ? 'selected' : ''} aria-pressed={activity === 'hiking'} onClick={() => changeActivity('hiking')}><Footprints size={19} />{t("Hiking")}</button></div>
          {mode === 'manual' ? <>
            <div className="planning-tabs" role="group" aria-label={t("Route style")}><button className={planningMode === 'point' ? 'active' : ''} aria-pressed={planningMode === 'point'} onClick={() => { if (planningMode !== 'point') { invalidate(); setPlanningMode('point'); } }}>{t("Point to point")}</button><button className={planningMode === 'loop' ? 'active' : ''} aria-pressed={planningMode === 'loop'} onClick={() => { if (planningMode !== 'loop') { invalidate(); setPlanningMode('loop'); setWaypoints(waypoints.slice(0, 1)); } }}><ArrowDownUp size={14} />{t("Round trip")}</button></div>
            <form className="place-search" onSubmit={event => void search(event)}><Search size={18} /><input ref={searchInput} aria-label={t("Search places or coordinates")} value={query} onChange={event => { setQuery(event.target.value); setPlaces([]); }} placeholder={searchTarget ? t("Find a replacement stop…") : t("Search places or coordinates…")} maxLength={200} /><button aria-label={t("Search")} disabled={searching || !query.trim()}>{searching ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={18} className="search-arrow" />}</button></form>
            <p className="search-help">{t("Search a place, enter latitude, longitude, or click the map.")}</p>
            {searchTarget && <button className="text-button" onClick={() => setSearchTarget(null)}>{t("Cancel replacing stop")}</button>}
            {places.length > 0 && <ul className="search-results">{places.map((place, index) => <li key={index}><button onClick={() => addLocation(place.coordinate, place.name)}>{place.name}<Plus size={16} /></button></li>)}</ul>}
            <div className="waypoints-heading"><h2>{planningMode === 'loop' ? t("Starting point") : t("Your stops")}</h2>{planningMode === 'point' && <button className="text-button" disabled={waypoints.length < 2} onClick={() => changeWaypoints([...waypoints].reverse())}><ArrowDownUp size={14} />{t("Reverse")}</button>}</div>
            {!waypoints.length ? <div className="stops-empty"><span className="stop-badge">A</span><div><strong>{t("A good route starts somewhere")}</strong><p>{t("Choose your first stop on the map or search above.")}</p></div></div> : <ol className="waypoint-list">{waypoints.map((point, index) => <li key={point.id}><span className={`stop-badge ${index === waypoints.length - 1 && index > 0 ? 'end' : ''}`}>{index === 0 ? 'A' : index === waypoints.length - 1 ? 'B' : index}</span><button className="stop-name" onClick={() => { setSearchTarget(point.id); searchInput.current?.focus(); }}>{point.name}<small>{index === 0 ? t("Start") : index === waypoints.length - 1 ? t("Finish") : t("Via")} {t("· click to replace")}</small></button><div className="stop-controls">{planningMode === 'point' && <><button className="icon-button" aria-label={t("Move stop {{number}} up", { number: formatNumber(index + 1) })} disabled={index === 0} onClick={() => { const next = [...waypoints]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; changeWaypoints(next); }}><ArrowUp size={13} /></button><button className="icon-button" aria-label={t("Move stop {{number}} down", { number: formatNumber(index + 1) })} disabled={index === waypoints.length - 1} onClick={() => { const next = [...waypoints]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; changeWaypoints(next); }}><ArrowDown size={13} /></button></>}<button className="icon-button" aria-label={t("Remove stop {{number}}", { number: formatNumber(index + 1) })} onClick={() => changeWaypoints(waypoints.filter(w => w.id !== point.id))}><X size={15} /></button></div></li>)}</ol>}
            {planningMode === 'point' && <button className="add-stop" onClick={() => { setSearchTarget(null); searchInput.current?.focus(); }}><Plus size={16} />{t("Add a stop")}<span>{t("or click the map")}</span></button>}
            {planningMode === 'loop' && <div className="loop-planner"><label htmlFor="distance">{t("Target distance")} <strong>{formatNumber(targetKm)} {t("km")}</strong></label><input id="distance" aria-label={t("Target loop distance")} type="range" min={2} max={100} value={formatNumber(targetKm)} onChange={event => { invalidate(); setTargetKm(Number(event.target.value)); }} /><p className="fine-print">{t("Two calculated possibilities. Actual distances vary with the path network.")}</p><button className="primary full-width" disabled={busy || !waypoints.length} onClick={() => void generateLoops()}><Sparkles size={17} />{busy ? t("Finding your way…") : t("Discover round trips")}</button>{alternatives.length > 0 && <div className="alternatives">{alternatives.map((alternative, index) => <button className={selectedAlternative === index ? 'chosen' : ''} key={index} onClick={() => selectAlternative(alternative, index)}><span>{t("Option")} {formatNumber(index + 1)}<strong>{formatDistance(alternative.stats.distance)}</strong></span><span>{formatDuration(alternative.stats.duration)}{selectedAlternative === index && <Check size={16} />}</span></button>)}</div>}</div>}
          </> : <div className="snapshot-notice"><Check size={18} /><div><strong>{result?.source === 'gpx' ? t("Original GPX geometry") : t("Saved route, ready to explore")}</strong><p>{t("Save and export without changing any points.")}</p><button className="text-button" onClick={editSnapshot}><Pencil size={14} />{t("Edit waypoints")}</button></div></div>}
          {busy && <p className="routing-status" role="status"><LoaderCircle size={16} className="spin" />{t("Calculating a real")} {activity === 'cycling' ? t("cycling") : t("hiking")} {t("route…")}</p>}
          {notice && <div className={`notice ${notice.error ? 'error' : 'success'}`} role={notice.error ? 'alert' : 'status'}><span>{translateMessage(notice.text)}</span><button aria-label={t("Dismiss notification")} onClick={() => setNotice(null)}><X size={16} /></button></div>}
          {(routingConfigured === false || configurationUnavailable) && !notice?.error && <div className="configuration-note"><Info size={16} /><span>{configurationUnavailable ? t("The routing proxy is unreachable. Map, GPX, and saved routes still work.") : t("Online routing is not configured on the server. Map, GPX, and saved routes still work.")}</span><button className="text-button" onClick={() => setHelpOpen(true)}>{t("Setup")}</button></div>}
          <Statistics route={result} />
          {!waypoints.length && !result && <div className="outdoor-note"><span>{t("LESS SCROLLING. MORE STROLLING.")}</span><p>{t("Start small. Take the scenic way.")}<br/>{t("Make a route that feels like you.")}</p></div>}
        </div>
        <footer className="planner-footer"><div className="route-actions"><button className="primary" disabled={!canUseRoute} onClick={() => { if (!name) setName(i18n.t('Untitled adventure')); setSaveOpen(true); }}><Bookmark size={17} />{t("Save route")}</button><button className="secondary" disabled={!canUseRoute} onClick={download}><Download size={17} />{t("Export GPX")}</button></div><button className="import-action" onClick={() => fileInput.current?.click()}><Upload size={15} />{t("Import GPX")}<span>{t("or drop a file anywhere")}</span></button></footer>
      </aside>
      <RouteMap segments={result?.segments || emptySegments} waypoints={mapWaypoints} editable={mode === 'manual' && !busy && (planningMode === 'point' || !result)} fitToken={fitToken} onAdd={coordinate => addLocation(coordinate)} onMove={(id, coordinate) => changeWaypoints(waypoints.map(w => w.id === id ? { ...w, coordinate, name: `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}` } : w))} onError={fail} />
    </main>
    <input ref={fileInput} hidden type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" aria-label={t("Import GPX file")} onChange={event => { void handleFile(event.target.files?.[0]); event.target.value = ''; }} />
    {libraryOpen && <Library onClose={() => setLibraryOpen(false)} onOpen={route => { setLibraryOpen(false); guard(() => openRoute(route)); }} />}
    {saveOpen && <Dialog title={t("Save your adventure")} onClose={() => { if (!saving) setSaveOpen(false); }}><p className="muted">{t("Keep it on this device. Give it a name you’ll remember.")}</p><form onSubmit={event => { event.preventDefault(); void doSave(); }}><label>{t("Route name")}<input autoFocus required maxLength={120} value={name} placeholder={t("Sunday’s scenic escape")} onChange={event => { setName(event.target.value); setDirty(true); }} /></label><label>{t("Description")} <span className="muted">{t("(optional)")}</span><textarea maxLength={2000} value={description} placeholder={t("A note for your future self…")} onChange={event => { setDescription(event.target.value); setDirty(true); }} /></label>{notice?.error && <p role="alert" className="error-inline">{translateMessage(notice.text)}</p>}<div className="button-row"><button className="secondary" type="button" disabled={saving} onClick={() => setSaveOpen(false)}>{t("Cancel")}</button><button className="primary" disabled={saving || !name.trim()}>{saving ? t("Saving…") : t("Save to library")}</button></div></form></Dialog>}
    {confirmation && <Dialog title={t(confirmation.title)} onClose={() => setConfirmation(null)}><p>{t(confirmation.text)}</p><div className="button-row"><button className="secondary" onClick={() => setConfirmation(null)}>{t("Cancel")}</button><button className="primary" onClick={() => { const action = confirmation.action; setConfirmation(null); action(); }}>{t(confirmation.label)}</button></div></Dialog>}
    {helpOpen && <Dialog title={t("A few helpful things")} onClose={() => setHelpOpen(false)}><div className="help-content"><h3>{t("Connect routing & search")}</h3><p>{t("For deployment administrators: create a key at")} <a href="https://account.heigit.org/signup" target="_blank" rel="noreferrer">HeiGIT / OpenRouteService</a>{t(". Set")} <code>ORS_API_KEY</code> {t("in the proxy’s server environment and restart the proxy. The browser never receives this key; it submits routing requests through the same-origin API.")}</p><h3>{t("Your route, your device")}</h3><p>{t("Routes stay in your browser’s IndexedDB. No account or backend is needed. Export GPX backups before clearing browser data.")}</p><h3>{t("Take it with you")}</h3><p>{t("Export a GPX, then use the file-import feature supported by your GPS device or app. Check the official Strava or Komoot help for GPX import availability. There is no direct publishing integration.")}</p><h3>{t("Real data, honest limits")}</h3><p>{t("Cycling uses ORS general cycling, not a dedicated gravel profile. Hiking uses foot-hiking. Access and surface quality depend on mapped data; always check conditions. Time and terrain elevations are estimates. Loops use ORS round-trip requests and may differ from the target distance.")}</p><h3>{t("Data & attribution")}</h3><p>{t("Map data ©")} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{t("OpenStreetMap contributors")}</a> {t("(ODbL). Default OSM tiles are for low-traffic development; use a suitable hosted provider for production. No map tiles are downloaded for offline use. Routing & place search ©")} <a href="https://openrouteservice.org" target="_blank" rel="noreferrer">OpenRouteService / HeiGIT</a>{t(", with OSM data.")}</p><p className="fine-print">{t("The proxy forwards the places you search and route points you submit to the routing provider. Your saved local library is not uploaded. Private provider credentials stay on the server. The saved library and GPX work offline after the app shell has been cached in a production build.")}</p></div></Dialog>}
  </div>;
}
