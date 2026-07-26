import { defineConfig, devices } from '@playwright/test'

const projectRoot = import.meta.dirname
const frontendPort = 4311
const apiPort = 4312
const chromiumExecutable = process.env.EFFECT_STATE_TREE_CHROME_PATH

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(chromiumExecutable === undefined
            ? {}
            : { executablePath: chromiumExecutable }),
        },
      },
    },
  ],
  webServer: [
    {
      command: 'bun src/server/main.ts',
      cwd: projectRoot,
      env: {
        ...process.env,
        TODO_API_PORT: String(apiPort),
      },
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: process.env.CI !== 'true',
      timeout: 60_000,
    },
    {
      command: `rsbuild dev --config rsbuild.config.ts --host 127.0.0.1 --port ${frontendPort}`,
      cwd: projectRoot,
      env: {
        ...process.env,
        PUBLIC_TODO_API_URL: `http://127.0.0.1:${apiPort}`,
      },
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: process.env.CI !== 'true',
      timeout: 60_000,
    },
  ],
})
