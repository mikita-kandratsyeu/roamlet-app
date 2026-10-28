import { afterEach, expect, it, vi } from 'vitest';
import i18n, { detectLanguage, formatNumber, LANGUAGE_KEY, translateMessage } from './i18n';
import { formatDistance, formatDuration } from './components/Statistics';
import { importGpx } from './domain/gpx';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function storage(saved: string | null = null) {
  const values = new Map<string, string>();
  if (saved !== null) values.set(LANGUAGE_KEY, saved);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
}

it('detects Russian navigator settings, honors saved preference, and falls back to English', () => {
  storage();
  vi.stubGlobal('navigator', { languages: ['ru-RU'], language: 'ru-RU' });
  expect(detectLanguage()).toBe('ru');
  localStorage.setItem(LANGUAGE_KEY, 'en');
  expect(detectLanguage()).toBe('en');
  localStorage.setItem(LANGUAGE_KEY, 'unsupported');
  vi.stubGlobal('navigator', { languages: ['de-DE'], language: 'de-DE' });
  expect(detectLanguage()).toBe('en');
  vi.stubGlobal('navigator', { language: 'ru' });
  expect(detectLanguage()).toBe('ru');
});

it('continues switching and syncing document language when storage is blocked', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new DOMException('Blocked'); },
    setItem: () => { throw new DOMException('Blocked'); },
  });
  vi.stubGlobal('navigator', { language: 'ru-RU' });
  expect(detectLanguage()).toBe('ru');
  await expect(i18n.changeLanguage('ru')).resolves.toBeDefined();
  expect(document.documentElement.lang).toBe('ru');
  await i18n.changeLanguage('en');
  expect(document.documentElement.lang).toBe('en');
});

it('formats distances, durations, elevations and dynamic errors in the selected locale', async () => {
  await i18n.changeLanguage('ru');
  expect(formatDistance(1342)).toBe('1,3 км');
  expect(formatDuration(3900)).toBe('1 ч 5 мин');
  expect(formatNumber(1234)).toBe(new Intl.NumberFormat('ru-RU').format(1234));
  expect(translateMessage('Unable to save route data.')).toBe('Не удалось сохранить данные маршрута.');
  expect(translateMessage('Invalid GPX latitude.')).toContain('широта');
  expect(translateMessage('Invalid GPX name: expected text.')).toContain('название');
  expect(translateMessage('Malformed GPX XML: Unexpected tag')).toBe('Некорректный XML в GPX.');
  expect(translateMessage('No route or location found (service 404). Try points closer to accessible roads or trails, or a shorter route.')).toContain('404');
  expect(translateMessage('Unknown browser failure')).toBe('Что-то пошло не так. Попробуйте ещё раз.');
  await i18n.changeLanguage('en');
  expect(formatDistance(1342)).toBe('1.3 km');
  expect(formatDuration(3900)).toBe('1 h 5 min');
});

it('localizes generated GPX labels without changing imported names', async () => {
  await i18n.changeLanguage('ru');
  const unnamed = importGpx('<gpx><wpt lat="47" lon="11"/></gpx>');
  expect(unnamed.name).toBe('Импортированный маршрут');
  expect(unnamed.waypoints[0].name).toBe('Путевая точка');
  const named = importGpx('<gpx><metadata><name>My trip</name></metadata><wpt lat="47" lon="11"><name>Cafe</name></wpt></gpx>');
  expect(named.name).toBe('My trip');
  expect(named.waypoints[0].name).toBe('Cafe');
});
