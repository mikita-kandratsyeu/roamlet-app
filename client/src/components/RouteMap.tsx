import { Button } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Coordinate, Waypoint } from '../domain/types';
import { initialMapView, saveMapView } from '../domain/mapView';
import { mapTiles, MAPBOX_TOKEN_REQUIRED_MESSAGE, DEFAULT_MAPBOX_STYLE } from '../domain/mapTiles';
import {
  LocateFixed,
  Scan,
  MousePointer2,
  Trees,
  Map as MapIcon,
  Plus,
  Minus,
  X,
  Layers,
  LoaderCircle,
  FileUp,
} from 'lucide-react';
import { waypointKind } from './waypointStyle';
import { useTheme } from '../theme';
import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import i18n, { formatNumber, translateMessage } from '../i18n';

const mapMotionDuration = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 450;

function mapFitPadding(container: HTMLElement | null) {
  const viewport = container?.getBoundingClientRect();
  const planner = document.getElementById('route-planner')?.getBoundingClientRect();
  if (
    !viewport?.width ||
    !planner?.width ||
    planner.top >= viewport.bottom ||
    planner.bottom <= viewport.top
  )
    return 65;
  const left = Math.min(planner.right - viewport.left + 24, viewport.width - 140);
  const elevation = document.getElementById('map-elevation-root')?.getBoundingClientRect();
  const bottom = elevation?.height
    ? Math.min(viewport.bottom - elevation.top + 24, viewport.height / 2)
    : 65;
  return { top: 65, bottom: Math.max(65, bottom), left: Math.max(65, left), right: 65 };
}

interface Props {
  segments: Coordinate[][];
  waypoints: Waypoint[];
  editable: boolean;
  fitToken: number;
  onAdd: (coordinate: Coordinate) => void;
  onMove: (id: string, coordinate: Coordinate) => void;
  onError: (message: string) => void;
  onImport?: () => void;
  plannerHidden?: boolean;
}
export function RouteMap(props: Props) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const latest = useRef(props);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [configurationError, setConfigurationError] = useState(false);
  const configuredStyle = import.meta.env.VITE_MAPBOX_STYLE?.trim() || DEFAULT_MAPBOX_STYLE;
  const [style, setStyle] = useState(configuredStyle);
  const [locating, setLocating] = useState(false);
  const lastFitToken = useRef(0);
  useEffect(() => {
    const region = container.current?.parentElement;
    const workspace = region?.closest<HTMLElement>('.workspace');
    const toolbar = region?.querySelector<HTMLElement>('.map-bottom-toolbar');
    if (!region || !workspace || !toolbar) return;
    const attribution = [
      ...region.querySelectorAll<HTMLElement>(
        '.mapboxgl-ctrl-bottom-left, .mapboxgl-ctrl-bottom-right',
      ),
    ];
    const stylePicker = region.querySelector<HTMLElement>('.map-top-label');
    const reopen = workspace.querySelector<HTMLElement>('.planner-reopen');
    const measure = () => {
      const attributionHeight = Math.max(
        24,
        ...attribution.map((element) => element.getBoundingClientRect().height),
      );
      const toolbarHeight = toolbar.getBoundingClientRect().height;
      const spacing = Number.parseFloat(getComputedStyle(region).getPropertyValue('--space')) || 12;
      const pickerTop =
        reopen && window.innerWidth <= 1024
          ? reopen.getBoundingClientRect().bottom - region.getBoundingClientRect().top + 8
          : spacing;
      workspace.style.setProperty('--map-attribution-height', `${attributionHeight}px`);
      workspace.style.setProperty(
        '--map-bottom-reserved',
        `${attributionHeight + toolbarHeight + 32}px`,
      );
      workspace.style.setProperty(
        '--map-mobile-controls-bottom',
        `${attributionHeight + toolbarHeight + 24}px`,
      );
      workspace.style.setProperty('--map-style-top', `${pickerTop}px`);
      workspace.style.setProperty(
        '--map-message-top',
        `${pickerTop + (stylePicker?.getBoundingClientRect().height || 40) + 8}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    for (const element of [region, toolbar, ...attribution, stylePicker, reopen]) {
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
        '--map-message-top',
      ]) {
        workspace.style.removeProperty(property);
      }
    };
  }, [ready, props.plannerHidden, t]);
  function changeStyle(next: string) {
    if (!next || next === style) return;
    setStyle(next);
    setReady(false);
    setMapError('');
    map.current?.setStyle(next);
  }
  const styles = [
    { value: DEFAULT_MAPBOX_STYLE, label: t('Outdoors') },
    { value: 'mapbox://styles/mapbox/streets-v12', label: t('Streets') },
  ];
  if (!styles.some((item) => item.value === configuredStyle))
    styles.unshift({ value: configuredStyle, label: t('Configured map') });
  useEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    if (!container.current) return;
    let tiles: ReturnType<typeof mapTiles>;
    try {
      tiles = mapTiles({
        VITE_MAPBOX_ACCESS_TOKEN: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
        VITE_MAPBOX_STYLE: import.meta.env.VITE_MAPBOX_STYLE,
      });
    } catch (error) {
      setConfigurationError(true);
      setMapError(error instanceof Error ? error.message : MAPBOX_TOKEN_REQUIRED_MESSAGE);
      return;
    }
    let instance: mapboxgl.Map;
    try {
      instance = new mapboxgl.Map({
        container: container.current,
        ...initialMapView(),
        accessToken: tiles.accessToken,
        logoPosition: 'bottom-left',
        attributionControl: false,
        locale: {
          'NavigationControl.ZoomIn': i18n.t('Zoom in'),
          'NavigationControl.ZoomOut': i18n.t('Zoom out'),
          'AttributionControl.ToggleAttribution': i18n.t('Toggle attribution'),
          'Map.Title': i18n.t('Map'),
        },
        style: tiles.style,
      });
    } catch {
      setMapError(
        'This browser cannot render the interactive map. Enable WebGL or try another browser. GPX and saved routes remain available.',
      );
      return;
    }
    map.current = instance;
    let moved = false;
    let storageWarningShown = false;
    const persistView = () => {
      const center = instance.getCenter().wrap();
      const saved = saveMapView({
        center: [center.lng, center.lat],
        zoom: instance.getZoom(),
        bearing: instance.getBearing(),
        pitch: instance.getPitch(),
      });
      if (!saved && !storageWarningShown) {
        storageWarningShown = true;
        setMapError(
          'Your browser cannot save the last map view. The map still works, but its position may reset after reloading.',
        );
      }
    };
    instance.on('moveend', () => {
      moved = true;
      persistView();
    });
    const persistOnHide = () => {
      if (moved) persistView();
    };
    window.addEventListener('pagehide', persistOnHide);
    instance.addControl(new mapboxgl.AttributionControl({ compact: false }), 'bottom-right');
    const installRouteLayers = () => {
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
          id: 'route-line',
          type: 'line',
          source: 'route',
          paint: { 'line-color': '#286046', 'line-width': 4 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }
      setReady(true);
      setMapError('');
    };
    instance.on('load', installRouteLayers);
    instance.on('style.load', installRouteLayers);
    instance.on('error', () =>
      setMapError(
        'Some map tiles could not load. Check your connection or configured tile provider. No offline map is stored.',
      ),
    );
    instance.on('click', (event) => {
      if (latest.current.editable) latest.current.onAdd([event.lngLat.lng, event.lngLat.lat]);
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => {
      window.removeEventListener('pagehide', persistOnHide);
      observer.disconnect();
      if (moved) persistView();
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !map.current) return;
    const dark = resolvedTheme === 'dark';
    map.current.setPaintProperty('route-casing', 'line-color', dark ? '#151b18' : '#ffffff');
    map.current.setPaintProperty('route-line', 'line-color', dark ? '#9bc5a7' : '#286046');
  }, [ready, resolvedTheme]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('route') as mapboxgl.GeoJSONSource;
    source.setData({
      type: 'FeatureCollection',
      features: props.segments
        .filter((s) => s.length >= 2)
        .map((coordinates) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates },
        })),
    });
  }, [ready, props.segments]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const markers = props.waypoints.map((point, index) => {
      const element = document.createElement('button');
      element.className = `waypoint-marker ${waypointKind(index, props.waypoints.length)}`;
      element.type = 'button';
      element.textContent = formatNumber(index + 1);
      const label = point.id.endsWith('-display-start')
        ? t('Track start')
        : point.id.endsWith('-display-finish')
          ? t('Track finish')
          : point.name;
      element.title = `${label}${props.editable ? t(' — drag to reposition') : ''}`;
      element.setAttribute('aria-label', element.title);
      element.addEventListener('click', (event) => event.stopPropagation());
      const marker = new mapboxgl.Marker({ element, draggable: props.editable })
        .setLngLat([point.coordinate[0], point.coordinate[1]])
        .addTo(map.current!);
      marker.on('dragend', () => {
        const position = marker.getLngLat();
        latest.current.onMove(point.id, [position.lng, position.lat]);
      });
      return marker;
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [ready, props.waypoints, props.editable, t]);
  useEffect(() => {
    const labels = [
      ['.mapboxgl-ctrl-zoom-in', t('Zoom in')],
      ['.mapboxgl-ctrl-zoom-out', t('Zoom out')],
      ['.mapboxgl-ctrl-attrib-button', t('Toggle attribution')],
      ['.mapboxgl-canvas', t('Map')],
    ];
    for (const [selector, label] of labels) {
      const element = container.current?.querySelector(selector);
      element?.setAttribute('aria-label', label);
      element?.setAttribute('title', label);
    }
  }, [t, ready]);
  useEffect(() => {
    if (!ready || !map.current || props.fitToken === lastFitToken.current) return;
    const coordinates = props.segments.flat().length
      ? props.segments.flat()
      : props.waypoints.map((w) => w.coordinate);
    if (!coordinates.length) return;
    lastFitToken.current = props.fitToken;
    const bounds = new mapboxgl.LngLatBounds();
    coordinates.forEach((c) => bounds.extend([c[0], c[1]]));
    map.current.fitBounds(bounds, {
      padding: mapFitPadding(container.current),
      maxZoom: 15,
      duration: mapMotionDuration(),
    });
  }, [ready, props.fitToken, props.segments, props.waypoints]);
  function locate() {
    if (!navigator.geolocation) {
      props.onError(
        'Location is not supported in this browser. Enter coordinates or click the map instead.',
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const coordinate: Coordinate = [position.coords.longitude, position.coords.latitude];
        map.current?.flyTo({ center: coordinate, zoom: 14, duration: mapMotionDuration() });
      },
      () => {
        setLocating(false);
        props.onError(
          'Location permission was denied or your position is unavailable. Enter coordinates or click the map instead.',
        );
      },
      { timeout: 10000 },
    );
  }
  return (
    <section className="map-region" aria-label={t('Interactive route map')}>
      <div ref={container} className="map-canvas" />
      {mapError && (
        <Alert className="map-warning" role="status">
          <span>{translateMessage(mapError)}</span>
          {!configurationError && (
            <Button
              variant="ghost"
              onClick={() => setMapError('')}
              aria-label={t('Dismiss map notice')}
            >
              <X size={16} />
            </Button>
          )}
        </Alert>
      )}
      {!ready && !mapError && (
        <div className="map-loading" role="status">
          <Skeleton className="h-4 w-4 rounded-full" />
          {t('Loading your map…')}
        </div>
      )}
      <Badge variant="secondary" className="map-top-label">
        <Layers size={18} aria-hidden="true" />
        <select
          className="map-style-select"
          aria-label={t('Map style')}
          value={style}
          disabled={!map.current}
          onChange={(event) => changeStyle(event.target.value)}
        >
          {styles.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </Badge>

      <div className="map-extra-controls" role="group" aria-label={t('Map controls')}>
        <Button
          variant="outline"
          size="icon"
          className="map-control"
          title={t('Zoom in')}
          aria-label={t('Zoom in')}
          disabled={!ready}
          onClick={() => map.current?.zoomIn({ duration: mapMotionDuration() })}
        >
          <Plus size={20} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="map-control"
          title={t('Zoom out')}
          aria-label={t('Zoom out')}
          disabled={!ready}
          onClick={() => map.current?.zoomOut({ duration: mapMotionDuration() })}
        >
          <Minus size={20} />
        </Button>
        <Button
          variant="ghost"
          className="map-control"
          title={t('Use my location')}
          aria-label={t('Use my location')}
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
            const bounds = new mapboxgl.LngLatBounds();
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
      </div>
      <div className="map-bottom-toolbar">
        <div className="map-bottom-leading">
          {ready && props.editable && (
            <div className="map-hint">
              <MousePointer2 size={16} />
              <span>{t('Click the map to add a stop. Drag pins to refine.')}</span>
            </div>
          )}
          <ToggleGroup
            type="single"
            className="map-style-tabs"
            aria-label={t('Map style')}
            value={style}
            onValueChange={changeStyle}
            disabled={!map.current}
          >
            {styles.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                {item.value === DEFAULT_MAPBOX_STYLE && <Trees size={18} aria-hidden="true" />}
                {item.value === 'mapbox://styles/mapbox/streets-v12' && (
                  <MapIcon size={18} aria-hidden="true" />
                )}
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="map-bottom-trailing">
          {props.onImport && (
            <Button
              variant="outline"
              className="map-import"
              aria-label={t('Import GPX on map')}
              onClick={props.onImport}
            >
              <FileUp size={18} />
              {t('Import GPX')}
            </Button>
          )}

          {ready && (
            <a
              className="map-issue"
              href="https://apps.mapbox.com/feedback/"
              target="_blank"
              rel="noreferrer"
            >
              {t('Report a map issue ↗')}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
