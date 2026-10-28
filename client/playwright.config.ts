import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'planner.spec.ts', fullyParallel: false, workers: 1, timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure', launchOptions: { args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'yarn dev --port 4174 --strictPort', url: 'http://127.0.0.1:4174', reuseExistingServer: false },
});
