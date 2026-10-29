import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import html from '../index.html?raw';
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from './theme';

let dark = false;
let listeners: Set<() => void>;
let storage: Map<string, string>;
let media: MediaQueryList;

beforeEach(() => {
  dark = false;
  listeners = new Set();
  storage = new Map();
  media = {
    get matches() {
      return dark;
    },
    addEventListener: vi.fn((_type, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type, listener: () => void) => listeners.delete(listener)),
  } as unknown as MediaQueryList;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.removeProperty('color-scheme');
});

function Consumer() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <>
      <output>
        {theme}:{resolvedTheme}
      </output>
      <button onClick={() => setTheme('light')}>Light</button>
      <button onClick={() => setTheme('dark')}>Dark</button>
      <button onClick={() => setTheme('system')}>System</button>
    </>
  );
}

function setup() {
  return render(
    <ThemeProvider>
      <Consumer />
    </ThemeProvider>,
  );
}

function changeOS(value: boolean) {
  act(() => {
    dark = value;
    listeners.forEach((listener) => listener());
  });
}

it('defaults to system and tracks OS changes, including color-scheme', () => {
  setup();
  expect(screen.getByRole('status')).toHaveTextContent('system:light');
  expect(document.documentElement.style.colorScheme).toBe('light');
  changeOS(true);
  expect(screen.getByRole('status')).toHaveTextContent('system:dark');
  expect(document.documentElement).toHaveClass('dark');
  expect(document.documentElement.style.colorScheme).toBe('dark');
  changeOS(false);
  expect(document.documentElement).not.toHaveClass('dark');
});

it.each(['light', 'dark'] as const)(
  'loads and preserves explicit %s despite OS changes',
  (theme) => {
    storage.set(THEME_STORAGE_KEY, theme);
    setup();
    expect(screen.getByRole('status')).toHaveTextContent(`${theme}:${theme}`);
    changeOS(true);
    changeOS(false);
    expect(screen.getByRole('status')).toHaveTextContent(`${theme}:${theme}`);
  },
);

it('persists selections and returns to the current OS preference', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
  expect(storage.get(THEME_STORAGE_KEY)).toBe('dark');
  expect(document.documentElement).toHaveClass('dark');
  changeOS(true);
  fireEvent.click(screen.getByRole('button', { name: 'Light' }));
  expect(document.documentElement).not.toHaveClass('dark');
  fireEvent.click(screen.getByRole('button', { name: 'System' }));
  expect(storage.get(THEME_STORAGE_KEY)).toBe('system');
  expect(screen.getByRole('status')).toHaveTextContent('system:dark');
});

it('ignores invalid stored values and syncs changes and deletion from other tabs', () => {
  storage.set(THEME_STORAGE_KEY, 'invalid');
  setup();
  expect(screen.getByRole('status')).toHaveTextContent('system:light');
  act(() =>
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' })),
  );
  expect(screen.getByRole('status')).toHaveTextContent('dark:dark');
  act(() =>
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'light' })),
  );
  expect(screen.getByRole('status')).toHaveTextContent('dark:dark');
  act(() =>
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: null })),
  );
  expect(screen.getByRole('status')).toHaveTextContent('system:light');
});

it('remains usable when storage access or persistence throws', () => {
  vi.mocked(localStorage.getItem).mockImplementation(() => {
    throw new Error('denied');
  });
  vi.mocked(localStorage.setItem).mockImplementation(() => {
    throw new Error('denied');
  });
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
  expect(screen.getByRole('status')).toHaveTextContent('dark:dark');
  expect(document.documentElement).toHaveClass('dark');
});

it('handles a missing matchMedia and supplies a safe standalone consumer fallback', () => {
  vi.stubGlobal('matchMedia', undefined);
  const view = setup();
  expect(screen.getByRole('status')).toHaveTextContent('system:light');
  view.unmount();
  render(<Consumer />);
  expect(screen.getByRole('status')).toHaveTextContent('system:light');
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
  expect(screen.getByRole('status')).toHaveTextContent('system:light');
});

it('cleans up subscriptions under StrictMode', () => {
  const view = render(
    <StrictMode>
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>
    </StrictMode>,
  );
  expect(listeners.size).toBe(1);
  view.unmount();
  expect(listeners.size).toBe(0);
});

it.each([
  ['dark', false, true],
  ['light', true, false],
  ['system', true, true],
  ['invalid', true, true],
  [null, false, false],
] as const)(
  'applies flash-free bootstrap for stored %s / OS dark %s',
  (stored, osDark, expectedDark) => {
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    new Function('document', 'localStorage', 'window', script!)(
      document,
      { getItem: () => stored },
      { matchMedia: () => ({ matches: osDark }) },
    );
    expect(document.documentElement.classList.contains('dark')).toBe(expectedDark);
    expect(document.documentElement.style.colorScheme).toBe(expectedDark ? 'dark' : 'light');
  },
);

it('bootstrap uses the OS when localStorage is denied', () => {
  new Function(
    'document',
    'localStorage',
    'window',
    html.match(/<script>([\s\S]*?)<\/script>/)![1],
  )(
    document,
    {
      getItem: () => {
        throw new Error('denied');
      },
    },
    { matchMedia: () => ({ matches: true }) },
  );
  expect(document.documentElement).toHaveClass('dark');
});

it('applies same-tab preference changes and reset without recreating the removed theme key', () => {
  storage.set(THEME_STORAGE_KEY, 'dark');
  setup();
  expect(screen.getByRole('status')).toHaveTextContent('dark:dark');
  storage.set(THEME_STORAGE_KEY, 'light');
  act(() => window.dispatchEvent(new Event('roamlet-preferences-change')));
  expect(screen.getByRole('status')).toHaveTextContent('light:light');
  storage.delete(THEME_STORAGE_KEY);
  act(() => window.dispatchEvent(new Event('roamlet-preferences-change')));
  expect(screen.getByRole('status')).toHaveTextContent('system:light');
  expect(storage.has(THEME_STORAGE_KEY)).toBe(false);
});
