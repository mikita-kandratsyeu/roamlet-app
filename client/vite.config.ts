import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'versioned-offline-shell',
      apply: 'build',
      async generateBundle(_, bundle) {
        const fsModuleName = 'node:fs';
        const { readFileSync } = (await import(fsModuleName)) as {
          readFileSync(path: URL, encoding: string): string;
        };
        const worker = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8');
        const assets = Object.entries(bundle)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(
            ([name, file]) =>
              name + (file.type === 'asset' && typeof file.source === 'string' ? file.source : ''),
          )
          .join('|');
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(worker + assets),
        );
        const revision = Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 16);
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: worker.replace('__BUILD_REVISION__', revision),
        });
      },
    },
  ],
  build: { manifest: 'assets/manifest.json' },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
