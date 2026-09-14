import { defineConfig } from 'vitest/config';

// Mirrors widget-studio/vitest.config.js. Needed from the moment this package gained
// its first Playwright spec (the Rotary rebuild's ticket 02): Vitest's default include
// globs `**/*.spec.js` too, so without this it tries to run tests/e2e/*.spec.js as unit
// tests and fails on the @playwright/test import. `npm run test:e2e` runs those.
// node_modules/dist are restated because specifying `exclude` replaces Vitest's own
// default exclude list rather than adding to it.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
});
