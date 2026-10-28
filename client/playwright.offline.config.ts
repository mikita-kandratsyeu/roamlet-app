import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'offline.spec.ts',
  workers: 1,
  timeout: 40_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4175',
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
  webServer: {
    command: 'yarn build && yarn workspace @roamlet/proxy start',
    url: 'http://127.0.0.1:4175',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ORS_API_KEY: '',
      MAPBOX_ACCESS_TOKEN: '',
      VITE_MAPBOX_ACCESS_TOKEN: '',
      VITE_MAPBOX_STYLE: '',
      PROXY_PORT: '4175',
    },
  },
});
