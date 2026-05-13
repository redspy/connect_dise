import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  use: {
    ignoreHTTPSErrors: true,
    headless: true,
  },
  reporter: [['html', { open: 'never' }], ['line']],
});
