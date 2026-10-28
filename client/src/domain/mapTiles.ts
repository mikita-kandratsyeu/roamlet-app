export const DEFAULT_MAPBOX_STYLE = 'mapbox://styles/mapbox/outdoors-v12';
export const MAPBOX_TOKEN_REQUIRED_MESSAGE =
  'Set VITE_MAPBOX_ACCESS_TOKEN to a public Mapbox token to display the map. Saved routes and GPX import/export remain available. Offline basemaps are not supported.';

interface MapEnvironment {
  VITE_MAPBOX_ACCESS_TOKEN?: string;
  VITE_MAPBOX_STYLE?: string;
}

export function mapTiles(environment: MapEnvironment) {
  const accessToken = environment.VITE_MAPBOX_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new Error(MAPBOX_TOKEN_REQUIRED_MESSAGE);
  }
  if (!accessToken.startsWith('pk.')) {
    throw new Error(
      'VITE_MAPBOX_ACCESS_TOKEN must be a public Mapbox token (pk.), not a secret token.',
    );
  }
  return {
    accessToken,
    style: environment.VITE_MAPBOX_STYLE?.trim() || DEFAULT_MAPBOX_STYLE,
  };
}
