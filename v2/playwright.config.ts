import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 2,
  timeout: 45000,
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'uv run uvicorn code_groove.app:app --app-dir apps/backend --port 8080',
          url: 'http://127.0.0.1:8080/healthz',
          reuseExistingServer: !process.env.CI,
          env: {
            MODEL_MODE: 'fixture',
            STORE_MODE: 'local',
            ENVIRONMENT: 'local',
            APP_ROLE: 'web',
            ENABLE_LIVE_ANALYSIS: 'false',
            GOOGLE_CLOUD_API_KEY: '',
            FIREBASE_API_KEY: '',
            FIREBASE_AUTH_DOMAIN: '',
            FIREBASE_APP_ID: '',
          },
        },
        { command: 'pnpm dev:web', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
      ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
