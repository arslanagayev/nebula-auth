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
    // Vitest stubs stylesheets by default; the palette test reads the design tokens.
    css: { include: [/tokens\.css/u] },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Rendering code needs a real GPU context and is exercised in the browser. The scene's
      // behaviour lives in lib/sceneMotion.ts, and its pure helpers are covered below.
      exclude: [
        'src/main.ts',
        'src/scene/NebulaScene.ts',
        'src/scene/core.ts',
        'src/scene/galaxy.ts',
        'src/scene/postprocessing.ts',
        'src/scene/starfield.ts',
        'src/scene/textures.ts',
      ],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        'src/lib/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/core/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/ui/**': { lines: 90, statements: 90, functions: 90, branches: 75 },
        'src/scene/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
      },
    },
  },
}));
