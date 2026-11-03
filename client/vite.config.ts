import { defineConfig } from 'vitest/config';
const localApiModule = new URL('../scripts/local-routing-api.mjs', import.meta.url).href;
const { localRoutingApi } = await import(/* @vite-ignore */ localApiModule);
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    localRoutingApi(),
    {
      name: 'versioned-offline-shell',
      apply: 'build',
      generateBundle: {
        order: 'post',
        async handler(_, bundle) {
          const manifest = bundle['assets/manifest.json'];
          if (manifest?.type === 'asset' && typeof manifest.source === 'string') {
            const entries: Record<string, { file: string }> = JSON.parse(manifest.source);
            const listed = new Set(Object.values(entries).map((entry) => entry.file));
            // Vite emits worker scripts as assets, outside its ordinary chunk manifest.
            for (const name of Object.keys(bundle)) {
              if (name.startsWith('assets/') && name.endsWith('.js') && !listed.has(name))
                entries[`_${name}`] = { file: name };
            }
            manifest.source = JSON.stringify(entries, null, 2);
          }
          const fsModuleName = 'node:fs';
          const { readFileSync } = (await import(fsModuleName)) as {
            readFileSync(path: URL, encoding: string): string;
          };
          const worker = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8');
          const assets = Object.entries(bundle)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(
              ([name, file]) =>
                name +
                (file.type === 'asset' && typeof file.source === 'string' ? file.source : ''),
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
    },
  ],
  worker: {
    format: 'es',
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  build: { manifest: 'assets/manifest.json' },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    environment: 'jsdom',
    // Native Node storage shadows jsdom globals and is not isolated per test file.
    execArgv: ['--no-experimental-webstorage'],
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
