import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({
  testDir: './',
  testMatch: 'capture-r14.spec.ts',
  timeout: 210000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 900 },
    video: { mode: 'on', size: { width: 1440, height: 900 } },
  },
  webServer: [
    {
      command: 'uv run uvicorn code_groove.app:app --app-dir apps/backend --port 8080',
      cwd: root,
      url: 'http://127.0.0.1:8080/healthz',
      reuseExistingServer: true,
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
    { command: 'pnpm dev:web', cwd: root, url: 'http://127.0.0.1:5173', reuseExistingServer: true },
  ],
});
