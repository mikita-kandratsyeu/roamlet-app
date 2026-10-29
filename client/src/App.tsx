import { Button } from './components/ui/button';
import { Toaster } from './components/ui/sonner';
import { Notification } from './components/Notification';
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
import { useRouteEditor } from './hooks/useRouteEditor';
import { usePointRouting } from './hooks/usePointRouting';
import { PlannerTools } from './components/PlannerTools';
import { PlannerDetails } from './components/PlannerDetails';
import { PlannerChoice } from './components/PlannerChoice';
import { CoordinateInput, type CoordinateInputHandle } from './components/CoordinateInput';
import { DraftPrompt } from './components/DraftPrompt';
import { initialEditor, newIdentity, withEditorSchedule } from './domain/editorSnapshot';
import { estimatePersonalTime } from './domain/time';
import { draftWriter, loadDraft, type DraftRecord } from './domain/drafts';
import { loadPreferences, savePreferences } from './domain/preferences';
import { Library } from './components/Library';
import { RouteComparison, ROUTE_COMPARISON_COLORS } from './components/RouteComparison';
import { ClimbAnalysis } from './components/ClimbAnalysis';
import { RouteSchedule } from './components/RouteSchedule';
import './components/ComparisonMap.css';
import { Statistics } from './components/Statistics';
import { formatDistance, formatDuration } from './domain/format';
import { useAppUpdate } from './hooks/useAppUpdate';
import {
  MapPinPlus,
  Plus,
  ArrowDownUp,
  ArrowUp,
  ArrowDown,
  X,
  Download,
  FileUp,
  Trash2,
  Bookmark,
  Sparkles,
  Check,
  Pencil,
  LoaderCircle,
  Info,
  PanelLeftOpen,
  PanelLeftClose,
  Route as RouteIcon,
  GripVertical,
  Ruler,
  Library as LibraryIcon,
  WifiOff,
} from 'lucide-react';
import type { Activity, Coordinate, PlannedRoute, RoutingResult, Waypoint } from './domain/types';
import { importGpx, exportGpx } from './domain/gpx';
import { ExportDialog } from './components/ExportDialog';
import { RouteDescription } from './components/RouteDescription';
import { calculateStats } from './domain/stats';
import { MANUAL_STOP_LIMIT } from './domain/manualRoute';
import { reverseWaypoints, reorderWaypoints, insertWaypoint } from './domain/waypointLegs';
import { isRouteResultCurrent } from './domain/editorRouting';
import { DEFAULT_ROUTING_OPTIONS } from './domain/routingOptions';
type PlanningMode = 'point' | 'loop' | 'manual';
import { saveRoute } from './domain/storage';
import { checkRoutingConfiguration, routingProvider } from './services/routing';
import { RouteMap } from './components/RouteMap';
import './route-editing.css';
import { Dialog } from './components/Dialog';
import { HeaderMenu } from './components/HeaderMenu';
import i18n, { formatNumber, translateMessage } from './i18n';

const emptySegments: Coordinate[][] = [];
const cyclingChoices = [
  { value: 'cycling-regular', label: 'Regular cycling' },
  { value: 'cycling-road', label: 'Road cycling' },
  { value: 'cycling-mountain', label: 'Mountain biking' },
] as const;
const sectionChoices = [
  { value: 'automatic', label: 'Road/path routing' },
  { value: 'direct', label: 'Direct line — unverified' },
] as const;
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
  const [preferences] = useState(loadPreferences);
  const [timeSyncRevision, setTimeSyncRevision] = useState(0);
  const [editorInitial] = useState(() => ({
    ...initialEditor(),
    activity: preferences.activity,
    planningMode: preferences.planningMode,
    automaticMode: preferences.planningMode === 'loop' ? ('loop' as const) : ('point' as const),
    targetKm: preferences.targetKm,
    speeds: preferences.speeds,
    stopsMinutes: preferences.stopsMinutes,
    fitness: preferences.fitness,
    routingOptions: preferences.routingOptions,
  }));
  const editor = useRouteEditor(editorInitial);
  const {
    activity,
    setActivity,
    waypoints,
    setWaypoints,
    result,
    setResult,
    mode,
    setMode,
    planningMode,
    setPlanningMode,
    setAutomaticMode,
    name,
    setName,
    description,
    setDescription,
    targetKm,
    setTargetKm,
    speeds,
    setSpeeds,
    stopsMinutes,
    setStopsMinutes,
    fitness,
    setFitness,
    surface,
    setSurface,
    routingOptions,
    setRoutingOptions,
    routeStale,
    setRouteStale,
  } = editor;
  const [panelHidden, setPanelHidden] = useState(preferences.panelHidden);
  const hidePlannerButton = useRef<HTMLButtonElement>(null);
  const showPlannerButton = useRef<HTMLButtonElement>(null);
  const plannerFocusRequested = useRef(false);
  useEffect(() => {
    if (!plannerFocusRequested.current) return;
    plannerFocusRequested.current = false;
    (panelHidden ? showPlannerButton : hidePlannerButton).current?.focus({ preventScroll: true });
  }, [panelHidden]);
  const automaticMode = editor.snapshot.automaticMode ?? 'point';
  const stopLimit = planningMode === 'manual' ? MANUAL_STOP_LIMIT : 25;
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
  const [notice, setNotice] = useState<{
    text: string;
    error: boolean;
    kind?: 'routing' | 'map';
  } | null>(null);
  const [mapRetryToken, setMapRetryToken] = useState(0);
  const [searchTarget, setSearchTarget] = useState<string | null>(null);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [focusWaypointToken, setFocusWaypointToken] = useState(0);
  const [elevationCoordinate, setElevationCoordinate] = useState<Coordinate | null>(null);
  const [elevationOpen, setElevationOpen] = useState<boolean | undefined>(undefined);
  const [fitToken, setFitToken] = useState(0);
  function selectWaypoint(id: string, focusMap = false) {
    setSelectedWaypointId(id);
    if (focusMap) setFocusWaypointToken((token) => token + 1);
    else {
      setPanelHidden(false);
      setCollapsed(false);
      requestAnimationFrame(() => {
        const item = [...document.querySelectorAll<HTMLElement>('[data-stop-id]')].find(
          (element) => element.dataset.stopId === id,
        );
        item?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
      });
    }
  }
  function replaceWaypoint(id: string) {
    selectWaypoint(id);
    setSearchTarget(id);
    searchInput.current?.focus();
    requestAnimationFrame(() => searchInput.current?.focus());
  }
  useEffect(() => {
    if (selectedWaypointId && !waypoints.some((point) => point.id === selectedWaypointId))
      setSelectedWaypointId(null);
  }, [waypoints, selectedWaypointId]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [comparisonRoutes, setComparisonRoutes] = useState<PlannedRoute[]>([]);
  const [comparisonError, setComparisonError] = useState('');
  const [climbSegments, setClimbSegments] = useState<Coordinate[][]>([]);
  const comparisonLayers = useMemo(
    () =>
      comparisonRoutes.flatMap((route, index) => {
        const direct = route.source === 'manual' ? route.segments : (route.directSegments ?? []);
        const directKeys = new Set(direct.map((segment) => JSON.stringify(segment)));
        return [
          {
            segments: route.segments.filter((segment) => !directKeys.has(JSON.stringify(segment))),
            color: ROUTE_COMPARISON_COLORS[index],
          },
          { segments: direct, color: ROUTE_COMPARISON_COLORS[index], dashed: true },
        ];
      }),
    [comparisonRoutes],
  );
  const comparisonSegments = useMemo(
    () => comparisonRoutes.flatMap((route) => route.segments),
    [comparisonRoutes],
  );
  const libraryTrigger = useRef<HTMLButtonElement>(null);
  const libraryReturnFocus = useRef<HTMLElement | null>(null);
  const libraryWasOpen = useRef(false);
  function openLibrary() {
    libraryReturnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLibraryOpen(true);
  }
  function closeLibrary() {
    setLibraryOpen(false);
  }
  const [saveOpen, setSaveOpen] = useState(false);
  const [exportRoute, setExportRoute] = useState<PlannedRoute | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(preferences.collapsed);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  useEffect(() => {
    if (libraryWasOpen.current && !libraryOpen) {
      const previous = libraryReturnFocus.current;
      const target =
        previous?.isConnected && !previous.closest('[hidden], [inert], [aria-hidden="true"]')
          ? previous
          : libraryTrigger.current;
      queueMicrotask(() =>
        (confirmation ? confirmationCancel.current : target)?.focus({ preventScroll: true }),
      );
    }
    libraryWasOpen.current = libraryOpen;
  }, [libraryOpen, confirmation]);
  const [alternatives, setAlternatives] = useState<RoutingResult[]>([]);
  const [selectedAlternative, setSelectedAlternative] = useState(-1);
  const routeIdentity = { current: editor.identity };
  const fileInput = useRef<HTMLInputElement>(null);
  const routeNameInput = useRef<HTMLInputElement>(null);
  const confirmationCancel = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<CoordinateInputHandle>(null);
  const request = useRef<AbortController | null>(null);
  const fail = (text: string, kind?: 'routing' | 'map') => setNotice({ text, error: true, kind });
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [writer] = useState(() => draftWriter(() => setDraftError(true)));
  const latestSnapshot = useRef(editor.snapshot);
  latestSnapshot.current = editor.snapshot;
  const update = useAppUpdate(writer.flush);
  const [online, setOnline] = useState(navigator.onLine);
  const offlineAutomatic = !online && planningMode !== 'manual';
  const checkConnection = () => setOnline(navigator.onLine);
  useEffect(() => {
    let active = true;
    loadDraft()
      .then((value) => {
        if (active) {
          setDraft(value);
          setDraftChecked(true);
        }
      })
      .catch(() => {
        if (active) {
          setDraftError(true);
          setDraftChecked(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (draftChecked && !draft && dirty) writer.schedule(editor.snapshot);
  }, [draftChecked, draft, dirty, editor.snapshot, writer]);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') void writer.flush();
    };
    document.addEventListener('visibilitychange', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      writer.cancel();
    };
  }, [writer]);
  const writingPreferences = useRef(false);
  const applyingPreferences = useRef(false);
  const previousSettings = useRef({
    activity,
    planningMode,
    targetKm,
    speeds,
    stopsMinutes,
    fitness,
    routingOptions,
    panelHidden,
    collapsed,
  });
  useEffect(() => {
    const current = {
      activity,
      planningMode,
      targetKm,
      speeds,
      stopsMinutes,
      fitness,
      routingOptions,
      panelHidden,
      collapsed,
    };
    const patch = Object.fromEntries(
      Object.entries(current).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(previousSettings.current[key as keyof typeof current]),
      ),
    );
    previousSettings.current = current;
    if (applyingPreferences.current) {
      applyingPreferences.current = false;
      return;
    }
    if (!Object.keys(patch).length) return;
    writingPreferences.current = true;
    savePreferences(patch);
    writingPreferences.current = false;
  }, [
    activity,
    planningMode,
    targetKm,
    speeds,
    stopsMinutes,
    fitness,
    routingOptions,
    panelHidden,
    collapsed,
  ]);
  useEffect(() => {
    const apply = (event: Event) => {
      if (writingPreferences.current) return;
      const detail = (event as CustomEvent<{ reset?: boolean; patch?: Record<string, unknown> }>)
        .detail;
      if (
        detail?.patch &&
        !detail.reset &&
        !Object.keys(detail.patch).some((key) =>
          [
            'activity',
            'planningMode',
            'targetKm',
            'speeds',
            'stopsMinutes',
            'fitness',
            'routingOptions',
            'panelHidden',
            'collapsed',
          ].includes(key),
        )
      )
        return;
      const next = loadPreferences();
      if (
        !detail ||
        detail.reset ||
        Object.keys(detail.patch ?? {}).some((key) => key === 'speeds' || key === 'stopsMinutes')
      )
        setTimeSyncRevision((revision) => revision + 1);
      applyingPreferences.current = true;
      if (!dirty && !result) {
        editor.routingAllowed.current = false;
        setActivity(next.activity);
        setRoutingOptions(next.routingOptions);
      }
      setSpeeds(next.speeds);
      setStopsMinutes(next.stopsMinutes);
      setFitness(next.fitness);
      if (detail?.reset) setSurface('unknown');
      setPanelHidden(next.panelHidden);
      setCollapsed(next.collapsed);
      setTargetKm(next.targetKm);
      if (!dirty && !result && mode !== 'snapshot') {
        setPlanningMode(next.planningMode);
        if (next.planningMode !== 'manual') setAutomaticMode(next.planningMode);
      }
    };
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener('roamlet-preferences-change', apply);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    return () => {
      window.removeEventListener('roamlet-preferences-change', apply);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
  }, [
    mode,
    dirty,
    result,
    setActivity,
    setRoutingOptions,
    setSpeeds,
    setStopsMinutes,
    setFitness,
    setSurface,
    setTargetKm,
    setPlanningMode,
    setAutomaticMode,
    editor.routingAllowed,
  ]);
  function travelHistory(direction: 'undo' | 'redo') {
    if (direction === 'undo' ? !editor.canUndo : !editor.canRedo) return;
    const changesGeometry =
      direction === 'undo' ? editor.undoChangesGeometry : editor.redoChangesGeometry;
    if (!changesGeometry) {
      editor[direction]();
      setDirty(true);
      return;
    }
    request.current?.abort();
    setBusy(false);
    setAlternatives([]);
    setSelectedAlternative(-1);
    editor[direction]();
    setDirty(true);
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        libraryOpen ||
        document.querySelector('[role="dialog"], dialog[open], .global-map-loader')
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select'))
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.altKey) {
        event.preventDefault();
        travelHistory(event.shiftKey ? 'redo' : 'undo');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  useEffect(() => {
    if (!online) setNotice((current) => (current?.kind ? null : current));
  }, [online]);

  usePointRouting({
    snapshot: editor.routingSnapshot,
    revision: routeRevision,
    online,
    allowed: editor.routingAllowed,
    request,
    setBusy,
    setResult,
    setRouteStale,
    setNotice,
  });
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    setConfigurationUnavailable(false);
    checkRoutingConfiguration(controller.signal)
      .then((configured) => {
        if (!controller.signal.aborted) setRoutingConfigured(configured);
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfigurationUnavailable(true);
      });
    return () => controller.abort();
  }, [online]);
  useEffect(
    () => () => {
      request.current?.abort();
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

  function invalidate(preserveGeometry = false) {
    editor.checkpoint();
    editor.routingAllowed.current = true;
    request.current?.abort();
    setBusy(false);
    setRouteStale(preserveGeometry);
    setElevationCoordinate(null);
    if (!preserveGeometry) setResult(null);
    setAlternatives([]);
    setSelectedAlternative(-1);
    setNotice(null);
    setDirty(true);
  }
  function changeWaypoints(next: Waypoint[]) {
    if (offlineAutomatic) return;
    invalidate(planningMode === 'point' && next.length >= 2);
    setWaypoints(next);
  }
  function changeRoutingOptions(next: typeof routingOptions) {
    if (mode !== 'manual' || planningMode === 'manual' || offlineAutomatic) return;
    invalidate(planningMode === 'point' && waypoints.length >= 2);
    setRoutingOptions(next);
  }
  function changePlanningMode(next: PlanningMode) {
    if (next === planningMode || (!online && next !== 'manual')) return;
    const points =
      next === 'manual' && planningMode === 'loop' && result ? result.waypoints : waypoints;
    if (next === 'point' && waypoints.length > 25) {
      fail('Automatic routing supports up to 25 stops. Remove points or keep manual mode.');
      return;
    }
    const change = () => {
      invalidate();
      setSearchTarget(null);
      searchInput.current?.clear();
      if (next !== 'manual') editor.setAutomaticMode(next);
      setPlanningMode(next);
      if (next === 'loop') setWaypoints(points.slice(0, 1));
      else if (next === 'manual') setWaypoints(points);
    };
    if (next === 'loop' && waypoints.length > 1) {
      setConfirmation({
        title: 'Switch to a round trip?',
        text: 'Only your starting point will be kept. Save or export the current route first to keep it.',
        label: 'Switch to round trip',
        action: change,
      });
    } else if (points.length > 1 && (next === 'manual' || planningMode === 'manual')) {
      setConfirmation({
        title: next === 'manual' ? 'Switch to manual drawing?' : 'Switch to automatic routing?',
        text:
          next === 'manual'
            ? 'Stops are kept, but the current geometry will be replaced by straight lines. Save or export the original first.'
            : 'Stops are kept, but Directions will replace the straight lines with a road/path route. Save or export the original first.',
        label: 'Switch mode',
        action: change,
      });
    } else change();
  }
  function addLocation(coordinate: Coordinate, label?: string) {
    if (mode !== 'manual') return;
    const point: Waypoint = {
      id: crypto.randomUUID(),
      name: label || `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`,
      coordinate,
    };
    if (searchTarget)
      changeWaypoints(
        waypoints.map((w) => (w.id === searchTarget ? { ...w, ...point, id: w.id } : w)),
      );
    else if (planningMode === 'loop') changeWaypoints([point]);
    else if (waypoints.length < stopLimit) changeWaypoints([...waypoints, point]);
    else {
      fail(
        planningMode === 'manual'
          ? 'A manual route supports up to 1,000 points. Remove a point before adding another.'
          : 'A route supports up to 25 stops. Remove a stop before adding another.',
      );
      return;
    }
    searchInput.current?.clear();
    setSearchTarget(null);
  }
  function reorderStop(fromId: string, toId: string) {
    const from = waypoints.findIndex((point) => point.id === fromId);
    const to = waypoints.findIndex((point) => point.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    changeWaypoints(reorderWaypoints(waypoints, from, to));
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
    setTimeSyncRevision((revision) => revision + 1);
    request.current?.abort();
    setBusy(false);
    void writer.clear();
    setDraft(null);
    const defaults = loadPreferences();
    editor.reset({
      ...initialEditor(),
      identity: newIdentity(),
      activity: defaults.activity,
      planningMode: defaults.planningMode,
      targetKm: defaults.targetKm,
      speeds: defaults.speeds,
      stopsMinutes: defaults.stopsMinutes,
      fitness: defaults.fitness,
      routingOptions: defaults.routingOptions,
    });
    setAlternatives([]);
    setSelectedAlternative(-1);
    setNotice(null);
    setPanelHidden(false);
    setCollapsed(false);
    editor.setAutomaticMode(defaults.planningMode === 'loop' ? 'loop' : 'point');
    setDirty(false);
    searchInput.current?.clear();
    setSearchTarget(null);
  }
  function openRoute(route: PlannedRoute) {
    setTimeSyncRevision((revision) => revision + 1);
    request.current?.abort();
    setBusy(false);
    void writer.clear();
    setDraft(null);
    editor.reset({
      ...editor.snapshot,
      surface: 'unknown',
      identity: { id: route.id, createdAt: route.createdAt },
      savedRouteId: route.id,
      routeMetadata: { favorite: route.favorite, tags: route.tags },
      result: route,
      departureLocal: route.departureLocal,
      routeStale: false,
      routingOptions: route.routingOptions ?? DEFAULT_ROUTING_OPTIONS,
      waypoints: route.waypoints,
      name: route.name,
      description: route.description,
      activity: route.activity,
      mode: 'snapshot',
      planningMode: route.source === 'manual' ? 'manual' : 'point',
    });
    setAlternatives([]);
    setSelectedAlternative(-1);
    editor.setAutomaticMode('point');
    setDirty(false);
    setLibraryOpen(false);
    setCollapsed(false);
    setPanelHidden(false);
    setFitToken((token) => token + 1);
    setSearchTarget(null);
    searchInput.current?.clear();
  }
  function currentRoute(): PlannedRoute | null {
    return result && isRouteResultCurrent(editor.snapshot) && !routeStale && !busy
      ? {
          ...withEditorSchedule(result, editor.snapshot),
          ...editor.snapshot.routeMetadata,
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
    const savedSnapshot = editor.snapshot;
    setSaving(true);
    try {
      await saveRoute(route);
      if (latestSnapshot.current === savedSnapshot) {
        setDirty(false);
        void writer.clear();
      }
      if (latestSnapshot.current.identity.id === savedSnapshot.identity.id)
        editor.setSavedRouteId(route.id);
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
  function download(route: PlannedRoute, filename: string) {
    const blob = new Blob([exportGpx(route)], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    try {
      document.body.append(link);
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    setExportRoute(null);
    setNotice({
      text: 'GPX exported. Import it through your GPS device or compatible app’s GPX upload workflow.',
      error: false,
    });
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
        editor.setSavedRouteId(null);
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
  function changeActivity(next: Activity) {
    if (
      next === activity ||
      (!online && result?.source === 'openrouteservice') ||
      (offlineAutomatic && mode === 'manual')
    )
      return;
    if (mode === 'snapshot' && (result?.source === 'gpx' || result?.source === 'manual')) {
      editor.checkpoint();
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
    if (!result || (!online && result.source !== 'manual')) return;
    if (!result.segments.some((segment) => segment.length >= 2)) {
      fail(
        'This GPX contains only isolated points. They are preserved for saving and export; start a new route to plan between locations.',
      );
      return;
    }
    const source = result.source;
    if (source === 'manual') {
      invalidate();
      setMode('manual');
      setPlanningMode('manual');
      return;
    }
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
      editor.setAutomaticMode('point');
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
  async function generatePointAlternatives() {
    if (!online || busy || waypoints.length !== 2 || waypoints[0].legMode === 'direct') return;
    invalidate(true);
    editor.routingAllowed.current = false;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const found = await routingProvider.calculatePointAlternatives!(
        waypoints,
        activity,
        controller.signal,
        routingOptions,
      );
      if (!controller.signal.aborted) {
        setAlternatives(found);
        selectAlternative(found[0], 0, false);
      }
    } catch (error) {
      if (!controller.signal.aborted) fail(errorMessage(error), 'routing');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function generateLoops() {
    if (!online) return;
    if (!waypoints.length) {
      fail('Choose a starting point on the map or enter coordinates first.');
      return;
    }
    invalidate(Boolean(result));
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const found = await routingProvider.calculateAlternatives(
        waypoints[0],
        activity,
        targetKm * 1000,
        controller.signal,
        routingOptions,
      );
      if (!controller.signal.aborted) {
        setAlternatives(found);
        selectAlternative(found[0], 0, false);
      }
    } catch (error) {
      if (!controller.signal.aborted) fail(errorMessage(error), 'routing');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function selectAlternative(calculated: RoutingResult, index: number, recordHistory = true) {
    if (recordHistory && selectedAlternative === index && result) return;
    if (recordHistory) editor.checkpoint();
    const coordinates = calculated.segments[0];
    const stops =
      planningMode === 'point'
        ? waypoints
        : [0, 0.25, 0.5, 0.75, 1].map((fraction, i) => ({
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
      routingOptions,
      ...calculated,
      updatedAt: new Date().toISOString(),
      source: 'openrouteservice',
    });
    setSelectedAlternative(index);
    setRouteStale(false);
    setElevationCoordinate(null);
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
  const canUseRoute = isRouteResultCurrent(editor.snapshot) && !busy && !routeStale;
  const routingError = !busy && notice?.kind === 'routing' && notice.error ? notice : null;
  const plannerStatus = busy
    ? routeStale && result
      ? t('Previous route shown while recalculating. Saving and export are paused.')
      : t('Calculating route…')
    : routingError
      ? translateMessage(routingError.text)
      : routeStale && result
        ? t('Previous route shown. Recalculate successfully before saving or exporting.')
        : dirty
          ? t('Unsaved changes')
          : result
            ? t('Saved route, ready to explore')
            : t('Start with two points on the map');
  const retryRouting = () => {
    if (planningMode === 'loop') void generateLoops();
    else {
      editor.routingAllowed.current = true;
      setRouteStale(true);
      setRouteRevision((revision) => revision + 1);
    }
  };
  const alternativesHelp = !online
    ? 'Connect to the internet to find alternatives.'
    : waypoints.length !== 2
      ? 'Alternatives are available for routes with exactly two stops.'
      : waypoints[0]?.legMode === 'direct'
        ? 'Switch the section to road/path routing to find alternatives.'
        : busy
          ? 'Wait for the current calculation to finish.'
          : 'Compare different routes between the start and finish.';

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
      <Toaster />
      {notice && (notice.kind !== 'routing' || panelHidden || libraryOpen) && (
        <Notification
          title={t(
            notice.kind === 'map'
              ? 'Map error'
              : notice.kind === 'routing'
                ? 'Routing error'
                : 'Notification',
          )}
          message={translateMessage(notice.text)}
          variant={notice.error ? 'error' : 'success'}
          onDismiss={() => setNotice(null)}
          actions={
            notice.kind && (
              <>
                {notice.kind === 'routing' && (
                  <Button
                    variant="outline"
                    disabled={!online || busy}
                    onClick={retryRouting}
                  >
                    {t('Retry routing')}
                  </Button>
                )}
                {notice.kind === 'map' && (
                  <Button
                    variant="outline"
                    disabled={!online}
                    onClick={() => {
                      setMapRetryToken((value) => value + 1);
                      setNotice(null);
                    }}
                  >
                    {t('Retry map')}
                  </Button>
                )}
                <Button variant="ghost" onClick={openLibrary}>
                  {t('Open library')}
                </Button>
                {notice.kind === 'routing' && (
                  <Button variant="ghost" onClick={() => changePlanningMode('manual')}>
                    {t('Use manual drawing')}
                  </Button>
                )}
              </>
            )
          }
        />
      )}
      <div
        className="editor-screen"
        aria-hidden={libraryOpen || undefined}
        inert={libraryOpen || undefined}
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
            <span className="brand-beta">beta</span>
          </a>
          <nav aria-label={t('Main navigation')}>
            <Button
              variant="ghost"
              className="header-library"
              ref={libraryTrigger}
              onClick={openLibrary}
              aria-label={t('My routes')}
            >
              <LibraryIcon size={18} aria-hidden="true" />
              <span>{t('My routes')}</span>
            </Button>
            <HeaderMenu
              onNewRoute={() => guard(newRoute)}
              onLibrary={openLibrary}
              onHelp={() => setHelpOpen(true)}
            />
          </nav>
        </header>
        {!online && (
          <Alert className="offline-banner" role="status">
            <WifiOff size={18} aria-hidden="true" />
            <div className="offline-banner-copy">
              <strong>{t('No internet connection')}</strong>
              <span>
                {t(
                  'Saved routes, GPX and coordinate-based manual drawing remain available. Map loading and automatic routing need internet.',
                )}
              </span>
            </div>
            <div className="offline-banner-actions">
              {(mode !== 'manual' || planningMode !== 'manual') && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (mode === 'manual') changePlanningMode('manual');
                    else if (result?.source === 'manual') editSnapshot();
                    else
                      guard(() => {
                        newRoute();
                        setPlanningMode('manual');
                      });
                  }}
                >
                  {t(
                    mode === 'snapshot' && result?.source !== 'manual'
                      ? 'New manual route'
                      : 'Use manual drawing',
                  )}
                </Button>
              )}
              <Button variant="outline" onClick={checkConnection}>
                {t('Check connection')}
              </Button>
            </div>
          </Alert>
        )}
        {update.available && (
          <Notification
            title={t('Notification')}
            message={t('An app update is ready.')}
            duration={Infinity}
            actions={
              <Button
                disabled={update.installing}
                onClick={() =>
                  setConfirmation({
                    title: 'Update app?',
                    text: 'Your draft will be saved before reloading.',
                    label: 'Reload app',
                    action: () => {
                      void update.apply();
                    },
                  })
                }
              >
                {t('Update app')}
              </Button>
            }
          />
        )}
        {update.failed && (
          <Notification
            title={t('Notification')}
            variant="error"
            message={t(
              update.failed === 'save-failed'
                ? 'The update could not save your draft. Please retry; the app has not reloaded.'
                : 'Your draft was saved, but the update could not be activated. Please retry or reload the page.',
            )}
          />
        )}
        {draftError && (
          <Notification
            title={t('Notification')}
            variant="error"
            message={t(
              'The draft could not be loaded or saved. Your routes and settings are unchanged.',
            )}
            actions={
              <Button
                onClick={() => {
                  void writer.clear().then((ok) => {
                    if (ok) setDraftError(false);
                  });
                }}
              >
                {t('Delete draft')}
              </Button>
            }
          />
        )}
        <main
          className={`workspace ${!online ? 'workspace-offline' : ''} ${collapsed ? 'panel-collapsed' : ''} ${panelHidden ? 'desktop-panel-hidden' : ''}`}
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
                {(result || collapsed) && (
                  <small>
                    {result
                      ? formatDistance(result.stats.distance) +
                        ' · ' +
                        formatDuration(result.stats.duration)
                      : t('Start with two points on the map')}
                  </small>
                )}
              </span>
            </Button>
            <div className="planner-scroll">
              <div className="planner-heading">
                <div>
                  <h1>{name || t('New route')}</h1>
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
              <div className={`planner-route-status ${busy ? 'is-calculating' : routingError ? 'is-error' : routeStale && result ? 'is-stale' : ''}`}
                role={routingError ? 'alert' : 'status'} aria-atomic="true">
                <div className="planner-route-status-copy">
                  {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" />
                    : routingError || routeStale && result ? <Info size={16} aria-hidden="true" />
                    : result && !dirty ? <Check size={16} aria-hidden="true" /> : null}
                  <div>
                    <p>{plannerStatus}</p>
                    {routingError && routeStale && result && (
                      <p className="planner-route-status-context">
                        {t('Previous route shown. Recalculate successfully before saving or exporting.')}
                      </p>
                    )}
                  </div>
                </div>
                {routingError && (
                  <div className="planner-route-status-actions">
                    <Button variant="outline" disabled={!online} onClick={retryRouting}>
                      {t('Retry routing')}
                    </Button>
                    <Button variant="ghost" onClick={() => changePlanningMode('manual')}>
                      {t('Use manual drawing')}
                    </Button>
                    <Button variant="ghost" onClick={openLibrary}>{t('Open library')}</Button>
                    <Button variant="ghost" onClick={() => setNotice(null)}>{t('Dismiss notification')}</Button>
                  </div>
                )}
              </div>
              <RouteDescription
                key={editor.identity.id}
                description={description}
                name={name}
                tags={editor.snapshot.routeMetadata?.tags}
              />
              <ToggleGroup
                type="single"
                value={activity}
                disabled={
                  !online &&
                  (mode === 'manual'
                    ? planningMode !== 'manual'
                    : result?.source === 'openrouteservice')
                }
                onValueChange={(value) => {
                  if (value === 'cycling' || value === 'hiking') changeActivity(value);
                }}
                className="activity-selector"
                aria-label={t('Activity profile')}
              >
                <ToggleGroupItem
                  value="cycling"
                  className={activity === 'cycling' ? 'selected' : ''}
                >
                  {t('Cycling')}
                </ToggleGroupItem>
                <ToggleGroupItem value="hiking" className={activity === 'hiking' ? 'selected' : ''}>
                  {t('Hiking')}
                </ToggleGroupItem>
              </ToggleGroup>
              {offlineAutomatic && mode === 'manual' && (
                <p className="fine-print" role="note">
                  {t('Connect to the internet to calculate routes.')}
                </p>
              )}
              {mode === 'manual' && planningMode === 'manual' && (
                <section className="manual-planning-section" aria-label={t('Manual route drawing')}>
                  <p className="fine-print manual-mode-note">
                    <Ruler size={14} aria-hidden="true" />
                    <strong>{t('Manual route drawing')}</strong>
                  </p>
                  <p className="fine-print">
                    {t('Straight lines between points. No road snapping.')}
                    {!online && (
                      <> {t('Enter coordinates to draw straight lines without an online map.')}</>
                    )}
                  </p>
                  <Button
                    variant="outline"
                    className="manual-planning-action"
                    disabled={!online}
                    aria-describedby={!online ? 'manual-return-offline' : undefined}
                    onClick={() => changePlanningMode(automaticMode)}
                  >
                    {t('Return to automatic routing')}
                  </Button>
                  {!online && (
                    <p id="manual-return-offline" className="fine-print">
                      {t('Connect to the internet to calculate routes.')}
                    </p>
                  )}
                </section>
              )}
              {mode === 'manual' ? (
                <fieldset className="planner-edit-fields" disabled={offlineAutomatic}>
                  {planningMode !== 'manual' && (
                    <ToggleGroup
                      type="single"
                      value={planningMode}
                      className="planning-tabs"
                      aria-label={t('Route style')}
                      onValueChange={(value) => {
                        if (value === 'point' || value === 'loop') changePlanningMode(value);
                      }}
                    >
                      <ToggleGroupItem
                        value="point"
                        className={planningMode === 'point' ? 'active' : ''}
                      >
                        {t('Point to point')}
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="loop"
                        className={planningMode === 'loop' ? 'active' : ''}
                      >
                        {t('Round trip')}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  )}
                  {planningMode !== 'manual' && online && !waypoints.length && (
                    <div className="manual-planning-discovery">
                      <Button
                        variant="outline"
                        className="manual-planning-action"
                        onClick={() => changePlanningMode('manual')}
                      >
                        <Ruler size={16} aria-hidden="true" />
                        {t('Draw a route manually')}
                      </Button>
                    </div>
                  )}
                  {planningMode !== 'manual' && (
                    <div className="routing-preferences">
                      {activity === 'cycling' && (
                        <div className="routing-profile-field">
                          <span className="personal-time-label">{t('Cycling route profile')}</span>
                          <PlannerChoice
                            label={t('Cycling route profile')}
                            value={routingOptions.cyclingProfile ?? 'cycling-regular'}
                            options={cyclingChoices}
                            disabled={offlineAutomatic}
                            onChange={(cyclingProfile) =>
                              changeRoutingOptions({ ...routingOptions, cyclingProfile })
                            }
                          />
                        </div>
                      )}
                      <div className="routing-avoid-options">
                        <label>
                          <input
                            type="checkbox"
                            checked={routingOptions.avoidFerries ?? false}
                            onChange={(event) =>
                              changeRoutingOptions({
                                ...routingOptions,
                                avoidFerries: event.target.checked,
                              })
                            }
                          />
                          {t('Avoid ferries')}
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={routingOptions.avoidSteps ?? false}
                            onChange={(event) =>
                              changeRoutingOptions({
                                ...routingOptions,
                                avoidSteps: event.target.checked,
                              })
                            }
                          />
                          {t('Avoid steps')}
                        </label>
                      </div>
                      <p className="fine-print">
                        {t('Routing preferences do not guarantee road surface or access.')}
                      </p>
                    </div>
                  )}
                  <CoordinateInput
                    ref={searchInput}
                    replacing={Boolean(searchTarget)}
                    onAdd={(coordinate) => {
                      setNotice(null);
                      addLocation(coordinate);
                    }}
                  />
                  {searchTarget && (
                    <Button
                      variant="ghost"
                      className="text-button"
                      onClick={() => setSearchTarget(null)}
                    >
                      {t('Cancel replacing stop')}
                    </Button>
                  )}
                  {!waypoints.length ? (
                    <Card className="stops-empty">
                      <MapPinPlus size={26} aria-hidden="true" />
                      <div>
                        <strong>{t('Where shall we go?')}</strong>
                        <p>{t('Click the map or enter coordinates to add a start and finish.')}</p>
                      </div>
                    </Card>
                  ) : (
                    <ol className="waypoint-list" aria-label={t('Route stops')}>
                      {waypoints.map((point, index) => (
                        <li
                          key={point.id}
                          data-stop-id={point.id}
                          className={`${draggedStop === point.id ? 'dragging' : ''} ${dropTarget === point.id ? 'drop-target' : ''} ${selectedWaypointId === point.id ? 'selected-stop' : ''}`}
                          onDragOver={(event) => {
                            if (!stopDrag.current || planningMode === 'loop') return;
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
                            {planningMode !== 'loop' && (
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
                              aria-pressed={selectedWaypointId === point.id}
                              onClick={() => selectWaypoint(point.id, true)}
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
                              <Button
                                variant="ghost"
                                className="icon-button"
                                aria-label={t('Replace stop {{number}}', {
                                  number: formatNumber(index + 1),
                                })}
                                onClick={() => replaceWaypoint(point.id)}
                              >
                                <Pencil size={13} />
                              </Button>
                              {planningMode !== 'loop' && (
                                <>
                                  <Button
                                    variant="ghost"
                                    className="icon-button"
                                    aria-label={t('Move stop {{number}} up', {
                                      number: formatNumber(index + 1),
                                    })}
                                    disabled={index === 0}
                                    onClick={() => {
                                      changeWaypoints(
                                        reorderWaypoints(waypoints, index, index - 1),
                                      );
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
                                      changeWaypoints(
                                        reorderWaypoints(waypoints, index, index + 1),
                                      );
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
                          {planningMode === 'point' && index < waypoints.length - 1 && (
                            <div className="leg-mode">
                              <span>
                                {t('Section {{number}}', { number: formatNumber(index + 1) })}
                              </span>
                              <PlannerChoice
                                label={t('Section {{number}} mode', {
                                  number: formatNumber(index + 1),
                                })}
                                value={point.legMode ?? 'automatic'}
                                options={sectionChoices}
                                disabled={offlineAutomatic}
                                onChange={(legMode) =>
                                  changeWaypoints(
                                    waypoints.map((candidate) =>
                                      candidate.id === point.id
                                        ? { ...candidate, legMode }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  {planningMode === 'point' &&
                    waypoints.slice(0, -1).some((point) => point.legMode === 'direct') && (
                      <p className="fine-print">
                        {t(
                          'Direct sections are unverified straight lines, not confirmed roads or trails.',
                        )}
                      </p>
                    )}
                  <div className="waypoint-tools" role="group" aria-label={t('Route stop actions')}>
                    {planningMode !== 'loop' && waypoints.length < stopLimit && (
                      <Button
                        variant="outline"
                        className="add-stop"
                        onClick={() => {
                          setSearchTarget(null);
                          searchInput.current?.focus();
                        }}
                      >
                        <Plus size={18} aria-hidden="true" />
                        <span>{t('Add a stop')}</span>
                      </Button>
                    )}
                    {planningMode !== 'loop' && waypoints.length > 1 && (
                      <Button
                        variant="outline"
                        className="reverse-stops"
                        aria-label={t('Reverse')}
                        onClick={() => changeWaypoints(reverseWaypoints(waypoints))}
                      >
                        <ArrowDownUp size={18} aria-hidden="true" />
                        <span>{t('Reverse')}</span>
                      </Button>
                    )}
                    {!!waypoints.length && (
                      <Button
                        variant="outline"
                        className="clear-stops"
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
                        <Trash2 size={18} aria-hidden="true" />
                        <span className="clear-stops-label">{t('Clear stops')}</span>
                      </Button>
                    )}
                  </div>
                  {planningMode === 'point' && (
                    <div className="calculate-action">
                      <Button
                        className="primary full-width"
                        disabled={!online || busy || waypoints.length < 2}
                        onClick={() => {
                          editor.routingAllowed.current = true;
                          editor.checkpoint();
                          setRouteStale(true);
                          setDirty(true);
                          setRouteRevision((revision) => revision + 1);
                        }}
                      >
                        {busy ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <RouteIcon size={17} />
                        )}
                        {busy
                          ? t('Calculating route…')
                          : result
                            ? t('Update route')
                            : t('Calculate route')}
                      </Button>
                      <p className="fine-print">
                        {t('Routes update automatically as you edit stops.')}
                      </p>
                      {routingProvider.calculatePointAlternatives && (
                        <Button
                          variant="outline"
                          className="find-alternatives full-width"
                          aria-describedby="point-alternatives-help"
                          disabled={
                            !online ||
                            busy ||
                            waypoints.length !== 2 ||
                            waypoints[0]?.legMode === 'direct'
                          }
                          onClick={() => void generatePointAlternatives()}
                        >
                          <Sparkles size={16} aria-hidden="true" />
                          {t('Find alternatives')}
                        </Button>
                      )}
                      {routingProvider.calculatePointAlternatives && (
                        <p id="point-alternatives-help" className="fine-print alternatives-help">
                          {t(alternativesHelp)}
                        </p>
                      )}
                      {alternatives.length > 0 && (
                        <div className="alternatives point-alternatives">
                          {alternatives.map((alternative, index) => (
                            <Button
                              variant="ghost"
                              className={selectedAlternative === index ? 'chosen' : ''}
                              key={index}
                              aria-pressed={selectedAlternative === index}
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
                        disabled={!online}
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
                        disabled={!online || busy || !waypoints.length}
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
                              aria-pressed={selectedAlternative === index}
                              onClick={() => selectAlternative(alternative, index)}
                            >
                              <span>
                                {t('Option')} {formatNumber(index + 1)}
                                <strong>{formatDistance(alternative.stats.distance)}</strong>
                                <small className="route-distance-delta">
                                  {t('Difference from target: {{distance}}', {
                                    distance: formatDistance(
                                      Math.abs(alternative.stats.distance - targetKm * 1000),
                                    ),
                                  })}
                                </small>
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
                </fieldset>
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
                    disabled={!online && result?.source !== 'manual'}
                    onClick={editSnapshot}
                  >
                    <Pencil size={18} aria-hidden="true" />
                    {t('Edit waypoints')}
                  </Button>
                </div>
              )}
              {online &&
                planningMode !== 'manual' &&
                (routingConfigured === false || configurationUnavailable) &&
                !notice?.error && (
                  <div className="configuration-note">
                    <Info size={16} />
                    <span>
                      {configurationUnavailable
                        ? t(
                            'OpenRouteService configuration could not be checked. GPX and saved routes still work.',
                          )
                        : t(
                            'Configure ORS_API_KEY on the server. GPX and saved routes remain available.',
                          )}
                    </span>
                    <Button
                      variant="ghost"
                      className="text-button"
                      onClick={() => setHelpOpen(true)}
                    >
                      {t('Setup')}
                    </Button>
                  </div>
                )}
              {result && !routeStale && (
                <Statistics
                  route={result}
                  mapAvailable={online}
                  onElevationHover={setElevationCoordinate}
                  elevationOpen={elevationOpen}
                  onElevationOpenChange={setElevationOpen}
                  speedKmh={speeds[activity]}
                  stopsMinutes={stopsMinutes}
                  fitness={fitness}
                  surface={surface}
                  emptyHint={planningMode === 'loop'
                    ? t('Choose a start and find round trips to see route details.')
                    : undefined}
                />
              )}
              <PlannerTools
                key={editor.identity.id}
                initiallyOpen={false}
                contextKey={`${editor.identity.id}:${activity}:${timeSyncRevision}`}
                speed={speeds[activity]}
                stops={stopsMinutes}
                activity={activity}
                fitness={fitness}
                surface={surface}
                onFitness={(value) => {
                  setFitness(value);
                  if (waypoints.length || result) setDirty(true);
                }}
                onSurface={(value) => {
                  setSurface(value);
                  if (waypoints.length || result) setDirty(true);
                }}
                onSpeed={(value) => {
                  setSpeeds((previous) => ({ ...previous, [activity]: value }));
                  if (waypoints.length || result) setDirty(true);
                }}
                onStops={(value) => {
                  setStopsMinutes(value);
                  if (waypoints.length || result) setDirty(true);
                }}
              />
              {routeStale && result ? null : result ? (
                <>
                  <PlannerDetails key={`climbs:${editor.identity.id}`} title={t('Climb analysis')}>
                    <ClimbAnalysis route={result} onHighlight={setClimbSegments} showHeading={false} />
                  </PlannerDetails>
                  <PlannerDetails key={`schedule:${editor.identity.id}`} title={t('Route schedule')}>
                  <RouteSchedule
                    showHeading={false}
                    route={result}
                    waypoints={editor.scheduleWaypoints}
                    departureLocal={editor.departureLocal}
                    movingSeconds={
                      estimatePersonalTime(result, {
                        speedKmh: speeds[activity],
                        stopsMinutes,
                        fitness,
                        surface,
                      })?.moving ?? null
                    }
                    geometryCurrent={canUseRoute}
                    contextKey={editor.identity.id}
                    onDepartureLocal={(value) => {
                      editor.setDepartureLocal(value);
                      setDirty(true);
                    }}
                    onWaypointPause={(id, value) => {
                      editor.setWaypointPause(id, value);
                      setDirty(true);
                    }}
                  />
                  </PlannerDetails>
                </>
              ) : (
                <section className="statistics statistics-empty" aria-label={t('Route statistics')}>
                  <Info size={18} aria-hidden="true" />
                  <p>
                    {planningMode === 'loop'
                      ? t('Choose a start and find round trips to see their distance and time.')
                      : t('Add two stops to see distance and time.')}
                  </p>
                </section>
              )}
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
                  onClick={() => {
                    if (!busy) setExportRoute(currentRoute());
                  }}
                >
                  <Download size={17} />
                  {t('Export')}
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
          <RouteMap
            key={mapRetryToken}
            online={online}
            onLibrary={openLibrary}
            onCheckConnection={checkConnection}
            plannerHidden={panelHidden}
            segments={result?.segments || emptySegments}
            waypoints={mapWaypoints}
            selectedWaypointId={selectedWaypointId}
            focusWaypointToken={focusWaypointToken}
            onSelectWaypoint={selectWaypoint}
            onReplaceWaypoint={replaceWaypoint}
            onRemoveWaypoint={(id) => changeWaypoints(waypoints.filter((point) => point.id !== id))}
            onStartWaypoint={(id) => {
              const point = waypoints.find((candidate) => candidate.id === id);
              if (point && waypoints[0]?.id !== id)
                changeWaypoints(reorderWaypoints(waypoints, waypoints.indexOf(point), 0));
            }}
            elevationCoordinate={elevationCoordinate}
            highlightSegments={climbSegments}
            routeStale={routeStale}
            directSegments={result?.source === 'manual' ? result.segments : result?.directSegments}
            alternativeSegments={alternatives.map((alternative) => alternative.segments)}
            selectedAlternativeIndex={selectedAlternative}
            editable={
              mode === 'manual' &&
              !busy &&
              !offlineAutomatic &&
              (planningMode !== 'loop' || !result)
            }
            manualDrawing={mode === 'manual' && planningMode === 'manual'}
            onToggleManualDrawing={
              mode === 'manual'
                ? () => changePlanningMode(planningMode === 'manual' ? automaticMode : 'manual')
                : result?.source === 'manual'
                  ? editSnapshot
                  : undefined
            }
            onUndo={() => travelHistory('undo')}
            onRedo={() => travelHistory('redo')}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            onInsert={
              mode === 'manual' && planningMode !== 'loop' && !routeStale
                ? (coordinate, index) => {
                    if (waypoints.length >= stopLimit) {
                      fail(
                        planningMode === 'manual'
                          ? 'A manual route supports up to 1,000 points. Remove a point before adding another.'
                          : 'A route supports up to 25 stops. Remove a stop before adding another.',
                      );
                      return;
                    }
                    changeWaypoints(
                      insertWaypoint(waypoints, index, {
                        id: crypto.randomUUID(),
                        name: `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`,
                        coordinate,
                      }),
                    );
                  }
                : undefined
            }
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
            onError={(text) => fail(text, 'map')}
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
      </div>
      {libraryOpen && (
        <Library
          onClose={closeLibrary}
          onCompare={(routes) => {
            setComparisonError('');
            setComparisonRoutes(routes);
          }}
          onOpen={(route) => {
            setLibraryOpen(false);
            guard(() => openRoute(route));
          }}
        />
      )}
      {comparisonRoutes.length >= 2 && (
        <Dialog title={t('Compare saved routes')} wide onClose={() => setComparisonRoutes([])}>
          <div className="comparison-map">
            <RouteMap
              online={online}
              segments={comparisonSegments}
              comparisonLayers={comparisonLayers}
              comparisonMode
              waypoints={[]}
              editable={false}
              plannerHidden
              fitToken={1}
              onAdd={() => {}}
              onMove={() => {}}
              onError={setComparisonError}
            />
          </div>
          {comparisonError && (
            <Notification
              title={t('Map error')}
              variant="error"
              message={translateMessage(comparisonError)}
              onDismiss={() => setComparisonError('')}
            />
          )}
          <RouteComparison routes={comparisonRoutes} />
        </Dialog>
      )}
      {draft && !libraryOpen && (
        <DraftPrompt
          onDismiss={() => setDraft(null)}
          onDelete={() => {
            void writer.clear().then((ok) => {
              if (ok) setDraft(null);
            });
          }}
          onRestore={() => {
            setTimeSyncRevision((revision) => revision + 1);
            request.current?.abort();
            setBusy(false);
            editor.reset(draft.snapshot);
            setDirty(true);
            setDraft(null);
            setAlternatives([]);
            setSelectedAlternative(-1);
            setFitToken((token) => token + 1);
          }}
        />
      )}
      {exportRoute && !libraryOpen && (
        <ExportDialog
          route={exportRoute}
          onDownload={download}
          onClose={() => setExportRoute(null)}
        />
      )}
      {saveOpen && !libraryOpen && (
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
      {confirmation && !libraryOpen && (
        <Dialog
          title={t(confirmation.title)}
          compact
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
              variant="destructive"
              className="danger"
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
      {helpOpen && !libraryOpen && (
        <Dialog title={t('A few helpful things')} onClose={() => setHelpOpen(false)}>
          <div className="help-content">
            <h3>{t('Planning routes')}</h3>
            <p>
              {t(
                'Choose cycling or hiking and add points on the map or enter coordinates. Automatic routing follows roads and paths using OpenRouteService and needs internet. No separate map or routing account is needed.',
              )}
            </p>
            <p>
              {t(
                'If automatic routing is unavailable, try again later, draw a route manually, or open a saved route. Manual drawing connects points with straight lines; it does not check roads or access.',
              )}
            </p>
            <h3>{t('Your route, your device')}</h3>
            <p>
              {t(
                'Routes stay only in this browser on this device. There is no cloud copy. Clearing browser data deletes them. Download a JSON library backup from My routes before clearing browser data; GPX exports contain individual routes, not a library backup.',
              )}
            </p>
            <h3>{t('Without an internet connection')}</h3>
            <p>
              {t(
                'Visit the app online first so its offline shell can be cached. No offline map regions are downloaded.',
              )}
            </p>
            <ul>
              <li>
                {t(
                  'Available offline: saved routes and statistics, GPX import and export, library backups, and manual drawing by coordinates.',
                )}
              </li>
              <li>
                {t(
                  'Internet required: loading the map, automatic routing and round trips. This app is not an offline navigation map.',
                )}
              </li>
            </ul>
            <h3>{t('Take it with you')}</h3>
            <p>
              {t(
                'Export a GPX, then use the file-import feature supported by your GPS device or app. Check the official Strava or Komoot help for GPX import availability. There is no direct publishing integration.',
              )}
            </p>
            <h3>{t('Real data, honest limits')}</h3>
            <p>
              {t(
                'Routes are planning suggestions, not a guarantee of access or safety. Check signs, access restrictions, weather and current trail conditions before travelling. Round trips may differ from the requested distance.',
              )}
            </p>
            <p>
              {t(
                'Travel times are approximate and depend on your pace, stops and conditions. Elevation is shown only when complete height data is available from an imported GPX or a supported automatic route. Heights may be estimates, and missing values are not filled in.',
              )}
            </p>
            <h3>{t('Data & attribution')}</h3>
            <p>
              {t('Map data ©')}{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                {t('OpenStreetMap contributors')}
              </a>{' '}
              {' · '}
              <a
                href="https://opendatacommons.org/licenses/odbl/1-0/"
                target="_blank"
                rel="noreferrer"
              >
                ODbL
              </a>
            </p>
            <p>
              {t('Standard map: OpenStreetMap. Light map:')}{' '}
              <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
                OpenFreeMap
              </a>
              {' · '}
              <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">
                OpenMapTiles
              </a>
              {'. '}
              {t('Custom maps may use other providers; their credits appear on the map.')}
            </p>
            <p>
              {t('Routing by')}{' '}
              <a href="https://openrouteservice.org/" target="_blank" rel="noreferrer">
                OpenRouteService
              </a>
              {' / '}
              <a href="https://heigit.org/" target="_blank" rel="noreferrer">
                HeiGIT
              </a>
              {t(
                ', based on OpenStreetMap data. Data licenses and provider terms apply; exporting a file does not grant additional rights to the underlying data.',
              )}
            </p>
            <h3>{t('Online requests and your data')}</h3>
            <p>
              {t(
                'Loading a map sends requests directly to its providers, which receive your IP address and the requested map area. When you calculate an automatic route, its points are sent through the Roamlet server to OpenRouteService. Manual calculations and GPX processing run on your device; your saved library is not automatically uploaded or synced.',
              )}
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
