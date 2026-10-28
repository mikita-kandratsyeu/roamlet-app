import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { Label } from './components/ui/label';
import { Slider } from './components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import { Badge } from './components/ui/badge';
import { Alert } from './components/ui/alert';
import { Card } from './components/ui/card';
import { waypointKind } from './components/waypointStyle';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapPinPlus,
  Search,
  Plus,
  ArrowDownUp,
  ArrowUp,
  ArrowDown,
  X,
  Download,
  FileUp,
  Trash2,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Check,
  Pencil,
  LoaderCircle,
  Info,
  PanelLeftOpen,
  PanelLeftClose,
  Route as RouteIcon,
  GripVertical,
  Library as LibraryIcon,
} from 'lucide-react';
import type { Activity, Coordinate, PlannedRoute, RoutingResult, Waypoint } from './domain/types';
import { importGpx, exportGpx, gpxFilename } from './domain/gpx';
import { calculateStats } from './domain/stats';
import { saveRoute } from './domain/storage';
import {
  checkRoutingConfiguration,
  routingProvider,
  searchPlaces,
  type Place,
} from './services/routing';
import { RouteMap } from './components/RouteMap';
import { Statistics, formatDistance, formatDuration } from './components/Statistics';
import { Dialog } from './components/Dialog';
import { Library } from './components/Library';
import { HeaderMenu } from './components/HeaderMenu';
import i18n, { formatNumber, translateMessage } from './i18n';

const emptySegments: Coordinate[][] = [];
const identity = (): { id: string; createdAt: string } => ({
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
});
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
interface Confirmation {
  title: string;
  text: string;
  label: string;
  action: () => void;
}

export default function App() {
  const { t } = useTranslation();
  const [panelHidden, setPanelHidden] = useState(false);
  const hidePlannerButton = useRef<HTMLButtonElement>(null);
  const showPlannerButton = useRef<HTMLButtonElement>(null);
  const plannerFocusRequested = useRef(false);
  useEffect(() => {
    if (!plannerFocusRequested.current) return;
    plannerFocusRequested.current = false;
    (panelHidden ? showPlannerButton : hidePlannerButton).current?.focus({ preventScroll: true });
  }, [panelHidden]);
  const [activity, setActivity] = useState<Activity>('cycling');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [result, setResult] = useState<PlannedRoute | null>(null);
  const [mode, setMode] = useState<'manual' | 'snapshot'>('manual');
  const [planningMode, setPlanningMode] = useState<'point' | 'loop'>('point');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [routeRevision, setRouteRevision] = useState(0);
  const [draggedStop, setDraggedStop] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const stopDrag = useRef<{
    id: string;
    pointerId?: number;
    startY: number;
    target: string | null;
    active: boolean;
  } | null>(null);
  useEffect(() => {
    if (!draggedStop) return;
    const cancel = () => {
      stopDrag.current = null;
      setDraggedStop(null);
      setDropTarget(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', cancel);
    };
  }, [draggedStop]);
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
  const routeNameInput = useRef<HTMLInputElement>(null);
  const confirmationCancel = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const fail = (text: string) => setNotice({ text, error: true });

  useEffect(() => {
    if (mode !== 'manual' || planningMode !== 'point' || waypoints.length < 2) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setNotice(null);
    setResult(null);
    const timer = setTimeout(() => {
      routingProvider
        .calculateRoute(waypoints, activity, controller.signal)
        .then((calculated) => {
          if (controller.signal.aborted) return;
          setResult({
            ...routeIdentity.current,
            name: i18n.t('Untitled adventure'),
            description: '',
            activity,
            waypoints,
            ...calculated,
            updatedAt: new Date().toISOString(),
            source: 'mapbox',
          });
        })
        .catch((error) => {
          if (!controller.signal.aborted) setNotice({ text: errorMessage(error), error: true });
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activity, waypoints, mode, planningMode, routeRevision]);
  useEffect(() => {
    const controller = new AbortController();
    checkRoutingConfiguration(controller.signal)
      .then((configured) => {
        if (!controller.signal.aborted) setRoutingConfigured(configured);
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfigurationUnavailable(true);
      });
    return () => controller.abort();
  }, []);
  useEffect(
    () => () => {
      request.current?.abort();
      searchRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function invalidate() {
    request.current?.abort();
    setBusy(false);
    setResult(null);
    setAlternatives([]);
    setSelectedAlternative(-1);
    setNotice(null);
    setDirty(true);
  }
  function changeWaypoints(next: Waypoint[]) {
    invalidate();
    setWaypoints(next);
  }
  function addLocation(coordinate: Coordinate, label?: string) {
    if (mode !== 'manual') return;
    const point: Waypoint = {
      id: crypto.randomUUID(),
      name: label || `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`,
      coordinate,
    };
    if (searchTarget)
      changeWaypoints(waypoints.map((w) => (w.id === searchTarget ? { ...point, id: w.id } : w)));
    else if (planningMode === 'loop') changeWaypoints([point]);
    else if (waypoints.length < 25) changeWaypoints([...waypoints, point]);
    else {
      fail('A route supports up to 25 stops. Remove a stop before adding another.');
      return;
    }
    searchRequest.current?.abort();
    setSearching(false);
    setPlaces([]);
    setQuery('');
    setSearchTarget(null);
  }
  function reorderStop(fromId: string, toId: string) {
    const from = waypoints.findIndex((point) => point.id === fromId);
    const to = waypoints.findIndex((point) => point.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...waypoints];
    next.splice(to, 0, next.splice(from, 1)[0]);
    changeWaypoints(next);
  }
  function finishStopDrag(commit = false) {
    const drag = stopDrag.current;
    stopDrag.current = null;
    setDraggedStop(null);
    setDropTarget(null);
    if (commit && drag?.active && drag.target) reorderStop(drag.id, drag.target);
  }
  function guard(action: () => void) {
    if (dirty)
      setConfirmation({
        title: 'Leave this route?',
        text: 'Your unsaved changes will be lost. Save the route first if you want to keep it.',
        label: 'Discard changes',
        action,
      });
    else action();
  }
  function newRoute() {
    invalidate();
    setPanelHidden(false);
    setCollapsed(false);
    routeIdentity.current = identity();
    setWaypoints([]);
    setName('');
    setDescription('');
    setMode('manual');
    setPlanningMode('point');
    setDirty(false);
    setQuery('');
    setPlaces([]);
    setSearchTarget(null);
  }
  function openRoute(route: PlannedRoute) {
    invalidate();
    routeIdentity.current = { id: route.id, createdAt: route.createdAt };
    setResult(route);
    setWaypoints(route.waypoints);
    setName(route.name);
    setDescription(route.description);
    setActivity(route.activity);
    setMode('snapshot');
    setPlanningMode('point');
    setDirty(false);
    setLibraryOpen(false);
    setCollapsed(false);
    setPanelHidden(false);
    setFitToken((token) => token + 1);
    setSearchTarget(null);
    setPlaces([]);
    setQuery('');
  }
  function currentRoute(): PlannedRoute | null {
    return result
      ? {
          ...result,
          name: name.trim() || i18n.t('Untitled adventure'),
          description: description.trim(),
          activity,
          updatedAt: new Date().toISOString(),
        }
      : null;
  }
  async function doSave() {
    const route = currentRoute();
    if (!route || !name.trim()) return;
    setSaving(true);
    try {
      await saveRoute(route);
      setDirty(false);
      setSaveOpen(false);
      setNotice({
        text: 'Route saved on this device. Your next adventure is ready.',
        error: false,
      });
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  function download() {
    const route = currentRoute();
    if (!route || busy) return;
    try {
      const blob = new Blob([exportGpx(route)], { type: 'application/gpx+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = gpxFilename(route.name);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({
        text: 'GPX exported. Import it through your GPS device or compatible app’s GPX upload workflow.',
        error: false,
      });
    } catch (error) {
      fail(errorMessage(error));
    }
  }
  async function handleFile(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      fail('Choose a GPX file smaller than 10 MiB.');
      return;
    }
    try {
      const route = importGpx(await file.text());
      guard(() => {
        openRoute(route);
        setDirty(true);
        setNotice({
          text: 'GPX imported. Original points and track segments are preserved. Save it to keep it on this device.',
          error: false,
        });
      });
    } catch (error) {
      fail(errorMessage(error));
    }
  }
  async function search(event: React.FormEvent) {
    event.preventDefault();
    searchRequest.current?.abort();
    setSearching(false);
    setNotice(null);
    setPlaces([]);
    const coordinateMatch = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordinateMatch) {
      const latitude = Number(coordinateMatch[1]),
        longitude = Number(coordinateMatch[2]);
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        fail('Use latitude −90 to 90 and longitude −180 to 180.');
        return;
      }
      addLocation([longitude, latitude]);
      return;
    }
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    try {
      const found = await searchPlaces(query, controller.signal);
      if (!controller.signal.aborted) {
        setPlaces(found);
        if (!found.length) fail('No places found. Try a town, address, or latitude, longitude.');
      }
    } catch (error) {
      if (!controller.signal.aborted) fail(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }
  function changeActivity(next: Activity) {
    if (next === activity) return;
    if (mode === 'snapshot' && result?.source === 'gpx') {
      setActivity(next);
      setResult({ ...result, activity: next, stats: calculateStats(result.segments, next) });
      setDirty(true);
    } else if (mode === 'snapshot') {
      setConfirmation({
        title: `Recalculate for ${next === 'cycling' ? 'cycling' : 'hiking'}?`,
        text: 'This changes the routing profile and may change the route geometry. Save or export the original if you want to keep it.',
        label: 'Recalculate route',
        action: () => {
          invalidate();
          setMode('manual');
          setActivity(next);
        },
      });
    } else {
      invalidate();
      setActivity(next);
    }
  }
  function editSnapshot() {
    if (!result) return;
    if (!result.segments.some((segment) => segment.length >= 2)) {
      fail(
        'This GPX contains only isolated points. They are preserved for saving and export; start a new route to plan between locations.',
      );
      return;
    }
    const source = result.source;
    const action = () => {
      let next = result.waypoints;
      if (source === 'gpx' || next.length < 2) {
        const coordinates = result.segments.flat();
        next = [coordinates[0], coordinates[coordinates.length - 1]].map((coordinate, index) => ({
          id: crypto.randomUUID(),
          name: i18n.t(index ? 'Imported finish' : 'Imported start'),
          coordinate,
        }));
      }
      invalidate();
      setMode('manual');
      setWaypoints(next);
      setPlanningMode('point');
    };
    setConfirmation({
      title: source === 'gpx' ? 'Convert GPX to an editable route?' : 'Edit this route?',
      text:
        source === 'gpx'
          ? 'A fresh road/path route will be calculated between the track’s start and finish. This replaces original GPX geometry; export or save the original first. Disconnected tracks may not be routable.'
          : 'Your saved waypoints will be routed again. Current map data may produce a different route.',
      label: 'Edit waypoints',
      action,
    });
  }
  async function generateLoops() {
    if (!waypoints.length) {
      fail('Choose a starting point on the map or with search first.');
      return;
    }
    invalidate();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const found = await routingProvider.calculateAlternatives(
        waypoints[0],
        activity,
        targetKm * 1000,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setAlternatives(found);
        selectAlternative(found[0], 0);
      }
    } catch (error) {
      if (!controller.signal.aborted) fail(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function selectAlternative(calculated: RoutingResult, index: number) {
    const coordinates = calculated.segments[0];
    const stops = [0, 0.25, 0.5, 0.75, 1].map((fraction, i) => ({
      id: crypto.randomUUID(),
      name:
        i === 0
          ? waypoints[0]?.name || i18n.t('Loop start')
          : i === 4
            ? i18n.t('Return to start')
            : i18n.t('Loop stop {{number}}', { number: formatNumber(i) }),
      coordinate: coordinates[Math.round(fraction * (coordinates.length - 1))],
    }));
    setResult({
      ...routeIdentity.current,
      name: i18n.t('Untitled adventure'),
      description: '',
      activity,
      waypoints: stops,
      ...calculated,
      updatedAt: new Date().toISOString(),
      source: 'mapbox',
    });
    setSelectedAlternative(index);
    setDirty(true);
  }
  const mapWaypoints = useMemo(() => {
    if (result?.source === 'gpx') {
      const points = result.segments.flat();
      if (!points.length) return result.waypoints;
      // Display-only endpoint markers must never alter imported/exported GPX waypoints.
      const endpoints: Waypoint[] = [
        { id: `${result.id}-display-start`, name: 'Track start', coordinate: points[0] },
        {
          id: `${result.id}-display-finish`,
          name: 'Track finish',
          coordinate: points[points.length - 1],
        },
      ];
      return [endpoints[0], ...result.waypoints, endpoints[1]];
    }
    return result && planningMode === 'loop' ? result.waypoints : waypoints;
  }, [result, planningMode, waypoints]);
  const canUseRoute = Boolean(result) && !busy;

  return (
    <div
      className="app"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        void handleFile(event.dataTransfer.files[0]);
      }}
    >
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            guard(newRoute);
          }}
          aria-label={t('Roamlet home')}
        >
          <span className="brand-mark">
            <img src="/icon.svg" alt="" />
          </span>
          <strong className="brand-wordmark">Roamlet</strong>
        </a>
        <nav aria-label={t('Main navigation')}>
          <Button
            variant="ghost"
            className="header-library"
            onClick={() => setLibraryOpen(true)}
            aria-label={t('My routes')}
          >
            <LibraryIcon size={18} aria-hidden="true" />
            <span>{t('My routes')}</span>
          </Button>
          <HeaderMenu
            onNewRoute={() => guard(newRoute)}
            onLibrary={() => setLibraryOpen(true)}
            onHelp={() => setHelpOpen(true)}
          />
        </nav>
      </header>
      <main
        className={`workspace ${collapsed ? 'panel-collapsed' : ''} ${panelHidden ? 'desktop-panel-hidden' : ''}`}
      >
        {panelHidden && (
          <Button
            ref={showPlannerButton}
            variant="outline"
            className="planner-reopen"
            aria-label={t('Show planner')}
            aria-controls="route-planner"
            onClick={() => {
              plannerFocusRequested.current = true;
              setPanelHidden(false);
            }}
          >
            <PanelLeftOpen size={18} />
            {t('Route planner')}
          </Button>
        )}
        <aside id="route-planner" className="planner" aria-label={t('Route planner')}>
          <Button
            variant="ghost"
            className="mobile-sheet-toggle"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
          >
            <span className="sheet-identity">
              <strong>{name || t('New route')}</strong>
              <small>
                {result
                  ? formatDistance(result.stats.distance) +
                    ' · ' +
                    formatDuration(result.stats.duration)
                  : t('Start with two points on the map')}
              </small>
            </span>
            {collapsed ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </Button>
          <div className="planner-scroll">
            <div className="planner-heading">
              <div>
                <h1>{name || t('New route')}</h1>
                <div className="planner-kicker">
                  <p className="muted">
                    {dirty ? t('Unsaved changes') : t('Start with two points on the map')}
                  </p>
                </div>
              </div>
              <div className="planner-heading-actions">
                {canUseRoute && (
                  <Button
                    variant="ghost"
                    className="icon-button"
                    aria-label={t('Edit route name')}
                    title={t('Edit route name')}
                    onClick={() => setSaveOpen(true)}
                  >
                    <Pencil size={16} />
                  </Button>
                )}
                <Button
                  ref={hidePlannerButton}
                  variant="ghost"
                  className="icon-button desktop-planner-toggle"
                  aria-label={t('Hide planner')}
                  title={t('Hide planner')}
                  aria-controls="route-planner"
                  onClick={() => {
                    plannerFocusRequested.current = true;
                    setPanelHidden(true);
                  }}
                >
                  <PanelLeftClose size={17} />
                </Button>
              </div>
            </div>
            <ToggleGroup
              type="single"
              value={activity}
              onValueChange={(value) => {
                if (value === 'cycling' || value === 'hiking') changeActivity(value);
              }}
              className="activity-selector"
              aria-label={t('Activity profile')}
            >
              <ToggleGroupItem value="cycling" className={activity === 'cycling' ? 'selected' : ''}>
                {t('Cycling')}
              </ToggleGroupItem>
              <ToggleGroupItem value="hiking" className={activity === 'hiking' ? 'selected' : ''}>
                {t('Hiking')}
              </ToggleGroupItem>
            </ToggleGroup>
            {mode === 'manual' ? (
              <>
                <ToggleGroup
                  type="single"
                  value={planningMode}
                  className="planning-tabs"
                  aria-label={t('Route style')}
                  onValueChange={(value) => {
                    if ((value === 'point' || value === 'loop') && value !== planningMode) {
                      const changeMode = () => {
                        invalidate();
                        setPlanningMode(value);
                        if (value === 'loop') setWaypoints(waypoints.slice(0, 1));
                      };
                      if (value === 'loop' && waypoints.length > 1)
                        setConfirmation({
                          title: 'Switch to a round trip?',
                          text: 'Only your starting point will be kept. Save or export the current route first to keep it.',
                          label: 'Switch to round trip',
                          action: changeMode,
                        });
                      else changeMode();
                    }
                  }}
                >
                  <ToggleGroupItem
                    value="point"
                    className={planningMode === 'point' ? 'active' : ''}
                  >
                    {t('Point to point')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="loop" className={planningMode === 'loop' ? 'active' : ''}>
                    {t('Round trip')}
                  </ToggleGroupItem>
                </ToggleGroup>
                <Label className="search-label" htmlFor="place-search-input">
                  {t('Find a place or enter coordinates')}
                </Label>
                <form className="place-search" onSubmit={(event) => void search(event)}>
                  <Search size={16} aria-hidden="true" />
                  <Input
                    ref={searchInput}
                    id="place-search-input"
                    aria-label={t('Search places or coordinates')}
                    value={query}
                    onChange={(event) => {
                      searchRequest.current?.abort();
                      setSearching(false);
                      setQuery(event.target.value);
                      setPlaces([]);
                    }}
                    placeholder={
                      searchTarget
                        ? t('Find a replacement stop…')
                        : t('Search places or coordinates…')
                    }
                    maxLength={200}
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    aria-label={t('Search')}
                    disabled={searching || !query.trim()}
                  >
                    {searching ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <>
                        <span className="search-submit-label">{t('Find')}</span>
                        <Search className="search-submit-icon" size={18} />
                      </>
                    )}
                  </Button>
                </form>
                <p className="search-help">
                  <span>{t('Search with the button or Enter · latitude, longitude')}</span>
                </p>
                {searchTarget && (
                  <Button
                    variant="ghost"
                    className="text-button"
                    onClick={() => setSearchTarget(null)}
                  >
                    {t('Cancel replacing stop')}
                  </Button>
                )}
                {places.length > 0 && (
                  <ul className="search-results" aria-label={t('Search results')}>
                    {places.map((place, index) => (
                      <li key={index}>
                        <Button
                          variant="ghost"
                          onClick={() => addLocation(place.coordinate, place.name)}
                        >
                          {place.name}
                          <Plus size={16} />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {!waypoints.length ? (
                  <Card className="stops-empty">
                    <MapPinPlus size={26} aria-hidden="true" />
                    <div>
                      <strong>{t('Where shall we go?')}</strong>
                      <p>{t('Click the map or search for a place to add a start and finish.')}</p>
                    </div>
                  </Card>
                ) : (
                  <ol className="waypoint-list">
                    {waypoints.map((point, index) => (
                      <li
                        key={point.id}
                        data-stop-id={point.id}
                        className={`${draggedStop === point.id ? 'dragging' : ''} ${dropTarget === point.id ? 'drop-target' : ''}`}
                        onDragOver={(event) => {
                          if (!stopDrag.current || planningMode !== 'point') return;
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = 'move';
                          stopDrag.current.target = point.id;
                          setDropTarget(point.id);
                        }}
                        onDrop={(event) => {
                          if (!stopDrag.current) return;
                          event.preventDefault();
                          event.stopPropagation();
                          stopDrag.current.target = point.id;
                          finishStopDrag(true);
                        }}
                      >
                        <Card className="waypoint-card">
                          {planningMode === 'point' && (
                            <span
                              className="stop-grip"
                              draggable
                              aria-hidden="true"
                              title={t('Drag to reorder stops')}
                              onPointerDown={(event) => {
                                if (event.button !== 0) return;
                                event.preventDefault();
                                event.currentTarget.setPointerCapture(event.pointerId);
                                stopDrag.current = {
                                  id: point.id,
                                  pointerId: event.pointerId,
                                  startY: event.clientY,
                                  target: null,
                                  active: false,
                                };
                              }}
                              onPointerMove={(event) => {
                                const drag = stopDrag.current;
                                if (!drag || drag.pointerId !== event.pointerId) return;
                                if (!drag.active && Math.abs(event.clientY - drag.startY) < 4)
                                  return;
                                drag.active = true;
                                setDraggedStop(drag.id);
                                const scroll =
                                  event.currentTarget.closest<HTMLElement>('.planner-scroll');
                                if (scroll) {
                                  const bounds = scroll.getBoundingClientRect();
                                  if (event.clientY < bounds.top + 32) scroll.scrollTop -= 16;
                                  else if (event.clientY > bounds.bottom - 32)
                                    scroll.scrollTop += 16;
                                }
                                const target = document
                                  .elementFromPoint(event.clientX, event.clientY)
                                  ?.closest<HTMLElement>('[data-stop-id]');
                                drag.target = target?.dataset.stopId ?? null;
                                setDropTarget(drag.target !== drag.id ? drag.target : null);
                              }}
                              onPointerUp={() => finishStopDrag(true)}
                              onPointerCancel={() => finishStopDrag()}
                              onLostPointerCapture={() => finishStopDrag()}
                              onDragStart={(event) => {
                                event.stopPropagation();
                                event.dataTransfer.setData('text/plain', point.id);
                                event.dataTransfer.effectAllowed = 'move';
                                stopDrag.current = {
                                  id: point.id,
                                  startY: 0,
                                  target: null,
                                  active: true,
                                };
                                setDraggedStop(point.id);
                              }}
                              onDragEnd={() => finishStopDrag()}
                            >
                              <GripVertical size={14} />
                            </span>
                          )}
                          <Badge
                            className={`stop-badge ${waypointKind(index, waypoints.length)}`}
                            aria-hidden="true"
                          >
                            {formatNumber(index + 1)}
                          </Badge>
                          <Button
                            variant="ghost"
                            className="stop-name"
                            onClick={() => {
                              setSearchTarget(point.id);
                              searchInput.current?.focus();
                            }}
                          >
                            <small>
                              {index === 0
                                ? t('Start')
                                : index === waypoints.length - 1
                                  ? t('Finish')
                                  : t('Via')}
                            </small>
                            {point.name}
                          </Button>
                          <div className="stop-controls">
                            {planningMode === 'point' && (
                              <>
                                <Button
                                  variant="ghost"
                                  className="icon-button"
                                  aria-label={t('Move stop {{number}} up', {
                                    number: formatNumber(index + 1),
                                  })}
                                  disabled={index === 0}
                                  onClick={() => {
                                    const next = [...waypoints];
                                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                    changeWaypoints(next);
                                  }}
                                >
                                  <ArrowUp size={13} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  className="icon-button"
                                  aria-label={t('Move stop {{number}} down', {
                                    number: formatNumber(index + 1),
                                  })}
                                  disabled={index === waypoints.length - 1}
                                  onClick={() => {
                                    const next = [...waypoints];
                                    [next[index + 1], next[index]] = [next[index], next[index + 1]];
                                    changeWaypoints(next);
                                  }}
                                >
                                  <ArrowDown size={13} />
                                </Button>
                              </>
                            )}
                            <Button
                              variant="ghost"
                              className="icon-button"
                              aria-label={t('Remove stop {{number}}', {
                                number: formatNumber(index + 1),
                              })}
                              onClick={() =>
                                changeWaypoints(waypoints.filter((w) => w.id !== point.id))
                              }
                            >
                              <X size={15} />
                            </Button>
                          </div>
                        </Card>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="waypoint-tools">
                  {planningMode === 'point' && waypoints.length < 25 && (
                    <Button
                      variant={waypoints.length ? 'ghost' : 'outline'}
                      className={`add-stop ${!waypoints.length ? 'add-stop-empty' : ''}`}
                      onClick={() => {
                        setSearchTarget(null);
                        searchInput.current?.focus();
                      }}
                    >
                      <Plus size={18} />
                      {t('Add a stop')}
                    </Button>
                  )}
                  {planningMode === 'point' && waypoints.length > 1 && (
                    <Button
                      variant="ghost"
                      className="reverse-stops"
                      aria-label={t('Reverse')}
                      onClick={() => changeWaypoints([...waypoints].reverse())}
                    >
                      <ArrowDownUp size={18} />
                      <span>{t('Reverse')}</span>
                    </Button>
                  )}
                  {!!waypoints.length && (
                    <Button
                      variant="ghost"
                      className="icon-button clear-stops"
                      aria-label={t('Clear stops')}
                      title={t('Clear stops')}
                      onClick={() =>
                        setConfirmation({
                          title: 'Clear all stops?',
                          text: 'This removes all stops and the calculated route. Saved routes are not affected.',
                          label: 'Clear stops',
                          action: () => changeWaypoints([]),
                        })
                      }
                    >
                      <Trash2 size={18} />
                    </Button>
                  )}
                </div>
                {planningMode === 'point' && (
                  <div className="calculate-action">
                    <Button
                      className="primary full-width"
                      disabled={busy || waypoints.length < 2}
                      onClick={() => setRouteRevision((revision) => revision + 1)}
                    >
                      {busy ? <LoaderCircle size={17} className="spin" /> : <RouteIcon size={17} />}
                      {busy
                        ? t('Calculating route…')
                        : result
                          ? t('Update route')
                          : t('Calculate route')}
                    </Button>
                    <p className="fine-print">
                      {t('Routes update automatically as you edit stops.')}
                    </p>
                  </div>
                )}
                {planningMode === 'loop' && (
                  <div className="loop-planner">
                    <Label htmlFor="distance">
                      {t('Target distance')}{' '}
                      <strong>
                        {formatNumber(targetKm)} {t('km')}
                      </strong>
                    </Label>
                    <Slider
                      id="distance"
                      aria-label={t('Target loop distance')}
                      min={2}
                      max={100}
                      step={1}
                      value={[targetKm]}
                      onValueChange={([distance]) => {
                        invalidate();
                        setTargetKm(distance);
                      }}
                      className="distance-slider"
                    />
                    <p className="fine-print">
                      {t(
                        'Two calculated possibilities. Actual distances vary with the path network.',
                      )}
                    </p>
                    <Button
                      className="primary full-width"
                      disabled={busy || !waypoints.length}
                      onClick={() => void generateLoops()}
                    >
                      <Sparkles size={17} />
                      {busy ? t('Finding your way…') : t('Discover round trips')}
                    </Button>
                    {alternatives.length > 0 && (
                      <div className="alternatives">
                        {alternatives.map((alternative, index) => (
                          <Button
                            variant="ghost"
                            className={selectedAlternative === index ? 'chosen' : ''}
                            key={index}
                            onClick={() => selectAlternative(alternative, index)}
                          >
                            <span>
                              {t('Option')} {formatNumber(index + 1)}
                              <strong>{formatDistance(alternative.stats.distance)}</strong>
                            </span>
                            <span>
                              {formatDuration(alternative.stats.duration)}
                              {selectedAlternative === index && <Check size={16} />}
                            </span>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="snapshot-panel">
                <Alert className="snapshot-notice" role="note">
                  <Info size={18} aria-hidden="true" />
                  <div>
                    <strong>{t('Original geometry preserved')}</strong>
                    <p>
                      {t(
                        'Viewing and exporting do not recalculate the route. Switch to editing points separately.',
                      )}
                    </p>
                  </div>
                </Alert>
                <Button
                  variant="outline"
                  className="secondary snapshot-edit"
                  onClick={editSnapshot}
                >
                  <Pencil size={18} aria-hidden="true" />
                  {t('Edit waypoints')}
                </Button>
              </div>
            )}
            {busy && (
              <p className="routing-status" role="status">
                <LoaderCircle size={16} className="spin" />
                {t('Calculating a real')} {activity === 'cycling' ? t('cycling') : t('hiking')}{' '}
                {t('route…')}
              </p>
            )}
            {notice && (
              <Alert
                variant={notice.error ? 'destructive' : 'default'}
                className={`notice ${notice.error ? 'error' : 'success'}`}
                role={notice.error ? 'alert' : 'status'}
              >
                <span>{translateMessage(notice.text)}</span>
                <Button
                  variant="ghost"
                  aria-label={t('Dismiss notification')}
                  onClick={() => setNotice(null)}
                >
                  <X size={16} />
                </Button>
              </Alert>
            )}
            {(routingConfigured === false || configurationUnavailable) && !notice?.error && (
              <div className="configuration-note">
                <Info size={16} />
                <span>
                  {configurationUnavailable
                    ? t(
                        'Mapbox configuration could not be checked. GPX and saved routes still work.',
                      )
                    : t(
                        'Configure a public Mapbox token in VITE_MAPBOX_ACCESS_TOKEN. GPX and saved routes remain available.',
                      )}
                </span>
                <Button variant="ghost" className="text-button" onClick={() => setHelpOpen(true)}>
                  {t('Setup')}
                </Button>
              </div>
            )}
            <Statistics
              route={result}
              emptyHint={
                planningMode === 'loop'
                  ? t('Choose a start and find round trips to see route details.')
                  : undefined
              }
            />
          </div>
          <footer className={`planner-footer ${canUseRoute ? 'route-ready' : ''}`}>
            <div className="route-actions">
              <Button
                className="primary"
                disabled={!canUseRoute}
                onClick={() => {
                  if (!name) setName(i18n.t('Untitled adventure'));
                  setSaveOpen(true);
                }}
              >
                <Bookmark size={17} />
                {t('Save route')}
              </Button>
              <Button
                variant="outline"
                className="secondary"
                disabled={!canUseRoute}
                onClick={download}
              >
                <Download size={17} />
                {t('Export GPX')}
              </Button>
            </div>
            <Button
              variant="ghost"
              className="import-action"
              onClick={() => fileInput.current?.click()}
            >
              <FileUp size={18} />
              {t('Import GPX')}
              <span>{t('or drop a file anywhere')}</span>
            </Button>
          </footer>
        </aside>
        <div id="map-elevation-root" />
        <RouteMap
          plannerHidden={panelHidden}
          onImport={() => fileInput.current?.click()}
          segments={result?.segments || emptySegments}
          waypoints={mapWaypoints}
          editable={mode === 'manual' && !busy && (planningMode === 'point' || !result)}
          fitToken={fitToken}
          onAdd={(coordinate) => addLocation(coordinate)}
          onMove={(id, coordinate) =>
            changeWaypoints(
              waypoints.map((w) =>
                w.id === id
                  ? {
                      ...w,
                      coordinate,
                      name: `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`,
                    }
                  : w,
              ),
            )
          }
          onError={fail}
        />
      </main>
      <Input
        ref={fileInput}
        hidden
        type="file"
        accept=".gpx,application/gpx+xml,application/xml,text/xml"
        aria-label={t('Import GPX file')}
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {libraryOpen && (
        <Library
          onClose={() => setLibraryOpen(false)}
          onOpen={(route) => {
            setLibraryOpen(false);
            guard(() => openRoute(route));
          }}
        />
      )}
      {saveOpen && (
        <Dialog
          title={t('Save your adventure')}
          initialFocusRef={routeNameInput}
          onClose={() => {
            if (!saving) setSaveOpen(false);
          }}
        >
          <p className="muted">{t('Keep it on this device. Give it a name you’ll remember.')}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void doSave();
            }}
          >
            <Label>
              {t('Route name')}
              <Input
                ref={routeNameInput}
                required
                maxLength={120}
                value={name}
                placeholder={t('Sunday’s scenic escape')}
                onChange={(event) => {
                  setName(event.target.value);
                  setDirty(true);
                }}
              />
            </Label>
            <Label>
              {t('Description')} <span className="muted">{t('(optional)')}</span>
              <Textarea
                maxLength={2000}
                value={description}
                placeholder={t('A note for your future self…')}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setDirty(true);
                }}
              />
            </Label>
            {notice?.error && (
              <p role="alert" className="error-inline">
                {translateMessage(notice.text)}
              </p>
            )}
            <div className="button-row">
              <Button
                variant="outline"
                className="secondary"
                type="button"
                disabled={saving}
                onClick={() => setSaveOpen(false)}
              >
                {t('Cancel')}
              </Button>
              <Button type="submit" className="primary" disabled={saving || !name.trim()}>
                {saving ? t('Saving…') : t('Save to library')}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {confirmation && (
        <Dialog
          title={t(confirmation.title)}
          initialFocusRef={confirmationCancel}
          onClose={() => setConfirmation(null)}
        >
          <p>{t(confirmation.text)}</p>
          <div className="button-row">
            <Button
              variant="ghost"
              ref={confirmationCancel}
              className="secondary"
              onClick={() => setConfirmation(null)}
            >
              {t('Cancel')}
            </Button>
            <Button
              className="primary"
              onClick={() => {
                const action = confirmation.action;
                setConfirmation(null);
                action();
              }}
            >
              {t(confirmation.label)}
            </Button>
          </div>
        </Dialog>
      )}
      {helpOpen && (
        <Dialog title={t('A few helpful things')} onClose={() => setHelpOpen(false)}>
          <div className="help-content">
            <h3>{t('Connect routing & search')}</h3>
            <p>
              {t('For deployment administrators: create a key at')}{' '}
              <a href="https://account.mapbox.com/auth/signup/" target="_blank" rel="noreferrer">
                Mapbox
              </a>
              {t('. Set')} <code>VITE_MAPBOX_ACCESS_TOKEN</code>{' '}
              {t(
                'in the client environment and restart Vite or rebuild. Use a public pk. token with minimal scopes and URL restrictions. Maps, routes, search and terrain are requested directly from Mapbox.',
              )}
            </p>
            <h3>{t('Your route, your device')}</h3>
            <p>
              {t(
                'Routes stay in your browser’s IndexedDB. No account or backend is needed. Export GPX backups before clearing browser data.',
              )}
            </p>
            <h3>{t('Take it with you')}</h3>
            <p>
              {t(
                'Export a GPX, then use the file-import feature supported by your GPS device or app. Check the official Strava or Komoot help for GPX import availability. There is no direct publishing integration.',
              )}
            </p>
            <h3>{t('Real data, honest limits')}</h3>
            <p>
              {t(
                'Cycling and hiking use Mapbox cycling and walking profiles. Access and surface quality depend on mapped data; always check conditions. Moving time and Terrain-RGB elevations are estimates. Loops are generated with intermediate points and may differ from the target distance.',
              )}
            </p>
            <h3>{t('Data & attribution')}</h3>
            <p>
              {t('Map data ©')}{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                {t('OpenStreetMap contributors')}
              </a>{' '}
              {t(
                '(ODbL). Maps, routing, terrain and place search are provided by Mapbox. No map regions are downloaded for offline use. Provider ©',
              )}{' '}
              <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">
                Mapbox
              </a>
              {t(', with OSM data.')}
            </p>
            <p className="fine-print">
              {t(
                'Maps, searches, route points and terrain requests go directly from your browser to Mapbox using a public token. Your saved local library is not uploaded. Saved routes and GPX work offline after the app shell is cached; basemaps require internet. Check provider terms before publishing stored routes or GPX exports.',
              )}
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
