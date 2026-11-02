import './map-controls.css';
import { lineFeatures, pointFeature, routeAnnotations } from '../domain/mapAnnotations';
import { observeSettledMapResize } from '../domain/mapResize';
import { Button } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Popover } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import type { Coordinate, Waypoint } from '../domain/types';
import { initialMapView } from '../domain/mapView';
import { mapPadding } from '../domain/mapPadding';
import { locationAccuracy } from '../domain/locationAccuracy';
import {
  loadPreferences,
  savePreferences,
  PREFERENCES_KEY,
  PREFERENCES_CHANGE_EVENT,
  type MapStyle,
  type PreferencesChangeDetail,
} from '../domain/preferences';
import { routeInsertion } from '../domain/routeInsertion';
import { installRouteLineDrag, MAP_PAN_OPTIONS } from '../lib/routeLineDrag';
import {
  mapTiles,
  MAP_STYLE_CONFIGURATION_MESSAGE,
  DEFAULT_MAP_STYLE,
  BRIGHT_MAP_STYLE,
} from '../domain/mapTiles';
import {
  LocateFixed,
  Scan,
  MousePointer2,
  Map as MapIcon,
  Sun,
  Ruler,
  Undo2,
  Redo2,
  Plus,
  Minus,
  X,
  LoaderCircle,
  RefreshCw,
  Library,
  MoreHorizontal,
} from 'lucide-react';
import { waypointKind } from './waypointStyle';
import { useTheme } from '../theme';
import { Notification } from './Notification';
import { MapLoader } from './MapLoader';
import { MapLoadingIndicator } from './MapLoadingIndicator';
import i18n, { formatNumber, translateMessage } from '../i18n';

const mapMotionDuration = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 450;

function mapFitPadding(container: HTMLElement | null) {
  const region = container?.parentElement;
  const screen = container?.closest('.editor-screen, .comparison-screen');
  const comparison = screen?.classList.contains('comparison-screen');
  return mapPadding({
    viewport: container?.getBoundingClientRect(),
    planner: screen?.querySelector('#route-planner, .comparison-screen-panel')?.getBoundingClientRect(),
    stylePicker: region?.querySelector<HTMLElement>('.map-style-picker')?.getBoundingClientRect(),
    controls: region?.querySelector<HTMLElement>('.map-extra-controls')?.getBoundingClientRect(),
    editingToolbar: region?.querySelector<HTMLElement>('.map-editing-toolbar')?.getBoundingClientRect(),
    compactPlanner: window.innerWidth <= (comparison ? 700 : 1024),
  });
}

interface Props {
  online?: boolean;
  loadingOverlayEnabled?: boolean;
  onLibrary?: () => void;
  onCheckConnection?: () => void;
  segments: Coordinate[][];
  waypoints: Waypoint[];
  editable: boolean;
  fitToken: number;
  fitSegments?: Coordinate[][];
  fitMaxZoom?: number;
  onAdd: (coordinate: Coordinate) => void;
  onMove: (id: string, coordinate: Coordinate) => void;
  onError: (message: string) => void;
  plannerHidden?: boolean;
  manualDrawing?: boolean;
  onToggleManualDrawing?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onInsert?: (coordinate: Coordinate, index: number) => void;
  selectedWaypointId?: string | null;
  onSelectWaypoint?: (id: string) => void;
  focusWaypointToken?: number;
  onRemoveWaypoint?: (id: string) => void;
  onReplaceWaypoint?: (id: string) => void;
  onStartWaypoint?: (id: string) => void;
  directSegments?: Coordinate[][];
  alternativeSegments?: Coordinate[][][];
  selectedAlternativeIndex?: number;
  elevationCoordinate?: Coordinate | null;
  highlightSegments?: Coordinate[][];
  comparisonLayers?: { segments: Coordinate[][]; color: string; dashed?: boolean }[];
  comparisonMode?: boolean;
  routeStale?: boolean;
  lockedWaypointIds?: string[];
  editingToolbar?: ReactNode;
}
export function RouteMap(props: Props) {
  const { t } = useTranslation();
  const accuracyId = useId();
  const { resolvedTheme } = useTheme();
  const { manualDrawing, editable, onUndo, onRedo, canUndo, canRedo, online = true } = props;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const locationMarker = useRef<maplibregl.Marker | null>(null);
  const focusedWaypointId = useRef<string | null>(null);
  const locationArea = useRef(locationAccuracy([0, 0], 0));
  const latest = useRef(props);
  const insertionEnabled = Boolean(props.onInsert);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState('');
  const [mapAttempt, setMapAttempt] = useState(0);
  const [configurationError, setConfigurationError] = useState(false);
  const configuredStyle = import.meta.env.VITE_MAP_STYLE?.trim() || DEFAULT_MAP_STYLE;
  const standardStyle = configuredStyle === BRIGHT_MAP_STYLE ? DEFAULT_MAP_STYLE : configuredStyle;
  const styleUrl = useCallback(
    (symbol: MapStyle) =>
      symbol === 'bright'
        ? BRIGHT_MAP_STYLE
        : symbol === 'custom'
          ? configuredStyle
          : standardStyle,
    [configuredStyle, standardStyle],
  );
  const [preferenceWarning, setPreferenceWarning] = useState('');
  const initialStyle = useRef<{ url: string; saved: boolean; missing: boolean } | null>(null);
  if (!initialStyle.current) {
    const preferences = loadPreferences();
    let saved = false;
    try {
      saved = !!localStorage.getItem(PREFERENCES_KEY);
    } catch {
      /* Defaults remain usable without storage. */
    }
    const missing =
      saved && preferences.style === 'custom' && configuredStyle === DEFAULT_MAP_STYLE;
    initialStyle.current = {
      url: missing ? DEFAULT_MAP_STYLE : saved ? styleUrl(preferences.style) : configuredStyle,
      saved,
      missing,
    };
  }
  const [style, setStyle] = useState(initialStyle.current.url);
  const activeStyle = useRef(style);
  const fallbackUsed = useRef(false);
  const lastCamera = useRef(JSON.stringify(initialMapView()));
  const suppressClickUntil = useRef(0);
  const savedStyleWarning = 'The saved map style is unavailable. The standard map is being used.';
  const [locating, setLocating] = useState(false);
  const lastFitToken = useRef(0);
  const lastFocusToken = useRef(0);
  const [bearing, setBearing] = useState(0);
  const [zoom, setZoom] = useState(10);
  const [insertionPreview, setInsertionPreview] = useState<Coordinate | null>(null);
  const [dragPreview, setDragPreview] = useState<Coordinate[] | null>(null);
  const lineDrag = useRef<ReturnType<typeof installRouteLineDrag> | null>(null);
  const markerDraggingId = useRef<string | null>(null);
  const cancelMarkerDrag = useRef<(() => void) | null>(null);
  const [routeHovered, setRouteHovered] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [compactControls, setCompactControls] = useState(
    () => window.matchMedia?.('(max-width: 700px)').matches ?? false,
  );
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 700px)');
    if (!media) return;
    const update = () => {
      setCompactControls(media.matches);
      setToolsOpen(false);
    };
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    setInsertionPreview(null);
    setRouteHovered(false);
  }, [editable]);
  useEffect(() => {
    const region = container.current?.parentElement;
    const workspace = region?.closest<HTMLElement>('.workspace');
    const toolbar = region?.querySelector<HTMLElement>('.map-bottom-toolbar');
    if (!region || !workspace || !toolbar) return;
    const attribution = [
      ...region.querySelectorAll<HTMLElement>(
        '.maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right',
      ),
    ];
    const stylePicker = region.querySelector<HTMLElement>('.map-top-label');
    const controls = region.querySelector<HTMLElement>('.map-extra-controls');
    const reopen = workspace.querySelector<HTMLElement>('.planner-reopen');
    const measure = () => {
      const attributionHeight = Math.max(
        24,
        ...attribution.map((element) => element.getBoundingClientRect().height),
      );
      const toolbarHeight = Math.max(
        toolbar.getBoundingClientRect().height,
        window.matchMedia?.('(min-width: 1025px)').matches
          ? stylePicker?.getBoundingClientRect().height || 0
          : 0,
      );
      const wrappedControlsHeight =
        window.innerWidth <= 700
          ? Math.max(0, (controls?.getBoundingClientRect().height || 44) - 44)
          : 0;
      const spacing = Number.parseFloat(getComputedStyle(region).getPropertyValue('--space')) || 12;
      const smallScreen =
        window.matchMedia?.('(max-width: 700px)').matches ?? window.innerWidth <= 700;
      const pickerTop =
        reopen && smallScreen
          ? reopen.getBoundingClientRect().bottom - region.getBoundingClientRect().top + 8
          : spacing;
      workspace.style.setProperty('--map-attribution-height', `${attributionHeight}px`);
      workspace.style.setProperty(
        '--map-bottom-reserved',
        `${attributionHeight + toolbarHeight + wrappedControlsHeight + 32}px`,
      );
      workspace.style.setProperty(
        '--map-mobile-controls-bottom',
        `${attributionHeight + toolbarHeight + 24}px`,
      );
      if (smallScreen) workspace.style.setProperty('--map-style-left', `${spacing}px`);
      else workspace.style.removeProperty('--map-style-left');
      workspace.style.setProperty('--map-style-top', `${pickerTop}px`);
      workspace.style.setProperty(
        '--map-message-top',
        `${pickerTop + (stylePicker?.getBoundingClientRect().height || 40) + 8}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    for (const element of [
      region,
      toolbar,
      ...attribution,
      stylePicker,
      controls,
      reopen,
    ]) {
      if (element) observer.observe(element);
    }
    measure();
    return () => {
      observer.disconnect();
      for (const property of [
        '--map-attribution-height',
        '--map-bottom-reserved',
        '--map-mobile-controls-bottom',
        '--map-style-top',
        '--map-style-left',
        '--map-message-top',
      ]) {
        workspace.style.removeProperty(property);
      }
    };
  }, [ready, online, props.plannerHidden, t]);
  function changeStyle(next: string) {
    if (!next || next === style) return;
    activeStyle.current = next;
    setStyle(next);
    setReady(false);
    setMapError('');
    setPreferenceWarning('');
    fallbackUsed.current = true;
    const symbol: MapStyle = next === BRIGHT_MAP_STYLE ? 'bright' : 'standard';
    savePreferences({ style: symbol });
    map.current?.setStyle(next);
  }
  const styles = [
    {
      value: style === DEFAULT_MAP_STYLE ? DEFAULT_MAP_STYLE : standardStyle,
      label: t('Standard map'),
      icon: MapIcon,
    },
    { value: BRIGHT_MAP_STYLE, label: t('Light map'), icon: Sun },
  ];
  useEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    lineDrag.current?.cancel();
  }, [props.segments, props.waypoints, props.editable, props.comparisonMode, props.routeStale, insertionEnabled]);
  useEffect(() => {
    setReady(false);
    setMapError('');
    setPreferenceWarning('');
    setLoading(online);
    lastFitToken.current = 0;
    if (!online || !container.current) return;
    let tiles: ReturnType<typeof mapTiles>;
    try {
      tiles = mapTiles({ VITE_MAP_STYLE: activeStyle.current });
      if (initialStyle.current!.missing) setPreferenceWarning(savedStyleWarning);
    } catch (error) {
      if (initialStyle.current!.saved) {
        tiles = { style: DEFAULT_MAP_STYLE };
        activeStyle.current = DEFAULT_MAP_STYLE;
        setStyle(DEFAULT_MAP_STYLE);
        fallbackUsed.current = true;
        setPreferenceWarning(savedStyleWarning);
      } else {
        setConfigurationError(true);
        setMapError(error instanceof Error ? error.message : MAP_STYLE_CONFIGURATION_MESSAGE);
        return;
      }
    }
    if (initialStyle.current!.missing || fallbackUsed.current)
      savePreferences({ style: 'standard' });
    let instance: maplibregl.Map;
    try {
      instance = new maplibregl.Map({
        container: container.current,
        ...initialMapView(),
        pitch: 0,
        maxPitch: 0,
        pitchWithRotate: false,
        touchPitch: false,
        dragPan: MAP_PAN_OPTIONS,
        doubleClickZoom: false,
        attributionControl: false,
        trackResize: false,
        locale: {
          'NavigationControl.ZoomIn': i18n.t('Zoom in'),
          'NavigationControl.ZoomOut': i18n.t('Zoom out'),
          'AttributionControl.ToggleAttribution': i18n.t('Toggle attribution'),
          'Map.Title': i18n.t('Map'),
        },
        style: tiles.style,
      });
    } catch {
      setLoading(false);
      setMapError(
        'This browser cannot render the interactive map. Enable WebGL or try another browser. GPX and saved routes remain available.',
      );
      return;
    }
    map.current = instance;
    let moved = false;
    let storageWarningShown = false;
    const persistView = () => {
      if (latest.current.comparisonMode) return;
      const center = instance.getCenter().wrap();
      const camera = {
        center: [center.lng, center.lat] as [number, number],
        zoom: instance.getZoom(),
        bearing: instance.getBearing(),
        pitch: 0,
      };
      lastCamera.current = JSON.stringify(camera);
      const saved = savePreferences({
        camera,
        style: activeStyle.current === BRIGHT_MAP_STYLE ? 'bright' : 'standard',
      });
      if (!saved && !storageWarningShown) {
        storageWarningShown = true;
        setMapError(
          'Your browser cannot save the last map view. The map still works, but its position may reset after reloading.',
        );
      }
    };
    let multiTouchGesture = false;
    let lastTouchClick: { x: number; y: number; time: number } | null = null;
    instance.on('dragstart', () => {
      suppressClickUntil.current = Infinity;
    });
    instance.on('dragend', () => {
      suppressClickUntil.current = Date.now() + 350;
    });
    const trackTouchGesture = (event: maplibregl.MapTouchEvent) => {
      if (event.originalEvent.touches.length < 2) return;
      if (!multiTouchGesture) {
        lineDrag.current?.cancel();
        cancelMarkerDrag.current?.();
      }
      multiTouchGesture = true;
      suppressClickUntil.current = Infinity;
    };
    const endTouchGesture = (event: maplibregl.MapTouchEvent) => {
      if (event.originalEvent.touches.length) return;
      if (multiTouchGesture || event.type === 'touchcancel')
        suppressClickUntil.current = Date.now() + 350;
      multiTouchGesture = false;
    };
    instance.on('touchstart', trackTouchGesture);
    instance.on('touchmove', trackTouchGesture);
    instance.on('touchend', endTouchGesture);
    instance.on('touchcancel', endTouchGesture);
    const preferencesChanged = (event: Event) => {
      const detail = (event as CustomEvent<PreferencesChangeDetail>).detail;
      if (detail?.reset) {
        setPreferenceWarning('');
        setMapError('');
      }
      const preferences = loadPreferences();
      const next = styleUrl(preferences.style);
      if (
        (!detail || detail.reset || detail.patch?.style !== undefined) &&
        next !== activeStyle.current
      ) {
        activeStyle.current = next;
        setStyle(next);
        setReady(false);
        instance.setStyle(next);
      }
      const flatCamera = { ...preferences.camera, pitch: 0 };
      const camera = JSON.stringify(flatCamera);
      if (
        !latest.current.comparisonMode &&
        (!detail || detail.reset || detail.patch?.camera !== undefined) &&
        camera !== lastCamera.current
      ) {
        lastCamera.current = camera;
        instance.jumpTo(flatCamera);
      }
    };
    window.addEventListener(PREFERENCES_CHANGE_EVENT, preferencesChanged);
    instance.on('moveend', () => {
      moved = true;
      persistView();
    });
    const persistOnHide = () => {
      if (moved) persistView();
    };
    window.addEventListener('pagehide', persistOnHide);
    instance.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
    if (maplibregl.ScaleControl) {
      instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    }
    const updateCameraControls = () => {
      setBearing(instance.getBearing());
      setZoom(instance.getZoom());
    };
    updateCameraControls();
    instance.on('rotate', updateCameraControls);
    instance.on('zoomend', updateCameraControls);
    const installRouteLayers = () => {
      lineDrag.current?.cancel();
      cancelMarkerDrag.current?.();
      if (!instance.getSource('location-accuracy')) {
        instance.addSource('location-accuracy', {
          type: 'geojson',
          data: locationArea.current,
        });
        instance.addLayer({
          id: 'location-accuracy-fill',
          type: 'fill',
          source: 'location-accuracy',
          paint: { 'fill-color': '#2684ff', 'fill-opacity': 0.16 },
        });
      }
      if (!instance.getSource('route')) {
        instance.addSource('route', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        instance.addLayer({
          id: 'route-casing',
          type: 'line',
          source: 'route',
          paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.95 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        instance.addLayer({
          id: 'route-hit',
          type: 'line',
          source: 'route',
          paint: { 'line-width': 28, 'line-opacity': 0 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        instance.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          paint: { 'line-color': '#286046', 'line-width': 4 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }
      const empty = { type: 'FeatureCollection' as const, features: [] };
      for (const id of [
        'route-alternatives',
        'route-direct',
        'route-annotations',
        'route-insertion',
        'route-drag-preview',
        'route-elevation',
        'route-highlight',
        'route-comparison',
      ]) {
        if (!instance.getSource(id)) instance.addSource(id, { type: 'geojson', data: empty });
      }
      if (!instance.getLayer?.('route-comparison-line')) {
        instance.addLayer({
          id: 'route-comparison-casing',
          type: 'line',
          source: 'route-comparison',
          paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.85 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        instance.addLayer({
          id: 'route-comparison-line',
          type: 'line',
          source: 'route-comparison',
          filter: ['!=', ['get', 'direct'], true],
          paint: { 'line-color': ['get', 'color'], 'line-width': 4 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        instance.addLayer({
          id: 'route-comparison-direct-line',
          type: 'line',
          source: 'route-comparison',
          filter: ['==', ['get', 'direct'], true],
          paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-dasharray': [2, 2] },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        instance.addLayer({
          id: 'route-highlight-line',
          type: 'line',
          source: 'route-highlight',
          paint: { 'line-color': '#ab43c0', 'line-width': 8, 'line-opacity': 0.85 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }
      if (!instance.getLayer?.('route-alternatives-line')) {
        instance.addLayer(
          {
            id: 'route-alternatives-line',
            type: 'line',
            source: 'route-alternatives',
            paint: { 'line-color': '#77857d', 'line-width': 3, 'line-opacity': 0.35 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          },
          'route-casing',
        );
        instance.addLayer({
          id: 'route-direct-line',
          type: 'line',
          source: 'route-direct',
          paint: { 'line-color': '#bc6a20', 'line-width': 4, 'line-dasharray': [2, 2] },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        instance.addLayer(
          {
            id: 'route-hover',
            type: 'line',
            source: 'route',
            paint: { 'line-color': '#52a87a', 'line-width': 14, 'line-opacity': 0 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          },
          'route-line',
        );
        instance.addLayer({
          id: 'route-drag-preview-line',
          type: 'line',
          source: 'route-drag-preview',
          paint: { 'line-color': '#bc6a20', 'line-width': 4, 'line-dasharray': [2, 2] },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        instance.addLayer({
          id: 'route-directions',
          type: 'symbol',
          source: 'route-annotations',
          filter: ['==', ['get', 'kind'], 'direction'],
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 20,
            'text-rotate': ['get', 'bearing'],
            'text-rotation-alignment': 'map',
            'text-keep-upright': false,
          },
          paint: { 'text-color': '#286046', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
        });
        instance.addLayer({
          id: 'route-kilometers',
          type: 'symbol',
          source: 'route-annotations',
          filter: ['==', ['get', 'kind'], 'kilometer'],
          layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.4] },
          paint: { 'text-color': '#286046', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
        });
        for (const [id, color] of [
          ['route-insertion', '#bc6a20'],
          ['route-elevation', '#ab43c0'],
        ]) {
          instance.addLayer({
            id: `${id}-point`,
            type: 'circle',
            source: id,
            paint: {
              'circle-radius': 7,
              'circle-color': color,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 3,
            },
          });
        }
      }
      setReady(true);
      setMapError('');
    };
    const fallbackSavedStyle = () => {
      if (
        !initialStyle.current!.saved ||
        activeStyle.current === DEFAULT_MAP_STYLE ||
        fallbackUsed.current
      )
        return false;
      fallbackUsed.current = true;
      activeStyle.current = DEFAULT_MAP_STYLE;
      setStyle(DEFAULT_MAP_STYLE);
      setReady(false);
      setPreferenceWarning(savedStyleWarning);
      savePreferences({ style: 'standard' });
      instance.setStyle(DEFAULT_MAP_STYLE);
      return true;
    };
    const timeout = window.setTimeout(() => {
      setLoading(false);
      if (!fallbackSavedStyle())
        setMapError('The map took too long to load. Check your connection and reload the page.');
    }, 30000);
    instance.on('load', () => {
      installRouteLayers();
      window.clearTimeout(timeout);
      setLoading(false);
    });
    instance.on('style.load', installRouteLayers);
    instance.on('error', () => {
      window.clearTimeout(timeout);
      setLoading(false);
      if (fallbackSavedStyle()) return;
      setMapError(
        'Some map tiles could not load. Check your connection or configured tile provider. No offline map is stored.',
      );
    });
    instance.on('click', (event) => {
      const current = latest.current;
      if (
        !current.editable ||
        multiTouchGesture ||
        (event.originalEvent?.detail ?? 0) > 1 ||
        Date.now() < suppressClickUntil.current ||
        (event.originalEvent?.target instanceof Element &&
          event.originalEvent.target.closest('.waypoint-marker'))
      )
        return;
      if (event.point && event.originalEvent?.type.startsWith('touch')) {
        const now = Date.now();
        if (lastTouchClick && now - lastTouchClick.time < 350 &&
          Math.hypot(event.point.x - lastTouchClick.x, event.point.y - lastTouchClick.y) < 8) return;
        lastTouchClick = { x: event.point.x, y: event.point.y, time: now };
      }
      const coordinate: Coordinate = [event.lngLat.lng, event.lngLat.lat];
      if (
        current.onInsert &&
        event.point &&
        instance.queryRenderedFeatures(event.point, { layers: ['route-hit'] }).length
      ) {
        const insertion = routeInsertion(coordinate, current.segments, current.waypoints);
        if (insertion) current.onInsert(insertion.coordinate, insertion.index);
        return;
      }
      if (
        event.point &&
        current.alternativeSegments?.length &&
        instance.queryRenderedFeatures(event.point, { layers: ['route-alternatives-line'] }).length
      )
        return;
      current.onAdd(coordinate);
    });
    const clearHover = () => {
      if (lineDrag.current?.isActive() || markerDraggingId.current) return;
      setRouteHovered(false);
      setInsertionPreview(null);
      instance.getCanvas().style.cursor =
        latest.current.manualDrawing && latest.current.editable ? 'crosshair' : '';
    };
    instance.on('mousemove', (event) => {
      if (lineDrag.current?.isActive() || markerDraggingId.current) return;
      const current = latest.current;
      if (
        !current.editable ||
        !event.point ||
        !instance.queryRenderedFeatures(event.point, { layers: ['route-hit'] }).length
      ) {
        clearHover();
        return;
      }
      setRouteHovered(true);
      instance.getCanvas().style.cursor = current.onInsert ? 'grab' : 'pointer';
      const insertion = current.onInsert
        ? routeInsertion([event.lngLat.lng, event.lngLat.lat], current.segments, current.waypoints)
        : null;
      setInsertionPreview(insertion?.coordinate ?? null);
    });
    const canvas = instance.getCanvas();
    const drag = installRouteLineDrag(instance, () => latest.current, (coordinates) => {
      setDragPreview(coordinates);
      setInsertionPreview(coordinates?.[1] ?? null);
      setRouteHovered(false);
      if (!coordinates) canvas.style.cursor =
        latest.current.manualDrawing && latest.current.editable ? 'crosshair' : '';
    }, (until) => { suppressClickUntil.current = until; });
    lineDrag.current = drag;
    canvas.addEventListener('mouseleave', clearHover);
    const stopObservingResize = observeSettledMapResize(container.current, () => instance.resize());
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('pagehide', persistOnHide);
      window.removeEventListener(PREFERENCES_CHANGE_EVENT, preferencesChanged);
      stopObservingResize();
      drag.destroy();
      cancelMarkerDrag.current?.();
      lineDrag.current = null;
      canvas.removeEventListener('mouseleave', clearHover);
      if (moved) persistView();
      locationMarker.current?.remove();
      locationMarker.current = null;
      locationArea.current = locationAccuracy([0, 0], 0);
      setLocating(false);
      setAccuracy(null);
      setInsertionPreview(null);
      setRouteHovered(false);
      instance.remove();
      map.current = null;
    };
  }, [mapAttempt, styleUrl, online]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const dark = resolvedTheme === 'dark';
    map.current.setPaintProperty('route-casing', 'line-color', dark ? '#151b18' : '#ffffff');
    map.current.setPaintProperty('route-line', 'line-color', dark ? '#9bc5a7' : '#286046');
  }, [ready, resolvedTheme]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('route') as maplibregl.GeoJSONSource | undefined;
    source?.setData(lineFeatures(props.segments));
  }, [ready, props.segments]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('route-direct') as maplibregl.GeoJSONSource | undefined;
    source?.setData(lineFeatures(props.directSegments ?? []));
  }, [ready, props.directSegments]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('route-alternatives') as maplibregl.GeoJSONSource | undefined;
    source?.setData(
      lineFeatures(
        (props.alternativeSegments ?? []).flatMap((segments, index) =>
          index === (props.selectedAlternativeIndex ?? 0) ? [] : segments,
        ),
      ),
    );
  }, [ready, props.alternativeSegments, props.selectedAlternativeIndex]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('route-annotations') as maplibregl.GeoJSONSource | undefined;
    source?.setData(routeAnnotations(props.segments, zoom));
  }, [ready, props.segments, zoom]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('route-insertion') as maplibregl.GeoJSONSource | undefined;
    source?.setData(pointFeature(insertionPreview));
  }, [ready, insertionPreview]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('route-drag-preview') as maplibregl.GeoJSONSource | undefined;
    source?.setData(lineFeatures(dragPreview ? [dragPreview] : []));
  }, [ready, dragPreview]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('route-elevation') as maplibregl.GeoJSONSource | undefined;
    source?.setData(pointFeature(props.elevationCoordinate));
  }, [ready, props.elevationCoordinate]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('route-highlight') as maplibregl.GeoJSONSource | undefined;
    source?.setData(lineFeatures(props.routeStale ? [] : (props.highlightSegments ?? [])));
  }, [ready, props.highlightSegments, props.routeStale]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('route-comparison') as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: (props.comparisonLayers ?? []).flatMap(({ segments, color, dashed }) =>
        segments
          .filter((segment) => segment.length >= 2)
          .map((coordinates) => ({
            type: 'Feature' as const,
            properties: { color, direct: dashed ?? false },
            geometry: { type: 'LineString' as const, coordinates },
          })),
      ),
    });
  }, [ready, props.comparisonLayers]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const opacity = props.comparisonMode ? 0 : props.routeStale ? 0.4 : 1;
    instance.setPaintProperty('route-line', 'line-opacity', opacity);
    instance.setPaintProperty('route-casing', 'line-opacity', opacity * 0.95);
    instance.setPaintProperty('route-direct-line', 'line-opacity', opacity);
    instance.setPaintProperty('route-directions', 'text-opacity', opacity);
    instance.setPaintProperty('route-kilometers', 'text-opacity', opacity);
  }, [ready, props.comparisonMode, props.routeStale]);
  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.setPaintProperty('route-hover', 'line-opacity', routeHovered && editable ? 0.25 : 0);
  }, [ready, routeHovered, editable]);
  useEffect(() => {
    setInsertionPreview(null);
    setRouteHovered(false);
  }, [props.segments]);
  useEffect(() => {
    if (
      !ready ||
      !map.current ||
      props.focusWaypointToken === undefined ||
      props.focusWaypointToken === lastFocusToken.current
    )
      return;
    lastFocusToken.current = props.focusWaypointToken;
    const point = props.waypoints.find((waypoint) => waypoint.id === props.selectedWaypointId);
    if (point)
      map.current.flyTo({
        center: [point.coordinate[0], point.coordinate[1]],
        duration: mapMotionDuration(),
      });
  }, [ready, props.focusWaypointToken, props.selectedWaypointId, props.waypoints]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const clearMarkerPreview = () => {
      markerDraggingId.current = null;
      cancelMarkerDrag.current = null;
      setDragPreview(null);
      setInsertionPreview(null);
      setRouteHovered(false);
      suppressClickUntil.current = Date.now() + 250;
      if (map.current) map.current.getCanvas().style.cursor =
        latest.current.manualDrawing && latest.current.editable ? 'crosshair' : '';
    };
    const markers = props.waypoints.map((point, index) => {
      const element = document.createElement('button');
      const selected = point.id === props.selectedWaypointId;
      element.className = `waypoint-marker ${waypointKind(index, props.waypoints.length)}${selected ? ' waypoint-marker-selected' : ''}`;
      element.setAttribute('aria-pressed', String(selected));
      element.type = 'button';
      element.dataset.waypointId = point.id;
      element.textContent = formatNumber(index + 1);
      const label = point.id.endsWith('-display-start')
        ? t('Track start')
        : point.id.endsWith('-display-finish')
          ? t('Track finish')
          : point.name;
      const draggable = props.editable && !props.lockedWaypointIds?.includes(point.id);
      element.title = `${label}${draggable ? t(' — drag to reposition') : ''}`;
      element.setAttribute('aria-label', element.title);
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        if (Date.now() < suppressClickUntil.current) return;
        latest.current.onSelectWaypoint?.(point.id);
      });
      const marker = new maplibregl.Marker({ element, draggable })
        .setLngLat([point.coordinate[0], point.coordinate[1]])
        .addTo(map.current!);
      if (focusedWaypointId.current === point.id) {
        element.focus({ preventScroll: true });
        focusedWaypointId.current = null;
      }
      let cancelled = false;
      const previewMarker = () => {
        if (cancelled || markerDraggingId.current !== point.id) return;
        const current = latest.current;
        const index = current.waypoints.findIndex((candidate) => candidate.id === point.id);
        const position = marker.getLngLat();
        const coordinate: Coordinate = [position.lng, position.lat];
        const previous = current.waypoints[index - 1];
        const next = current.waypoints[index + 1];
        const coordinates = [...(previous ? [previous.coordinate] : []), coordinate,
          ...(next ? [next.coordinate] : [])];
        setDragPreview(coordinates.length >= 2 ? coordinates : null);
        setInsertionPreview(coordinate);
        setRouteHovered(false);
      };
      marker.on('dragstart', () => {
        if (!draggable) return;
        lineDrag.current?.cancel();
        cancelled = false;
        element.classList.add('waypoint-marker-dragging');
        markerDraggingId.current = point.id;
        cancelMarkerDrag.current = () => {
          cancelled = true;
          element.classList.remove('waypoint-marker-dragging');
          marker.setLngLat([point.coordinate[0], point.coordinate[1]]);
          clearMarkerPreview();
        };
        suppressClickUntil.current = Infinity;
        map.current!.getCanvas().style.cursor = 'grabbing';
        previewMarker();
      });
      marker.on('drag', previewMarker);
      marker.on('dragend', () => {
        element.classList.remove('waypoint-marker-dragging');
        if (markerDraggingId.current === point.id) clearMarkerPreview();
        suppressClickUntil.current = Date.now() + 250;
        if (cancelled) {
          marker.setLngLat([point.coordinate[0], point.coordinate[1]]);
          return;
        }
        if (!latest.current.editable || latest.current.lockedWaypointIds?.includes(point.id)) return;
        const position = marker.getLngLat();
        latest.current.onMove(point.id, [position.lng, position.lat]);
      });
      return marker;
    });
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !cancelMarkerDrag.current) return;
      cancelMarkerDrag.current();
      event.preventDefault();
      event.stopPropagation();
    };
    const cancelOnBlur = () => cancelMarkerDrag.current?.();
    window.addEventListener('keydown', cancelOnEscape, true);
    window.addEventListener('blur', cancelOnBlur);
    return () => {
      cancelMarkerDrag.current?.();
      window.removeEventListener('keydown', cancelOnEscape, true);
      window.removeEventListener('blur', cancelOnBlur);
      const active = document.activeElement;
      focusedWaypointId.current =
        active instanceof HTMLElement && active.classList.contains('waypoint-marker')
          ? (active.dataset.waypointId ?? null)
          : null;
      markers.forEach((marker) => marker.remove());
    };
  }, [ready, props.waypoints, props.editable, props.lockedWaypointIds, props.selectedWaypointId, t]);
  useEffect(() => {
    const labels = [
      ['.maplibregl-ctrl-zoom-in', t('Zoom in')],
      ['.maplibregl-ctrl-zoom-out', t('Zoom out')],
      ['.maplibregl-ctrl-attrib-button', t('Toggle attribution')],
      ['.maplibregl-canvas', t('Map')],
    ];
    for (const [selector, label] of labels) {
      const element = container.current?.querySelector(selector);
      element?.setAttribute('aria-label', label);
      element?.setAttribute('title', label);
    }
    const scale = container.current?.querySelector('.maplibregl-ctrl-scale');
    if (scale) {
      scale.setAttribute('role', 'img');
      scale.setAttribute('aria-label', `${t('Map scale')}: ${scale.textContent}`);
    }
  }, [t, ready, zoom]);
  useEffect(() => {
    if (!ready || !map.current || props.fitToken === lastFitToken.current) return;
    const segments = props.fitSegments ?? props.segments;
    const coordinates = segments.flat().length
      ? segments.flat()
      : props.waypoints.map((w) => w.coordinate);
    if (!coordinates.length) return;
    lastFitToken.current = props.fitToken;
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((c) => bounds.extend([c[0], c[1]]));
    map.current.resize();
    map.current.fitBounds(bounds, {
      padding: mapFitPadding(container.current),
      maxZoom: props.fitMaxZoom ?? 15,
      duration: mapMotionDuration(),
    });
  }, [ready, props.fitToken, props.fitSegments, props.fitMaxZoom, props.segments, props.waypoints]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const canvas = map.current.getCanvas();
    canvas.style.cursor = manualDrawing && editable ? 'crosshair' : '';
    const undo = (event: KeyboardEvent) => {
      if (!editable || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const redo = (key === 'z' && event.shiftKey) || key === 'y';
      const action = redo
        ? canRedo !== false
          ? onRedo
          : undefined
        : key === 'z' && canUndo !== false
          ? onUndo
          : undefined;
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        action();
      }
    };
    canvas.addEventListener('keydown', undo);
    return () => {
      canvas.style.cursor = '';
      canvas.removeEventListener('keydown', undo);
    };
  }, [ready, manualDrawing, editable, onUndo, onRedo, canUndo, canRedo]);
  function locate() {
    if (!navigator.geolocation) {
      props.onError(
        'Location is not supported in this browser. Enter coordinates or click the map instead.',
      );
      return;
    }
    const instance = map.current;
    if (!instance) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (map.current !== instance) return;
        setLocating(false);
        const coordinate: Coordinate = [position.coords.longitude, position.coords.latitude];
        if (!locationMarker.current) {
          const element = document.createElement('div');
          element.className = 'user-location-marker';
          locationMarker.current = new maplibregl.Marker({ element });
        }
        locationMarker.current.setLngLat(coordinate).addTo(instance);
        locationArea.current = locationAccuracy(coordinate, position.coords.accuracy);
        const source = instance.getSource('location-accuracy') as
          maplibregl.GeoJSONSource | undefined;
        source?.setData(locationArea.current);
        const reportedAccuracy = position.coords.accuracy;
        setAccuracy(
          Number.isFinite(reportedAccuracy) && reportedAccuracy > 0 ? reportedAccuracy : null,
        );
        const ring = locationArea.current.features[0]?.geometry.coordinates[0];
        if (ring?.length) {
          const bounds = new maplibregl.LngLatBounds();
          ring.forEach((point) => bounds.extend([point[0], point[1]]));
          instance.fitBounds(bounds, {
            padding: mapFitPadding(container.current),
            maxZoom: 16,
            duration: mapMotionDuration(),
          });
        } else {
          instance.flyTo({ center: coordinate, duration: mapMotionDuration() });
        }
      },
      (error) => {
        if (map.current !== instance) return;
        setLocating(false);
        latest.current.onError(
          error.code === 1
            ? 'Location permission was denied. Enable location access in your browser settings.'
            : error.code === 3
              ? 'Location request timed out. Try again.'
              : 'Your position is unavailable. Enter coordinates or click the map instead.',
        );
      },
      { timeout: 10000 },
    );
  }

  if (!online) {
    return (
      <section className="map-region map-offline" aria-label={t('Interactive route map')}>
        <div className="offline-map-content" role="status">
          <MapIcon size={44} strokeWidth={1.25} aria-hidden="true" />
          <h2>{t('Map unavailable offline')}</h2>
          <p>
            {t(
              'Roamlet does not download map regions. Connect to the internet to see the map and calculate routes again.',
            )}
          </p>
          <div className="offline-map-actions">
            <Button variant="outline" onClick={props.onCheckConnection}>
              <RefreshCw size={18} aria-hidden="true" />
              {t('Retry map')}
            </Button>
            {props.onLibrary && (
              <Button onClick={props.onLibrary}>
                <Library size={18} aria-hidden="true" />
                {t('My routes')}
              </Button>
            )}
          </div>
          <small>
            {t(
              'Open and export local routes without an online map. Elevation is available only when saved in the route or GPX. No offline map is stored.',
            )}
          </small>
        </div>
      </section>
    );
  }
  const navigationControls = (
    <>
      <Button
        variant="outline"
        size="icon"
        className="map-control map-north-control"
        title={t('Reset north')}
        aria-label={t('Reset north')}
        disabled={!ready}
        onClick={() => map.current?.easeTo?.({ bearing: 0, duration: mapMotionDuration() })}
      >
        <span className="map-compass" aria-hidden="true">
          <small className="map-compass-label">N</small>
          <svg
            className="map-compass-needle size-6"
            viewBox="0 0 24 24"
            fill="none"
            focusable="false"
            style={{ transform: `rotate(${-bearing}deg)` }}
          >
            <path className="map-compass-south" d="M12 22 7 12h10Z" />
            <path className="map-compass-north" d="M12 2 7 12h10Z" />
            <path className="map-compass-facet" d="M12 2v10h5Z" />
            <circle className="map-compass-pivot" cx="12" cy="12" r="1.5" />
          </svg>
        </span>
        {compactControls && <span>{t('Reset north')}</span>}
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="map-control map-zoom-in"
        title={t('Zoom in')}
        aria-label={t('Zoom in')}
        disabled={!ready}
        onClick={() => map.current?.zoomIn({ duration: mapMotionDuration() })}
      >
        <Plus size={20} aria-hidden="true" />
        {compactControls && <span>{t('Zoom in')}</span>}
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="map-control map-zoom-out"
        title={t('Zoom out')}
        aria-label={t('Zoom out')}
        disabled={!ready}
        onClick={() => map.current?.zoomOut({ duration: mapMotionDuration() })}
      >
        <Minus size={20} aria-hidden="true" />
        {compactControls && <span>{t('Zoom out')}</span>}
      </Button>
    </>
  );
  const editingControls = props.comparisonMode ? null : (
    <>
      <Button
        variant={props.manualDrawing ? 'default' : 'outline'}
        size="icon"
        className="map-control map-manual-tool"
        aria-label={t('Manual drawing')}
        title={t('Manual drawing')}
        aria-pressed={Boolean(props.manualDrawing)}
        disabled={!props.onToggleManualDrawing}
        onClick={props.onToggleManualDrawing}
      >
        <Ruler size={20} aria-hidden="true" />
        {compactControls && <span>{t('Manual drawing')}</span>}
      </Button>
      {props.editable && (props.onUndo || props.canUndo !== undefined) && (
        <Button
          className="map-control map-undo-tool"
          variant="outline"
          size="icon"
          aria-label={t(
            props.manualDrawing && props.canUndo === undefined ? 'Undo last point' : 'Undo',
          )}
          title={t(props.manualDrawing && props.canUndo === undefined ? 'Undo last point' : 'Undo')}
          disabled={!props.onUndo || props.canUndo === false}
          onClick={props.onUndo}
        >
          <Undo2 size={18} aria-hidden="true" />
          {compactControls && (
            <span>
              {t(props.manualDrawing && props.canUndo === undefined ? 'Undo last point' : 'Undo')}
            </span>
          )}
        </Button>
      )}
      {props.editable && (props.onRedo || props.canRedo !== undefined) && (
        <Button
          className="map-control map-redo-tool"
          variant="outline"
          size="icon"
          aria-label={t('Redo')}
          title={t('Redo')}
          disabled={!props.onRedo || props.canRedo === false}
          onClick={props.onRedo}
        >
          <Redo2 size={18} aria-hidden="true" />
          {compactControls && <span>{t('Redo')}</span>}
        </Button>
      )}
    </>
  );
  return (
    <section className="map-region" aria-label={t('Interactive route map')}>
      <div ref={container} className="map-canvas" />
      {ready && accuracy !== null && (
        <span id={accuracyId} className="sr-only" role="status">
          {t('Location accuracy: ±{{meters}} m', { meters: formatNumber(Math.round(accuracy)) })}
        </span>
      )}
      {(mapError || preferenceWarning) && (
        <Notification
          title={t(mapError ? 'Map error' : 'Notification')}
          message={translateMessage(mapError || preferenceWarning)}
          variant={mapError ? 'error' : 'warning'}
          dismissible={!configurationError}
          onDismiss={() => {
            setMapError('');
            setPreferenceWarning('');
          }}
          actions={
            mapError &&
            !configurationError && (
              <Button
                variant="outline"
                onClick={() => {
                  setMapError('');
                  setReady(false);
                  if (map.current) map.current.setStyle(activeStyle.current);
                  else {
                    setLoading(true);
                    setMapAttempt((attempt) => attempt + 1);
                  }
                }}
              >
                {t('Retry map')}
              </Button>
            )
          }
        />
      )}
      {loading &&
        props.loadingOverlayEnabled !== false &&
        !mapError &&
        (props.comparisonMode ? (
          <div
            className="comparison-map-loading map-loading-surface"
            role="status"
            aria-busy="true"
          >
            <MapLoadingIndicator />
            <span>{t('Loading your map…')}</span>
          </div>
        ) : (
          <MapLoader />
        ))}
      {!props.comparisonMode && (
        <ToggleGroup
          type="single"
          className="map-style-picker map-top-label"
          aria-label={t('Map style')}
          value={style}
          onValueChange={changeStyle}
          disabled={!map.current}
        >
          {styles.map((item) => (
            <ToggleGroupItem
              key={item.value}
              value={item.value}
              className="map-style-option"
              aria-label={item.label}
              title={item.label}
            >
              <item.icon size={20} aria-hidden="true" />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      <div className="map-extra-controls" role="group" aria-label={t('Map controls')}>
        {!compactControls && navigationControls}
        <Button
          variant="ghost"
          className="map-control"
          title={t('Use my location')}
          aria-label={t('Use my location')}
          aria-describedby={accuracy !== null ? accuracyId : undefined}
          disabled={!ready || locating}
          onClick={locate}
        >
          {locating ? <LoaderCircle size={20} className="spin" /> : <LocateFixed size={20} />}
        </Button>
        <Button
          variant="ghost"
          className="map-control"
          title={t('Fit route')}
          aria-label={t('Fit route')}
          onClick={() => {
            const coordinates = props.segments.flat().length
              ? props.segments.flat()
              : props.waypoints.map((w) => w.coordinate);
            if (!coordinates.length) return;
            const bounds = new maplibregl.LngLatBounds();
            coordinates.forEach((c) => bounds.extend([c[0], c[1]]));
            map.current?.fitBounds(bounds, {
              padding: mapFitPadding(container.current),
              maxZoom: 15,
              duration: mapMotionDuration(),
            });
          }}
          disabled={!ready || (!props.waypoints.length && !props.segments.length)}
        >
          <Scan size={18} />
        </Button>
        {!compactControls && editingControls}
        <Popover.Root open={toolsOpen} onOpenChange={setToolsOpen}>
          <Popover.Trigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="map-control map-tools-trigger"
              aria-label={t('More map tools')}
              title={t('More map tools')}
            >
              <MoreHorizontal size={20} aria-hidden="true" />
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="map-tools-panel"
              side="top"
              align="end"
              sideOffset={8}
              collisionPadding={12}
              aria-label={t('Map controls')}
            >
              <div className="map-tools-heading">
                <strong>{t('Map controls')}</strong>
                <Popover.Close asChild>
                  <Button variant="ghost" size="icon" aria-label={t('Close map tools')}>
                    <X size={18} aria-hidden="true" />
                  </Button>
                </Popover.Close>
              </div>
              {compactControls && navigationControls}
              {compactControls && editingControls}
              {ready && (
                <a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">
                  {t('Report a map issue ↗')}
                </a>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <div className={`map-bottom-toolbar${props.editingToolbar ? ' map-editing-toolbar' : ''}`}>
        {props.editingToolbar ?? <div className="map-bottom-leading">
          {ready && props.editable && (
            <div className="map-drawing-tools">
              <div className="map-hint">
                <MousePointer2 size={16} aria-hidden="true" />
                <span>
                  {dragPreview
                    ? t('Preview only — release to apply. Escape cancels.')
                    : props.manualDrawing
                      ? t('Click to draw straight lines. Drag points to adjust.')
                      : t('Click the map to add a stop. Drag pins to refine.')}
                </span>
              </div>
            </div>
          )}
        </div>}
      </div>
    </section>
  );
}
