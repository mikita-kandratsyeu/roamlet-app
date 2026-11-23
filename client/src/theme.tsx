import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type Look = 'default' | 'vice';
export const THEME_STORAGE_KEY = 'roamlet-theme';
export const LOOK_STORAGE_KEY = 'roamlet-look';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function isLook(value: unknown): value is Look {
  return value === 'default' || value === 'vice';
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

export function storedLook(): Look {
  try {
    const value = localStorage.getItem(LOOK_STORAGE_KEY);
    return isLook(value) ? value : 'default';
  } catch {
    return 'default';
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

export function saveLook(look: Look): boolean {
  if (!isLook(look)) return false;
  try {
    localStorage.setItem(LOOK_STORAGE_KEY, look);
    return true;
  } catch {
    return false;
  }
}

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

function applyLook(look: Look) {
  if (look === 'vice') document.documentElement.setAttribute('data-look', 'vice');
  else document.documentElement.removeAttribute('data-look');
}

const ThemeContext = createContext<{
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  look: Look;
  setTheme: (theme: Theme) => void;
  setLook: (look: Look) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(storedTheme);
  const [look, updateLook] = useState<Look>(storedLook);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolvedTheme = theme === 'system' ? system : theme;

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    applyLook(look);
  }, [look]);

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
      if (event.key === LOOK_STORAGE_KEY || event.key === null) {
        updateLook(isLook(event.newValue) ? event.newValue : 'default');
      }
    };
    const preferences = () => {
      updateTheme(storedTheme());
      updateLook(storedLook());
    };
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

  function setLook(value: Look) {
    updateLook(value);
    applyLook(value);
    if (saveLook(value))
      window.dispatchEvent(
        new CustomEvent('roamlet-preferences-change', { detail: { patch: { look: value } } }),
      );
    else window.dispatchEvent(new Event('roamlet-preferences-error'));
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, look, setTheme, setLook }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function routeLineColors(resolvedTheme: ResolvedTheme, look: Look) {
  if (look === 'vice') {
    return resolvedTheme === 'dark'
      ? { line: '#ff4fd8', casing: '#120814' }
      : { line: '#e0127a', casing: '#fff8f4' };
  }
  return resolvedTheme === 'dark'
    ? { line: '#9bc5a7', casing: '#151b18' }
    : { line: '#286046', casing: '#ffffff' };
}

export function useTheme() {
  const context = useContext(ThemeContext);
  // Standalone consumers (including existing App tests) remain safe without a provider.
  return (
    context ?? {
      theme: 'system' as const,
      resolvedTheme: systemTheme(),
      look: 'default' as const,
      setTheme: () => {},
      setLook: () => {},
    }
  );
}