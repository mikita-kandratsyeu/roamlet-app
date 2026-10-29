import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'versioned-offline-shell',
    apply: 'build',
    generateBundle(_, bundle) {
      const revision = createHash('sha256').update(Object.keys(bundle).sort().join('|')).digest('hex').slice(0, 16);
      const worker = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker.replace('__BUILD_REVISION__', revision) });
    },
  }],
  build: { manifest: 'assets/manifest.json' },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
