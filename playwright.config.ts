import { defineConfig, devices } from '@playwright/test';
const live = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const localURL = `http://127.0.0.1:${process.env.DICE_CI_PORT ?? '8787'}`;
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 600000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/report.json' }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? localURL,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 900 },
        launchOptions: {
          args: [
            '--enable-webgl',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ],
        },
      },
    },
    {
      name: 'firefox',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 360, height: 800 } },
    },
  ],
  webServer: live
    ? undefined
    : {
        command: process.env.CI ? 'npm run dev:ci' : 'npm run dev',
        url: localURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
