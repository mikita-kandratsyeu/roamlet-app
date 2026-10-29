export interface MapView {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}
export const MAP_VIEW_KEY = 'roamlet:map-view:v1';
const view = (longitude: number, latitude: number, zoom = 5): MapView => ({
  center: [longitude, latitude],
  zoom,
  bearing: 0,
  pitch: 0,
});
const world = () => view(10, 20, 2);

// Regional starting views are heuristics, not measurements of the user's position.
const timeZones: Record<string, MapView> = {
  'Europe/Minsk': view(28, 53.5),
  'Europe/Moscow': view(38, 56),
  'Europe/Kyiv': view(31, 49),
  'Europe/Kiev': view(31, 49),
  'Europe/London': view(-3, 54),
  'Europe/Dublin': view(-8, 53.5),
  'Europe/Paris': view(2.5, 47),
  'Europe/Berlin': view(10.5, 51),
  'Europe/Vienna': view(14, 47.5),
  'Europe/Zurich': view(8.3, 46.8),
  'Europe/Warsaw': view(19, 52),
  'Europe/Vilnius': view(24, 55),
  'Europe/Riga': view(25, 57),
  'Europe/Tallinn': view(25.5, 59),
  'Europe/Madrid': view(-3.5, 40),
  'Europe/Lisbon': view(-8, 39.5),
  'Europe/Rome': view(12.5, 43),
  'Europe/Helsinki': view(25, 63, 4),
  'Europe/Stockholm': view(16, 62, 4),
  'Europe/Oslo': view(10, 63, 4),
  'America/New_York': view(-75, 40, 4),
  'America/Chicago': view(-91, 40, 4),
  'America/Denver': view(-107, 40, 4),
  'America/Los_Angeles': view(-120, 38, 4),
  'America/Toronto': view(-80, 45, 4),
  'America/Vancouver': view(-123, 50, 4),
  'America/Mexico_City': view(-102, 23, 4),
  'America/Sao_Paulo': view(-48, -23, 4),
  'America/Argentina/Buenos_Aires': view(-64, -35, 4),
  'Asia/Tokyo': view(138, 37, 4),
  'Asia/Seoul': view(128, 36),
  'Asia/Shanghai': view(105, 35, 3),
  'Asia/Kolkata': view(79, 23, 4),
  'Asia/Calcutta': view(79, 23, 4),
  'Asia/Dubai': view(54, 24.5),
  'Asia/Singapore': view(103.8, 1.35, 8),
  'Asia/Bangkok': view(101, 15, 4),
  'Australia/Sydney': view(148, -33, 4),
  'Australia/Melbourne': view(145, -37, 4),
  'Australia/Perth': view(117, -30, 4),
  'Pacific/Auckland': view(173, -41, 4),
  'Africa/Johannesburg': view(25, -29, 4),
  'Africa/Cairo': view(30, 27, 4),
};
const regions: Record<string, MapView> = {
  BY: view(28, 53.5),
  RU: view(60, 57, 3),
  UA: view(31, 49),
  GB: view(-3, 54),
  IE: view(-8, 53.5),
  DE: view(10.5, 51),
  AT: view(14, 47.5),
  CH: view(8.3, 46.8),
  FR: view(2.5, 47),
  PL: view(19, 52),
  LT: view(24, 55),
  LV: view(25, 57),
  EE: view(25.5, 59),
  ES: view(-3.5, 40),
  PT: view(-8, 39.5),
  IT: view(12.5, 43),
  NL: view(5.5, 52),
  BE: view(4.5, 50.8),
  CZ: view(15.5, 49.8),
  US: view(-98, 39, 3),
  CA: view(-105, 56, 3),
  MX: view(-102, 23, 4),
  BR: view(-52, -14, 3),
  AR: view(-64, -35, 4),
  JP: view(138, 37, 4),
  KR: view(128, 36),
  CN: view(105, 35, 3),
  IN: view(79, 23, 4),
  AU: view(134, -26, 3),
  NZ: view(173, -41, 4),
  ZA: view(25, -29, 4),
};
const languages: Record<string, MapView> = {
  be: regions.BY,
  uk: regions.UA,
  de: view(10, 49, 4),
  fr: view(2.5, 47, 4),
  pl: regions.PL,
  lt: regions.LT,
  lv: regions.LV,
  et: regions.EE,
  ja: regions.JP,
  ko: regions.KR,
};
export function approximateMapView(timeZone: string, browserLanguages: readonly string[]): MapView {
  if (Object.hasOwn(timeZones, timeZone)) return structuredClone(timeZones[timeZone]);
  // Do not interpret UTC offsets as longitude: many locations share the same offset.
  if (timeZone.startsWith('Europe/')) return view(15, 52, 3);
  if (timeZone.startsWith('Australia/')) return structuredClone(regions.AU);
  if (timeZone.startsWith('Asia/')) return view(90, 30, 2.5);
  if (timeZone.startsWith('Africa/')) return view(20, 0, 2.5);
  for (const language of browserLanguages) {
    try {
      const locale = new Intl.Locale(language);
      if (locale.region && regions[locale.region]) return structuredClone(regions[locale.region]);
      if (languages[locale.language]) return structuredClone(languages[locale.language]);
    } catch {
      /* Ignore unsupported browser locale tags and continue to the next preference. */
    }
  }
  return world();
}
export function validMapView(value: unknown): value is MapView {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<MapView>;
  return (
    Array.isArray(v.center) &&
    v.center.length === 2 &&
    v.center.every(Number.isFinite) &&
    Math.abs(v.center[0]) <= 180 &&
    Math.abs(v.center[1]) <= 85.051129 &&
    typeof v.zoom === 'number' &&
    Number.isFinite(v.zoom) &&
    v.zoom >= 0 &&
    v.zoom <= 24 &&
    typeof v.bearing === 'number' &&
    Number.isFinite(v.bearing) &&
    Math.abs(v.bearing) <= 180 &&
    typeof v.pitch === 'number' &&
    Number.isFinite(v.pitch) &&
    v.pitch >= 0 &&
    v.pitch <= 85
  );
}
export function initialMapView(): MapView {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(MAP_VIEW_KEY) || 'null');
    if (validMapView(stored)) return stored;
  } catch {
    /* Storage may be blocked or an older saved view may be malformed. */
  }
  return defaultMapView();
}
export function defaultMapView(): MapView {
  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* Locale fallback works without timezone support. */
  }
  return approximateMapView(
    timeZone,
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
}
export function saveMapView(value: MapView): boolean {
  if (!validMapView(value)) return false;
  try {
    localStorage.setItem(MAP_VIEW_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
