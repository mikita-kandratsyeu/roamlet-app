import { afterEach, expect, it, vi } from 'vitest';

const storageKey = 'roamlet-test-storage';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem(storageKey);
  sessionStorage.removeItem(storageKey);
});

it.each(['localStorage', 'sessionStorage'] as const)(
  'uses isolated browser %s rather than native Node storage',
  (name) => {
    const storage = globalThis[name];
    expect(storage).toBeInstanceOf(Storage);
    storage.setItem(storageKey, 'browser value');
    expect(storage.getItem(storageKey)).toBe('browser value');
    expect(
      globalThis[name === 'localStorage' ? 'sessionStorage' : 'localStorage'].getItem(storageKey),
    ).toBeNull();

    vi.stubGlobal(name, undefined);
    vi.unstubAllGlobals();
    expect(globalThis[name]).toBe(storage);
    expect(globalThis[name].getItem(storageKey)).toBe('browser value');
  },
);
