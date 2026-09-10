import { defineConfig } from '@playwright/test';

// Real-browser tests for widget/Shadow-DOM rendering behavior — see
// tests/e2e/README.md before writing the first one here.
export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npx serve . -l 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:4173',
  },
});
