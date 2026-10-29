export const DEFAULT_MAP_STYLE = '/osm-standard.json';
export const BRIGHT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';
export const MAP_STYLE_CONFIGURATION_MESSAGE =
  'Set VITE_MAP_STYLE to an HTTP(S) or root-relative style URL. Saved routes and GPX remain available. Offline basemaps are not supported.';

interface MapEnvironment {
  VITE_MAP_STYLE?: string;
}

export function mapTiles(environment: MapEnvironment) {
  const style = environment.VITE_MAP_STYLE?.trim() || DEFAULT_MAP_STYLE;
  let url: URL;
  try {
    url = new URL(style, 'https://roamlet.invalid');
  } catch {
    throw new Error(MAP_STYLE_CONFIGURATION_MESSAGE);
  }
  if (
    !(/^https?:\/\//i.test(style) || (style.startsWith('/') && !style.startsWith('//'))) ||
    !['http:', 'https:'].includes(url.protocol) ||
    style.includes('\\') ||
    url.username ||
    url.password
  ) {
    throw new Error(MAP_STYLE_CONFIGURATION_MESSAGE);
  }
  return { style };
}
