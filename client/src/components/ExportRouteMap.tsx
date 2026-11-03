import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapTiles } from '../domain/mapTiles';
import { lineFeatures } from '../domain/mapAnnotations';
import type { Coordinate } from '../domain/types';

export function ExportRouteMap({ segments }: { segments: Coordinate[][] }) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const geometry = useMemo(() => {
    let previousLongitude: number | undefined;
    const unwrapped = segments.map((segment) => segment.map((point): Coordinate => {
      let longitude = point[0];
      if (previousLongitude !== undefined) {
        longitude += 360 * Math.round((previousLongitude - longitude) / 360);
      }
      previousLongitude = longitude;
      return [longitude, point[1]];
    }));
    const points = unwrapped.flat();
    if (!points.length) return null;
    const projected = unwrapped.map((segment) => segment.map(([longitude, latitude]) => {
      const radians = Math.max(-85.051129, Math.min(85.051129, latitude)) * Math.PI / 180;
      return [longitude / 360, -Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI)];
    }));
    const all = projected.flat();
    const bounds = new maplibregl.LngLatBounds();
    for (const point of points) bounds.extend([point[0], point[1]]);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of all) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const scale = Math.min(536 / Math.max(maxX - minX, 1e-8), 136 / Math.max(maxY - minY, 1e-8));
    const preview = projected.map((segment) => segment.map(([x, y]) => [
      300 + (x - (minX + maxX) / 2) * scale,
      100 + (y - (minY + maxY) / 2) * scale,
    ]));
    return { segments: unwrapped, points, bounds, preview, endpoints: [all[0], all[all.length - 1]].map(([x, y]) => [
      300 + (x - (minX + maxX) / 2) * scale,
      100 + (y - (minY + maxY) / 2) * scale,
    ]) };
  }, [segments]);

  useEffect(() => {
    setReady(false);
    if (!container.current || !geometry) return;
    let map: maplibregl.Map | undefined;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      map?.remove();
    };
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: mapTiles({ VITE_MAP_STYLE: import.meta.env.VITE_MAP_STYLE }).style,
        center: [geometry.points[0][0], geometry.points[0][1]],
        zoom: 12,
        interactive: false,
        attributionControl: false,
      });
      map.getCanvas().removeAttribute('tabindex');
      map.addControl(new maplibregl.AttributionControl({ compact: false }));
      const fit = () => map?.fitBounds(geometry.bounds, { padding: 32, maxZoom: 15, duration: 0 });
      fit();
      map.on('load', () => {
        if (disposed || !map) return;
        map.addSource('export-route', { type: 'geojson', data: lineFeatures(geometry.segments) });
        map.addLayer({ id: 'export-route-outline', type: 'line', source: 'export-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 7 } });
        map.addLayer({ id: 'export-route-line', type: 'line', source: 'export-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#26745b', 'line-width': 4 } });
        map.addSource('export-endpoints', { type: 'geojson', data: {
          type: 'FeatureCollection', features: [geometry.points[0], geometry.points[geometry.points.length - 1]].map((coordinates, index) => ({
            type: 'Feature', properties: { finish: index === 1 }, geometry: { type: 'Point', coordinates },
          })),
        } });
        map.addLayer({ id: 'export-endpoints', type: 'circle', source: 'export-endpoints',
          paint: { 'circle-radius': 5, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
            'circle-color': ['case', ['get', 'finish'], '#c75146', '#26745b'] } });
      });
      map.on('idle', () => { if (!disposed) setReady(true); });
      map.on('error', () => { if (!disposed) { setReady(false); dispose(); } });
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => { if (!disposed) { map?.resize(); fit(); } });
        observer.observe(container.current);
      }
    } catch {
      dispose();
    }
    return dispose;
  }, [geometry]);

  if (!geometry) return null;
  return (
    <figure className="export-route-map" aria-label={t('Route map preview')}>
      {!ready && <svg viewBox="0 0 600 200" role="img" aria-label={t('Route outline')}>
        {geometry.preview.map((segment, index) => <polyline key={index}
          points={segment.map((point) => point.join(',')).join(' ')} fill="none"
          stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />)}
        {geometry.endpoints.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="6"
          fill={index ? '#c75146' : '#26745b'} stroke="white" strokeWidth="2" />)}
      </svg>}
      <div ref={container} className={`export-route-map-canvas${ready ? ' is-ready' : ''}`} />
      {!ready && <figcaption>{t('Route outline · basemap unavailable offline')}</figcaption>}
    </figure>
  );
}
