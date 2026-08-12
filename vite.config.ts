/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    // The Playwright visual suite (tests/visual) is its own gate in its own
    // CI job; keep Vitest's unit/coverage chain away from it. The defaults
    // are spelled out because setting `exclude` replaces them.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite}.config.*',
      'tests/visual/**',
      // The nodes/sec bench and the Stockfish sparring match are opt-in
      // harnesses (task 3.7): they measure wall time / play minutes-long
      // matches, so they run only via their own vitest configs
      // (vitest.bench.config.ts / vitest.sparring.config.ts), never under
      // npm test, npm run check, or CI.
      'bench/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**'],
      thresholds: {
        'src/core/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
