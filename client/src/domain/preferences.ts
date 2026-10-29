import { detectLanguage, LANGUAGE_KEY, saveLanguage } from '../i18n';
import { isFitness, type Fitness } from './time';
import { isTheme, saveTheme, storedTheme, THEME_STORAGE_KEY, type Theme } from '../theme';
import { initialMapView, MAP_VIEW_KEY, saveMapView, validMapView, type MapView } from './mapView';

import type { RoutingOptions } from './types';
import { DEFAULT_ROUTING_OPTIONS, validRoutingOptions } from './routingOptions';

export type MapStyle = 'standard' | 'bright' | 'custom';
export interface Preferences {
  activity: 'cycling' | 'hiking';
  planningMode: 'point' | 'loop' | 'manual';
  targetKm: number;
  speeds: { cycling: number; hiking: number };
  stopsMinutes: number;
  fitness: Fitness;
  routingOptions: RoutingOptions;
  panelHidden: boolean;
  collapsed: boolean;
  library: {
    sort: 'updated' | 'name' | 'distance';
    query: string;
    activity: 'all' | 'cycling' | 'hiking';
    favoriteOnly: boolean;
    tag: string;
    minKm: string;
    maxKm: string;
  };
  style: MapStyle;
  theme: Theme;
  language: 'en' | 'ru';
  camera: MapView;
}
export const PREFERENCES_KEY = 'roamlet:preferences:v1';
export const PREFERENCES_CHANGE_EVENT = 'roamlet-preferences-change';
export const PREFERENCES_ERROR_EVENT = 'roamlet-preferences-error';
export const DEFAULT_PREFERENCES: Preferences = {
  activity: 'cycling',
  planningMode: 'point',
  targetKm: 20,
  speeds: { cycling: 18, hiking: 5 },
  stopsMinutes: 0,
  fitness: 'regular',
  routingOptions: { ...DEFAULT_ROUTING_OPTIONS },
  panelHidden: false,
  collapsed: false,
  library: {
    sort: 'updated',
    query: '',
    activity: 'all',
    favoriteOnly: false,
    tag: '',
    minKm: '',
    maxKm: '',
  },
  style: 'standard',
  theme: 'system',
  language: 'en',
  camera: { center: [10, 20], zoom: 2, bearing: 0, pitch: 0 },
};
const keys = [PREFERENCES_KEY, THEME_STORAGE_KEY, LANGUAGE_KEY, MAP_VIEW_KEY];
const fields = [
  'activity',
  'planningMode',
  'targetKm',
  'speeds',
  'stopsMinutes',
  'fitness',
  'routingOptions',
  'panelHidden',
  'collapsed',
  'library',
  'style',
] as const;
function persistentFields(value: Partial<Preferences>) {
  return Object.fromEntries(
    fields.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
  );
}
export interface PreferencesChangeDetail {
  patch?: Partial<Preferences>;
  reset?: boolean;
}
function notify(name: string, detail?: PreferencesChangeDetail) {
  window.dispatchEvent(detail ? new CustomEvent(name, { detail }) : new Event(name));
}
const positive = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonnegative = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const distanceFilter = (value: unknown) =>
  typeof value === 'string' &&
  (value === '' || (value.trim() !== '' && nonnegative(Number(value))));
function valid(value: Preferences): boolean {
  const library = value.library;
  return (
    !!value &&
    ['cycling', 'hiking'].includes(value.activity) &&
    ['point', 'loop', 'manual'].includes(value.planningMode) &&
    positive(value.targetKm) &&
    !!value.speeds &&
    positive(value.speeds.cycling) &&
    positive(value.speeds.hiking) &&
    nonnegative(value.stopsMinutes) &&
    isFitness(value.fitness) &&
    validRoutingOptions(value.routingOptions) &&
    typeof value.panelHidden === 'boolean' &&
    typeof value.collapsed === 'boolean' &&
    !!library &&
    ['updated', 'name', 'distance'].includes(library.sort) &&
    typeof library.query === 'string' &&
    ['all', 'cycling', 'hiking'].includes(library.activity) &&
    typeof library.favoriteOnly === 'boolean' &&
    typeof library.tag === 'string' &&
    distanceFilter(library.minKm) &&
    distanceFilter(library.maxKm) &&
    ['standard', 'bright', 'custom'].includes(value.style) &&
    isTheme(value.theme) &&
    ['en', 'ru'].includes(value.language) &&
    validMapView(value.camera)
  );
}
export function loadPreferences(): Preferences {
  const defaults = structuredClone(DEFAULT_PREFERENCES);
  defaults.theme = storedTheme();
  defaults.language = detectLanguage();
  defaults.camera = initialMapView();
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    const language = localStorage.getItem(LANGUAGE_KEY);
    const camera = localStorage.getItem(MAP_VIEW_KEY);
    if (
      (theme !== null && !isTheme(theme)) ||
      (language !== null && language !== 'en' && language !== 'ru') ||
      (camera !== null && !validMapView(JSON.parse(camera)))
    )
      notify(PREFERENCES_ERROR_EVENT);
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return defaults;
    const record: unknown = JSON.parse(raw);
    if (
      !record ||
      typeof record !== 'object' ||
      !('version' in record) ||
      record.version !== 1 ||
      !('preferences' in record)
    )
      throw new Error('Invalid preferences');
    if (
      !record.preferences ||
      typeof record.preferences !== 'object' ||
      Array.isArray(record.preferences)
    )
      throw new Error('Invalid preferences');
    const stored = persistentFields(record.preferences);
    if (Object.hasOwn(stored, 'fitness') && !isFitness(stored.fitness)) {
      stored.fitness = defaults.fitness;
      notify(PREFERENCES_ERROR_EVENT);
    }
    const merged = {
      ...defaults,
      ...stored,
      theme: defaults.theme,
      language: defaults.language,
      camera: defaults.camera,
    };
    if (!valid(merged)) throw new Error('Invalid preferences');
    return merged;
  } catch {
    notify(PREFERENCES_ERROR_EVENT);
    return defaults;
  }
}
function transaction(write: () => void, detail: PreferencesChangeDetail): boolean {
  const previous = new Map<string, string | null>();
  try {
    for (const key of keys) previous.set(key, localStorage.getItem(key));
    write();
  } catch {
    for (const [key, value] of previous) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        /* Storage can become unavailable during rollback. */
      }
    }
    notify(PREFERENCES_ERROR_EVENT);
    return false;
  }
  notify(PREFERENCES_CHANGE_EVENT, detail);
  return true;
}
export function savePreferences(patch: Partial<Preferences>): boolean {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    notify(PREFERENCES_ERROR_EVENT);
    return false;
  }
  const merged = { ...loadPreferences(), ...patch };
  if (!valid(merged)) {
    notify(PREFERENCES_ERROR_EVENT);
    return false;
  }
  return transaction(
    () => {
      // Theme, language and camera keep their existing single source of truth.
      const { theme, language, camera } = merged;
      localStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify({ version: 1, preferences: persistentFields(merged) }),
      );
      if (patch.theme !== undefined && !saveTheme(theme))
        throw new Error('Theme storage unavailable');
      if (patch.language !== undefined && !saveLanguage(language))
        throw new Error('Language storage unavailable');
      if (patch.camera !== undefined && !saveMapView(camera))
        throw new Error('Camera storage unavailable');
    },
    { patch },
  );
}
export function resetPreferences(): boolean {
  return transaction(
    () => {
      for (const key of keys) localStorage.removeItem(key);
    },
    { reset: true },
  );
}
