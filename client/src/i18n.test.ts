import { afterEach, expect, it, vi } from 'vitest';
import i18n, { detectLanguage, formatNumber, LANGUAGE_KEY, translateMessage } from './i18n';
import { formatDistance, formatDuration } from './components/Statistics';
import { importGpx } from './domain/gpx';
import english from './locales/en.json';
import russian from './locales/ru.json';

it('loads complete JSON dictionaries with matching keys and interpolation placeholders', async () => {
  expect(Object.keys(russian).sort()).toEqual(Object.keys(english).sort());
  for (const key of Object.keys(english) as Array<keyof typeof english>) {
    expect(english[key].trim(), key).not.toBe('');
    expect(russian[key].trim(), key).not.toBe('');
    expect(english[key].match(/\{\{[^}]+\}\}/g)?.sort() ?? [], key).toEqual(
      key.match(/\{\{[^}]+\}\}/g)?.sort() ?? [],
    );
    expect(russian[key].match(/\{\{[^}]+\}\}/g)?.sort() ?? [], key).toEqual(
      english[key].match(/\{\{[^}]+\}\}/g)?.sort() ?? [],
    );
  }
  await i18n.changeLanguage('en');
  expect(i18n.t('My routes')).toBe(english['My routes']);
  await i18n.changeLanguage('ru');
  expect(i18n.t('My routes')).toBe(russian['My routes']);
});

it.each([
  ['New route', 'New route', 'Новый маршрут'],
  ['Clear all stops?', 'Clear all stops?', 'Удалить все точки?'],
  ['Clear stops', 'Clear stops', 'Удалить все точки'],
  [
    'This removes all stops and the calculated route. Saved routes are not affected.',
    'This removes all stops and the calculated route. Saved routes are not affected.',
    'Все точки и рассчитанный маршрут будут удалены. Сохранённые маршруты не затрагиваются.',
  ],
  ['Save route', 'Save route', 'Сохранить маршрут'],
  ['Untitled adventure', 'Untitled route', 'Новый маршрут'],
  ['A good route starts somewhere', 'Add a starting point', 'Добавьте начальную точку'],
  ['Your next adventure belongs here', 'No saved routes yet', 'Сохранённых маршрутов пока нет'],
  [
    'Route saved on this device. Your next adventure is ready.',
    'Route saved in this browser on this device.',
    'Маршрут сохранён в этом браузере на этом устройстве.',
  ],
  ['Roamlet — Route planner', 'Roamlet — Route planner', 'Roamlet — Планировщик маршрутов'],
  [
    'Plan cycling and hiking routes. Save them on your device. Import and export GPX.',
    'Plan cycling and hiking routes. Save them on your device. Import and export GPX.',
    'Планируйте велосипедные и пешие маршруты. Сохраняйте их на своём устройстве. Импортируйте и экспортируйте GPX.',
  ],
])('translates product copy for %s without changing its resource key', async (key, en, ru) => {
  await i18n.changeLanguage('en');
  expect(i18n.t(key)).toBe(en);
  await i18n.changeLanguage('ru');
  expect(i18n.t(key)).toBe(ru);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function storage(saved: string | null = null) {
  const values = new Map<string, string>();
  if (saved !== null) values.set(LANGUAGE_KEY, saved);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
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
    getItem: () => {
      throw new DOMException('Blocked');
    },
    setItem: () => {
      throw new DOMException('Blocked');
    },
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
  expect(translateMessage('Unable to save route data.')).toBe(
    'Не удалось сохранить маршрут. Проверьте доступ к хранилищу браузера и свободное место. Экспортируйте GPX, чтобы оставить копию.',
  );
  expect(translateMessage('Invalid GPX latitude.')).toContain('широта');
  expect(translateMessage('Invalid GPX name: expected text.')).toContain('название');
  expect(translateMessage('Malformed GPX XML: Unexpected tag')).toBe(
    'В файле GPX некорректный XML. Экспортируйте файл заново из исходного приложения.',
  );
  expect(
    translateMessage(
      'No route or location found (service 404). Try points closer to accessible roads or trails, or a shorter route.',
    ),
  ).toContain('404');
  expect(translateMessage('Unknown browser failure')).toBe(
    'Не удалось выполнить действие. Попробуйте ещё раз.',
  );
  await i18n.changeLanguage('en');
  expect(formatDistance(1342)).toBe('1.3 km');
  expect(formatDuration(3900)).toBe('1 h 5 min');
});

it('localizes generated GPX labels without changing imported names', async () => {
  await i18n.changeLanguage('ru');
  const unnamed = importGpx('<gpx><wpt lat="47" lon="11"/></gpx>');
  expect(unnamed.name).toBe('Импортированный маршрут');
  expect(unnamed.waypoints[0].name).toBe('Точка');
  const named = importGpx(
    '<gpx><metadata><name>My trip</name></metadata><wpt lat="47" lon="11"><name>Cafe</name></wpt></gpx>',
  );
  expect(named.name).toBe('My trip');
  expect(named.waypoints[0].name).toBe('Cafe');
});
