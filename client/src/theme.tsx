import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'roamlet-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(theme: Theme): boolean {
  if (!isTheme(theme)) return false;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

const ThemeContext = createContext<{
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(storedTheme);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolvedTheme = theme === 'system' ? system : theme;

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    let media: MediaQueryList | undefined;
    const change = () => setSystem(systemTheme());
    try {
      media = window.matchMedia(DARK_QUERY);
      change();
      if (media.addEventListener) media.addEventListener('change', change);
      else media.addListener(change);
    } catch {
      // Browsers without matchMedia retain the light fallback.
    }
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        updateTheme(isTheme(event.newValue) ? event.newValue : 'system');
      }
    };
    const preferences = () => updateTheme(storedTheme());
    window.addEventListener('roamlet-preferences-change', preferences);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('roamlet-preferences-change', preferences);
      if (media?.removeEventListener) media.removeEventListener('change', change);
      else media?.removeListener(change);
      window.removeEventListener('storage', sync);
    };
  }, []);

  function setTheme(value: Theme) {
    updateTheme(value);
    applyTheme(value === 'system' ? systemTheme() : value);
    if (saveTheme(value))
      window.dispatchEvent(
        new CustomEvent('roamlet-preferences-change', { detail: { patch: { theme: value } } }),
      );
    else window.dispatchEvent(new Event('roamlet-preferences-error'));
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  // Standalone consumers (including existing App tests) remain safe without a provider.
  return context ?? { theme: 'system' as const, resolvedTheme: systemTheme(), setTheme: () => {} };
}
