import { describe, expect, it } from 'vitest';
import { mapTiles, OSM_ATTRIBUTION, OSM_TILE_URL } from './mapTiles';

describe('map provider credits', () => {
  it('uses visible linked OpenStreetMap contributor credits by default', () => {
    expect(mapTiles({})).toEqual({ url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION, maxZoom: 19, isOpenStreetMap: true });
    expect(OSM_ATTRIBUTION).toContain('https://www.openstreetmap.org/copyright');
    expect(OSM_ATTRIBUTION).toContain('OpenStreetMap contributors');
    expect(mapTiles({ VITE_TILE_ATTRIBUTION: '   ' }).attribution).toBe(OSM_ATTRIBUTION);
  });
  it('preserves the configured provider’s legal attribution', () => {
    const attribution = '© Example tiles · © OpenStreetMap contributors';
    expect(mapTiles({ VITE_TILE_URL: 'https://tiles.example/{z}/{x}/{y}.png', VITE_TILE_ATTRIBUTION: attribution, VITE_TILE_MAX_ZOOM: '17' })).toEqual({ url: 'https://tiles.example/{z}/{x}/{y}.png', attribution, maxZoom: 17, isOpenStreetMap: false });
  });
  it('does not falsely credit OpenStreetMap for an unknown tile provider', () => {
    expect(() => mapTiles({ VITE_TILE_URL: 'https://tiles.example/{z}/{x}/{y}.png' })).toThrow('VITE_TILE_ATTRIBUTION');
  });
});
