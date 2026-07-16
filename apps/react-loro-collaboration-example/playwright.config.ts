import { defineConfig, devices } from '@playwright/test'

const projectRoot = import.meta.dirname
const collaborationPort = 4313
const frontendPort = 4314
const chromiumExecutable = process.env.EFFECT_TREE_CHROME_PATH

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
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
        COLLABORATION_PORT: String(collaborationPort),
      },
      url: `http://127.0.0.1:${collaborationPort}/health`,
      reuseExistingServer: process.env.CI !== 'true',
      timeout: 60_000,
    },
    {
      command: `vite --config vite.config.ts --host 127.0.0.1 --port ${frontendPort}`,
      cwd: projectRoot,
      env: {
        ...process.env,
        COLLABORATION_SERVER_URL: `http://127.0.0.1:${collaborationPort}`,
      },
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: process.env.CI !== 'true',
      timeout: 60_000,
    },
  ],
})
