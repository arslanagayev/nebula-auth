import { defineConfig } from 'vitest/config';

/**
 * GitHub Pages serves project sites from `/<repo>/`. The deploy workflow passes the
 * exact path reported by `actions/configure-pages`, so forks with another name work too.
 */
const PAGES_BASE = process.env.BASE_PATH ?? '/nebula-auth/';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? PAGES_BASE : '/',
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js is ~600 kB minified. It only ships in the lazily imported scene chunk,
    // which loads after the form is already interactive.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The WebGL layer needs a real GPU context; it is exercised manually in the browser.
      exclude: ['src/main.ts', 'src/scene/**'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        'src/lib/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/core/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
      },
    },
  },
}));
