import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_STYLE, mapTiles } from './mapTiles';
import standardStyle from '../../public/osm-standard.json';

describe('MapLibre map configuration', () => {
  it('uses the local OpenStreetMap raster style without credentials by default', () => {
    expect(mapTiles({})).toEqual({ style: DEFAULT_MAP_STYLE });
    expect(DEFAULT_MAP_STYLE).toBe('/osm-standard.json');
  });
  it('uses standard OSM tiles with visible attribution and native tile dimensions', () => {
    expect(standardStyle.version).toBe(8);
    expect(standardStyle.sources.osm).toEqual({
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    expect(standardStyle.layers).toEqual([
      { id: 'osm-standard', type: 'raster', source: 'osm' },
    ]);
  });
  it('trims the configured style and treats blank values as the default', () => {
    expect(mapTiles({ VITE_MAP_STYLE: ' https://maps.example/style.json ' })).toEqual({
      style: 'https://maps.example/style.json',
    });
    expect(mapTiles({ VITE_MAP_STYLE: ' ' }).style).toBe(DEFAULT_MAP_STYLE);
  });
  it.each(['/style.json', 'http://localhost:5173/style.json'])(
    'supports local style %s without a Mapbox token',
    (style) => expect(mapTiles({ VITE_MAP_STYLE: style })).toEqual({ style }),
  );
  it.each([
    'mapbox://styles/mapbox/outdoors-v12',
    'javascript:alert(1)',
    '//example.com/style.json',
    'style.json',
    'https://user:secret@example.com/style.json',
    '/\\\\example.com/style.json',
  ])('rejects unsupported style URLs without exposing configuration: %s', (style) => {
    expect(() => mapTiles({ VITE_MAP_STYLE: style })).toThrow('VITE_MAP_STYLE');
    try {
      mapTiles({ VITE_MAP_STYLE: style });
    } catch (error) {
      expect(String(error)).not.toContain(style);
    }
  });
});
