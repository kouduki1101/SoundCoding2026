import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: /\.spec\.ts$/,
  timeout: 30000,
  fullyParallel: false,
  reporter: 'list',
  webServer: {
    command: 'node runner.mjs',
    cwd: import.meta.dirname,
    url: 'http://127.0.0.1:4174/api/catalog',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
  },
});
