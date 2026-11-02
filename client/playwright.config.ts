import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: [
    'planner.spec.ts',
    'connectors.spec.ts',
    'google-drive.spec.ts',
    'map-view.spec.ts',
    'lifecycle.spec.ts',
    'ui-consistency.spec.ts',
    'route-card.spec.ts',
    'time-model.spec.ts',
    'preparation.spec.ts',
    'routing-tools.spec.ts',
    'mobile-ergonomics.spec.ts',
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--enable-webgl',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'yarn dev --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    env: {
      ORS_API_KEY: 'test-only-not-a-real-ors-key',
      VITE_MAP_STYLE: '/__fixtures__/map-style.json',
    },
  },
});
