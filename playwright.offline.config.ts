import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'offline.spec.ts', workers: 1, timeout: 40_000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4175', trace: 'retain-on-failure', launchOptions: { args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'yarn build && yarn preview --port 4175 --strictPort', url: 'http://127.0.0.1:4175', timeout: 120_000, reuseExistingServer: false, env: { VITE_ORS_API_KEY: '' } },
});
