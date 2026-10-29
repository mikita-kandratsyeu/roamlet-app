import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import english from './locales/en.json';
import russian from './locales/ru.json';

export const LANGUAGE_KEY = 'roamlet-language';
export function detectLanguage(): 'en' | 'ru' {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    /* Storage can be disabled by browser privacy settings. */
  }
  return typeof navigator !== 'undefined' &&
    (navigator.languages?.[0] || navigator.language)?.toLowerCase().startsWith('ru')
    ? 'ru'
    : 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: english },
    ru: { translation: russian },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'ru'],
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  initImmediate: false,
  showSupportNotice: false,
});
let skipLanguagePersistence = false;
export function saveLanguage(language: 'en' | 'ru'): boolean {
  if (language !== 'en' && language !== 'ru') return false;
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
    return true;
  } catch {
    window.dispatchEvent(new Event('roamlet-preferences-error'));
    return false;
  }
}
window.addEventListener('roamlet-preferences-change', () => {
  const language = detectLanguage();
  if (language === i18n.language) return;
  skipLanguagePersistence = true;
  void i18n.changeLanguage(language);
  skipLanguagePersistence = false;
});
function synchronizeLanguage(language: string) {
  const normalized = language.startsWith('ru') ? 'ru' : 'en';
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalized;
    document.title = i18n.t('Roamlet — Route planner');
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute(
        'content',
        i18n.t('Plan cycling and hiking routes. Save them on your device. Import and export GPX.'),
      );
  }
  if (!skipLanguagePersistence && saveLanguage(normalized)) {
    window.dispatchEvent(
      new CustomEvent('roamlet-preferences-change', {
        detail: { patch: { language: normalized } },
      }),
    );
  }
}
i18n.on('languageChanged', synchronizeLanguage);
synchronizeLanguage(i18n.language);
export const locale = () => (i18n.resolvedLanguage === 'ru' ? 'ru-RU' : 'en-US');
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(locale(), options).format(value);

// Keep domain errors in their original form so active notices can follow language changes.
export function translateMessage(message: string): string {
  if (i18n.exists(message)) return i18n.t(message);
  const status = message.match(/^No route or location found \(service (\d+)\)\./);
  if (status)
    return i18n.t(
      'No route or location found (service {{status}}). Try points closer to accessible roads or trails, or a shorter route.',
      { status: status[1] },
    );
  if (message.startsWith('Malformed GPX XML:')) return i18n.t('Malformed GPX XML.');
  const field = message.match(/^Invalid GPX (.+?)(: expected text\.|\.)$/);
  if (field)
    return i18n.t(
      field[2].startsWith(':') ? 'Invalid GPX {{field}}: expected text.' : 'Invalid GPX {{field}}.',
      { field: i18n.t(field[1]) },
    );
  return i18n.resolvedLanguage === 'ru'
    ? i18n.t('Something went wrong. Please try again.')
    : message;
}
export default i18n;
