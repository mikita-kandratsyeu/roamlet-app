// Browser i18n is an unchanged dependency of the domain parser. Initialize its
// worker-local event target before imports, including bundled/inlined imports.
export function ensureGpxWorkerEnvironment(): void {
  if (typeof window === 'undefined') {
    Object.defineProperty(globalThis, 'window', {
      value: new EventTarget(),
      configurable: true,
    });
  }
}

ensureGpxWorkerEnvironment();
