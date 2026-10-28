import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Coordinate, Waypoint } from '../domain/types';
import { initialMapView, saveMapView } from '../domain/mapView';
import { mapTiles, OSM_TILE_URL } from '../domain/mapTiles';
import { LocateFixed, Maximize, MapPin } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import i18n, { translateMessage } from '../i18n';

interface Props {
  segments: Coordinate[][];
  waypoints: Waypoint[];
  editable: boolean;
  fitToken: number;
  onAdd: (coordinate: Coordinate) => void;
  onMove: (id: string, coordinate: Coordinate) => void;
  onError: (message: string) => void;
}
export function RouteMap(props: Props) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const latest = useRef(props);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState('');
  useEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    if (!container.current) return;
    let tiles: ReturnType<typeof mapTiles>;
    try {
      tiles = mapTiles({
        VITE_TILE_URL: import.meta.env.VITE_TILE_URL,
        VITE_TILE_ATTRIBUTION: import.meta.env.VITE_TILE_ATTRIBUTION,
        VITE_TILE_MAX_ZOOM: import.meta.env.VITE_TILE_MAX_ZOOM,
      });
    } catch (error) {
      setMapError(
        error instanceof Error
          ? error.message
          : 'Set VITE_TILE_ATTRIBUTION to the tile provider’s required credits.',
      );
      return;
    }
    let instance: maplibregl.Map;
    try {
      instance = new maplibregl.Map({
        container: container.current,
        ...initialMapView(),
        attributionControl: false,
        locale: {
          'NavigationControl.ZoomIn': i18n.t('Zoom in'),
          'NavigationControl.ZoomOut': i18n.t('Zoom out'),
          'AttributionControl.ToggleAttribution': i18n.t('Toggle attribution'),
          'Map.Title': i18n.t('Map'),
        },
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: [tiles.url],
              tileSize: 256,
              maxzoom: tiles.maxZoom,
              attribution: tiles.attribution,
            },
          },
          layers: [{ id: 'base', type: 'raster', source: 'osm' }],
        },
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
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
    instance.on('load', () => {
      instance.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      instance.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#faf7f2', 'line-width': 8, 'line-opacity': 0.95 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
      instance.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#173b30', 'line-width': 4 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
      setReady(true);
      setMapError('');
    });
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
    const source = map.current.getSource('route') as maplibregl.GeoJSONSource;
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
      element.className = `waypoint-marker ${index === 0 ? 'start' : index === props.waypoints.length - 1 ? 'finish' : ''}`;
      element.type = 'button';
      element.textContent =
        index === 0 ? 'A' : index === props.waypoints.length - 1 ? 'B' : String(index);
      const label = point.id.endsWith('-display-start')
        ? t('Track start')
        : point.id.endsWith('-display-finish')
          ? t('Track finish')
          : point.name;
      element.title = `${label}${props.editable ? t(' — drag to reposition') : ''}`;
      element.setAttribute('aria-label', element.title);
      element.addEventListener('click', (event) => event.stopPropagation());
      const marker = new maplibregl.Marker({ element, draggable: props.editable })
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
  }, [t, ready]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const coordinates = props.segments.flat().length
      ? props.segments.flat()
      : props.waypoints.map((w) => w.coordinate);
    if (!coordinates.length) return;
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((c) => bounds.extend([c[0], c[1]]));
    map.current.fitBounds(bounds, { padding: 65, maxZoom: 15, duration: 500 });
  }, [ready, props.fitToken, props.segments, props.waypoints]);
  function locate() {
    if (!navigator.geolocation) {
      props.onError(
        'Location is not supported in this browser. Search for a place or click the map instead.',
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinate: Coordinate = [position.coords.longitude, position.coords.latitude];
        map.current?.flyTo({ center: coordinate, zoom: 14 });
        if (props.editable) props.onAdd(coordinate);
      },
      () =>
        props.onError(
          'Location permission was denied or your position is unavailable. Search for a place or click the map instead.',
        ),
      { timeout: 10000 },
    );
  }
  return (
    <section className="map-region" aria-label={t('Interactive route map')}>
      <div ref={container} className="map-canvas" />
      {mapError && (
        <div className="map-warning" role="status">
          {translateMessage(mapError)}
          <button onClick={() => setMapError('')} aria-label={t('Dismiss map notice')}>
            ×
          </button>
        </div>
      )}
      {!ready && !mapError && <div className="map-loading">{t('Loading your map…')}</div>}
      <div className="map-top-label">
        <span className="live-dot" /> {t('YOUR NEXT WAY OUT')}
      </div>
      <div className="map-extra-controls">
        <button
          className="map-control"
          title={t('Use my location')}
          aria-label={t('Use my location')}
          onClick={locate}
        >
          <LocateFixed size={20} />
        </button>
        <button
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
            map.current?.fitBounds(bounds, { padding: 65, maxZoom: 15 });
          }}
          disabled={!props.waypoints.length && !props.segments.length}
        >
          <Maximize size={18} />
        </button>
      </div>
      {props.editable && (
        <div className="map-hint">
          <MapPin size={16} />
          <span>{t('Click the map to add a stop. Drag pins to refine.')}</span>
        </div>
      )}
      {(!import.meta.env.VITE_TILE_URL?.trim() ||
        import.meta.env.VITE_TILE_URL.trim() === OSM_TILE_URL) && (
        <a
          className="map-issue"
          href="https://www.openstreetmap.org/fixthemap"
          target="_blank"
          rel="noreferrer"
        >
          {t('Report a map issue ↗')}
        </a>
      )}
    </section>
  );
}
