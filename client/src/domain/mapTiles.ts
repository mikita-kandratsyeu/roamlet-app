export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>';

interface TileEnvironment {
  VITE_TILE_URL?: string;
  VITE_TILE_ATTRIBUTION?: string;
  VITE_TILE_MAX_ZOOM?: string;
}

export function mapTiles(environment: TileEnvironment) {
  const url = environment.VITE_TILE_URL?.trim() || OSM_TILE_URL;
  const attribution = environment.VITE_TILE_ATTRIBUTION?.trim();
  if (url !== OSM_TILE_URL && !attribution) {
    throw new Error('Set VITE_TILE_ATTRIBUTION to the tile provider’s required credits.');
  }
  return {
    url,
    attribution: attribution || OSM_ATTRIBUTION,
    maxZoom: Number(environment.VITE_TILE_MAX_ZOOM) || 19,
    isOpenStreetMap: url === OSM_TILE_URL,
  };
}
