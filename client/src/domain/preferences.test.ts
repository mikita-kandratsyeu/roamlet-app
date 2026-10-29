import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n, { LANGUAGE_KEY } from '../i18n';
import { THEME_STORAGE_KEY } from '../theme';
import { MAP_VIEW_KEY } from './mapView';
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  resetPreferences,
  PREFERENCES_KEY,
  PREFERENCES_CHANGE_EVENT,
  PREFERENCES_ERROR_EVENT,
} from './preferences';

let storage: Map<string, string>;
let changed: ReturnType<typeof vi.fn>;
let failed: ReturnType<typeof vi.fn>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  changed = vi.fn();
  failed = vi.fn();
  window.addEventListener(PREFERENCES_CHANGE_EVENT, changed);
  window.addEventListener(PREFERENCES_ERROR_EVENT, failed);
});
afterEach(() => {
  window.removeEventListener(PREFERENCES_CHANGE_EVENT, changed);
  window.removeEventListener(PREFERENCES_ERROR_EVENT, failed);
  vi.unstubAllGlobals();
});
it('exports isolated defaults and merges the existing language/theme/camera storage', () => {
  storage.set(THEME_STORAGE_KEY, 'dark');
  storage.set(LANGUAGE_KEY, 'ru');
  const camera = { center: [12, 48], zoom: 8, bearing: 10, pitch: 0 };
  storage.set(MAP_VIEW_KEY, JSON.stringify(camera));
  const loaded = loadPreferences();
  expect(loaded).toMatchObject({ ...DEFAULT_PREFERENCES, theme: 'dark', language: 'ru', camera });
  loaded.speeds.cycling = 1;
  loaded.library.query = 'changed';
  expect(loadPreferences().speeds.cycling).toBe(18);
  expect(DEFAULT_PREFERENCES.library.query).toBe('');
});
it('saves validated patches in a versioned envelope without redundant legacy stores or URLs', () => {
  expect(
    savePreferences({ targetKm: 34, speeds: { cycling: 22, hiking: 4 }, style: 'custom' }),
  ).toBe(true);
  expect(savePreferences({ panelHidden: true })).toBe(true);
  expect(loadPreferences()).toMatchObject({ targetKm: 34, panelHidden: true, style: 'custom' });
  const record = JSON.parse(storage.get(PREFERENCES_KEY)!);
  expect(record.version).toBe(1);
  expect(record.preferences).not.toHaveProperty('theme');
  expect(record.preferences).not.toHaveProperty('language');
  expect(record.preferences).not.toHaveProperty('camera');
  expect(storage.size).toBe(1);
  expect(changed).toHaveBeenCalledTimes(2);
});
it('delegates theme/language/camera saves to their existing keys and syncs current language', () => {
  const camera = { center: [12, 48] as [number, number], zoom: 8, bearing: 10, pitch: 0 };
  expect(savePreferences({ theme: 'dark', language: 'ru', camera })).toBe(true);
  expect(storage.get(THEME_STORAGE_KEY)).toBe('dark');
  expect(storage.get(LANGUAGE_KEY)).toBe('ru');
  expect(JSON.parse(storage.get(MAP_VIEW_KEY)!)).toEqual(camera);
  expect(i18n.language).toBe('ru');
});
it.each([
  { targetKm: 0 },
  { targetKm: Infinity },
  { stopsMinutes: -1 },
  { speeds: { cycling: NaN, hiking: 5 } },
  { panelHidden: 'true' },
  { style: 'https://secret.invalid/style?key=secret' },
  { library: { ...DEFAULT_PREFERENCES.library, sort: 'invalid' } },
  { library: { ...DEFAULT_PREFERENCES.library, minKm: 'invalid' } },
  { camera: { ...DEFAULT_PREFERENCES.camera, center: [181, 0] } },
])('rejects invalid patches without changing persisted state: %j', (patch) => {
  expect(savePreferences(patch as Parameters<typeof savePreferences>[0])).toBe(false);
  expect(storage.size).toBe(0);
  expect(failed).toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});
it.each([
  '{',
  JSON.stringify({ version: 2, preferences: {} }),
  JSON.stringify({ version: 1, preferences: null }),
  JSON.stringify({ version: 1, preferences: { targetKm: -5 } }),
])('loads safe defaults and reports malformed or unsupported storage: %s', (raw) => {
  storage.set(PREFERENCES_KEY, raw);
  expect(loadPreferences()).toMatchObject({
    activity: 'cycling',
    targetKm: 20,
    speeds: { cycling: 18, hiking: 5 },
  });
  expect(failed).toHaveBeenCalled();
});
it('reports invalid legacy values without overwriting them', () => {
  storage.set(THEME_STORAGE_KEY, 'unknown');
  storage.set(LANGUAGE_KEY, 'xx');
  storage.set(MAP_VIEW_KEY, '{');
  expect(loadPreferences()).toMatchObject({ theme: 'system', language: 'en' });
  expect(failed).toHaveBeenCalled();
  expect(storage.get(MAP_VIEW_KEY)).toBe('{');
});
it('resets only preferences and legacy keys, including current language without recreating its key', () => {
  savePreferences({
    language: 'ru',
    theme: 'dark',
    targetKm: 42,
    camera: DEFAULT_PREFERENCES.camera,
  });
  storage.set('roamlet:draft:v1', 'draft');
  storage.set('routes', 'routes');
  changed.mockClear();
  expect(resetPreferences()).toBe(true);
  expect([...storage.entries()]).toEqual([
    ['roamlet:draft:v1', 'draft'],
    ['routes', 'routes'],
  ]);
  expect(i18n.language).toBe('en');
  expect(changed).toHaveBeenCalledOnce();
});
it('reports blocked writes and rolls back already-written preferences on legacy failures', () => {
  savePreferences({ targetKm: 27 });
  const previous = storage.get(PREFERENCES_KEY);
  changed.mockClear();
  vi.mocked(localStorage.setItem).mockImplementation((key: string, value: string) => {
    if (key === THEME_STORAGE_KEY) throw new Error('denied');
    storage.set(key, value);
  });
  expect(savePreferences({ targetKm: 80, theme: 'dark' })).toBe(false);
  expect(storage.get(PREFERENCES_KEY)).toBe(previous);
  expect(changed).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalled();
});
it('rolls back a partial reset and emits no successful reset when removal fails', () => {
  savePreferences({ targetKm: 27, theme: 'dark' });
  changed.mockClear();
  vi.mocked(localStorage.removeItem).mockImplementation((key: string) => {
    if (key === THEME_STORAGE_KEY) throw new Error('denied');
    storage.delete(key);
  });
  expect(resetPreferences()).toBe(false);
  expect(loadPreferences()).toMatchObject({ targetKm: 27, theme: 'dark' });
  expect(changed).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalled();
});

it('migrates old preferences without losing custom speed or stop values and persists fitness once', () => {
  storage.set(
    PREFERENCES_KEY,
    JSON.stringify({
      version: 1,
      preferences: { speeds: { cycling: 12.5, hiking: 4.8 }, stopsMinutes: 15 },
    }),
  );
  expect(loadPreferences()).toMatchObject({
    speeds: { cycling: 12.5, hiking: 4.8 },
    stopsMinutes: 15,
    fitness: 'regular',
  });
  expect(savePreferences({ fitness: 'trained' })).toBe(true);
  expect(loadPreferences()).toMatchObject({
    speeds: { cycling: 12.5, hiking: 4.8 },
    stopsMinutes: 15,
    fitness: 'trained',
  });
  expect(JSON.parse(storage.get(PREFERENCES_KEY)!).preferences).not.toHaveProperty('surface');
  expect(storage.size).toBe(1);
  expect(savePreferences({ fitness: 'expert' } as never)).toBe(false);
  expect(loadPreferences().fitness).toBe('trained');
});

it('defaults unsupported stored fitness without losing existing valid custom speeds', () => {
  storage.set(
    PREFERENCES_KEY,
    JSON.stringify({
      version: 1,
      preferences: { speeds: { cycling: 12.5, hiking: 4.8 }, stopsMinutes: 15, fitness: 'expert' },
    }),
  );
  expect(loadPreferences()).toMatchObject({
    speeds: { cycling: 12.5, hiking: 4.8 },
    stopsMinutes: 15,
    fitness: 'regular',
  });
  expect(failed).toHaveBeenCalled();
});
